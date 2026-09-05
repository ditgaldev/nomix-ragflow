/** A server-side transport/native API error, never an Agent tool error. */
export class RagFlowApiError extends Error {
  readonly status: number
  readonly code: string | number
  constructor(code: string | number, status = 0) {
    // Native error text can contain provider IDs, URLs, credentials or document
    // content. Keep this exception safe; callers retain code/status for policy.
    super(`RAGFlow request failed (${code}).`)
    this.name = 'RagFlowApiError'
    this.code = code
    this.status = status
  }
}
