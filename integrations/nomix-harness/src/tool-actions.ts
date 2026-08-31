import { BusinessGatewayError } from './errors.js'
import { RAGFLOW_AGENT_TOOL_NAMES, type RagFlowAgentToolName } from './harness-contract.js'
import { agentCapabilities, type BusinessGatewayCapability } from './manifest.js'

type Input = Record<string, unknown>

function inputObject(value: unknown): Input {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new BusinessGatewayError('RAGFlow tool input must be an object', {
      code: 'RAGFLOW_TOOL_INPUT_INVALID',
      status: 422,
    })
  }
  return value as Input
}

export function isRagFlowAgentToolName(value: string): value is RagFlowAgentToolName {
  return (RAGFLOW_AGENT_TOOL_NAMES as readonly string[]).includes(value)
}

/** Resolve every canonical operation represented by a concrete tool action. */
export function resolveRagFlowToolCapabilities(tool: string, inputValue: unknown): readonly BusinessGatewayCapability[] {
  if (!isRagFlowAgentToolName(tool)) {
    throw new BusinessGatewayError(`Tool ${tool} is not a RAGFlow Agent tool`, {
      code: 'RAGFLOW_TOOL_ACTION_UNMAPPED',
      status: 422,
    })
  }
  const input = inputObject(inputValue)
  const action = tool === 'ragflow_retrieval' ? 'search' : input.action
  if (typeof action !== 'string' || !action) {
    throw new BusinessGatewayError(`RAGFlow tool ${tool} is missing a canonical action`, {
      code: 'RAGFLOW_TOOL_INPUT_INVALID',
      status: 422,
    })
  }
  const kind = input.kind === 'chat' || input.kind === 'agent' ? input.kind : undefined
  const candidates = agentCapabilities(tool, action)
  const capabilities = kind === undefined
    ? candidates.filter(capability => capability.agentKind === undefined)
    : candidates.filter(capability => capability.agentKind === kind)
  if (capabilities.length === 0) {
    throw new BusinessGatewayError(`RAGFlow action ${tool}.${action}${kind ? `.${kind}` : ''} is not mapped to the Gateway contract`, {
      code: 'RAGFLOW_TOOL_ACTION_UNMAPPED',
      status: 422,
    })
  }
  return capabilities
}

export function isRagFlowToolConcurrencySafe(tool: string, inputValue?: unknown): boolean {
  try {
    return resolveRagFlowToolCapabilities(tool, inputValue).every(capability => capability.risk === 'read')
  } catch {
    return false
  }
}
