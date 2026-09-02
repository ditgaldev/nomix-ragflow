import { createHash } from 'node:crypto'
import { basename } from 'node:path'
import type { FileSystem } from '@nomix-ai/nomix-harness/plugin/fs'
import type { RagFlowBusinessClient } from './client.js'
import { BusinessGatewayError } from './errors.js'
import type { Document } from './types.js'

export interface TransferOptions {
  workspaceRoot: string
  maxFileBytes: number
}

export interface DownloadedDocument {
  name: string
  mimeType: string
  bytes: Uint8Array
  sha256: string
}

export function safeTransferName(sourcePath: string, displayName: string | undefined): string {
  const value = displayName ?? basename(sourcePath)
  if (!value || value === '.' || value === '..' || value.includes('/') || value.includes('\\') || value.includes('\0') || value.includes('\r') || value.includes('\n')) {
    throw new TypeError('Upload or artifact displayName must be a plain file name')
  }
  return value
}

async function workspaceTarget(
  fs: FileSystem,
  cwd: string | undefined,
  rootPath: string,
  inputPath: string,
  signal: AbortSignal,
) {
  const root = await fs.resolve(rootPath, { ...(cwd ? { cwd } : {}), signal })
  const target = await fs.resolve(inputPath, { cwd: root.displayPath, signal })
  if (!fs.contains(root, target)) throw new TypeError(`Path escapes the Agent workspace root: ${inputPath}`)
  return { root, target }
}

/** Read an upload only through the Agent filesystem provider. */
export async function uploadWorkspaceDocument(
  fs: FileSystem,
  cwd: string | undefined,
  client: RagFlowBusinessClient,
  options: TransferOptions,
  datasetId: string,
  sourcePath: string,
  displayName: string | undefined,
  signal: AbortSignal,
  idempotencyKey: string,
): Promise<Document[]> {
  const name = safeTransferName(sourcePath, displayName)
  const { root, target } = await workspaceTarget(fs, cwd, options.workspaceRoot, sourcePath, signal)
  const entry = await fs.lstat(sourcePath, { cwd: root.displayPath }, signal)
  if (entry?.type === 'symlink') throw new TypeError(`Symbolic-link uploads are not allowed: ${sourcePath}`)
  if (entry?.type !== 'file') throw new TypeError(`Upload source is not a regular file: ${sourcePath}`)
  if (entry.size !== undefined && entry.size > options.maxFileBytes) {
    throw new BusinessGatewayError(`Upload exceeds the ${options.maxFileBytes}-byte Agent file limit`, {
      code: 'FILE_TOO_LARGE',
      status: 413,
      details: { maxBytes: options.maxFileBytes, actualBytes: entry.size },
      retryable: false,
    })
  }
  const bytes = await fs.readBytes(target, signal, options.maxFileBytes)
  if (bytes.byteLength > options.maxFileBytes) {
    throw new BusinessGatewayError(`Upload exceeds the ${options.maxFileBytes}-byte Agent file limit`, {
      code: 'FILE_TOO_LARGE',
      status: 413,
      details: { maxBytes: options.maxFileBytes, actualBytes: bytes.byteLength },
      retryable: false,
    })
  }
  // Blob owns its data. Reuse the normal ArrayBuffer-backed view and copy only
  // a SharedArrayBuffer-backed provider result, which Blob cannot safely own.
  const blobBytes: Uint8Array<ArrayBuffer> = bytes.buffer instanceof ArrayBuffer
    ? new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    : Uint8Array.from(bytes)
  const body = new Blob([blobBytes])
  return client.documents.upload(datasetId, [{ body, displayName: name }], { signal, idempotencyKey })
}

/**
 * Consume an authorized download with a strict byte cap. Persistence belongs to
 * the Agent-scoped artifact/spill provider, never to the host Node filesystem.
 */
export async function readDownloadedDocument(
  response: Response,
  maxBytes: number,
  requestedName: string,
  signal: AbortSignal,
): Promise<DownloadedDocument> {
  const declaredLength = response.headers.get('content-length')
  if (declaredLength !== null) {
    const parsedLength = Number(declaredLength)
    if (Number.isSafeInteger(parsedLength) && parsedLength > maxBytes) {
      await response.body?.cancel().catch(() => undefined)
      throw new TypeError(`Download exceeds the ${maxBytes}-byte Agent artifact limit`)
    }
  }

  const name = safeTransferName('ragflow-document.bin', requestedName)
  const mimeType = response.headers.get('content-type')?.split(';', 1)[0]?.trim() || 'application/octet-stream'
  const chunks: Uint8Array[] = []
  let total = 0
  const reader = response.body?.getReader()
  const cancelOnAbort = (): void => { void reader?.cancel(signal.reason).catch(() => undefined) }
  signal.addEventListener('abort', cancelOnAbort, { once: true })
  try {
    if (!reader) {
      signal.throwIfAborted()
      const bytes = new Uint8Array(await response.arrayBuffer())
      if (bytes.byteLength > maxBytes) throw new TypeError(`Download exceeds the ${maxBytes}-byte Agent artifact limit`)
      chunks.push(bytes)
      total = bytes.byteLength
    } else {
      while (true) {
        signal.throwIfAborted()
        const next = await reader.read()
        if (next.done) break
        total += next.value.byteLength
        if (total > maxBytes) throw new TypeError(`Download exceeds the ${maxBytes}-byte Agent artifact limit`)
        chunks.push(next.value)
      }
      signal.throwIfAborted()
    }
  } catch (error) {
    await reader?.cancel().catch(() => undefined)
    throw error
  } finally {
    signal.removeEventListener('abort', cancelOnAbort)
    reader?.releaseLock()
  }

  const bytes = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  return {
    name,
    mimeType,
    bytes,
    sha256: createHash('sha256').update(bytes).digest('hex'),
  }
}
