import { Context } from '@nomix-ai/nomix-harness/plugin'
import type { Agent } from '@nomix-ai/nomix-harness/plugin/agent'
import { createScope } from '@nomix-ai/nomix-harness/plugin/scope'
import { SystemPrompt, renderPrompt } from '@nomix-ai/nomix-harness/plugin/system-prompt'
import { ToolRuntime } from '@nomix-ai/nomix-harness/plugin/tools'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { applyKnowledgeConsumer } from '../packages/dsh-bundle-ragflow-knowledge/consumer.js'
import { KNOWLEDGE_EVIDENCE_INSTRUCTIONS } from '../packages/dsh-knowledge-policy/policy.js'
import { documentDetail } from './knowledge-fixtures.js'

// Real Cordis scopes, prompt registry, schema pipeline and approval dispatch.
// Only Agent session records and external business services are test doubles.
const roots: Context[] = []
afterEach(async () => { await Promise.all(roots.splice(0).map(ctx => ctx.fiber.dispose())) })

function setup() {
  const root = new Context()
  roots.push(root)
  const prompt = new SystemPrompt(root, { includeHarnessIdentity: false })
  const tools = new ToolRuntime(root)
  const search = vi.fn(async () => ({ hits: [], reason: 'NO_AUTHORIZED_RELEVANT_EVIDENCE' }))
  const reindexDocument = vi.fn(async () => ({ documentId: 'doc-1', operationId: 'op-1', status: 'PENDING' }))
  const getDocument = vi.fn(async () => documentDetail({ status: 'CREATING', searchable: false, activeVersion: null }))
  const forOperation = vi.fn(async () => ({ search, reindexDocument, getDocument }))
  root.provide('knowledge', { forOperation } as never)
  root.provide('businessIdentity', {} as never)
  root.provide('credentials', {} as never)
  root.provide('spillStore', {} as never)
  const agent = { id: 'session-1', session: { header: { agentPreset: 'maintainer' } } } as unknown as Agent
  const scope = createScope(root, agent)
  Object.assign(agent, { ctx: scope.ctx.extend({ agent }) })
  root.provide('agents', { list: () => [agent] } as never)
  applyKnowledgeConsumer(root, { agentToolsets: [{ agentPreset: 'maintainer', toolset: 'write' }] })
  const execute = (name: string, input: unknown) => tools.execute({ agent, name, callId: 'call-1' as never, arguments: { input }, signal: new AbortController().signal })
  return { root, prompt, tools, agent, scope, execute, search, reindexDocument, forOperation }
}

describe('Harness 0.2.9 knowledge integration', () => {
  it('installs evidence guidance and exactly sixteen tools only in the selected Agent scope', async () => {
    const { prompt, agent, scope } = setup()
    const selected = await prompt.assemble({ scope: agent })
    expect(renderPrompt(selected)).toContain(KNOWLEDGE_EVIDENCE_INSTRUCTIONS)
    expect(selected.tools).toHaveLength(16)
    const outside = await prompt.assemble({ scope: {} })
    expect(outside.tools).toHaveLength(0)
    expect(renderPrompt(outside)).not.toContain(KNOWLEDGE_EVIDENCE_INSTRUCTIONS)
    await scope.dispose()
    expect((await prompt.assemble({ scope: agent })).tools).toHaveLength(0)
    expect(renderPrompt(await prompt.assemble({ scope: agent }))).not.toContain(KNOWLEDGE_EVIDENCE_INSTRUCTIONS)
  })

  it('passes the no-evidence result through the actual Harness output schema', async () => {
    const { execute, search } = setup()
    const result = await execute('knowledge_search', { query: '内部政策', documentIds: [] })
    expect(result.isError).toBe(false)
    expect(search).toHaveBeenCalledOnce()
    expect(JSON.stringify(result)).toContain('不得根据常识伪造企业内部规则')
  })

  it('passes a newly created document with no active version through the actual output schema', async () => {
    const { execute } = setup()
    const result = await execute('knowledge_document_get', { documentId: 'doc-1' })
    expect(result.isError).toBe(false)
    expect(JSON.stringify(result)).toContain('CREATING')
  })

  it('fails closed without approval support and dispatches only after allowed-once', async () => {
    const { root, execute, reindexDocument } = setup()
    const input = { documentId: 'doc-1', expectedVersion: 1 }
    expect((await execute('knowledge_document_reindex', input)).isError).toBe(true)
    expect(reindexDocument).not.toHaveBeenCalled()
    const request = vi.fn(async () => 'rejected')
    root.provide('approval', { request } as never)
    expect((await execute('knowledge_document_reindex', input)).isError).toBe(true)
    expect(reindexDocument).not.toHaveBeenCalled()
    request.mockResolvedValue('allowed-once')
    expect((await execute('knowledge_document_reindex', input)).isError).toBe(false)
    expect(reindexDocument).toHaveBeenCalledOnce()
    expect(request).toHaveBeenCalledTimes(2)
  })

  it('rejects undeclared inputs before business dispatch in the actual runtime', async () => {
    const { execute, forOperation } = setup()
    expect((await execute('knowledge_search', { query: 'q', datasetId: 'raw' })).isError).toBe(true)
    expect(forOperation).not.toHaveBeenCalled()
  })

  it('does not expose service exceptions to the model', async () => {
    const { execute, forOperation } = setup()
    forOperation.mockRejectedValue(new TypeError('Header synthetic-private-token https://private-ragflow/model-id'))
    const result = await execute('knowledge_search', { query: 'q' })
    expect(result.isError).toBe(true)
    expect(JSON.stringify(result)).not.toMatch(/synthetic-private-token|private-ragflow|model-id/u)
  })
})
