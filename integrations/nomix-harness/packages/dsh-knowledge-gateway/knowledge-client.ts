import { KnowledgeGatewayError, knowledgeErrorForStatus } from '../dsh-knowledge/knowledge-errors.js'
import {
  knowledgeGatewayRoutes,
  type CitationContextRequest,
  type DeleteResourceRequest,
  type DocumentDeleteRequest,
  type EmptyRequest,
  type KnowledgeDocumentReplaceRequest,
  type KnowledgeDocumentUpdateRequest,
  type KnowledgeDocumentUploadRequest,
  type KnowledgeGatewayOperationId,
  type KnowledgeGatewayResponseData,
  type KnowledgeSpaceCreateRequest,
  type KnowledgeSpaceUpdateRequest,
  type ListDocumentsRequest,
  type ListSpacesRequest,
  type OperationReasonRequest,
  type VersionedResourceRequest,
} from '../dsh-knowledge/knowledge-openapi.generated.js'
import { parseKnowledgeEnvelope, parseKnowledgeErrorEnvelope, type KnowledgeResponseMeta } from '../dsh-knowledge/knowledge-schema.js'
import type { KnowledgeRequestContext, KnowledgeRequestOptions } from '../dsh-knowledge/knowledge-types.js'
import type { KnowledgeService } from '../dsh-knowledge/service.js'
import type { JsonValue } from '@nomix-ai/nomix-harness/plugin/tools'

const FORBIDDEN_RESPONSE_KEY = /(?:ragflow|dataset|chunk|pipeline|model|rerank|provider)(?:[_-]?(?:id|url|key|token))?|(?:api[_-]?key|base[_-]?url|endpoint|last[_-]?error)/iu
const RETRYABLE_STATUS = new Set([408, 429, 502, 503, 504])
const MAX_READ_ATTEMPTS = 2

function operationPath(operationId: KnowledgeGatewayOperationId, parameters: Record<string, string> = {}): string {
  let path: string = knowledgeGatewayRoutes[operationId].path
  for (const [name, value] of Object.entries(parameters)) path = path.replace(`{${name}}`, encodeURIComponent(value))
  if (/\{[^}]+\}/u.test(path)) throw new KnowledgeGatewayError('A required Knowledge Gateway path parameter is missing.', { code: 'KNOWLEDGE_INVALID_INPUT', status: 422 })
  return path.replace(/^\/internal\/v1\/knowledge\//u, '')
}

function gatewayRoot(value: string): URL {
  let url: URL
  try { url = new URL(value) } catch { throw new KnowledgeGatewayError('gatewayBaseURL must be an absolute HTTP(S) URL.', { code: 'KNOWLEDGE_INVALID_INPUT', status: 422 }) }
  const local = url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '[::1]'
  if (url.protocol !== 'https:' && !(local && url.protocol === 'http:')) throw new KnowledgeGatewayError('gatewayBaseURL must use HTTPS outside localhost.', { code: 'KNOWLEDGE_INVALID_INPUT', status: 422 })
  if (url.username || url.password || url.search || url.hash) throw new KnowledgeGatewayError('gatewayBaseURL must not contain credentials, query parameters, or fragments.', { code: 'KNOWLEDGE_INVALID_INPUT', status: 422 })
  url.pathname = `${url.pathname.replace(/\/$/u, '')}/internal/v1/knowledge/`
  return url
}

function safeJson(value: unknown, path = '$', depth = 0): JsonValue {
  if (depth > 64) throw new KnowledgeGatewayError('The Knowledge Gateway returned an excessively nested response.', { code: 'KNOWLEDGE_GATEWAY_PROTOCOL_ERROR', status: 502 })
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (Array.isArray(value)) return value.map((entry, index) => safeJson(entry, `${path}[${index}]`, depth + 1))
  if (value && typeof value === 'object') {
    const result: Record<string, JsonValue> = Object.create(null)
    for (const [key, entry] of Object.entries(value)) {
      if (FORBIDDEN_RESPONSE_KEY.test(key)) throw new KnowledgeGatewayError('The Knowledge Gateway returned a provider-internal field.', { code: 'KNOWLEDGE_GATEWAY_PROTOCOL_ERROR', status: 502 })
      result[key] = safeJson(entry, `${path}.${key}`, depth + 1)
    }
    return result
  }
  throw new KnowledgeGatewayError(`The Knowledge Gateway returned non-JSON data at ${path}.`, { code: 'KNOWLEDGE_GATEWAY_PROTOCOL_ERROR', status: 502 })
}

