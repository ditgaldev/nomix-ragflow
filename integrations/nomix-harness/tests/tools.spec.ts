import { describe, expect, it, vi } from 'vitest'
import { destructiveDecision, registerRagFlowTools } from '../src/tools.js'

describe('destructive tool approval classification', () => {
  it.each([
    ['ragflow_manage_datasets', 'delete'],
    ['ragflow_manage_documents', 'delete'],
    ['ragflow_manage_documents', 'cancel_parse'],
    ['ragflow_manage_chunks', 'delete'],
    ['ragflow_manage_chats', 'delete'],
    ['ragflow_manage_sessions', 'delete'],
    ['ragflow_manage_agents', 'delete'],
    ['ragflow_manage_memories', 'delete'],
    ['ragflow_manage_memories', 'forget_message'],
  ])('asks once for %s.%s', async (name, action) => {
    const next = vi.fn(async () => ({ kind: 'allow' as const }))
    await expect(destructiveDecision(name, { input: { action } }, next)).resolves.toMatchObject({ kind: 'ask' })
    expect(next).not.toHaveBeenCalled()
  })

  it('delegates non-destructive and foreign calls', async () => {
    const next = vi.fn(async () => ({ kind: 'allow' as const }))
    await expect(destructiveDecision('ragflow_manage_datasets', { input: { action: 'list' } }, next)).resolves.toEqual({ kind: 'allow' })
    await expect(destructiveDecision('another_plugin', { action: 'delete' }, next)).resolves.toEqual({ kind: 'allow' })
    expect(next).toHaveBeenCalledTimes(2)
  })
})

describe('REST retrieval tool', () => {
  function setup(options: { datasets?: Array<{ id: string }> } = {}) {
    const definitions: Array<{ name: string; timeoutMs?: number; parameters?: unknown; execute: (args: unknown, exec: { signal: AbortSignal }) => Promise<unknown> }> = []
    const search = vi.fn(async () => ({ chunks: [{ id: 'chunk-1' }], total: 1, doc_aggs: {} }))
    const list = vi.fn(async () => options.datasets ?? [])
    const deleteDataset = vi.fn(async () => undefined)
    const ctx = {
      tools: {
        register(definition: typeof definitions[number]) {
          definitions.push(definition)
          return () => undefined
        },
      },
      effect(callback: () => (() => void)) { callback() },
    } as never
    const client = { datasets: { list, delete: deleteDataset }, retrieval: { search } } as never
    registerRagFlowTools(ctx, client, { workspaceRoot: '.', maxFileBytes: 1024 })
    const retrieval = definitions.find(definition => definition.name === 'ragflow_retrieval')
    if (retrieval === undefined) throw new Error('retrieval tool was not registered')
    return { definitions, deleteDataset, list, retrieval, search }
  }

  it('registers one retrieval tool alongside the eight management tools', () => {
    const { definitions } = setup()
    expect(definitions).toHaveLength(9)
    expect(definitions.map(definition => definition.name)).toContain('ragflow_retrieval')
    expect(definitions.every(definition => definition.timeoutMs === 300_000)).toBe(true)
  })

  it('calls the REST retrieval client with explicit datasets', async () => {
    const { list, retrieval, search } = setup()
    const signal = new AbortController().signal

    await expect(retrieval.execute({
      input: {
        question: 'What changed?',
        datasetIds: ['dataset-1'],
        documentIds: ['document-1'],
        pageSize: 5,
        keyword: true,
      },
    }, { signal })).resolves.toEqual({ chunks: [{ id: 'chunk-1' }], total: 1, doc_aggs: {} })

    expect(list).not.toHaveBeenCalled()
    expect(search).toHaveBeenCalledWith(expect.objectContaining({
      question: 'What changed?',
      datasetIds: ['dataset-1'],
      documentIds: ['document-1'],
      pageSize: 5,
      keyword: true,
    }), { signal })
  })

  it('resolves all accessible datasets when datasetIds is omitted', async () => {
    const { list, retrieval, search } = setup({ datasets: [{ id: 'dataset-1' }, { id: 'dataset-2' }] })
    const signal = new AbortController().signal

    await retrieval.execute({ input: { question: 'Search everything' } }, { signal })

    expect(list).toHaveBeenCalledWith({ page: 1, pageSize: 100 }, { signal })
    expect(search).toHaveBeenCalledWith(expect.objectContaining({
      question: 'Search everything',
      datasetIds: ['dataset-1', 'dataset-2'],
    }), { signal })
  })

  it('fails before retrieval when no dataset is accessible', async () => {
    const { retrieval, search } = setup()
    await expect(retrieval.execute({ input: { question: 'Search everything' } }, {
      signal: new AbortController().signal,
    })).rejects.toThrow('No accessible RAGFlow datasets found')
    expect(search).not.toHaveBeenCalled()
  })

  it('requires an explicit dataset deletion scope', async () => {
    const { definitions, deleteDataset } = setup()
    const tool = definitions.find(definition => definition.name === 'ragflow_manage_datasets')
    if (tool === undefined) throw new Error('dataset tool was not registered')
    const exec = { signal: new AbortController().signal }
    await expect(tool.execute({ input: { action: 'delete' } }, exec)).rejects.toThrow(/non-empty input\.ids|deleteAll/)
    expect(deleteDataset).not.toHaveBeenCalled()
    await expect(tool.execute({ input: { action: 'delete', deleteAll: true } }, exec)).resolves.toEqual({ ok: true })
    expect(deleteDataset).toHaveBeenCalledWith(undefined, true, { signal: exec.signal })
  })
})
