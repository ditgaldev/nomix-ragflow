import { describe, expect, it } from 'vitest'
import * as root from '../src/index.js'
import * as client from '../src/client.js'
import * as errors from '../src/errors.js'
import * as manifest from '../src/manifest.js'
import * as plugin from '../src/plugin.js'
import * as consumer from '../src/consumer.js'
import * as provider from '../src/provider.js'
import * as service from '../src/service.js'
import * as types from '../src/types.js'

describe('public package entries', () => {
  it('keeps the root free of Harness runtime imports', () => {
    expect(root.RagFlowBusinessClient).toBeTypeOf('function')
    expect(root.BusinessGatewayError).toBeTypeOf('function')
    expect(root.capabilityManifest.standardVersion).toBe('v1')
    expect('apply' in root).toBe(false)
    expect('RagFlowClient' in root).toBe(false)
    expect('RagFlowApiError' in root).toBe(false)
  })

  it('allows every subpath module to load independently', () => {
    expect(client.RagFlowBusinessClient).toBeTypeOf('function')
    expect(errors.BusinessGatewayError).toBeTypeOf('function')
    expect(manifest.capabilityManifest.service).toBe('nomix-ragflow')
    expect(manifest.ragFlowHarnessCapabilityManifest.architecture).toBe('service-provider-consumer')
    expect(service.RagFlowRuntime).toBeTypeOf('function')
    expect(provider.BusinessGatewayRagFlowProvider).toBeTypeOf('function')
    expect(consumer.applyRagFlowConsumer).toBeTypeOf('function')
    expect(Object.keys(types)).toEqual([])
  })

  it('keeps plugin lifecycle metadata on the plugin subpath', () => {
    expect(plugin.name).toBe('nomix-ragflow')
    expect(plugin.inject).toEqual(['ragflow', 'agents', 'tools', 'credentials', 'fs', 'spillStore'])
    expect(plugin.Config).toBeDefined()
    expect(plugin.apply).toBeTypeOf('function')
    expect(plugin.RagFlowBusinessClient).toBeTypeOf('function')
  })
})
