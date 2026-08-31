import { Context, type Fiber } from '@nomix-ai/cordis'
import AgentRegistry, { type Agent } from '@nomix-ai/nomix-agent'
import AgentLoop from '@nomix-ai/nomix-agent-loop'
import CredentialProvider, { type CredentialInfo, type CredentialRef, type ResolvedCredential } from '@nomix-ai/nomix-credentials'
import LocalFileSystem from '@nomix-ai/nomix-fs-local'
import LlmRuntime, { CallId, createUserMessage, LlmAdapter, type GenerateOptions, type StreamChunk } from '@nomix-ai/nomix-llm'
import SessionStore, { SessionId } from '@nomix-ai/nomix-session'
import LocalSpillStore from '@nomix-ai/nomix-spill-local'
import { createScope, type Scope } from '@nomix-ai/nomix-scope'
import SystemPrompt from '@nomix-ai/nomix-system-prompt'
import ToolRuntime, { type PreToolDecision, type ToolExecution, type ToolExecutionResult } from '@nomix-ai/nomix-tools'
import ApprovalService from '@nomix-ai/nomix-user-approval'
import { describe, expect, it } from 'vitest'
import type { RagFlowBusinessClient } from '../src/client.js'
import { RAGFLOW_AGENT_TOOL_NAMES } from '../src/harness-contract.js'
import { apply, inject } from '../src/plugin.js'
import RagFlowRuntime from '../src/service.js'
import { registerRagFlowTools, writeDecision, type RagFlowToolServices } from '../src/tools.js'

interface HarnessEventView {
  type: string
  data: {
    callId?: string
    id?: string
    message?: { content: Array<{ type: string; isError?: boolean }> }
    outcome?: string
    reason?: string
    toolName?: string
  }
}

function eventsOf(agent: Agent): HarnessEventView[] {
  return agent.session.events as unknown as HarnessEventView[]
}

function messagesOf(agent: Agent): Array<{ content: Array<{ type: string }> }> {
  return agent.session.deriveMessages() as unknown as Array<{ content: Array<{ type: string }> }>
}

class TestCredentialProvider extends CredentialProvider {
  token = 'operation-token'
  resolveCalls = 0

  async resolve(_ref: CredentialRef): Promise<ResolvedCredential | undefined> {
    this.resolveCalls += 1
    return this.token ? { value: this.token, source: 'test' } : undefined
  }

  async describe(_ref: CredentialRef): Promise<CredentialInfo> {
    return { configured: Boolean(this.token), source: 'test', writable: true }
  }

  async set(_ref: CredentialRef, value: string): Promise<void> { this.token = value }
  async unset(_ref: CredentialRef): Promise<void> { this.token = '' }
}

class ScriptedRetrievalAdapter extends LlmAdapter {
  readonly requests: GenerateOptions[] = []

  async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    this.requests.push(options)
    if (this.requests.length === 1) {
      const id = CallId('ragflow-retrieval-call')
      const args = JSON.stringify({ input: { question: 'Acme' } })
      const block = { type: 'tool-call' as const, id, name: 'ragflow_retrieval', arguments: args }
      yield { type: 'block-start', index: 0, blockType: 'tool-call' }
      yield { type: 'tool-call-delta', index: 0, id, name: 'ragflow_retrieval', argumentsDelta: args }
      yield { type: 'block-end', index: 0, block }
      yield { type: 'usage', usage: { inputTokens: 10, outputTokens: 5 } }
      yield { type: 'finish', reason: { kind: 'tool-calls' } }
      return
    }
    const block = { type: 'text' as const, text: 'RAGFlow retrieval completed.' }
    yield { type: 'block-start', index: 0, blockType: 'text' }
    yield { type: 'text-delta', index: 0, text: block.text }
    yield { type: 'block-end', index: 0, block }
    yield { type: 'usage', usage: { inputTokens: 15, outputTokens: 4 } }
    yield { type: 'finish', reason: { kind: 'stop' } }
  }
}

class ScriptedDeleteAdapter extends LlmAdapter {
  readonly requests: GenerateOptions[] = []

