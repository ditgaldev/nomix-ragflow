import type { JsonValue } from './types.js'

const NON_RETRYABLE_CODES = new Set([
  'ACCESS_TOKEN_UNAVAILABLE',
  'AUTHENTICATION_REQUIRED',
  'IDEMPOTENCY_KEY_REQUIRED',
  'FILE_TOO_LARGE',
  'INVALID_GATEWAY_RESPONSE',
  'REQUEST_CANCELLED',
  'REQUEST_TOO_LARGE',
  'RESOURCE_NOT_FOUND',
  'RESPONSE_TOO_LARGE',
  'RAGFLOW_AGENT_CONTEXT_REQUIRED',
  'RAGFLOW_AGENT_SELECTION_CONFLICT',
  'RAGFLOW_AGENT_SELECTION_REQUIRED',
  'RAGFLOW_ARTIFACT_INPUT_UNAVAILABLE',
  'RAGFLOW_ARTIFACT_TOO_LARGE',
  'RAGFLOW_CAPABILITY_MANIFEST_INVALID',
  'RAGFLOW_CONSUMER_CONFIG_INVALID',
  'RAGFLOW_CONSUMER_DEPENDENCY_UNAVAILABLE',
  'RAGFLOW_DUPLICATE_PROVIDER',
  'RAGFLOW_PROVIDER_AMBIGUOUS',
  'RAGFLOW_PROVIDER_CONFIG_INVALID',
  'RAGFLOW_PROVIDER_UNAVAILABLE',
  'RAGFLOW_TOOL_ACTION_UNMAPPED',
  'RAGFLOW_TOOL_INPUT_INVALID',
])

function retryableFailure(code: string, status: number): boolean {
  if (NON_RETRYABLE_CODES.has(code)) return false
  return code === 'REQUEST_TIMEOUT'
    || code === 'REQUEST_FAILED'
    || code === 'TOKEN_PROVIDER_FAILED'
    || status === 408
    || status === 429
    || status >= 500
}

/** Stable error contract returned by the Nomix RAGFlow Business Gateway. */
export class BusinessGatewayError extends Error {
  readonly code: string
  readonly status: number
  readonly requestId?: string
  readonly details?: JsonValue
  readonly retryable: boolean
  readonly retryAfterMs?: number

