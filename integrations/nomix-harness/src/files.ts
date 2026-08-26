import { basename } from 'node:path'
import type { Context } from '@nomix-ai/cordis'
import type {} from '@nomix-ai/nomix-fs'
import type { Document } from './types.js'
import type { RagFlowClient } from './client.js'

export interface TransferOptions {
  workspaceRoot: string
  maxFileBytes: number
}

async function workspaceTarget(ctx: Context, rootPath: string, inputPath: string, signal: AbortSignal) {
  const root = await ctx.fs.resolve(rootPath, { signal })
  const target = await ctx.fs.resolve(inputPath, { cwd: rootPath, signal })
  if (!ctx.fs.contains(root, target)) throw new Error(`Path escapes the Harness workspace: ${inputPath}`)
  return target
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
  if (entry.size !== undefined && entry.size > options.maxFileBytes) throw new Error(`Upload exceeds the ${options.maxFileBytes}-byte limit`)
  const target = await workspaceTarget(ctx, options.workspaceRoot, sourcePath, signal)
  const bytes = await ctx.fs.readBytes(target, signal, options.maxFileBytes)
  const ownedBytes = new Uint8Array(bytes.byteLength)
  ownedBytes.set(bytes)
  const body = new Blob([ownedBytes])
  return client.documents.upload(datasetId, [{ body, displayName: displayName ?? (basename(sourcePath) || 'document') }], { signal })
}
