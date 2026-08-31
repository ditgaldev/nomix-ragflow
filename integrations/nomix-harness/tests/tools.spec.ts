import { afterEach, describe, expect, it, vi } from 'vitest'
import { BusinessGatewayError } from '../src/errors.js'
import { RAGFLOW_AGENT_TOOL_NAMES } from '../src/harness-contract.js'
import { capabilityManifest } from '../src/manifest.js'
import { registerRagFlowTools, writeDecision, type RagFlowToolServices } from '../src/tools.js'
import type { RagFlowToolArtifact } from '../src/types.js'
import type { RequestOptions } from '../src/types.js'

const writeAgentActions = [...new Map(capabilityManifest.operations
  .filter(capability => capability.agentTool !== undefined && capability.risk !== 'read')
  .map(capability => [
    `${capability.agentTool}:${capability.agentAction}:${capability.agentKind ?? ''}`,
    [capability.agentTool!, capability.agentAction!, capability.agentKind] as const,
  ])).values()]

afterEach(() => vi.restoreAllMocks())

describe('all Agent writes require one-time approval', () => {
  it.each(writeAgentActions)('asks once for %s.%s.%s', async (name, action, kind) => {
    const next = vi.fn(async () => ({ kind: 'allow' as const }))
    await expect(writeDecision(name, { input: { action, operationId: `approval-${action}-${kind ?? 'default'}`, ...(kind ? { kind } : {}) } }, next)).resolves.toMatchObject({
      kind: 'ask',
      reason: expect.stringContaining('Gateway authorization and scope are still enforced'),
    })
    expect(next).not.toHaveBeenCalled()
  })

  it('fails closed before approval when a write has no stable business operationId', async () => {
    const next = vi.fn(async () => ({ kind: 'allow' as const }))
    await expect(writeDecision('ragflow_manage_datasets', { input: { action: 'delete', datasetId: 'dataset-1', version: 1 } }, next)).resolves.toMatchObject({
      kind: 'deny',
      reason: expect.stringMatching(/operationId.*non-empty|string.*operationId/i),
    })
    expect(next).not.toHaveBeenCalled()
  })

  it('presents bounded resource, artifact, version, and intent details for approval', async () => {
    const next = vi.fn(async () => ({ kind: 'allow' as const }))
    const decision = await writeDecision('ragflow_transfer_documents', {
      input: {
        action: 'upload',
        operationId: 'upload-customer-handbook-v3',
        datasetId: 'dataset-1',
        sourcePath: 'knowledge/customer-handbook.pdf',
        displayName: 'Customer handbook',
      },
    }, next)
    expect(decision).toMatchObject({ kind: 'ask' })
    if (decision.kind !== 'ask') throw new Error('Expected one-time approval')
    expect(decision.reason).toContain('datasetId=dataset-1')
    expect(decision.reason).toContain('artifactPath=knowledge/customer-handbook.pdf')
    expect(decision.reason).toContain('displayName=Customer handbook')
    expect(decision.reason).toContain('operationId=upload-customer-handbook-v3')
    expect(next).not.toHaveBeenCalled()
  })

  it.each([
    ['ragflow_discover', { action: 'context' }],
    ['ragflow_retrieval', {}],
    ['ragflow_manage_datasets', { action: 'list' }],
    ['ragflow_manage_documents', { action: 'list' }],
    ['ragflow_manage_chunks', { action: 'list' }],
    ['ragflow_manage_chats', { action: 'get' }],
    ['ragflow_manage_sessions', { action: 'list', kind: 'chat' }],
    ['ragflow_manage_agents', { action: 'get' }],
    ['ragflow_manage_memories', { action: 'search_messages' }],
    ['ragflow_transfer_documents', { action: 'download' }],
  ])('delegates read %s', async (name, input) => {
    const next = vi.fn(async () => ({ kind: 'allow' as const }))
    await expect(writeDecision(name, { input }, next)).resolves.toEqual({ kind: 'allow' })
    expect(next).toHaveBeenCalledOnce()
  })

  it('does not inspect other plugins and fails closed on RAGFlow manifest drift', async () => {
    const next = vi.fn(async () => ({ kind: 'allow' as const }))
    await expect(writeDecision('crm_manage_accounts', { unrelated: true }, next)).resolves.toEqual({ kind: 'allow' })
    await expect(writeDecision('ragflow_manage_datasets', { input: { action: 'future_write' } }, next)).resolves.toMatchObject({ kind: 'deny' })
    expect(next).toHaveBeenCalledOnce()
  })
})

