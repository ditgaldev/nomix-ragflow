import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, isAbsolute, join, relative, resolve } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { uploadWorkspaceDocument } from '../src/files.js'

describe('workspace document transfer', () => {
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
      processPath(target: { targetKey: string }) { return target.targetKey },
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
    return { root, ctx: { fs } as never }
  }

  it('uploads a file-backed Blob and enforces workspace containment', async () => {
    const { root, ctx } = await fixture()
    await writeFile(join(root, 'source.txt'), 'streamed body')
    const upload = vi.fn(async (_datasetId, documents) => {
      expect(documents[0].displayName).toBe('source.txt')
      expect(await documents[0].body.text()).toBe('streamed body')
      return [{ id: 'doc', name: 'source.txt', dataset_id: 'dataset' }]
    })
    const client = { documents: { upload } } as never
    await expect(uploadWorkspaceDocument(ctx, client, { workspaceRoot: root, maxFileBytes: 100 }, 'dataset', 'source.txt', undefined, new AbortController().signal)).resolves.toHaveLength(1)
    await expect(uploadWorkspaceDocument(ctx, client, { workspaceRoot: root, maxFileBytes: 100 }, 'dataset', '../outside.txt', undefined, new AbortController().signal)).rejects.toThrow(/escapes|regular file/)
    expect(upload).toHaveBeenCalledTimes(1)
  })

  it('rejects an upload larger than the Harness read limit', async () => {
    const { root, ctx } = await fixture()
    await writeFile(join(root, 'large.bin'), new Uint8Array(101))
    const client = { documents: { upload: vi.fn() } } as never
    await expect(uploadWorkspaceDocument(ctx, client, { workspaceRoot: root, maxFileBytes: 100 }, 'dataset', 'large.bin', undefined, new AbortController().signal)).rejects.toThrow(/exceeds/)
    expect(basename(root)).toMatch(/^ragflow-transfer-/)
  })
})
