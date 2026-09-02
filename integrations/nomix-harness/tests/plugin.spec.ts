import { Context } from '@nomix-ai/nomix-harness/plugin'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { assertRagFlowConsumerConfiguration } from '../src/consumer.js'
import { MAX_RAGFLOW_AGENT_UPLOAD_BYTES, RAGFLOW_TOOL_TIMEOUT_GRACE_MS } from '../src/harness-contract.js'
import * as plugin from '../src/plugin.js'
import { BusinessGatewayRagFlowProvider } from '../src/provider.js'
import { RagFlowRuntime, type RagFlowProvider } from '../src/service.js'

afterEach(() => vi.unstubAllGlobals())

interface RegisteredTool {
  name: string
  timeoutMs?: number
  execute(args: unknown, exec: unknown): Promise<unknown>
}

function pluginHarness(agentPreset = 'knowledge-worker') {
  const definitions = new Map<string, RegisteredTool>()
  const approvalHooks: unknown[] = []
  const effects: Array<() => void> = []
  let provider: { createClient(operation: unknown): Promise<unknown> } | undefined
  const ragflow = {
    registerProvider(value: typeof provider) {
      provider = value
      const dispose = () => { if (provider === value) provider = undefined }
      effects.push(dispose)
      return dispose
    },
    clientFor(operation: unknown) {
      if (!provider) throw new Error('provider unavailable')
      return provider.createClient(operation)
    },
  }
  const agentCtx: Record<string, unknown> = {
    ragflow,
    credentials: { resolve: async () => ({ value: 'agent-token', source: 'test' }) },
    tools: { register: (definition: RegisteredTool) => { definitions.set(definition.name, definition); return () => definitions.delete(definition.name) } },
    fs: {},
    spillStore: { saveText: async () => ({ locator: '/spill/result', bytes: 1, retrievalHint: 'read result' }) },
    on: (name: string, listener: unknown) => {
      if (name === 'tools/pre-execute') approvalHooks.push(listener)
      return () => approvalHooks.splice(approvalHooks.indexOf(listener), 1)
    },
  }
  agentCtx.get = (key: string) => agentCtx[key]
  const agent = { id: 'session-1', session: { header: { cwd: 'D:\\workspace', agentPreset } }, ctx: agentCtx }
  agentCtx.agent = agent
  const root = {
    ragflow,
    agents: { list: () => [agent] },
    effect(factory: () => () => void) {
      const nested = factory()
      let active = true
      const dispose = () => { if (active) { active = false; nested() } }
      effects.push(dispose)
      return dispose
    },
    on: () => () => undefined,
  }
  return { root, agent, definitions, approvalHooks, dispose: () => effects.reverse().forEach(dispose => dispose()) }
}

