import value from './capabilities.generated.json' with { type: 'json' }
import { DEFAULT_RAGFLOW_AGENT_ARTIFACT_MAX_BYTES, effectiveBinaryArtifactBytes, RAGFLOW_AGENT_TOOL_NAMES } from './harness-contract.js'

export type CapabilityRisk = 'read' | 'write' | 'destructive'
export type CapabilityIdempotency = 'none' | 'supported' | 'required'

export interface BusinessGatewayCapability {
  operation: string
  method: string
  path: string
  requiredAction: string
  additionalRequiredActions: string[]
  resourceType: string
  risk: CapabilityRisk
  idempotency: CapabilityIdempotency
  clientMethod: string
  agentTool?: string
  agentAction?: string
  agentKind?: 'chat' | 'agent'
}

export interface BusinessGatewayCapabilityManifest {
  standardVersion: 'v1'
  service: 'nomix-ragflow'
  plane: 'data'
  operations: BusinessGatewayCapability[]
}

/** Generated package snapshot of the server's canonical capability manifest. */
export const capabilityManifest = value as BusinessGatewayCapabilityManifest

const capabilitiesByOperation = new Map(capabilityManifest.operations.map(capability => [capability.operation, capability]))
const agentToolNames = new Set(capabilityManifest.operations.flatMap(capability => capability.agentTool === undefined ? [] : [capability.agentTool]))

export function isRagFlowAgentTool(name: string): boolean {
  return agentToolNames.has(name)
}

/** Resolve and validate the canonical REST operation used by one Agent action. */
export function agentCapability(
  operation: string,
  tool: string,
  action: string,
  kind?: 'chat' | 'agent',
): BusinessGatewayCapability {
  const capability = capabilitiesByOperation.get(operation)
  if (capability === undefined
    || capability.agentTool !== tool
    || capability.agentAction !== action
    || capability.agentKind !== kind) {
    throw new Error(`Agent binding ${tool}.${action}${kind === undefined ? '' : `.${kind}`} does not match canonical operation ${operation}`)
  }
  return capability
}

/** Return every canonical operation represented by a concrete Agent action. */
export function agentCapabilities(tool: string, action: string): readonly BusinessGatewayCapability[] {
  return capabilityManifest.operations.filter(capability => capability.agentTool === tool && capability.agentAction === action)
}

/** Harness composition metadata. This describes capabilities and grants no permission. */
export const ragFlowHarnessCapabilityManifest = {
  standardVersion: 'v1',
  service: 'nomix-ragflow',
  architecture: 'service-provider-consumer',
  tools: RAGFLOW_AGENT_TOOL_NAMES,
  agentSelection: 'agent-scope-or-preset-or-explicit-all',
  rootSelectionRequired: true,
  providerSelection: 'explicit-or-exactly-one',
  credentialResolution: 'agent-context-per-operation',
  networkClient: 'RagFlowBusinessClient',
  configurationValidation: 'load-time-before-registration',
  discovery: 'redacted-authorization-summary',
  riskAndApprovalSource: 'business-gateway-capability-manifest',
  concurrency: 'read-parallel-write-exclusive',
  idempotency: 'agent-business-intent-operation-id',
  toolTimeout: 'gateway-deadline-plus-artifact-grace',
  output: 'closed-discriminated-observation',
  artifactPlane: {
    text: 'spill-text',
    binary: 'base64-text-spill-fallback',
    nativeBinary: false,
    defaultMaxStoredBytes: DEFAULT_RAGFLOW_AGENT_ARTIFACT_MAX_BYTES,
    effectiveDefaultMaxBinaryBytes: effectiveBinaryArtifactBytes(DEFAULT_RAGFLOW_AGENT_ARTIFACT_MAX_BYTES),
  },
} as const
