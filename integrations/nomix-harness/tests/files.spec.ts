import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { isAbsolute, join, relative, resolve } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { readDownloadedDocument, uploadWorkspaceDocument } from '../src/files.js'
import { MAX_RAGFLOW_AGENT_UPLOAD_BYTES } from '../src/harness-contract.js'

describe('Agent filesystem and artifact transfer', () => {
  const roots: string[] = []

  afterEach(async () => {
    await Promise.all(roots.splice(0).map(path => rm(path, { recursive: true, force: true })))
  })

  async function fixture() {
    const root = await mkdtemp(join(tmpdir(), 'ragflow-transfer-'))
    roots.push(root)
    const pathOf = (path: string, cwd = root) => resolve(cwd, path)
    const fs = {
      async resolve(path: string, options: { cwd?: string } = {}) {
        const host = pathOf(path, options.cwd ?? root)
        return { targetKey: host, displayPath: host }
      },
      contains(parent: { targetKey: string }, child: { targetKey: string }) {
        const path = relative(parent.targetKey, child.targetKey)
        return path === '' || (!path.startsWith('..') && !isAbsolute(path))
      },
      async lstat(path: string, options: { cwd?: string } = {}) {
        try {
          const info = await import('node:fs/promises').then(module => module.lstat(pathOf(path, options.cwd ?? root)))
          return { type: info.isSymbolicLink() ? 'symlink' : info.isFile() ? 'file' : info.isDirectory() ? 'directory' : 'other', version: 'v', size: info.size }
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
          throw error
        }
      },
      async readBytes(target: { targetKey: string }, _signal: AbortSignal, maxBytes: number) {
        const bytes = await readFile(target.targetKey)
        if (bytes.byteLength > maxBytes) throw new Error('FS_TOO_LARGE')
        return bytes
      },
    }
    return { root, rawFs: fs, fs: fs as never }
  }

  it('uploads through the Agent fs provider and enforces workspace containment', async () => {
    const { root, fs } = await fixture()
    await writeFile(join(root, 'source.txt'), 'streamed body')
    const upload = vi.fn(async (_datasetId, documents) => {
      expect(documents[0].displayName).toBe('source.txt')
      expect(await documents[0].body.text()).toBe('streamed body')
      return [{ id: 'doc', name: 'source.txt', datasetId: 'dataset' }]
    })
    const client = { documents: { upload } } as never
    await expect(uploadWorkspaceDocument(fs, root, client, { workspaceRoot: '.', maxFileBytes: 100 }, 'dataset', 'source.txt', undefined, new AbortController().signal, 'upload-1')).resolves.toHaveLength(1)
    await expect(uploadWorkspaceDocument(fs, root, client, { workspaceRoot: '.', maxFileBytes: 100 }, 'dataset', '../outside.txt', undefined, new AbortController().signal, 'upload-2')).rejects.toThrow(/escapes|regular file/)
    expect(upload).toHaveBeenCalledTimes(1)
  })

  it('rejects oversized files, symlinks, and path-like names before upload', async () => {
    const { root, fs, rawFs } = await fixture()
    await writeFile(join(root, 'large.bin'), new Uint8Array(101))
    await writeFile(join(root, 'source.txt'), 'body')
    const upload = vi.fn()
    const client = { documents: { upload } } as never
    await expect(uploadWorkspaceDocument(fs, root, client, { workspaceRoot: '.', maxFileBytes: 100 }, 'dataset', 'large.bin', undefined, new AbortController().signal, 'upload-large')).rejects.toThrow(/exceeds/)
    const symlinkFs = { ...rawFs, lstat: async () => ({ type: 'symlink', version: 'v', size: 4 }) } as never
    await expect(uploadWorkspaceDocument(symlinkFs, root, client, { workspaceRoot: '.', maxFileBytes: 100 }, 'dataset', 'source.txt', undefined, new AbortController().signal, 'upload-link')).rejects.toThrow(/Symbolic-link/)
    await expect(uploadWorkspaceDocument(fs, root, client, { workspaceRoot: '.', maxFileBytes: 100 }, 'dataset', 'source.txt', '../renamed.txt', new AbortController().signal, 'upload-name')).rejects.toThrow(/plain file name/)
    expect(upload).not.toHaveBeenCalled()
  })

  it('accepts 63/64 MiB metadata boundaries and rejects 65 MiB before reading', async () => {
    const { root, rawFs } = await fixture()
    const upload = vi.fn(async () => [])
    const client = { documents: { upload } } as never
    const mebibyte = 1024 * 1024
    const sizes = [63 * mebibyte, 64 * mebibyte, 65 * mebibyte]
    for (const size of sizes) {
      const readBytes = vi.fn(async () => new Uint8Array())
      const boundedFs = {
        ...rawFs,
        lstat: async () => ({ type: 'file', version: 'v', size }),
        readBytes,
      } as never
      const result = uploadWorkspaceDocument(
        boundedFs,
        root,
        client,
        { workspaceRoot: '.', maxFileBytes: MAX_RAGFLOW_AGENT_UPLOAD_BYTES },
        'dataset',
        'boundary.bin',
        undefined,
        new AbortController().signal,
        `upload-${size}`,
      )
      if (size <= MAX_RAGFLOW_AGENT_UPLOAD_BYTES) {
        await expect(result).resolves.toEqual([])
        expect(readBytes).toHaveBeenCalledOnce()
      } else {
        await expect(result).rejects.toMatchObject({ code: 'FILE_TOO_LARGE', status: 413 })
        expect(readBytes).not.toHaveBeenCalled()
      }
    }
    expect(upload).toHaveBeenCalledTimes(2)
  })

  it('reads bounded downloads without touching the host filesystem', async () => {
    const response = new Response(new Uint8Array([0, 1, 2, 255]), {
      headers: { 'content-type': 'application/octet-stream', 'content-length': '4' },
    })
    const artifact = await readDownloadedDocument(response, 100, 'result.bin', new AbortController().signal)
    expect(artifact).toMatchObject({ name: 'result.bin', mimeType: 'application/octet-stream', sha256: expect.stringMatching(/^[a-f0-9]{64}$/) })
    expect([...artifact.bytes]).toEqual([0, 1, 2, 255])
  })

  it('cancels a streamed download that crosses the artifact limit', async () => {
    const response = new Response(new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(60))
        controller.enqueue(new Uint8Array(60))
        controller.close()
      },
    }))
    await expect(readDownloadedDocument(response, 100, 'too-large.bin', new AbortController().signal)).rejects.toThrow(/100-byte Agent artifact limit/)
  })

  it('cancels an in-flight artifact stream when the tool signal aborts', async () => {
    const response = new Response(new ReadableStream<Uint8Array>({ start: () => undefined }))
    const controller = new AbortController()
    const pending = readDownloadedDocument(response, 100, 'cancelled.bin', controller.signal)
    controller.abort(new DOMException('tool cancelled', 'AbortError'))
    await expect(pending).rejects.toThrow(/tool cancelled|aborted/i)
  })
})
