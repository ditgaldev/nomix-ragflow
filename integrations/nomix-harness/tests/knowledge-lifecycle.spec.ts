import { Context } from '@nomix-ai/nomix-harness/plugin'
import { AgentRegistry, type Agent } from '@nomix-ai/nomix-harness/plugin/agent'
import { AgentLoop } from '@nomix-ai/nomix-harness/plugin/agent-loop'
import { CallId, createUserMessage, LlmAdapter, LlmRuntime, markAgentLoopRequest, type GenerateOptions, type StreamChunk } from '@nomix-ai/nomix-harness/plugin/llm'
import { SessionStore, SessionId } from '@nomix-ai/nomix-harness/plugin/session'
import { SystemPrompt } from '@nomix-ai/nomix-harness/plugin/system-prompt'
import { ToolRuntime } from '@nomix-ai/nomix-harness/plugin/tools'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { applyKnowledgeConsumer } from '../packages/dsh-bundle-ragflow-knowledge/consumer.js'
import { BusinessIdentityRuntime } from '../packages/dsh-business-identity/business-identity.js'
import { KnowledgeRuntime } from '../packages/dsh-knowledge/service.js'
import { applyKnowledgeProvider } from '../packages/dsh-knowledge-gateway/provider.js'
import { KNOWLEDGE_EVIDENCE_INSTRUCTIONS } from '../packages/dsh-knowledge-policy/policy.js'
import { documentDetail, versionDetail, success, failure, metadata } from './knowledge-fixtures.js'

// Real Agent Loop, ToolRuntime, Consumer, identity and HTTP Provider. Only the
// model, remote Gateway, credential backing and spill storage are test doubles.
class ScriptedModel extends LlmAdapter {
  requests: GenerateOptions[] = []
  constructor(private readonly script: Array<{ name: string; input: object }> = []) { super() }
  async * stream(request: GenerateOptions): AsyncIterable<StreamChunk> {
    this.requests.push(request)
    const call = this.script.shift()
    if (call) {
      const id = CallId(`model-call-${this.requests.length}`)
      const args = JSON.stringify({ input: call.input })
      yield { type: 'block-start', index: 0, blockType: 'tool-call' }
      yield { type: 'tool-call-delta', index: 0, id, name: call.name, argumentsDelta: args }
      yield { type: 'block-end', index: 0, block: { type: 'tool-call', id, name: call.name, arguments: args } }
      yield { type: 'finish', reason: { kind: 'tool-calls' } }
    } else yield { type: 'finish', reason: { kind: 'stop' } }
  }
}

const roots: Context[] = []
afterEach(async () => { await Promise.all(roots.splice(0).map(ctx => ctx.fiber.dispose())); vi.unstubAllGlobals() })

async function setup(model = new ScriptedModel()) {
  const ctx = new Context(); roots.push(ctx)
  await ctx.plugin(LlmRuntime)
  await ctx.plugin(SessionStore)
  await ctx.plugin(SystemPrompt, { includeHarnessIdentity: false })
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(AgentLoop, { agents: [] })
  new KnowledgeRuntime(ctx)
  const identity = new BusinessIdentityRuntime(ctx)
  const credentials = { resolve: vi.fn(async () => ({ value: 'test-service', source: 'test' })) }
  ctx.provide('credentials', credentials as never)
  const stored = new Map<string, string>()
  const saveText = vi.fn(async (input: { suggestedName: string; content: string }) => {
    stored.set(input.suggestedName, input.content)
    return { locator: `spill://${input.suggestedName}`, bytes: new TextEncoder().encode(input.content).byteLength, retrievalHint: `Read ${input.suggestedName}` }
  })
  ctx.provide('spillStore', { saveText } as never)
  const requestApproval = vi.fn(async () => 'allowed-once')
  ctx.provide('approval', { request: requestApproval } as never)
  applyKnowledgeProvider(ctx, { gatewayBaseURL: 'https://gateway.example', serviceTokenRef: 'KNOWLEDGE_SERVICE_TOKEN' })
  applyKnowledgeConsumer(ctx, { agentToolsets: [{ agentPreset: 'maintainer', toolset: 'admin' }] })
  ctx.llm.registerAdapter(['test'], model)
  const handle = await ctx.agents.create({ sessionId: SessionId('knowledge-session'), meta: { agentPreset: 'maintainer' }, agentOptions: { provider: 'test', model: 'test' } })
  const agent = handle.agent
  const bind = (assertion = 'test-user') => identity.bindSession({ sessionId: agent.id, userAssertion: assertion, expiresAtEpochSeconds: Math.floor(Date.now() / 1000) + 60 })
  const unbind = bind()
  const execute = (name: string, input: object, callId = name, signal = new AbortController().signal) => ctx.tools.execute({ agent, name, arguments: { input }, callId: CallId(callId), signal })
  return { ctx, agent, handle, model, execute, identity, bind, unbind, credentials, requestApproval, stored, saveText }
}

