import { createWriteStream, openAsBlob } from 'node:fs'
import { lstat, stat, unlink } from 'node:fs/promises'
import { Readable, Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import type { Context } from '@nomix-ai/cordis'
import type {} from '@nomix-ai/nomix-fs'
import type { Document } from './types.js'
import type { RagFlowClient } from './client.js'

export interface TransferOptions {
  workspaceRoot: string
  maxFileBytes: number
}

function localFilesystemError(operation: string, cause: unknown): Error {
  return new Error(`${operation} requires a local Harness filesystem; this filesystem cannot expose a usable host path`, { cause })
}

async function workspacePath(ctx: Context, rootPath: string, inputPath: string, signal: AbortSignal) {
  const root = await ctx.fs.resolve(rootPath, { signal })
  const target = await ctx.fs.resolve(inputPath, { cwd: rootPath, signal })
  if (!ctx.fs.contains(root, target)) throw new Error(`Path escapes the Harness workspace: ${inputPath}`)
  return { target, hostPath: ctx.fs.processPath(target) }
}

export async function uploadWorkspaceDocument(
  ctx: Context,
  client: RagFlowClient,
  options: TransferOptions,
  datasetId: string,
  sourcePath: string,
  displayName: string | undefined,
  signal: AbortSignal,
): Promise<Document[]> {
  const entry = await ctx.fs.lstat(sourcePath, { cwd: options.workspaceRoot }, signal)
  if (entry?.type === 'symlink') throw new Error(`Symbolic-link uploads are not allowed: ${sourcePath}`)
  if (entry?.type !== 'file') throw new Error(`Upload source is not a regular file: ${sourcePath}`)
  const { hostPath } = await workspacePath(ctx, options.workspaceRoot, sourcePath, signal)
  let info
  try {
    info = await stat(hostPath)
  } catch (cause) {
    throw localFilesystemError('Document upload', cause)
  }
  if (!info.isFile()) throw new Error(`Upload source is not a regular local file: ${sourcePath}`)
  if (info.size > options.maxFileBytes) throw new Error(`Upload exceeds the ${options.maxFileBytes}-byte limit`)

  // Node's file-backed Blob lets undici stream multipart bytes directly from
  // disk, keeping binary content out of the MCP channel and process memory.
  const body = await openAsBlob(hostPath)
  return client.documents.upload(datasetId, [{ body, displayName: displayName ?? hostPath.split(/[\\/]/).at(-1) ?? 'document' }], { signal })
}

export async function downloadWorkspaceDocument(
  ctx: Context,
  client: RagFlowClient,
  options: TransferOptions,
  datasetId: string,
  documentId: string,
  destinationPath: string,
  signal: AbortSignal,
): Promise<{ path: string; bytes: number }> {
  const existing = await ctx.fs.lstat(destinationPath, { cwd: options.workspaceRoot }, signal)
  if (existing !== undefined) throw new Error(`Download destination already exists: ${destinationPath}`)
  const { hostPath } = await workspacePath(ctx, options.workspaceRoot, destinationPath, signal)
  try {
    await lstat(hostPath).then(
      () => { throw new Error(`Download destination already exists: ${destinationPath}`) },
      (error: NodeJS.ErrnoException) => { if (error.code !== 'ENOENT') throw error },
    )
  } catch (cause) {
    if (cause instanceof Error && cause.message.startsWith('Download destination')) throw cause
    throw localFilesystemError('Document download', cause)
  }

  const response = await client.documents.download(datasetId, documentId, { signal })
  if (response.body === null) throw new Error('RAGFlow returned an empty download stream')
  const declaredSize = Number(response.headers.get('content-length'))
  if (Number.isFinite(declaredSize) && declaredSize > options.maxFileBytes) {
    await response.body.cancel()
    throw new Error(`Download exceeds the ${options.maxFileBytes}-byte limit`)
  }

  let bytes = 0
  const limiter = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      bytes += chunk.byteLength
      if (bytes > options.maxFileBytes) callback(new Error(`Download exceeds the ${options.maxFileBytes}-byte limit`))
      else callback(null, chunk)
    },
  })
  try {
    await pipeline(
      Readable.fromWeb(response.body as import('node:stream/web').ReadableStream),
      limiter,
      createWriteStream(hostPath, { flags: 'wx' }),
      { signal },
    )
  } catch (cause) {
    await unlink(hostPath).catch(() => undefined)
    if ((cause as NodeJS.ErrnoException).code === 'ENOENT') throw localFilesystemError('Document download', cause)
    throw cause
  }
  return { path: destinationPath, bytes }
}
