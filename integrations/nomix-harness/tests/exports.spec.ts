import { describe, expect, it } from 'vitest'
import * as root from '../src/index.js'
import * as plugin from '../packages/dsh-bundle-ragflow-knowledge/plugin.js'
import BusinessIdentity, { BusinessIdentityRuntime } from '../packages/dsh-business-identity/business-identity.js'
import Service, { KnowledgeRuntime } from '../packages/dsh-knowledge/service.js'
import { KnowledgeGatewayProvider } from '../packages/dsh-knowledge-gateway/provider.js'
import { applyKnowledgeConsumer } from '../packages/dsh-bundle-ragflow-knowledge/consumer.js'

describe('package entry points', () => {
  it('exports knowledge manifests at root while the plugin uses the knowledge runtime', () => {
    expect(root.knowledgeGatewayCapabilityManifest.service).toBe('knowledge-gateway')
    expect(root.RagFlowBusinessClient).toBeTypeOf('function')
    expect(root.RagFlowApiError).toBeTypeOf('function')
    expect(plugin).not.toHaveProperty('RagFlowBusinessClient')
    expect(plugin.name).toBe('nomix-ragflow')
    expect(Service).toBe(KnowledgeRuntime)
    expect(BusinessIdentity).toBe(BusinessIdentityRuntime)
    expect(KnowledgeGatewayProvider).toBeTypeOf('function')
    expect(applyKnowledgeConsumer).toBeTypeOf('function')
  })
})