async function run(agent: Agent) {
  agent.followup(createUserMessage({ content: [{ type: 'text', text: '处理业务知识' }], source: { kind: 'user' } }))
  await agent.whenIdle()
}

describe('knowledge request boundary and continuous workflows', () => {
  it.each([false, true])('checks the exact dynamic complete prompt with no second assembly (valid=%s)', async valid => {
    const { agent, model } = await setup()
    const text = vi.fn(context => context.agent && !valid ? 'Missing policy' : KNOWLEDGE_EVIDENCE_INSTRUCTIONS)
    agent.ctx.systemPrompt.section({ name: 'deployment', order: 0, complete: true, text })
    await run(agent)
    expect(text).toHaveBeenCalledTimes(1)
    expect(text.mock.calls[0]![0].agent).toBe(agent)
    expect(text.mock.calls[0]![0].signal).toBeInstanceOf(AbortSignal)
    expect(model.requests).toHaveLength(valid ? 1 : 0)
    if (valid) expect(model.requests[0]!.system).toBe(KNOWLEDGE_EVIDENCE_INSTRUCTIONS)
  })

  it('routes the stream guard only to its owned session and removes it on Agent disposal', async () => {
    const { ctx, agent, handle, model } = await setup()
    const stream = async (sessionId: string) => { for await (const _ of ctx.llm.stream(markAgentLoopRequest({ provider: 'test', model: 'test', sessionId: SessionId(sessionId), system: 'No policy', messages: [] }))) { /* drain */ } }
    await stream('unselected-session')
    await expect(stream(agent.id)).rejects.toThrow('missing the required evidence policy')
    await handle.dispose()
    await stream(agent.id)
    expect(model.requests).toHaveLength(2)
  })

  it('runs upload → processing → activation → search → source through the actual Agent Loop', async () => {
    const steps = [
      { name: 'knowledge_document_upload', input: { knowledgeSpaceId: 'space-1', fileResourceId: 'file-1', documentName: '制度.pdf' } },
      { name: 'knowledge_document_get', input: { documentId: 'doc-1' } },
      { name: 'knowledge_operation_get', input: { operationId: 'op-1' } },
      { name: 'knowledge_document_get', input: { documentId: 'doc-1' } },
      { name: 'knowledge_search', input: { query: '制度' } },
      { name: 'knowledge_source_read', input: { citationId: 'cite-1' } },
    ]
    const { agent, model, requestApproval } = await setup(new ScriptedModel(steps))
    const replies = [
      { documentId: 'doc-1', operationId: 'op-1', status: 'PENDING' },
      documentDetail({ status: 'CREATING', searchable: false, activeVersion: null, candidateVersion: versionDetail({ status: 'INGESTING', operationStatus: 'RUNNING', progressPercent: null, progressSource: 'UNAVAILABLE', activatedAt: null, readyAt: null }) }),
      { operationId: 'op-1', operationType: 'DOCUMENT_UPLOAD', status: 'SUCCEEDED', createdAt: '2026-09-05T00:00:00Z' },
      documentDetail(),
      { query: '制度', traceId: 'search-trace', hits: [{ citationId: 'cite-1', documentId: 'doc-1', documentName: '制度', chapterPath: ['第一章'], content: '按制度申请', score: 0.9, metadata }] },
      { citationId: 'cite-1', documentId: 'doc-1', versionId: 'v-1', documentName: '制度', beforeContent: '', matchedContent: '按制度申请', afterContent: '', requestedContextBefore: 1000, requestedContextAfter: 1000, actualContextBefore: 0, actualContextAfter: 0, locationPrecision: 'EXACT_OFFSET', matchedContentTruncated: false },
    ]
    const fetch = vi.fn(async (_url, init) => {
      const headers = new Headers(init.headers)
      expect(headers.get('authorization')).toBe('Bearer test-service')
      expect(headers.get('x-user-assertion')).toBe('test-user')
      expect(headers.get('x-harness-session-id')).toBe(agent.id)
      expect(headers.get('x-tool-call-id')).toBeTruthy()
      expect(headers.get('x-request-id')).toBeTruthy()
      return Response.json(success(replies.shift()))
    })
    vi.stubGlobal('fetch', fetch)
    await run(agent)
    expect(replies).toHaveLength(0)
    expect(model.requests).toHaveLength(7)
    const results = agent.session.events.filter(event => event.type === 'tool/result')
    expect(results).toHaveLength(6)
    expect(JSON.stringify(results)).not.toContain('"isError":true')
    expect(JSON.stringify(model.requests.at(-1)!.messages)).toContain('按制度申请')
    expect(requestApproval).not.toHaveBeenCalled()
  })

  it('reads lockVersion zero, updates with it, and reports a stale write conflict', async () => {
    const { execute } = await setup()
    const detail = documentDetail({ lockVersion: 0 })
    const fetch = vi.fn(async (_url, init) => init.method === 'GET' ? Response.json(success(detail)) : Response.json(success({ documentId: 'doc-1', knowledgeSpaceId: 'space-1', name: '新名称', status: 'ACTIVE', version: 1, activeVersion: null, metadata })))
    vi.stubGlobal('fetch', fetch)
    const read = await execute('knowledge_document_get', { documentId: 'doc-1' })
    expect(read.isError).toBe(false)
    expect((await execute('knowledge_document_update', { documentId: 'doc-1', expectedVersion: detail.lockVersion, name: '新名称' })).isError).toBe(false)
    expect(JSON.parse(fetch.mock.calls[1]![1].body).expectedVersion).toBe(0)
    fetch.mockImplementation(async () => Response.json(failure('DOCUMENT_VERSION_CONFLICT'), { status: 409 }))
    expect((await execute('knowledge_document_update', { documentId: 'doc-1', expectedVersion: 0, name: '冲突' }, 'new-intent')).error?.info?.code).toBe('KNOWLEDGE_CONFLICT')
  })

  it.each([
    ['knowledge_document_update', { documentId: 'doc-1', expectedVersion: 0, metadata: { department: 'finance' } }, 'KNOWLEDGE_METADATA_FIELD_NOT_ALLOWED'],
    ['knowledge_search', { query: 'q', metadataFilter: { department: ['finance'] } }, 'KNOWLEDGE_METADATA_FILTER_FIELD_NOT_ALLOWED'],
    ['knowledge_search', { query: 'q', metadataFilter: { category: [] } }, 'KNOWLEDGE_METADATA_VALUE_INVALID'],
    ['knowledge_document_update', { documentId: 'doc-1', expectedVersion: 0, metadata: { tags: null } }, 'KNOWLEDGE_METADATA_VALUE_INVALID'],
  ] as const)('preserves business errors in actual runtime: %s %j', async (name, input, code) => {
    const { execute } = await setup()
    const fetch = vi.fn(); vi.stubGlobal('fetch', fetch)
    expect((await execute(name, input)).error?.info?.code).toBe(code)
    expect(fetch).not.toHaveBeenCalled()
  })

  it('gates approval, keeps replay keys stable, refreshes identity, and rejects expired identity', async () => {
    const { execute, requestApproval, bind, credentials } = await setup()
    const fetch = vi.fn(async () => Response.json(success({ documentId: 'doc-1', operationId: 'op-2', status: 'PENDING' })))
    vi.stubGlobal('fetch', fetch)
    requestApproval.mockResolvedValue('rejected')
    const input = { documentId: 'doc-1', expectedVersion: 0 }
    expect((await execute('knowledge_document_reindex', input, 'replay')).isError).toBe(true)
    expect(fetch).not.toHaveBeenCalled()
    requestApproval.mockResolvedValue('allowed-once')
    expect((await execute('knowledge_document_reindex', input, 'replay')).isError).toBe(false)
    const unbind = bind('refreshed-user')
    credentials.resolve.mockResolvedValue({ value: 'refreshed-service', source: 'test' })
    expect((await execute('knowledge_document_reindex', input, 'replay')).isError).toBe(false)
    const headers = fetch.mock.calls.map(call => new Headers((call as unknown as [unknown, RequestInit])[1].headers))
    expect(headers[0]!.get('idempotency-key')).toBe(headers[1]!.get('idempotency-key'))
    expect(headers[1]!.get('x-user-assertion')).toBe('refreshed-user')
    expect(headers[1]!.get('authorization')).toBe('Bearer refreshed-service')
    const clock = vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 61_000)
    try {
      expect((await execute('knowledge_document_get', { documentId: 'doc-1' })).error?.info?.code).toBe('KNOWLEDGE_UNAUTHENTICATED')
    } finally { clock.mockRestore(); unbind() }
    expect(fetch).toHaveBeenCalledTimes(2)
  })

  it.each([
    ['replace', 'REPLACE', 'SUCCEEDED'], ['replace', 'REPLACE', 'FAILED'],
    ['reindex', 'REINDEX', 'SUCCEEDED'], ['reindex', 'REINDEX', 'CANCELLED'],
  ] as const)('observes old/new version transitions for %s ending %s/%s', async (action, changeType, outcome) => {
    const { execute, requestApproval } = await setup()
    const pending = versionDetail({ versionId: 'v-2', versionNo: 2, changeType, operationId: 'op-2', operationStatus: 'RUNNING', status: 'INGESTING', progressPercent: null, progressSource: 'UNAVAILABLE', activatedAt: null, readyAt: null })
    const finished = outcome === 'SUCCEEDED'
      ? documentDetail({ activeVersion: versionDetail({ versionId: 'v-2', versionNo: 2, changeType, operationId: 'op-2' }) })
      : documentDetail({ candidateVersion: { ...pending, status: outcome, operationStatus: outcome, ...(outcome === 'FAILED' ? { retryable: true, error: { code: 'RAGFLOW_INGESTION_TIMEOUT', message: '文档处理超时', retryable: true } } : {}) } })
    const operation = (status: string) => ({ operationId: 'op-2', operationType: action === 'replace' ? 'DOCUMENT_REPLACE' : 'DOCUMENT_REINDEX', status, createdAt: '2026-09-05T00:00:00Z' })
    const replies = [
      { documentId: 'doc-1', operationId: 'op-2', status: 'PENDING' },
      documentDetail({ candidateVersion: pending }),
      { query: 'q', traceId: 'search-trace', hits: [{ citationId: 'old-version-cite', documentId: 'doc-1', documentName: '制度', chapterPath: [], content: '旧版证据', score: 1, metadata }] },
      operation(outcome), finished,
      ...(outcome === 'FAILED' ? [{ operationId: 'op-3', parentOperationId: 'op-2', status: 'PENDING' }, documentDetail({ candidateVersion: { ...pending, operationId: 'op-3' } })] : []),
    ]
    vi.stubGlobal('fetch', vi.fn(async () => Response.json(success(replies.shift()))))
    const changed = await execute(`knowledge_document_${action}`, { documentId: 'doc-1', expectedVersion: 0, ...(action === 'replace' ? { fileResourceId: 'file-2' } : {}) })
    expect(changed.isError).toBe(false)
    const processing = await execute('knowledge_document_get', { documentId: 'doc-1' })
    expect(processing.isError).toBe(false)
    expect(JSON.stringify(processing.content)).toContain('当前生效版本：V1')
    expect(JSON.stringify(processing.content)).toContain('待生效版本：V2')
    const search = await execute('knowledge_search', { query: 'q' })
    expect(search.isError).toBe(false)
    expect(JSON.stringify(search.content)).toContain('旧版证据')
    const op = outcome === 'CANCELLED'
      ? await execute('knowledge_operation_cancel', { operationId: 'op-2', reason: '用户取消' })
      : await execute('knowledge_operation_get', { operationId: 'op-2' })
    expect(op.isError).toBe(false)
    const final = await execute('knowledge_document_get', { documentId: 'doc-1' })
    expect(final.isError).toBe(false)
    expect(JSON.stringify(final.content)).toContain(outcome === 'SUCCEEDED' ? '当前生效版本：V2' : `状态：${outcome}`)
    if (outcome === 'FAILED') {
      expect((await execute('knowledge_operation_retry', { operationId: 'op-2', reason: '确认恢复' })).isError).toBe(false)
      const retried = await execute('knowledge_document_get', { documentId: 'doc-1' })
      expect(retried.isError).toBe(false)
      expect(JSON.stringify(retried.content)).toContain('待生效版本：V2')
      expect(JSON.stringify(retried.content)).toContain('操作编号：op-3')
    }
    expect(replies).toHaveLength(0)
    expect(requestApproval).toHaveBeenCalledTimes(outcome === 'SUCCEEDED' ? 1 : 2)
  })

  it('forwards caller cancellation through Harness and Gateway without another attempt', async () => {
    const { execute } = await setup()
    const controller = new AbortController()
    let started!: () => void
    const ready = new Promise<void>(resolve => { started = resolve })
    let observed: AbortSignal | undefined
    const fetch = vi.fn(async (_url, init) => new Promise<Response>((_resolve, reject) => {
      observed = init.signal
      observed!.addEventListener('abort', () => reject(observed!.reason), { once: true })
      started()
    }))
    vi.stubGlobal('fetch', fetch)
    const result = execute('knowledge_search', { query: 'q' }, 'cancelled-call', controller.signal)
    await ready
    controller.abort()
    expect((await result).isError).toBe(true)
    expect(observed?.aborted).toBe(true)
    expect(fetch).toHaveBeenCalledOnce()
  })

  it('spills a large authorized search as complete UTF-8 JSON through the runtime', async () => {
    const { execute, stored, saveText } = await setup()
    const hits = Array.from({ length: 8 }, (_, i) => ({ citationId: `cite-${i}`, documentId: `doc-${i}`, documentName: '制度', chapterPath: ['正文'], content: '文'.repeat(2000), score: 0.9, metadata }))
    const data = { query: '制度', traceId: 'search-trace', hits }
    vi.stubGlobal('fetch', vi.fn(async () => Response.json(success(data))))
    const result = await execute('knowledge_search', { query: '制度' })
    expect(result.isError).toBe(false)
    expect(saveText).toHaveBeenCalledOnce()
    expect(JSON.parse([...stored.values()][0]!)).toEqual(data)
    expect(JSON.stringify(result)).not.toContain('base64')
    expect(JSON.stringify(result)).toContain('spill://')
  })
})
