export type KnowledgeErrorCode =
  | 'KNOWLEDGE_UNAUTHENTICATED'
  | 'KNOWLEDGE_FORBIDDEN'
  | 'KNOWLEDGE_NOT_FOUND'
  | 'KNOWLEDGE_CONFLICT'
  | 'KNOWLEDGE_OPERATION_PENDING'
  | 'KNOWLEDGE_PROVIDER_UNAVAILABLE'
  | 'KNOWLEDGE_INVALID_INPUT'
  | 'KNOWLEDGE_GATEWAY_PROTOCOL_ERROR'
  | 'KNOWLEDGE_METADATA_FIELD_NOT_ALLOWED'
  | 'KNOWLEDGE_METADATA_FILTER_FIELD_NOT_ALLOWED'
  | 'KNOWLEDGE_METADATA_VALUE_INVALID'
  | 'KNOWLEDGE_METADATA_TOO_LARGE'

export class KnowledgeGatewayError extends Error {
  readonly code: KnowledgeErrorCode
  readonly status: number
  readonly retryable: boolean

  constructor(message: string, options: { code: KnowledgeErrorCode; status: number; retryable?: boolean; cause?: unknown }) {
    super(message, { cause: options.cause })
    this.name = 'KnowledgeGatewayError'
    this.code = options.code
    this.status = options.status
    this.retryable = options.retryable ?? false
  }
}

const CODE_MAP: Readonly<Record<string, KnowledgeErrorCode>> = {
  knowledge_gateway_protocol_error: 'KNOWLEDGE_GATEWAY_PROTOCOL_ERROR',
  knowledge_metadata_field_not_allowed: 'KNOWLEDGE_METADATA_FIELD_NOT_ALLOWED',
  knowledge_metadata_filter_field_not_allowed: 'KNOWLEDGE_METADATA_FILTER_FIELD_NOT_ALLOWED',
  knowledge_metadata_value_invalid: 'KNOWLEDGE_METADATA_VALUE_INVALID',
  knowledge_metadata_too_large: 'KNOWLEDGE_METADATA_TOO_LARGE',
  document_version_transition_in_progress: 'KNOWLEDGE_OPERATION_PENDING',
  knowledge_unauthenticated: 'KNOWLEDGE_UNAUTHENTICATED',
  knowledge_unauthorized: 'KNOWLEDGE_UNAUTHENTICATED',
  knowledge_forbidden: 'KNOWLEDGE_FORBIDDEN',
  knowledge_not_found: 'KNOWLEDGE_NOT_FOUND',
  knowledge_space_not_found: 'KNOWLEDGE_NOT_FOUND',
  knowledge_document_not_found: 'KNOWLEDGE_NOT_FOUND',
  knowledge_conflict: 'KNOWLEDGE_CONFLICT',
  knowledge_version_conflict: 'KNOWLEDGE_CONFLICT',
  knowledge_operation_pending: 'KNOWLEDGE_OPERATION_PENDING',
  knowledge_document_not_ready: 'KNOWLEDGE_OPERATION_PENDING',
  knowledge_provider_unavailable: 'KNOWLEDGE_PROVIDER_UNAVAILABLE',
  knowledge_provider_timeout: 'KNOWLEDGE_PROVIDER_UNAVAILABLE',
  knowledge_rate_limited: 'KNOWLEDGE_PROVIDER_UNAVAILABLE',
  knowledge_invalid_input: 'KNOWLEDGE_INVALID_INPUT',
  space_not_found: 'KNOWLEDGE_NOT_FOUND',
  space_disabled: 'KNOWLEDGE_FORBIDDEN',
  space_not_empty: 'KNOWLEDGE_CONFLICT',
  space_has_pending_operations: 'KNOWLEDGE_CONFLICT',
  document_not_found: 'KNOWLEDGE_NOT_FOUND',
  document_not_ready: 'KNOWLEDGE_OPERATION_PENDING',
  document_version_conflict: 'KNOWLEDGE_CONFLICT',
  document_already_deleted: 'KNOWLEDGE_CONFLICT',
  file_not_found: 'KNOWLEDGE_NOT_FOUND',
  file_type_not_allowed: 'KNOWLEDGE_INVALID_INPUT',
  file_too_large: 'KNOWLEDGE_INVALID_INPUT',
  ingestion_failed: 'KNOWLEDGE_PROVIDER_UNAVAILABLE',
  ingestion_already_running: 'KNOWLEDGE_OPERATION_PENDING',
  incompatible_embedding_group: 'KNOWLEDGE_CONFLICT',
  provider_timeout: 'KNOWLEDGE_PROVIDER_UNAVAILABLE',
  provider_unavailable: 'KNOWLEDGE_PROVIDER_UNAVAILABLE',
  rate_limited: 'KNOWLEDGE_PROVIDER_UNAVAILABLE',
  approval_required: 'KNOWLEDGE_OPERATION_PENDING',
  operation_conflict: 'KNOWLEDGE_CONFLICT',
  operation_not_found: 'KNOWLEDGE_NOT_FOUND',
  operation_not_cancellable: 'KNOWLEDGE_CONFLICT',
  operation_not_retryable: 'KNOWLEDGE_CONFLICT',
  operation_manual_retry_limit_exceeded: 'KNOWLEDGE_CONFLICT',
  invalid_context_range: 'KNOWLEDGE_INVALID_INPUT',
} as const

