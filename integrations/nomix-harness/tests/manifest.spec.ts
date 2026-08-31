import { describe, expect, it } from 'vitest'
import { RagFlowBusinessClient } from '../src/client.js'
import { RAGFLOW_AGENT_TOOL_NAMES } from '../src/harness-contract.js'
import { agentCapability, capabilityManifest, ragFlowHarnessCapabilityManifest } from '../src/manifest.js'

describe('canonical capability manifest', () => {
  it('has unique operations and routes with v1 identity', () => {
    expect(capabilityManifest).toMatchObject({ standardVersion: 'v1', service: 'nomix-ragflow', plane: 'data' })
    const operations = capabilityManifest.operations.map(item => item.operation)
    const routes = capabilityManifest.operations.map(item => `${item.method} ${item.path}`)
    expect(new Set(operations).size).toBe(operations.length)
    expect(new Set(routes).size).toBe(routes.length)
  })

  it('resolves every declared client method and stable Agent tool', () => {
    const client = new RagFlowBusinessClient({ baseURL: 'https://gateway.example.com', accessToken: 'token' })
    const tools = new Set<string>(RAGFLOW_AGENT_TOOL_NAMES)
    for (const capability of capabilityManifest.operations) {
      const [domain, method] = capability.clientMethod.split('.')
      expect(domain, capability.operation).toBeTruthy()
      expect(method, capability.operation).toBeTruthy()
      const group = client[domain as keyof RagFlowBusinessClient] as unknown as Record<string, unknown>
      expect(group, capability.clientMethod).toBeDefined()
      expect(group[method as string], capability.clientMethod).toBeTypeOf('function')
      if (capability.agentTool !== undefined) expect(tools.has(capability.agentTool), capability.operation).toBe(true)
    }
  })

  it('gives every Agent operation one unique tool/action/kind binding', () => {
    const agentOperations = capabilityManifest.operations.filter(capability => capability.agentTool !== undefined)
    const bindings = agentOperations.map(capability => `${capability.agentTool}:${capability.agentAction}:${capability.agentKind ?? ''}`)
    expect(agentOperations.every(capability => Boolean(capability.agentAction))).toBe(true)
    expect(new Set(bindings).size).toBe(bindings.length)
    for (const capability of agentOperations) {
      expect(agentCapability(capability.operation, capability.agentTool!, capability.agentAction!, capability.agentKind)).toBe(capability)
    }
    expect(() => agentCapability('datasets.create', 'ragflow_manage_datasets', 'list')).toThrow(/does not match/)
  })

  it('requires idempotency for every Agent write represented by POST creation or invocation', () => {
    for (const capability of capabilityManifest.operations.filter(item => item.risk !== 'read' && item.method === 'POST')) {
      expect(capability.idempotency, capability.operation).toBe('required')
    }
  })

  it('describes the same Harness architecture as CRM without granting permissions', () => {
    expect(ragFlowHarnessCapabilityManifest).toMatchObject({
      architecture: 'service-provider-consumer',
      agentSelection: 'agent-scope-or-preset-or-explicit-all',
      rootSelectionRequired: true,
      providerSelection: 'explicit-or-exactly-one',
      credentialResolution: 'agent-context-per-operation',
      configurationValidation: 'load-time-before-registration',
      discovery: 'redacted-authorization-summary',
      idempotency: 'agent-business-intent-operation-id',
      toolTimeout: 'gateway-deadline-plus-artifact-grace',
      concurrency: 'read-parallel-write-exclusive',
      output: 'closed-discriminated-observation',
    })
    expect(ragFlowHarnessCapabilityManifest.artifactPlane).toMatchObject({
      text: 'spill-text',
      nativeBinary: false,
      defaultMaxStoredBytes: expect.any(Number),
      effectiveDefaultMaxBinaryBytes: expect.any(Number),
    })
    expect(ragFlowHarnessCapabilityManifest.tools).toEqual(RAGFLOW_AGENT_TOOL_NAMES)
    expect(ragFlowHarnessCapabilityManifest).not.toHaveProperty('actions')
  })
})