describe('Business Gateway Agent tools', () => {
  function setup() {
    const agent = { id: 'ragflow-agent-a' }
    const definitions: Array<{
      name: string
      timeoutMs?: number
      parameters?: unknown
      output?: { schema?: unknown }
      isConcurrencySafe?: (args: { input: unknown }) => boolean
      execute: (args: { input: Record<string, unknown> }, exec: { signal: AbortSignal; callId: string; name: string; agent: typeof agent }) => Promise<unknown>
    }> = []
    const search = vi.fn(async (_input: unknown, _options: RequestOptions) => ({ data: { chunks: [{ id: 'chunk-1', content: 'answer' }], total: 1, docAggs: {} }, meta: { requestId: 'request-search' } }))
    const deleteDataset = vi.fn(async (_id: string, _options: { signal: AbortSignal; idempotencyKey: string; version: number }) => ({ successCount: 1 }))
    const createMemory = vi.fn(async (_input: unknown, _options: RequestOptions) => ({ id: 'memory-1' }))
    const batchCreateMessages = vi.fn(async (_input: unknown, _options: RequestOptions) => ({ successCount: 1 }))
    const upload = vi.fn(async () => [{ id: 'document-1', name: 'source.txt', datasetId: 'dataset-1' }])
    const download = vi.fn(async () => new Response(new Uint8Array([65, 66]), { headers: { 'content-type': 'text/plain', 'content-length': '2' } }))
    const getContext = vi.fn(async () => ({
      subject: 'subject-a', actorSubject: 'actor-a', onBehalfOfSubject: null, workspaceId: 'workspace-a',
      actions: ['authorization:read'], datasetScope: { mode: 'ids', ids: ['dataset-1'] }, documentScope: { mode: 'inherit' },
      chatScope: { mode: 'ids', ids: ['chat-1'] }, agentScope: { mode: 'ids', ids: ['agent-1'] },
      memoryScope: { mode: 'ids', ids: ['memory-1'] },
      permissionRef: null, authenticationType: 'token-introspection', requestId: 'request-a', tokenUse: 'data',
      audience: ['nomix-ragflow-data'], expiresAt: '2026-08-29T00:00:00Z', clientId: 'harness',
    }))
    const tools = {
      register(definition: typeof definitions[number]) {
        definitions.push(definition)
        return () => definitions.splice(definitions.indexOf(definition), 1)
      },
    }
    const ctx = {
      agent,
      tools,
      get: (key: string) => key === 'tools' ? tools : undefined,
    } as never
    const client = {
      authorization: { getContext },
      datasets: { delete: deleteDataset },
      memories: { create: createMemory },
      memoryMessages: { batchCreate: batchCreateMessages },
      documents: { upload, download },
      retrieval: { search },
    } as never
    const spillText = vi.fn(async (_exec, input: { name: string; mimeType: string; content: string }): Promise<RagFlowToolArtifact> => ({
      kind: 'spill', name: input.name, locator: `/spill/${input.name}`, mimeType: input.mimeType, encoding: 'utf8',
      bytes: Buffer.byteLength(input.content), storedBytes: Buffer.byteLength(input.content), retrievalHint: 'read spill',
    }))
    const binaryArtifact: RagFlowToolArtifact = {
      kind: 'spill', name: 'answer.txt.base64', locator: '/spill/answer.txt.base64', mimeType: 'text/plain', encoding: 'base64',
      originalName: 'answer.txt', originalMimeType: 'text/plain', bytes: 2, storedBytes: 4, sha256: 'f'.repeat(64), retrievalHint: 'decode spill',
    }
    const services: RagFlowToolServices = {
      client: async () => client,
      spillText,
      spillBytes: async () => binaryArtifact,
      uploadDocument: async (_exec, selectedClient, input) => selectedClient.documents.upload(input.datasetId, [{ body: new Blob(['body']), displayName: input.displayName ?? 'source.txt' }], { signal: _exec.signal, idempotencyKey: input.idempotencyKey }),
      downloadArtifact: async () => binaryArtifact,
    }
    const dispose = registerRagFlowTools(ctx, services)
    const execution = (name: string, callId: string) => ({ signal: new AbortController().signal, callId, name, agent })
    const retrieval = definitions.find(definition => definition.name === 'ragflow_retrieval')!
    const datasets = definitions.find(definition => definition.name === 'ragflow_manage_datasets')!
    return { agent, batchCreateMessages, createMemory, datasets, definitions, deleteDataset, dispose, download, execution, getContext, retrieval, search, spillText, upload }
  }

  it('registers stable names with closed schemas, concurrency semantics, and reversible cleanup', () => {
    const { definitions, dispose } = setup()
    expect(definitions.map(definition => definition.name)).toEqual(RAGFLOW_AGENT_TOOL_NAMES)
    expect(definitions.every(definition => definition.timeoutMs === 90_000)).toBe(true)
    expect(definitions.every(definition => (definition.output!.schema as { additionalProperties?: boolean }).additionalProperties === false)).toBe(true)
    expect(JSON.stringify(definitions.map(definition => definition.parameters))).not.toMatch(/deleteAll|tenantId|userId|permissionRef/)

    const retrieval = definitions.find(definition => definition.name === 'ragflow_retrieval')!
    const datasets = definitions.find(definition => definition.name === 'ragflow_manage_datasets')!
    expect(retrieval.isConcurrencySafe?.({ input: { question: 'q' } })).toBe(true)
    expect(datasets.isConcurrencySafe?.({ input: { action: 'list' } })).toBe(true)
    expect(datasets.isConcurrencySafe?.({ input: { action: 'delete' } })).toBe(false)
    dispose()
    expect(definitions).toEqual([])
  })

  it('lets Gateway scope retrieval and emits a closed inline observation', async () => {
    const { execution, retrieval, search } = setup()
    const exec = execution('ragflow_retrieval', 'call-retrieval')
    await expect(retrieval.execute({ input: { question: 'Search my authorized scope', limit: 5 } }, exec)).resolves.toMatchObject({
      status: 'success',
      data: { kind: 'retrieval', format: 'json-entries', truncated: false },
      nextActions: [],
      artifacts: [],
    })
    expect(search).toHaveBeenCalledWith(expect.objectContaining({ question: 'Search my authorized scope', datasetIds: undefined, limit: 5 }), expect.objectContaining({ signal: exec.signal }))
    expect(search.mock.calls[0]![1]).not.toHaveProperty('headers')
  })

  it('rejects fractional values for integer Gateway fields before calling the client', async () => {
    const { datasets, deleteDataset, execution, retrieval, search } = setup()
    await expect(retrieval.execute({ input: { question: 'fractional page', limit: 1.5 } }, execution('ragflow_retrieval', 'fractional-limit'))).rejects.toThrow(/integer/)
    await expect(datasets.execute({ input: {
      action: 'delete',
      operationId: 'fractional-version',
      datasetId: 'dataset-1',
      version: 1.5,
    } }, execution('ragflow_manage_datasets', 'fractional-version'))).rejects.toThrow(/integer|oneOf/)
    expect(search).not.toHaveBeenCalled()
    expect(deleteDataset).not.toHaveBeenCalled()
  })

  it('uses optimistic version and an Agent-bound stable idempotency key', async () => {
    const { datasets, deleteDataset, execution } = setup()
    const firstExec = execution('ragflow_manage_datasets', 'tool-call-7')
    const retryExec = execution('ragflow_manage_datasets', 'tool-call-8')
    const distinctExec = execution('ragflow_manage_datasets', 'tool-call-9')
    await expect(datasets.execute({ input: { action: 'delete' } }, firstExec)).rejects.toThrow(/oneOf|non-empty/)
    await datasets.execute({ input: { action: 'delete', operationId: 'delete-dataset-1', datasetId: 'dataset-1', version: 7 } }, firstExec)
    await datasets.execute({ input: { action: 'delete', operationId: 'delete-dataset-1', datasetId: 'dataset-1', version: 7 } }, retryExec)
    await datasets.execute({ input: { action: 'delete', operationId: 'delete-dataset-1-again', datasetId: 'dataset-1', version: 7 } }, distinctExec)
    const firstOptions = deleteDataset.mock.calls[0]![1]
    expect(firstOptions).toMatchObject({ signal: firstExec.signal, version: 7 })
    expect(firstOptions.idempotencyKey).toMatch(/^agent:[a-f0-9]{64}$/)
    expect(deleteDataset.mock.calls[1]![1].idempotencyKey).toBe(firstOptions.idempotencyKey)
    expect(deleteDataset.mock.calls[2]![1].idempotencyKey).not.toBe(firstOptions.idempotencyKey)
  })

  it('redacts identity, grants, and raw scope identifiers from discovery output', async () => {
    const { definitions, execution, getContext } = setup()
    const discover = definitions.find(definition => definition.name === 'ragflow_discover')!
    const result = await discover.execute({ input: { action: 'context' } }, execution('ragflow_discover', 'discover'))
    const visible = JSON.stringify(result)
    expect(getContext).toHaveBeenCalledOnce()
    expect(visible).toContain('gateway')
    expect(visible).toContain('actionCount')
    expect(visible).toContain('idCount')
    expect(visible).not.toMatch(/subject-a|actor-a|workspace-a|dataset-1|chat-1|agent-1|memory-1|authorization:read|permissionRef|clientId/)
  })

  it('keeps uploads as resources and downloads as artifact references without inline base64', async () => {
    const { definitions, execution, upload } = setup()
    const transfer = definitions.find(definition => definition.name === 'ragflow_transfer_documents')!
    const uploadResult = await transfer.execute({ input: { action: 'upload', operationId: 'upload-source-1', datasetId: 'dataset-1', sourcePath: 'source.txt' } }, execution('ragflow_transfer_documents', 'upload'))
    expect(uploadResult).toMatchObject({
      status: 'success', summary: 'Uploaded 1 document(s) to the authorized dataset.',
      data: { kind: 'mutation', format: 'json-entries' }, artifacts: [],
    })
    expect(upload).toHaveBeenCalledOnce()

    const downloadResult = await transfer.execute({ input: { action: 'download', datasetId: 'dataset-1', documentId: 'document-1', fileName: 'answer.txt' } }, execution('ragflow_transfer_documents', 'download'))
    expect(downloadResult).toMatchObject({
      status: 'success', data: { kind: 'artifact-reference', format: 'artifact-reference', artifactName: 'answer.txt.base64', bytes: 2, truncated: true },
      artifacts: [{ kind: 'spill', encoding: 'base64', originalName: 'answer.txt', locator: '/spill/answer.txt.base64' }],
    })
    expect(JSON.stringify(downloadResult)).not.toContain('QUI=')
  })

  it('spills large results instead of exposing unbounded model-visible JSON', async () => {
    const { retrieval, search, spillText, execution } = setup()
    search.mockResolvedValueOnce({ data: { chunks: [{ id: 'chunk-1', content: 'x'.repeat(20_000) }], total: 1, docAggs: {} }, meta: { requestId: 'large' } })
    const result = await retrieval.execute({ input: { question: 'large' } }, execution('ragflow_retrieval', 'large-result'))
    expect(result).toMatchObject({ data: { kind: 'artifact-reference', truncated: true }, artifacts: [{ kind: 'spill', encoding: 'utf8' }] })
    expect(spillText).toHaveBeenCalledOnce()
    expect(JSON.stringify(result)).not.toContain('x'.repeat(1_000))
  })

  it('does not turn approval into Gateway authorization', async () => {
    const { datasets, deleteDataset, execution } = setup()
    deleteDataset.mockRejectedValueOnce(new BusinessGatewayError('scope denied', { code: 'RESOURCE_NOT_FOUND', status: 404, requestId: 'req-safe' }))
    await expect(datasets.execute({ input: { action: 'delete', operationId: 'delete-outside-scope', datasetId: 'outside-scope', version: 1 } }, execution('ragflow_manage_datasets', 'approved-call')))
      .rejects.toThrow(/scope denied.*Root cause:.*Safe retry:.*Stop condition:.*req-safe/)
  })

  it('strips Agent routing fields before memory write bodies', async () => {
    const { batchCreateMessages, createMemory, definitions, execution } = setup()
    const memories = definitions.find(definition => definition.name === 'ragflow_manage_memories')!
    const exec = execution('ragflow_manage_memories', 'memory-call')
    await memories.execute({ input: { action: 'create', operationId: 'create-memory-1', name: 'Memory', memoryType: ['raw'], embdId: 'embed', llmId: 'llm' } }, exec)
    await memories.execute({ input: { action: 'add_message', operationId: 'add-memory-message-1', memoryIds: ['memory-1'], agentId: 'agent', sessionId: 'session', userInput: 'hello', agentResponse: 'world' } }, exec)
    expect(createMemory.mock.calls[0]![0]).toEqual({ name: 'Memory', memoryType: ['raw'], embdId: 'embed', llmId: 'llm' })
    expect(batchCreateMessages.mock.calls[0]![0]).toEqual({ memoryIds: ['memory-1'], agentId: 'agent', sessionId: 'session', userInput: 'hello', agentResponse: 'world' })
  })
})