  async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    this.requests.push(options)
    if (this.requests.length === 1) {
      const id = CallId('ragflow-delete-call')
      const args = JSON.stringify({
        input: {
          action: 'delete',
          operationId: 'delete-confirmed-duplicate-dataset-42',
          datasetId: 'dataset-42',
          version: 7,
        },
      })
      const block = { type: 'tool-call' as const, id, name: 'ragflow_manage_datasets', arguments: args }
      yield { type: 'block-start', index: 0, blockType: 'tool-call' }
      yield { type: 'tool-call-delta', index: 0, id, name: 'ragflow_manage_datasets', argumentsDelta: args }
      yield { type: 'block-end', index: 0, block }
      yield { type: 'usage', usage: { inputTokens: 10, outputTokens: 5 } }
      yield { type: 'finish', reason: { kind: 'tool-calls' } }
      return
    }
    const block = { type: 'text' as const, text: 'RAGFlow dataset deletion completed.' }
    yield { type: 'block-start', index: 0, blockType: 'text' }
    yield { type: 'text-delta', index: 0, text: block.text }
    yield { type: 'block-end', index: 0, block }
    yield { type: 'usage', usage: { inputTokens: 12, outputTokens: 4 } }
    yield { type: 'finish', reason: { kind: 'stop' } }
  }
}

async function mountHarness(root: Context, approval = false): Promise<void> {
  const plugins: ReadonlyArray<readonly [unknown, unknown]> = [
    [SystemPrompt, {}],
    ...(approval ? [[ApprovalService, { policy: 'ask' }] as const] : []),
    [ToolRuntime, {}],
    [LlmRuntime, {}],
    [SessionStore, {}],
    [AgentRegistry, {}],
    [TestCredentialProvider, {}],
    [LocalFileSystem, { cwd: process.cwd() }],
    [LocalSpillStore, {}],
    [RagFlowRuntime, {}],
    [AgentLoop, { agents: [] }],
  ]
  for (const [plugin, config] of plugins) await root.plugin(plugin as never, config as never)
}

