import knowledgeValue from '../packages/dsh-knowledge/knowledge-capabilities.generated.json' with { type: 'json' }
import { KNOWLEDGE_AGENT_TOOL_NAMES, TOOLSET_TOOLS } from '../packages/dsh-knowledge/harness-contract.js'

export interface KnowledgeGatewayCapability {
  operation: string
  method: string
  path: string
  tool: string
  actions: string[]
  risk: 'read' | 'write' | 'admin'
  approval: 'allow' | 'ask'
  concurrency: 'parallel' | 'exclusive'
  retrySafe: boolean
  idempotency: 'none' | 'required'
  requestSchema?: string
  querySchema?: string
  responseSchema: string
  toolSchema: string
}

export interface KnowledgeGatewayCapabilityManifest {
  standardVersion: 'v1'
  service: 'knowledge-gateway'
  source: 'Knowledge Gateway OpenAPI'
  requiredHeaders: string[]
  businessRules: {
    authorizationOwner: 'business-knowledge-gateway'
    identitySource: 'dsh-business-identity-session-binding'
    providerSelectionOwner: 'business-knowledge-gateway'
    pageIndex: { owner: 'ragflow'; treeExposure: 'none'; tuningExposure: 'none' }
    lifecycle: {
      space: string[]
      document: string[]
      version: string[]
      operation: string[]
    }
    searchEligibility: { documentStatus: 'ACTIVE'; activeVersionStatus: 'READY' }
    searchLimits: { maximumHits: 8; maximumHitsPerDocument: 4; maximumHitCodePoints: 2500; maximumTotalCodePoints: 16000 }
    citationContext: { unit: 'unicode-code-point'; defaultBefore: 1000; defaultAfter: 1000; maximumBefore: 5000; maximumMatch: 2500; maximumAfter: 5000; maximumTotal: 12500 }
    download: { activeVersionOnly: true; fixedExpirySeconds: 60; binaryTransfer: false }
    writeCardinality: 'single-resource'
    idempotency: 'tool-call-derived-header'
    automaticRetry: { owner: 'gateway-worker'; sameOperation: true; maximumAttempts: 5 }
    manualRetry: { createsChildOperation: true; maximumAttempts: 3 }
    approvalPolicy: { allow: string[]; ask: string[] }
  }
  operations: KnowledgeGatewayCapability[]
}

export const knowledgeGatewayCapabilityManifest = knowledgeValue as KnowledgeGatewayCapabilityManifest

/** Agent-facing capability contract. Authorization and provider mapping remain Gateway-only. */
export const knowledgeHarnessCapabilityManifest = {
  standardVersion: 'v1',
  service: 'knowledge-gateway',
  package: '@nomix-ai/nomix-ragflow',
  architecture: 'business-identity-service-provider-consumer',
  endpointPrefix: '/internal/v1/knowledge/',
  tools: KNOWLEDGE_AGENT_TOOL_NAMES,
  toolsets: TOOLSET_TOOLS,
  identity: ['harness-service-token', 'session-bound-user-assertion'],
  identityBinding: 'dsh-business-identity',
  authorization: 'gateway-only',
  concurrency: 'contract-policy-per-tool',
  idempotency: 'harness-tool-execution-derived',
  binary: false,
  spill: 'utf8-json-saveText',
  responseValidation: 'generated-openapi-runtime',
  responseReadLimit: 'artifactMaxBytes',
  pageIndex: knowledgeGatewayCapabilityManifest.businessRules.pageIndex,
  operations: knowledgeGatewayCapabilityManifest.operations,
} as const