describe('Service / Provider / Consumer composition', () => {
  it('keeps the composition metadata aligned with Agent-scoped dependencies', () => {
    expect(plugin.name).toBe('nomix-ragflow')
    expect(plugin.inject).toEqual(['ragflow', 'agents', 'tools', 'credentials', 'fs', 'spillStore'])
    expect(plugin.Config).toBeDefined()
    expect(plugin.apply).toBeTypeOf('function')
  })

  it('fails closed when a root Consumer has no explicit Agent selection', () => {
    expect(() => assertRagFlowConsumerConfiguration({} as never, {})).toThrow(/agentPresets|attachToAllAgents/)
    expect(() => assertRagFlowConsumerConfiguration({} as never, { agentPresets: ['sales'], attachToAllAgents: true })).toThrow(/either agentPresets/)
    expect(() => assertRagFlowConsumerConfiguration({ agent: {} } as never, {})).not.toThrow()
  })

  it('rejects Agent upload budgets above the bounded in-memory ceiling', () => {
    expect(() => assertRagFlowConsumerConfiguration({ agent: {} } as never, {
      maxFileBytes: MAX_RAGFLOW_AGENT_UPLOAD_BYTES + 1,
    })).toThrow(/maxFileBytes/)
    expect(() => assertRagFlowConsumerConfiguration({ agent: {} } as never, {
      maxFileBytes: MAX_RAGFLOW_AGENT_UPLOAD_BYTES,
    })).not.toThrow()
  })

  it('mounts tools and approval only in selected Agent contexts and cleans them up', () => {
    const harness = pluginHarness()
    plugin.apply(harness.root as never, {
      baseURL: 'https://ragflow-gateway.example.com',
      accessTokenRef: 'BUSINESS_TOKEN',
      agentPresets: ['knowledge-worker'],
    })
    expect([...harness.definitions]).toHaveLength(10)
    expect([...harness.definitions.values()].every(definition => definition.timeoutMs === 90_000)).toBe(true)
    expect(harness.approvalHooks).toHaveLength(1)
    expect('tools' in harness.root).toBe(false)
    harness.dispose()
    expect(harness.definitions.size).toBe(0)
    expect(harness.approvalHooks).toHaveLength(0)
  })

  it('derives every tool deadline from the Gateway request timeout plus artifact grace', () => {
    const harness = pluginHarness()
    plugin.apply(harness.root as never, {
      baseURL: 'https://ragflow-gateway.example.com',
      accessTokenRef: 'BUSINESS_TOKEN',
      requestTimeoutMs: 123_000,
      agentPresets: ['knowledge-worker'],
    })
    expect([...harness.definitions.values()].every(definition => definition.timeoutMs === 123_000 + RAGFLOW_TOOL_TIMEOUT_GRACE_MS)).toBe(true)
    harness.dispose()
  })

  it('does not attach tools to an Agent outside the preset allow-list', () => {
    const harness = pluginHarness('general')
    plugin.apply(harness.root as never, {
      baseURL: 'https://ragflow-gateway.example.com',
      accessTokenRef: 'BUSINESS_TOKEN',
      agentPresets: ['knowledge-worker'],
    })
    expect(harness.definitions.size).toBe(0)
    expect(harness.approvalHooks).toHaveLength(0)
    harness.dispose()
  })

  it('rejects execution objects owned by a different Agent', async () => {
    const harness = pluginHarness()
    plugin.apply(harness.root as never, {
      baseURL: 'https://ragflow-gateway.example.com',
      accessTokenRef: 'BUSINESS_TOKEN',
      attachToAllAgents: true,
    })
    const discover = harness.definitions.get('ragflow_discover')!
    await expect(discover.execute({ input: { action: 'context' } }, {
      name: 'ragflow_discover',
      callId: 'cross-agent',
      signal: new AbortController().signal,
      agent: { id: 'other-agent' },
    })).rejects.toThrow(/Agent context that registered/)
    harness.dispose()
  })

  it('selects an explicit Provider or exactly one available Provider', async () => {
    const root = new Context()
    const runtime = new RagFlowRuntime(root)
    const client = {} as never
    const provider = (id: string): RagFlowProvider => ({ id, available: () => true, createClient: async () => client })
    const disposeA = runtime.registerProvider(provider('a'))
    expect(await runtime.clientFor({ context: root, credentials: {} as never })).toBe(client)
    const disposeB = runtime.registerProvider(provider('b'))
    await expect(runtime.clientFor({ context: root, credentials: {} as never })).rejects.toMatchObject({ code: 'RAGFLOW_PROVIDER_AMBIGUOUS' })
    expect(await runtime.clientFor({ context: root, credentials: {} as never, providerId: 'b' })).toBe(client)
    disposeB()
    disposeA()
    await expect(runtime.clientFor({ context: root, credentials: {} as never })).rejects.toMatchObject({
      code: 'RAGFLOW_PROVIDER_UNAVAILABLE',
      retryable: false,
    })
    await root.fiber.dispose()
  })

  it('applies the effective base64 binary limit before buffering a download', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(new Uint8Array(7), {
      headers: { 'content-type': 'application/octet-stream', 'content-length': '7' },
    })))
    const harness = pluginHarness()
    plugin.apply(harness.root as never, {
      baseURL: 'https://ragflow-gateway.example.com',
      accessTokenRef: 'BUSINESS_TOKEN',
      artifactMaxBytes: 8,
      attachToAllAgents: true,
    })
    const transfer = harness.definitions.get('ragflow_transfer_documents')!
    await expect(transfer.execute({ input: {
      action: 'download',
      datasetId: 'dataset-1',
      documentId: 'document-1',
      fileName: 'bounded.bin',
    } }, {
      name: 'ragflow_transfer_documents',
      callId: 'bounded-download',
      signal: new AbortController().signal,
      agent: harness.agent,
    })).rejects.toThrow(/6-byte Agent artifact limit/)
    harness.dispose()
  })

  it('resolves a rotated credential once per Agent operation and never from a root/global credential service', async () => {
    const authorizations: string[] = []
    vi.stubGlobal('fetch', vi.fn(async (_url: URL, init: RequestInit) => {
      authorizations.push(new Headers(init.headers).get('authorization') ?? '')
      return new Response(JSON.stringify({ data: [], meta: { requestId: 'request-list', hasNext: false, nextCursor: null } }), {
        headers: { 'content-type': 'application/json' },
      })
    }))
    let token = 'token-agent-a'
    const resolve = vi.fn(async () => ({ value: token, source: 'agent-session' }))
    const provider = new BusinessGatewayRagFlowProvider('https://ragflow-gateway.example.com', 'BUSINESS_TOKEN', 1_000)
    const operationContext = {} as never
    const credentials = { resolve } as never

    const first = await provider.createClient({ context: operationContext, credentials })
    await Promise.all([first.datasets.list(), first.datasets.list()])
    token = 'token-agent-b'
    const second = await provider.createClient({ context: operationContext, credentials })
    await second.datasets.list()

    expect(resolve).toHaveBeenCalledTimes(2)
    expect(authorizations).toEqual(['Bearer token-agent-a', 'Bearer token-agent-a', 'Bearer token-agent-b'])
  })

  it('redacts credential-provider failure details at the Provider boundary', async () => {
    const provider = new BusinessGatewayRagFlowProvider('https://ragflow-gateway.example.com', 'BUSINESS_TOKEN', 1_000)
    const error = await provider.createClient({
      context: {} as never,
      credentials: { resolve: async () => { throw new Error('provider echoed super-secret-token') } } as never,
    }).catch(value => value) as Error & { cause?: unknown }
    expect(error).toMatchObject({ code: 'TOKEN_PROVIDER_FAILED', status: 503 })
    expect(`${error.message} ${String(error.cause)} ${JSON.stringify(error)}`).not.toContain('super-secret-token')
  })

  it('does not share operation-local tokens between concurrent Agent contexts', async () => {
    const seen: string[] = []
    vi.stubGlobal('fetch', vi.fn(async (_url: URL, init: RequestInit) => {
      seen.push(new Headers(init.headers).get('authorization') ?? '')
      return new Response(JSON.stringify({ data: [], meta: { requestId: 'request-list', hasNext: false, nextCursor: null } }), {
        headers: { 'content-type': 'application/json' },
      })
    }))
    const provider = new BusinessGatewayRagFlowProvider('https://ragflow-gateway.example.com', 'BUSINESS_TOKEN', 1_000)
    const credentials = (value: string) => ({ resolve: async () => ({ value, source: 'agent-session' }) }) as never
    const [clientA, clientB] = await Promise.all([
      provider.createClient({ context: {} as never, credentials: credentials('token-agent-a') }),
      provider.createClient({ context: {} as never, credentials: credentials('token-agent-b') }),
    ])
    await Promise.all([clientA.datasets.list(), clientB.datasets.list()])
    expect(seen.sort()).toEqual(['Bearer token-agent-a', 'Bearer token-agent-b'])
  })
})