describe('real Nomix Harness runtime integration', () => {
  it('runs the exported Service, Provider, Consumer, and AgentLoop through the durable Session log', async () => {
    const root = new Context()
    const fetchCalls: Array<{ url: string; method?: string; authorization?: string }> = []
    const originalFetch = globalThis.fetch
    globalThis.fetch = async (input, init) => {
      fetchCalls.push({
        url: String(input),
        method: init?.method,
        authorization: new Headers(init?.headers).get('authorization') ?? undefined,
      })
      return new Response(JSON.stringify({
        data: { chunks: [{ id: 'chunk-1', content: 'Acme handbook answer' }], total: 1, docAggs: {} },
        meta: { requestId: 'retrieval-request' },
      }), { status: 200, headers: { 'content-type': 'application/json' } })
    }
    try {
      await mountHarness(root)
      const adapter = new ScriptedRetrievalAdapter()
      root.llm.registerAdapter(['ragflow-scripted'], adapter)
      const ragFlowFiber = root.plugin({ name: 'ragflow-real-composition', inject, apply }, {
        baseURL: 'https://ragflow.example.com',
        accessTokenRef: 'RAGFLOW_BUSINESS_ACCESS_TOKEN',
        agentPresets: ['knowledge'],
      }) as Fiber
      await ragFlowFiber

      const handle = await root.agents.create({
        sessionId: SessionId('ragflow-real-agent'),
        meta: { cwd: process.cwd(), agentPreset: 'knowledge' },
        agentOptions: { provider: 'ragflow-scripted', model: 'scripted-model' },
      })
      expect(root.tools.schemas(handle.agent).map(schema => schema.name)).toEqual(RAGFLOW_AGENT_TOOL_NAMES)
      handle.agent.followup(createUserMessage({ content: [{ type: 'text', text: 'Retrieve Acme knowledge.' }], source: { kind: 'user' } }))
      await handle.agent.whenIdle()

      expect(adapter.requests).toHaveLength(2)
      expect(adapter.requests[0]?.tools?.map(tool => tool.name)).toEqual([...RAGFLOW_AGENT_TOOL_NAMES].sort())
      const resultEvent = eventsOf(handle.agent).find(event => event.type === 'tool/result')
      const resultBlock = resultEvent?.data.message?.content[0]
      expect(resultBlock).toMatchObject({ type: 'tool-result', isError: false })
      expect(messagesOf(handle.agent).some(message => message.content.some(block => block.type === 'tool-result'))).toBe(true)
      expect(fetchCalls).toEqual([{
        url: 'https://ragflow.example.com/api/v1/retrieval',
        method: 'POST',
        authorization: 'Bearer operation-token',
      }])
      expect((root.credentials as TestCredentialProvider).resolveCalls).toBe(1)

      await handle.dispose()
      expect(root.tools.schemas(handle.agent)).toEqual([])

      const liveDuringPluginUnload = await root.agents.create({
        sessionId: SessionId('ragflow-plugin-unload-agent'),
        meta: { cwd: process.cwd(), agentPreset: 'knowledge' },
        agentOptions: { provider: 'ragflow-scripted', model: 'scripted-model' },
      })
      expect(root.tools.schemas(liveDuringPluginUnload.agent).map(schema => schema.name)).toEqual(RAGFLOW_AGENT_TOOL_NAMES)
      await ragFlowFiber.dispose()
      expect(root.tools.schemas(liveDuringPluginUnload.agent)).toEqual([])
      await expect(root.ragflow.clientFor({ context: root, credentials: root.credentials })).rejects.toMatchObject({ code: 'RAGFLOW_PROVIDER_UNAVAILABLE' })
      await liveDuringPluginUnload.dispose()
    } finally {
      globalThis.fetch = originalFetch
      await root.fiber.dispose()
    }
  })

  it('records one-time approval with target details before a destructive Gateway call', async () => {
    const root = new Context()
    const fetchCalls: Array<{ url: string; method?: string; authorization?: string; idempotencyKey?: string; version?: string }> = []
    const originalFetch = globalThis.fetch
    globalThis.fetch = async (input, init) => {
      const headers = new Headers(init?.headers)
      fetchCalls.push({
        url: String(input),
        method: init?.method,
        authorization: headers.get('authorization') ?? undefined,
        idempotencyKey: headers.get('idempotency-key') ?? undefined,
        version: headers.get('if-match') ?? undefined,
      })
      return new Response(JSON.stringify({ data: { successCount: 1 }, meta: { requestId: 'delete-request' } }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    }
    try {
      await mountHarness(root, true)
      const adapter = new ScriptedDeleteAdapter()
      root.llm.registerAdapter(['ragflow-delete-scripted'], adapter)
      const ragFlowFiber = root.plugin({ name: 'ragflow-real-approval', inject, apply }, {
        baseURL: 'https://ragflow.example.com',
        accessTokenRef: 'RAGFLOW_BUSINESS_ACCESS_TOKEN',
        agentPresets: ['knowledge'],
      }) as Fiber
      await ragFlowFiber
      const handle = await root.agents.create({
        sessionId: SessionId('ragflow-real-approval-agent'),
        meta: { cwd: process.cwd(), agentPreset: 'knowledge' },
        agentOptions: { provider: 'ragflow-delete-scripted', model: 'scripted-model' },
      })
      const disposeAnswerer = handle.agent.ctx.on('approval/request', async () => 'allowed-once')
      handle.agent.followup(createUserMessage({ content: [{ type: 'text', text: 'Delete the confirmed duplicate dataset.' }], source: { kind: 'user' } }))
      await handle.agent.whenIdle()

      const events = eventsOf(handle.agent)
      const asked = events.find(event => event.type === 'approval/asked')
      const decided = events.find(event => event.type === 'approval/decided')
      expect(asked?.data).toMatchObject({ toolName: 'ragflow_manage_datasets', callId: 'ragflow-delete-call' })
      expect(asked?.data.reason).toContain('datasetId=dataset-42')
      expect(asked?.data.reason).toContain('version=7')
      expect(asked?.data.reason).toContain('operationId=delete-confirmed-duplicate-dataset-42')
      expect(decided?.data).toMatchObject({ id: asked?.data.id, outcome: 'allowed-once' })
      const eventTypes = events.map(event => event.type)
      expect(eventTypes.indexOf('approval/asked')).toBeLessThan(eventTypes.indexOf('approval/decided'))
      expect(eventTypes.indexOf('approval/decided')).toBeLessThan(eventTypes.indexOf('tool/result'))
      expect(fetchCalls).toHaveLength(1)
      expect(fetchCalls[0]).toMatchObject({
        url: 'https://ragflow.example.com/api/v1/datasets/dataset-42',
        method: 'DELETE',
        authorization: 'Bearer operation-token',
        version: '7',
        idempotencyKey: expect.stringMatching(/^agent:[a-f0-9]{64}$/),
      })
      const result = events.find(event => event.type === 'tool/result')
      expect(result?.data.message?.content[0]).toMatchObject({ type: 'tool-result', isError: false })

      disposeAnswerer()
      await handle.dispose()
      await ragFlowFiber.dispose()
    } finally {
      globalThis.fetch = originalFetch
      await root.fiber.dispose()
    }
  })

  it('keeps tools Agent-scoped, schedules reads in parallel, validates output, emits durable results, gates writes, and disposes cleanly', async () => {
    const root = new Context()
    const promptFiber = root.plugin(SystemPrompt, {})
    await promptFiber
    const toolsFiber = root.plugin(ToolRuntime, {})
    await toolsFiber

    const search = async () => ({ data: { chunks: [{ id: 'chunk-1', content: 'answer' }], total: 1, docAggs: {} }, meta: { requestId: 'search' } })
    let deleteCalls = 0
    const deleteDataset = async () => { deleteCalls += 1; return { successCount: 1 } }
    const services: RagFlowToolServices = {
      client: async () => ({ retrieval: { search }, datasets: { delete: deleteDataset } } as unknown as RagFlowBusinessClient),
      spillText: async () => ({ kind: 'spill', name: 'result.json', locator: '/spill/result.json', mimeType: 'application/json', encoding: 'utf8', bytes: 1, storedBytes: 1, retrievalHint: 'read result' }),
      spillBytes: async () => ({ kind: 'spill', name: 'artifact.bin.base64', locator: '/spill/artifact', mimeType: 'text/plain', encoding: 'base64', originalName: 'artifact.bin', originalMimeType: 'application/octet-stream', bytes: 1, storedBytes: 4, retrievalHint: 'decode result' }),
      uploadDocument: async () => [],
      downloadArtifact: async () => ({ kind: 'spill', name: 'artifact.bin.base64', locator: '/spill/artifact', mimeType: 'text/plain', encoding: 'base64', originalName: 'artifact.bin', originalMimeType: 'application/octet-stream', bytes: 1, storedBytes: 4, retrievalHint: 'decode result' }),
    }

    const agent = { id: 'ragflow-runtime-agent', session: { header: { cwd: 'D:\\workspace', agentPreset: 'knowledge' } } } as unknown as Agent
    let agentScope: Scope | undefined
    let resultEvent: Readonly<ToolExecutionResult> | undefined
    const composition = {
      inject: ['tools'],
      apply(ctx: Context) {
        agentScope = createScope(ctx, agent)
        const agentCtx = agentScope.ctx.extend({ agent })
        ;(agent as unknown as { ctx: Context }).ctx = agentCtx
        const disposeTools = registerRagFlowTools(agentCtx as never, services)
        const disposeApproval = agentCtx.on('tools/pre-execute', (exec: ToolExecution, next: () => Promise<PreToolDecision>) => writeDecision(exec.name, exec.arguments, next))
        const disposeResult = agentCtx.on('tools/result', (_exec: ToolExecution, result: Readonly<ToolExecutionResult>) => { resultEvent = result })
        return async () => {
          disposeResult()
          disposeApproval()
          disposeTools()
          await agentScope?.dispose()
        }
      },
    }
    const compositionFiber = root.plugin(composition, undefined) as Fiber
    await compositionFiber

    try {
      expect(root.tools.schemas()).toEqual([])
      expect(root.tools.schemas(agent).map(schema => schema.name)).toEqual(RAGFLOW_AGENT_TOOL_NAMES)

      const signal = new AbortController().signal
      const searchExecution = { callId: 'search-1', name: 'ragflow_retrieval', arguments: { input: { question: 'Acme' } }, agent, signal } as const
      const deleteExecution = {
        callId: 'delete-1',
        name: 'ragflow_manage_datasets',
        arguments: { input: { action: 'delete', operationId: 'delete-dataset-1', datasetId: 'dataset-1', version: 1 } },
        agent,
        signal,
      } as const
      expect(root.tools.executionMode(searchExecution)).toEqual({ kind: 'parallel' })
      expect(root.tools.executionMode(deleteExecution)).toEqual({ kind: 'exclusive' })

      const result = await root.tools.execute(searchExecution)
      expect(result.isError).toBe(false)
      if (result.isError) throw new Error(result.error.message)
      expect(result.value).toMatchObject({ status: 'success', data: { kind: 'retrieval', format: 'json-entries', truncated: false } })
      expect(result.content[0]).toMatchObject({ type: 'text' })
      expect(resultEvent).toBe(result)
      expect(Object.isFrozen(resultEvent)).toBe(true)

      const destructive = await root.tools.execute(deleteExecution)
      expect(destructive.isError).toBe(true)
      expect(deleteCalls).toBe(0)

      await agentScope!.dispose()
      expect(root.tools.schemas(agent)).toEqual([])
    } finally {
      await compositionFiber.dispose()
      await toolsFiber.dispose()
      await promptFiber.dispose()
      await root.fiber.dispose()
    }
  })
})