export function knowledgeErrorForStatus(status: number, remoteCode?: string, remoteRetryable?: boolean): KnowledgeGatewayError {
  const key = remoteCode?.toLowerCase()
  const mapped = key && Object.hasOwn(CODE_MAP, key) ? CODE_MAP[key] : undefined
  if (mapped) {
    const messages: Record<KnowledgeErrorCode, string> = {
      KNOWLEDGE_GATEWAY_PROTOCOL_ERROR: 'The Knowledge Gateway response violates the required protocol.',
      KNOWLEDGE_METADATA_FIELD_NOT_ALLOWED: 'Only category, tags, versionLabel and productCode metadata fields are allowed.',
      KNOWLEDGE_METADATA_FILTER_FIELD_NOT_ALLOWED: 'Only category, tagsAny, tagsAll, versionLabel and productCode filters are allowed.',
      KNOWLEDGE_METADATA_VALUE_INVALID: 'Metadata values must satisfy the normalized length, character and uniqueness rules.',
      KNOWLEDGE_METADATA_TOO_LARGE: 'Metadata JSON must not exceed 4096 UTF-8 bytes.',
      KNOWLEDGE_UNAUTHENTICATED: 'Knowledge Gateway authentication failed.',
      KNOWLEDGE_FORBIDDEN: 'The current user is not allowed to perform this knowledge operation.',
      KNOWLEDGE_NOT_FOUND: 'The requested knowledge resource was not found or is not visible.',
      KNOWLEDGE_CONFLICT: 'The knowledge resource changed or the operation conflicts with its current state. Refresh the business resource before submitting a new intent.',
      KNOWLEDGE_OPERATION_PENDING: 'The knowledge operation is still pending. Read its operation status before taking another action.',
      KNOWLEDGE_PROVIDER_UNAVAILABLE: 'The Knowledge Gateway is temporarily unavailable. A mutation may only be retried by replaying the same Harness tool execution.',
      KNOWLEDGE_INVALID_INPUT: 'The Knowledge Gateway rejected the business input. Correct the business fields before retrying.',
    }
    const reasons: Record<string, string> = {
      space_not_empty: 'SPACE_NOT_EMPTY: The space contains documents and cannot be deleted. Cascade deletion is not available.',
      space_has_pending_operations: 'SPACE_HAS_PENDING_OPERATIONS: Wait for the space operations to finish before requesting deletion.',
      operation_not_retryable: 'OPERATION_NOT_RETRYABLE: This operation cannot be retried. Resolve the business failure before creating a new intent.',
      operation_manual_retry_limit_exceeded: 'OPERATION_MANUAL_RETRY_LIMIT_EXCEEDED: The root operation has exhausted its three manual retries. Contact a knowledge administrator.',
      invalid_context_range: 'INVALID_CONTEXT_RANGE: Context sizes must be integers from 0 to 5000 Unicode code points.',
    }
    return new KnowledgeGatewayError(reasons[remoteCode!.toLowerCase()] ?? messages[mapped], { code: mapped, status, retryable: remoteRetryable })
  }
  if (status === 401) return new KnowledgeGatewayError('Knowledge Gateway authentication failed.', { code: 'KNOWLEDGE_UNAUTHENTICATED', status })
  if (status === 403) return new KnowledgeGatewayError('The current user is not allowed to perform this knowledge operation.', { code: 'KNOWLEDGE_FORBIDDEN', status })
  if (status === 404) return new KnowledgeGatewayError('The requested knowledge resource was not found or is not visible.', { code: 'KNOWLEDGE_NOT_FOUND', status })
  if (status === 409 || status === 412) return new KnowledgeGatewayError('The knowledge resource changed or the operation conflicts with its current state.', { code: 'KNOWLEDGE_CONFLICT', status })
  if (status === 423 || status === 425) return new KnowledgeGatewayError('The knowledge operation is still pending.', { code: 'KNOWLEDGE_OPERATION_PENDING', status, retryable: remoteRetryable ?? true })
  if (status === 408 || status === 429 || status >= 500) return new KnowledgeGatewayError('The Knowledge Gateway is temporarily unavailable.', { code: 'KNOWLEDGE_PROVIDER_UNAVAILABLE', status, retryable: remoteRetryable ?? true })
  return new KnowledgeGatewayError('The Knowledge Gateway rejected the business input.', { code: 'KNOWLEDGE_INVALID_INPUT', status })
}