async function readJson(response: Response, maxBytes: number): Promise<unknown> {
  const length = Number(response.headers.get('content-length'))
  if (Number.isFinite(length) && length > maxBytes) {
    await response.body?.cancel()
    throw new KnowledgeGatewayError('The Knowledge Gateway response exceeds the configured business artifact limit.', { code: 'KNOWLEDGE_PROVIDER_UNAVAILABLE', status: 502 })
  }
  const reader = response.body?.getReader()
  if (!reader) {
    const text = await response.text()
    if (new TextEncoder().encode(text).byteLength > maxBytes) throw new KnowledgeGatewayError('The Knowledge Gateway response exceeds the configured business artifact limit.', { code: 'KNOWLEDGE_PROVIDER_UNAVAILABLE', status: 502 })
    return JSON.parse(text)
  }
  const decoder = new TextDecoder()
  let bytes = 0
  let text = ''
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    bytes += value.byteLength
    if (bytes > maxBytes) {
      await reader.cancel()
      throw new KnowledgeGatewayError('The Knowledge Gateway response exceeds the configured business artifact limit.', { code: 'KNOWLEDGE_PROVIDER_UNAVAILABLE', status: 502 })
    }
    text += decoder.decode(value, { stream: true })
  }
  text += decoder.decode()
  return JSON.parse(text)
}

function assertResourceIdentity(actual: string | undefined, expected: string, field: string): void {
  if (actual !== expected) throw new KnowledgeGatewayError(`The Knowledge Gateway returned a mismatched ${field}.`, { code: 'KNOWLEDGE_GATEWAY_PROTOCOL_ERROR', status: 502 })
}

function assertRequestedPage(meta: KnowledgeResponseMeta, input: ListSpacesRequest): void {
  if (meta.pagination?.page !== (input.page ?? 1) || meta.pagination?.pageSize !== (input.pageSize ?? 20)) {
    throw new KnowledgeGatewayError('The Knowledge Gateway returned a mismatched page.', { code: 'KNOWLEDGE_GATEWAY_PROTOCOL_ERROR', status: 502 })
  }
}

export class KnowledgeGatewayClient implements KnowledgeService {
  private readonly root: URL

  constructor(
    gatewayBaseURL: string,
    private readonly context: KnowledgeRequestContext,
    private readonly timeoutMs: number,
    private readonly maxResponseBytes: number,
    private readonly onResponseMeta?: (meta: KnowledgeResponseMeta) => void,
  ) {
    this.root = gatewayRoot(gatewayBaseURL)
  }