  constructor(message: string, options: {
    code?: string
    status?: number
    requestId?: string
    details?: JsonValue
    retryable?: boolean
    retryAfterMs?: number
    cause?: unknown
  } = {}) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause })
    this.name = 'BusinessGatewayError'
    this.code = options.code ?? 'BUSINESS_GATEWAY_ERROR'
    this.status = options.status ?? 0
    this.requestId = options.requestId
    this.details = options.details
    this.retryable = options.retryable ?? retryableFailure(this.code, this.status)
    this.retryAfterMs = options.retryAfterMs
  }

  get rootCauseHint(): string {
    if (this.code === 'REQUEST_TIMEOUT') return 'The RAGFlow Business Gateway did not finish the complete response before the configured deadline.'
    if (this.code === 'REQUEST_CANCELLED') return 'The caller cancelled the RAGFlow operation.'
    if (this.code === 'REQUEST_FAILED') return 'The RAGFlow Business Gateway connection failed before the complete response was received.'
    if (this.code === 'ACCESS_TOKEN_UNAVAILABLE' || this.code === 'TOKEN_PROVIDER_FAILED') return 'The current Agent/session business access token could not be resolved.'
    if (this.code === 'RAGFLOW_PROVIDER_UNAVAILABLE') return 'The RAGFlow Service Definition has no available Business Gateway Provider for this Consumer binding.'
    if (this.code === 'RAGFLOW_PROVIDER_AMBIGUOUS') return 'More than one RAGFlow Provider is available and the Consumer did not select one.'
    if (this.code === 'RAGFLOW_DUPLICATE_PROVIDER') return 'Two RAGFlow Providers attempted to register the same stable provider ID.'
    if (this.code === 'RAGFLOW_AGENT_SELECTION_REQUIRED') return 'A root-scoped Consumer did not declare which Agents may receive RAGFlow tools.'
    if (this.code === 'RAGFLOW_AGENT_SELECTION_CONFLICT') return 'The Consumer declared both a preset allow-list and deployment-wide Agent attachment.'
    if (this.code === 'RAGFLOW_CONSUMER_CONFIG_INVALID' || this.code === 'RAGFLOW_PROVIDER_CONFIG_INVALID') return 'The Harness rejected invalid RAGFlow plugin configuration before registering runtime effects.'
    if (this.code === 'RAGFLOW_CONSUMER_DEPENDENCY_UNAVAILABLE') return 'The selected Agent isolation layer does not provide every declared RAGFlow Consumer dependency.'
    if (this.code === 'RAGFLOW_AGENT_CONTEXT_REQUIRED') return 'The call did not run through the Agent scope that owns this RAGFlow tool.'
    if (this.code === 'RAGFLOW_TOOL_ACTION_UNMAPPED' || this.code === 'RAGFLOW_CAPABILITY_MANIFEST_INVALID') return 'The Agent action does not match the canonical Business Gateway capability manifest.'
    if (this.code === 'RAGFLOW_TOOL_INPUT_INVALID') return 'The Agent input does not match the selected closed action schema.'
    if (this.code === 'RAGFLOW_ARTIFACT_STORE_UNAVAILABLE') return 'The Harness spill provider could not persist the complete RAGFlow result.'
    if (this.code === 'RAGFLOW_ARTIFACT_INPUT_UNAVAILABLE') return 'The upload path could not be resolved or read through the Agent filesystem provider.'
    if (this.code === 'RAGFLOW_ARTIFACT_TOO_LARGE') return 'The artifact exceeds the Agent-side bounded transfer or persisted-spill limit.'
    if (this.code === 'FILE_TOO_LARGE') return 'The selected upload exceeds the bounded Agent or Gateway single-file limit.'
    if (this.code === 'REQUEST_TOO_LARGE') return 'The complete multipart or JSON request exceeds the Gateway request-body budget.'
    if (this.code === 'RESPONSE_TOO_LARGE') return 'The Gateway response body exceeded the configured bounded client transfer limit.'
    if (this.code === 'INVALID_GATEWAY_RESPONSE') return 'The Gateway returned a response that does not satisfy the generated operation contract.'
    if (this.status === 401) return 'The business access token is missing, inactive, expired, or revoked.'
    if (this.status === 403) return 'The validated token does not grant the required action, workspace, or data scope.'
    if (this.status === 404) return 'The resource does not exist or is outside the validated data scope.'
    if (this.status === 409) return 'The resource version or idempotency reservation conflicts with the current state.'
    if (this.status === 422) return 'The RAGFlow Business Gateway rejected one or more request fields.'
    if (this.status === 428) return 'The write omitted the current optimistic resource version.'
    if (this.status === 429) return 'The RAGFlow Business Gateway temporarily rejected the request rate.'
    if (this.status === 503) return 'Token Introspection or the RAGFlow Business Gateway is temporarily unavailable.'
    return `The RAGFlow Business Gateway rejected operation ${this.code}.`
  }

  get retryHint(): string {
    if (['RAGFLOW_PROVIDER_UNAVAILABLE', 'RAGFLOW_PROVIDER_AMBIGUOUS', 'RAGFLOW_DUPLICATE_PROVIDER'].includes(this.code)) return 'Correct the Service Definition, provider IDs, and Consumer binding before retrying.'
    if (this.code === 'RAGFLOW_AGENT_SELECTION_REQUIRED') return 'Mount the Consumer in agent.ctx, configure agentPresets, or explicitly enable attachToAllAgents.'
    if (this.code === 'RAGFLOW_AGENT_SELECTION_CONFLICT') return 'Keep agentPresets or attachToAllAgents=true, but not both.'
    if (this.code === 'RAGFLOW_CONSUMER_CONFIG_INVALID' || this.code === 'RAGFLOW_PROVIDER_CONFIG_INVALID') return 'Correct the plugin configuration and reload it before retrying.'
    if (this.code === 'RAGFLOW_CONSUMER_DEPENDENCY_UNAVAILABLE') return 'Mount credentials, filesystem, spill, tool, and RAGFlow services in the selected Agent layer before retrying.'
    if (this.code === 'RAGFLOW_TOOL_ACTION_UNMAPPED' || this.code === 'RAGFLOW_CAPABILITY_MANIFEST_INVALID') return 'Align the tool action catalog with the generated Gateway manifest before retrying.'
    if (this.code === 'RAGFLOW_TOOL_INPUT_INVALID') return 'Retry once using only fields declared by the selected action schema.'
    if (this.code === 'RAGFLOW_AGENT_CONTEXT_REQUIRED') return 'Invoke the registered tool through its owning Agent scope.'
    if (this.code === 'RAGFLOW_ARTIFACT_INPUT_UNAVAILABLE' || this.code === 'RAGFLOW_ARTIFACT_TOO_LARGE' || this.code === 'FILE_TOO_LARGE') return 'Choose a smaller readable artifact in the Agent workspace, or use the REST upload path for large files.'
    if (this.code === 'REQUEST_TOO_LARGE') return 'Reduce the request or split the operation; do not retry the unchanged body.'
    if (this.code === 'RESPONSE_TOO_LARGE') return 'Use a smaller page or artifact; do not retry the same unbounded response.'
    if (this.code === 'INVALID_GATEWAY_RESPONSE') return 'Stop and repair the Gateway response contract before retrying.'
    if (this.status === 401) return 'Refresh or replace the Agent/session business access token before retrying.'
    if (this.status === 403) return 'Request the required business authorization; Harness approval cannot grant it.'
    if (this.status === 404) return 'Reload the authorized list and retry only with a visible Gateway-returned identifier.'
    if (this.status === 409 || this.status === 428) return 'Reload the resource version; reuse the operationId only for the identical business intent.'
    if (this.retryable) return `Retry once after ${this.retryAfterMs === undefined ? 'a short bounded delay' : `${this.retryAfterMs}ms`}; reuse the same operationId for an uncertain write.`
    return 'Correct the request, authorization, or resource visibility before retrying.'
  }

  get stopCondition(): string {
    if (this.status === 403 || this.status === 404) return 'Stop rather than trying alternate resource identifiers.'
    return this.retryable ? 'Stop after the same transient failure occurs twice.' : 'Stop until the request input, resource version, configuration, or authorization changes.'
  }
}