  private async requestEnvelope<Operation extends KnowledgeGatewayOperationId>(
    operationId: Operation,
    parameters?: Record<string, string>,
    body?: unknown,
    options: KnowledgeRequestOptions = {},
    query?: URLSearchParams,
  ): Promise<{ data: KnowledgeGatewayResponseData<Operation>; meta: KnowledgeResponseMeta }> {
    const operation = knowledgeGatewayRoutes[operationId]
    if (operation.idempotency === 'required' && !options.idempotencyKey) {
      throw new KnowledgeGatewayError('A Harness-derived idempotency key is required for this knowledge mutation.', { code: 'KNOWLEDGE_INVALID_INPUT', status: 422 })
    }
    // Mutation retry/orchestration belongs to the Gateway Worker. The plugin
    // retries one transient read only; callers may replay the exact same
    // Harness execution with its stable key when transport outcome is unknown.
    const retrySafe = operation.retrySafe
    const maximumAttempts = retrySafe ? MAX_READ_ATTEMPTS : 1
    const identityValues = Object.values(this.context)
    if (identityValues.some(value => typeof value !== 'string' || !/^[\x21-\x7e]+$/u.test(value))) {
      throw new KnowledgeGatewayError('The trusted knowledge identity contains an invalid credential or correlation header.', { code: 'KNOWLEDGE_UNAUTHENTICATED', status: 401 })
    }
    const headers = new Headers({
      authorization: `Bearer ${this.context.serviceToken}`,
      'x-user-assertion': this.context.userAssertion,
      'x-harness-session-id': this.context.sessionId,
      'x-tool-call-id': this.context.toolCallId,
      'x-request-id': this.context.requestId,
      accept: 'application/json',
    })
    if (body !== undefined) headers.set('content-type', 'application/json')
    if (options.idempotencyKey) headers.set('idempotency-key', options.idempotencyKey)
    const url = new URL(operationPath(operationId, parameters), this.root)
    if (query) url.search = query.toString()

    const signal = AbortSignal.any([options.signal ?? new AbortController().signal, AbortSignal.timeout(this.timeoutMs)])
    for (let attempt = 1; attempt <= maximumAttempts; attempt++) {
      let response: Response
      try {
        response = await fetch(url, { method: operation.method, headers, signal, redirect: 'manual', ...(body === undefined ? {} : { body: JSON.stringify(body) }) })
      } catch (cause) {
        if (options.signal?.aborted) throw cause
        if (retrySafe && attempt < maximumAttempts && !signal.aborted) continue
        throw new KnowledgeGatewayError('The Knowledge Gateway could not be reached.', { code: 'KNOWLEDGE_PROVIDER_UNAVAILABLE', status: 503, retryable: retrySafe, cause })
      }
      if (response.status >= 300 && response.status < 400) {
        await response.body?.cancel()
        throw new KnowledgeGatewayError('Knowledge Gateway redirects are not permitted.', { code: 'KNOWLEDGE_GATEWAY_PROTOCOL_ERROR', status: 502 })
      }
      let value: unknown
      try {
        value = await readJson(response, response.ok ? this.maxResponseBytes : Math.min(this.maxResponseBytes, 64 * 1024))
      } catch (cause) {
        if (options.signal?.aborted) throw cause
        // Complete malformed JSON and local size limits are not transport
        // failures. Only interrupted reads may consume the remaining retry.
        if (cause instanceof SyntaxError || cause instanceof KnowledgeGatewayError) {
          if (response.ok && cause instanceof KnowledgeGatewayError) throw cause
          throw new KnowledgeGatewayError('The Knowledge Gateway response violates the JSON data/meta protocol.', { code: 'KNOWLEDGE_GATEWAY_PROTOCOL_ERROR', status: 502, cause })
        }
        if (retrySafe && attempt < maximumAttempts && !signal.aborted) continue
        throw new KnowledgeGatewayError('The Knowledge Gateway response could not be received completely.', { code: 'KNOWLEDGE_PROVIDER_UNAVAILABLE', status: 503, retryable: retrySafe, cause })
      }
      if (!response.ok) {
        let remote
        try { remote = parseKnowledgeErrorEnvelope(value) } catch (cause) {
          throw new KnowledgeGatewayError('The Knowledge Gateway error response violates the data/meta protocol.', { code: 'KNOWLEDGE_GATEWAY_PROTOCOL_ERROR', status: 502, cause })
        }
        const { code, retryable: remoteRetryable } = remote.meta.error
        if (retrySafe && attempt < maximumAttempts && !signal.aborted && remoteRetryable !== false && (remoteRetryable || RETRYABLE_STATUS.has(response.status))) continue
        throw knowledgeErrorForStatus(response.status, code, remoteRetryable)
      }
      const parsed = parseKnowledgeEnvelope(operationId, safeJson(value))
      this.onResponseMeta?.(parsed.meta)
      return parsed
    }
    throw new KnowledgeGatewayError('The Knowledge Gateway is temporarily unavailable.', { code: 'KNOWLEDGE_PROVIDER_UNAVAILABLE', status: 503, retryable: retrySafe })
  }

  private async request<Operation extends KnowledgeGatewayOperationId>(operation: Operation, parameters?: Record<string, string>, body?: unknown, options?: KnowledgeRequestOptions, query?: URLSearchParams): Promise<KnowledgeGatewayResponseData<Operation>> {
    return (await this.requestEnvelope(operation, parameters, body, options, query)).data
  }

  async search(input: Parameters<KnowledgeService['search']>[0], options?: KnowledgeRequestOptions) {
    const result = await this.request('knowledgeSearch', undefined, input, options)
    if (result.query !== undefined && result.query !== input.query) throw new KnowledgeGatewayError('The Knowledge Gateway returned a mismatched search query.', { code: 'KNOWLEDGE_GATEWAY_PROTOCOL_ERROR', status: 502 })
    return result
  }
  async listSpaces(input: ListSpacesRequest, options?: KnowledgeRequestOptions) {
    const query = new URLSearchParams()
    query.set('page', String(input.page ?? 1))
    query.set('pageSize', String(input.pageSize ?? 20))
    const result = await this.requestEnvelope('knowledgeSpacesList', undefined, undefined, options, query)
    assertRequestedPage(result.meta, input)
    return { ...result.data, pagination: result.meta.pagination! }
  }
  async getSpace(knowledgeSpaceId: string, options?: KnowledgeRequestOptions) {
    const result = await this.request('knowledgeSpaceGet', { spaceId: knowledgeSpaceId }, undefined, options)
    assertResourceIdentity(result.spaceId, knowledgeSpaceId, 'spaceId')
    return result
  }
  async createSpace(input: KnowledgeSpaceCreateRequest, options: KnowledgeRequestOptions) {
    const result = await this.request('knowledgeSpaceCreate', undefined, input, options)
    if (result.code !== input.code) throw new KnowledgeGatewayError('The Knowledge Gateway returned a mismatched space code.', { code: 'KNOWLEDGE_GATEWAY_PROTOCOL_ERROR', status: 502 })
    if (result.name !== input.name) throw new KnowledgeGatewayError('The Knowledge Gateway returned a mismatched space name.', { code: 'KNOWLEDGE_GATEWAY_PROTOCOL_ERROR', status: 502 })
    return result
  }
  async updateSpace(knowledgeSpaceId: string, input: KnowledgeSpaceUpdateRequest, options: KnowledgeRequestOptions) {
    const result = await this.request('knowledgeSpaceUpdate', { spaceId: knowledgeSpaceId }, input, options)
    assertResourceIdentity(result.spaceId, knowledgeSpaceId, 'spaceId')
    return result
  }
  async deleteSpace(knowledgeSpaceId: string, input: DeleteResourceRequest, options: KnowledgeRequestOptions) {
    const result = await this.request('knowledgeSpaceDelete', { spaceId: knowledgeSpaceId }, input, options)
    assertResourceIdentity(result.spaceId, knowledgeSpaceId, 'spaceId')
    return result
  }
  async listDocuments(knowledgeSpaceId: string, input: ListDocumentsRequest, options?: KnowledgeRequestOptions) {
    const query = new URLSearchParams()
    query.set('page', String(input.page ?? 1))
    query.set('pageSize', String(input.pageSize ?? 20))
    const result = await this.requestEnvelope('knowledgeDocumentsList', { spaceId: knowledgeSpaceId }, undefined, options, query)
    assertRequestedPage(result.meta, input)
    for (const item of result.data.items) assertResourceIdentity(item.knowledgeSpaceId, knowledgeSpaceId, 'knowledgeSpaceId')
    return { ...result.data, pagination: result.meta.pagination! }
  }
  async getDocument(documentId: string, options?: KnowledgeRequestOptions) {
    const result = await this.request('knowledgeDocumentGet', { documentId }, undefined, options)
    assertResourceIdentity(result.documentId, documentId, 'documentId')
    return result
  }
  uploadDocument(knowledgeSpaceId: string, input: KnowledgeDocumentUploadRequest, options: KnowledgeRequestOptions) { return this.request('knowledgeDocumentUpload', { spaceId: knowledgeSpaceId }, input, options) }
  async updateDocument(documentId: string, input: KnowledgeDocumentUpdateRequest, options: KnowledgeRequestOptions) {
    const result = await this.request('knowledgeDocumentUpdate', { documentId }, input, options)
    assertResourceIdentity(result.documentId, documentId, 'documentId')
    return result
  }
  async replaceDocument(documentId: string, input: KnowledgeDocumentReplaceRequest, options: KnowledgeRequestOptions) {
    const result = await this.request('knowledgeDocumentReplace', { documentId }, input, options)
    assertResourceIdentity(result.documentId, documentId, 'documentId')
    return result
  }
  async enableDocument(documentId: string, input: VersionedResourceRequest, options: KnowledgeRequestOptions) {
    const result = await this.request('knowledgeDocumentEnable', { documentId }, input, options)
    assertResourceIdentity(result.documentId, documentId, 'documentId')
    return result
  }
  async disableDocument(documentId: string, input: VersionedResourceRequest, options: KnowledgeRequestOptions) {
    const result = await this.request('knowledgeDocumentDisable', { documentId }, input, options)
    assertResourceIdentity(result.documentId, documentId, 'documentId')
    return result
  }
  async reindexDocument(documentId: string, input: VersionedResourceRequest, options: KnowledgeRequestOptions) {
    const result = await this.request('knowledgeDocumentReindex', { documentId }, input, options)
    assertResourceIdentity(result.documentId, documentId, 'documentId')
    return result
  }
  async deleteDocument(documentId: string, input: DocumentDeleteRequest, options: KnowledgeRequestOptions) {
    const result = await this.request('knowledgeDocumentDelete', { documentId }, input, options)
    assertResourceIdentity(result.documentId, documentId, 'documentId')
    return result
  }
  async createDownloadLink(documentId: string, input: EmptyRequest = {}, options?: KnowledgeRequestOptions) {
    const result = await this.request('knowledgeDocumentCreateDownloadLink', { documentId }, input, options)
    assertResourceIdentity(result.documentId, documentId, 'documentId')
    return result
  }
  async getCitation(citationId: string, input: CitationContextRequest, options?: KnowledgeRequestOptions) {
    const query = new URLSearchParams()
    if (input.contextBefore !== undefined) query.set('contextBefore', String(input.contextBefore))
    if (input.contextAfter !== undefined) query.set('contextAfter', String(input.contextAfter))
    const result = await this.request('knowledgeCitationRead', { citationId }, undefined, options, query)
    assertResourceIdentity(result.citationId, citationId, 'citationId')
    const expectedBefore = input.contextBefore ?? 1000
    const expectedAfter = input.contextAfter ?? 1000
    if (result.requestedContextBefore !== expectedBefore || result.requestedContextAfter !== expectedAfter) throw new KnowledgeGatewayError('The Knowledge Gateway returned mismatched citation context counts.', { code: 'KNOWLEDGE_GATEWAY_PROTOCOL_ERROR', status: 502 })
    return result
  }
  async getOperation(operationId: string, options?: KnowledgeRequestOptions) {
    const result = await this.request('knowledgeOperationGet', { operationId }, undefined, options)
    assertResourceIdentity(result.operationId, operationId, 'operationId')
    return result
  }
  async cancelOperation(operationId: string, input: OperationReasonRequest, options: KnowledgeRequestOptions) {
    const result = await this.request('knowledgeOperationCancel', { operationId }, input, options)
    assertResourceIdentity(result.operationId, operationId, 'operationId')
    return result
  }
  async retryOperation(operationId: string, input: OperationReasonRequest, options: KnowledgeRequestOptions) {
    const result = await this.request('knowledgeOperationRetry', { operationId }, input, options)
    assertResourceIdentity(result.parentOperationId, operationId, 'parentOperationId')
    if (result.operationId === operationId) throw new KnowledgeGatewayError('The Knowledge Gateway did not create a child retry operation.', { code: 'KNOWLEDGE_GATEWAY_PROTOCOL_ERROR', status: 502 })
    return result
  }
}
