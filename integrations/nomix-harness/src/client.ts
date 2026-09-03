import { BusinessGatewayError } from './errors.js'
import { assertOperationResponse, isOpenApiErrorEnvelope } from './openapi.generated.js'
import type {
  Agent,
  BusinessAuthorizationContext,
  Chat,
  Chunk,
  CreateAgentRequest,
  CreateChatRequest,
  CreateDatasetRequest,
  CreateMemoryRequest,
  Dataset,
  Document,
  GatewayResult,
  InvokeSessionRequest,
  JsonObject,
  JsonValue,
  ListAgentsRequest,
  ListChatsRequest,
  ListDatasetsRequest,
  ListDocumentsRequest,
  ListMemoriesRequest,
  ListSessionsRequest,
  Memory,
  Message,
  OperationBody,
  OperationQuery,
  PageRequest,
  PageIndexResult,
  PageIndexStatus,
  PageIndexSearchResult,
  RequestOptions,
  RetrievalResult,
  RetrieveRequest,
  SearchMemoryMessagesRequest,
  SearchPageIndexRequest,
  BuildPageIndexRequest,
  Session,
  SessionTarget,
  UploadDocument,
  VersionedRequestOptions,
} from './types.js'
import type { BusinessGatewayJsonOperation, OpenApiSuccessEnvelope, OperationData, OperationResponse } from './openapi.generated.js'

export { BusinessGatewayError } from './errors.js'
export type * from './types.js'

export const DEFAULT_RAGFLOW_RESPONSE_MAX_BYTES = 16 * 1024 * 1024
export const MAX_RAGFLOW_RESPONSE_MAX_BYTES = 64 * 1024 * 1024
const ERROR_RESPONSE_MAX_BYTES = 64 * 1024

export interface RagFlowBusinessClientOptions {
  /** Dedicated Business Gateway service root. It must not include /api/v1. */
  baseURL: string
  /** Business access token or a provider called for every request. */
  accessToken: string | (() => string | Promise<string>)
  timeoutMs?: number
  /** Maximum response bytes buffered by this client. Defaults to 16 MiB. */
  maxResponseBytes?: number
  /** Audit-only entry point marker. It never grants actions or data scope. */
  source?: 'rest' | 'agent'
}

type QueryValue = string | number | boolean | readonly string[] | undefined
type Query = Record<string, QueryValue>

interface WireOptions {
  query?: Query
  json?: unknown
  body?: BodyInit
  options?: RequestOptions
  idempotencyRequired?: boolean
}

function positiveInteger(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) throw new TypeError(`${label} must be a positive safe integer`)
  return value
}

function responseByteLimit(value: number, label: string): number {
  const limit = positiveInteger(value, label)
  if (limit > MAX_RAGFLOW_RESPONSE_MAX_BYTES) {
    throw new TypeError(`${label} must not exceed ${MAX_RAGFLOW_RESPONSE_MAX_BYTES}`)
  }
  return limit
}

async function responseBytes(response: Response, maximumBytes: number): Promise<Uint8Array> {
  const declaredLength = response.headers.get('content-length')
  if (declaredLength !== null && /^\d+$/u.test(declaredLength) && Number(declaredLength) > maximumBytes) {
    await response.body?.cancel().catch(() => undefined)
    throw new BusinessGatewayError(`Business Gateway response exceeds the ${maximumBytes}-byte client limit`, {
      code: 'RESPONSE_TOO_LARGE',
      status: 502,
    })
  }
  if (response.body === null) return new Uint8Array()
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      total += value.byteLength
      if (total > maximumBytes) {
        await reader.cancel().catch(() => undefined)
        throw new BusinessGatewayError(`Business Gateway response exceeds the ${maximumBytes}-byte client limit`, {
          code: 'RESPONSE_TOO_LARGE',
          status: 502,
        })
      }
      chunks.push(value)
    }
  } finally {
    reader.releaseLock()
  }
  const bytes = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  return bytes
}

async function responseJson(response: Response, maximumBytes: number): Promise<unknown> {
  const bytes = await responseBytes(response, maximumBytes)
  if (bytes.byteLength === 0) throw new TypeError('Business Gateway returned an empty JSON response')
  return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) as unknown
}

function serviceRoot(value: string): string {
  if (value.trim() === '') throw new TypeError('baseURL must not be empty')
  const url = new URL(value)
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && isLoopback(url.hostname))) {
    throw new TypeError('baseURL must use HTTPS except for a loopback development endpoint')
  }
  if (url.username || url.password || url.search || url.hash) throw new TypeError('baseURL must not contain credentials, query, or fragment')
  if (url.pathname !== '' && url.pathname !== '/') throw new TypeError('baseURL must be the service root without /api/v1 or another path')
  return url.origin
}

function isLoopback(hostname: string): boolean {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]' || hostname === '::1'
}

function appendQuery(url: URL, query: Query | undefined): void {
  if (query === undefined) return
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined) continue
    if (Array.isArray(value)) {
      for (const member of value) url.searchParams.append(key, member)
    } else {
      url.searchParams.set(key, String(value))
    }
  }
}

function pageQuery(request: PageRequest): Query {
  return { cursor: request.cursor, limit: request.limit }
}

function defaultErrorCode(status: number): string {
  return ({
    400: 'BAD_REQUEST',
    401: 'UNAUTHENTICATED',
    403: 'FORBIDDEN',
    404: 'NOT_FOUND',
    409: 'CONFLICT',
    422: 'VALIDATION_ERROR',
    428: 'VERSION_REQUIRED',
    429: 'RATE_LIMITED',
    503: 'AUTH_SERVICE_UNAVAILABLE',
  } as Record<number, string>)[status] ?? (status >= 500 ? 'SERVER_ERROR' : `HTTP_${status}`)
}

function retryAfterMilliseconds(value: string | null): number | undefined {
  if (!value) return undefined
  if (/^\d+$/u.test(value)) {
    const milliseconds = Number(value) * 1_000
    return Number.isFinite(milliseconds) ? milliseconds : undefined
  }
  const date = Date.parse(value)
  return Number.isNaN(date) ? undefined : Math.max(0, date - Date.now())
}

function cancellationError(method: string, path: string, timeout: AbortSignal, external: AbortSignal | undefined, cause: unknown): BusinessGatewayError {
  const timedOut = timeout.aborted && !external?.aborted
  return new BusinessGatewayError(
    timedOut ? `Business Gateway timed out for ${method} ${path}` : `Business Gateway request was cancelled for ${method} ${path}`,
    {
      code: timedOut ? 'REQUEST_TIMEOUT' : 'REQUEST_CANCELLED',
      status: timedOut ? 408 : 0,
      retryable: timedOut,
      cause,
    },
  )
}

interface RequestLifecycle {
  readonly timeout: AbortSignal
  readonly signal: AbortSignal
  finish(): void
}

function requestLifecycle(timeoutMs: number, external: AbortSignal | undefined): RequestLifecycle {
  const timeoutController = new AbortController()
  const timer = globalThis.setTimeout(
    () => timeoutController.abort(new DOMException('The operation timed out', 'TimeoutError')),
    timeoutMs,
  )
  let finished = false
  return {
    timeout: timeoutController.signal,
    signal: external === undefined ? timeoutController.signal : AbortSignal.any([timeoutController.signal, external]),
    finish() {
      if (finished) return
      finished = true
      globalThis.clearTimeout(timer)
    },
  }
}

function responseWithLifecycle(
  response: Response,
  lifecycle: RequestLifecycle,
  external: AbortSignal | undefined,
  method: string,
  path: string,
): Response {
  if (response.body === null) {
    lifecycle.finish()
    return response
  }
  const reader = response.body.getReader()
  let settled = false
  const settle = (): void => {
    if (settled) return
    settled = true
    lifecycle.finish()
    reader.releaseLock()
  }
  const body = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const next = await reader.read()
        if (next.done) {
          settle()
          controller.close()
        } else {
          controller.enqueue(next.value)
        }
      } catch (cause) {
        const error = lifecycle.signal.aborted
          ? cancellationError(method, path, lifecycle.timeout, external, cause)
          : new BusinessGatewayError(`Business Gateway response failed before completion for ${method} ${path}`, {
              code: 'REQUEST_FAILED',
              status: 0,
              retryable: true,
              cause,
            })
        settle()
        controller.error(error)
      }
    },
    async cancel(reason) {
      try {
        await reader.cancel(reason)
      } finally {
        settle()
      }
    },
  })
  return new Response(body, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  })
}

async function withAbort<T>(value: Promise<T>, signal: AbortSignal): Promise<T> {
  signal.throwIfAborted()
  let onAbort: (() => void) | undefined
  const aborted = new Promise<never>((_resolve, reject) => {
    onAbort = () => reject(signal.reason ?? new DOMException('The operation was aborted', 'AbortError'))
    signal.addEventListener('abort', onAbort, { once: true })
  })
  try {
    return await Promise.race([value, aborted])
  } finally {
    if (onAbort !== undefined) signal.removeEventListener('abort', onAbort)
  }
}

async function delay(milliseconds: number, signal: AbortSignal | undefined): Promise<void> {
  signal?.throwIfAborted()
  await new Promise<void>((resolve, reject) => {
    let timer: ReturnType<typeof globalThis.setTimeout>
    const onAbort = () => {
      globalThis.clearTimeout(timer)
      signal?.removeEventListener('abort', onAbort)
      reject(signal?.reason ?? new DOMException('The operation was aborted', 'AbortError'))
    }
    const cleanup = () => signal?.removeEventListener('abort', onAbort)
    timer = globalThis.setTimeout(() => {
      cleanup()
      resolve()
    }, milliseconds)
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}

class BusinessGatewayTransport {
  private readonly apiURL: string
  private readonly accessToken: () => string | Promise<string>
  private readonly timeoutMs: number
  private readonly maxResponseBytes: number
  private readonly source: 'rest' | 'agent'

  constructor(options: RagFlowBusinessClientOptions) {
    const accessToken = options.accessToken
    if (typeof accessToken === 'string' && accessToken.trim() === '') {
      throw new TypeError('accessToken must not be empty')
    }
    this.apiURL = `${serviceRoot(options.baseURL)}/api/v1`
    this.accessToken = typeof accessToken === 'string' ? () => accessToken : accessToken
    this.timeoutMs = positiveInteger(options.timeoutMs ?? 60_000, 'timeoutMs')
    this.maxResponseBytes = responseByteLimit(options.maxResponseBytes ?? DEFAULT_RAGFLOW_RESPONSE_MAX_BYTES, 'maxResponseBytes')
    if (options.source !== undefined && options.source !== 'rest' && options.source !== 'agent') {
      throw new TypeError('source must be rest or agent')
    }
    this.source = options.source ?? 'rest'
    if (this.timeoutMs > 300_000) throw new TypeError('timeoutMs must not exceed 300000')
  }

  async request<O extends BusinessGatewayJsonOperation>(operation: O, method: string, path: string, wire: WireOptions = {}): Promise<OperationData<O>> {
    const envelope = await this.requestEnvelope(operation, method, path, wire)
    return envelope.data
  }

  async requestEnvelope<O extends BusinessGatewayJsonOperation>(operation: O, method: string, path: string, wire: WireOptions = {}): Promise<OpenApiSuccessEnvelope<OperationData<O>>> {
    const response = await this.raw(method, path, {
      ...wire,
      ...(wire.json === undefined ? {} : { body: JSON.stringify(wire.json) }),
    })
    const contentType = response.headers.get('content-type') ?? ''
    if (!contentType.includes('json')) {
      await response.body?.cancel().catch(() => undefined)
      throw new BusinessGatewayError(`Business Gateway returned non-JSON for ${method} ${path}`, {
        code: 'INVALID_GATEWAY_RESPONSE',
        status: response.status,
      })
    }
    let envelope: unknown
    try {
      envelope = await responseJson(response, this.responseLimit(wire.options))
    } catch (cause) {
      if (cause instanceof BusinessGatewayError) throw cause
      throw new BusinessGatewayError(`Business Gateway returned invalid JSON for ${method} ${path}`, {
        code: 'INVALID_GATEWAY_RESPONSE',
        status: response.status,
        cause,
      })
    }
    try {
      assertOperationResponse(operation, envelope)
    } catch (cause) {
      throw new BusinessGatewayError(`Business Gateway returned an invalid envelope for ${method} ${path}`, {
        code: 'INVALID_GATEWAY_RESPONSE',
        status: response.status,
        cause,
      })
    }
    return envelope
  }

  async raw(method: string, path: string, wire: WireOptions = {}): Promise<Response> {
    const options = wire.options ?? {}
    if (wire.idempotencyRequired && !options.idempotencyKey?.trim()) {
      throw new BusinessGatewayError('This write requires RequestOptions.idempotencyKey', {
        code: 'IDEMPOTENCY_KEY_REQUIRED',
        status: 400,
      })
    }
    const url = new URL(`${this.apiURL}${path}`)
    appendQuery(url, wire.query)
    const lifecycle = requestLifecycle(this.timeoutMs, options.signal)
    let token: string
    try {
      token = (await withAbort(Promise.resolve(this.accessToken()), lifecycle.signal)).trim()
    } catch (cause) {
      lifecycle.finish()
      if (lifecycle.signal.aborted) throw cancellationError(method, path, lifecycle.timeout, options.signal, undefined)
      if (cause instanceof BusinessGatewayError) throw cause
      throw new BusinessGatewayError('Unable to resolve the business access token', {
        code: 'ACCESS_TOKEN_UNAVAILABLE',
      })
    }
    if (!token || /\s/u.test(token)) {
      lifecycle.finish()
      throw new BusinessGatewayError('A non-empty business access token without whitespace is required', {
        code: 'ACCESS_TOKEN_UNAVAILABLE',
        status: 401,
      })
    }

    const headers = new Headers({
      authorization: `Bearer ${token}`,
      accept: 'application/json',
      'x-nomix-call-source': this.source,
    })
    if (wire.json !== undefined) headers.set('content-type', 'application/json')
    if (options.idempotencyKey) headers.set('idempotency-key', options.idempotencyKey)
    if (options.version !== undefined) headers.set('if-match', String(positiveInteger(options.version, 'RequestOptions.version')))
    let response: Response
    try {
      response = await globalThis.fetch(url, { method, headers, body: wire.body, signal: lifecycle.signal })
    } catch (cause) {
      lifecycle.finish()
      if (lifecycle.signal.aborted) throw cancellationError(method, path, lifecycle.timeout, options.signal, cause)
      throw new BusinessGatewayError(`Business Gateway request failed for ${method} ${path}`, {
        code: 'REQUEST_FAILED',
        status: 0,
        retryable: true,
        cause,
      })
    }
    const managedResponse = responseWithLifecycle(response, lifecycle, options.signal, method, path)
    if (!managedResponse.ok) throw await this.error(managedResponse, method, path, token, this.responseLimit(options))
    return managedResponse
  }

  private responseLimit(options: RequestOptions | undefined): number {
    if (options?.maxResponseBytes === undefined) return this.maxResponseBytes
    return Math.min(this.maxResponseBytes, responseByteLimit(options.maxResponseBytes, 'RequestOptions.maxResponseBytes'))
  }

  private async error(response: Response, method: string, path: string, token: string, maximumBytes: number): Promise<BusinessGatewayError> {
    let body: unknown
    try {
      body = await responseJson(response, Math.min(maximumBytes, ERROR_RESPONSE_MAX_BYTES))
    } catch (cause) {
      if (cause instanceof BusinessGatewayError && ['REQUEST_CANCELLED', 'REQUEST_FAILED', 'REQUEST_TIMEOUT'].includes(cause.code)) throw cause
      // Non-JSON errors are represented only by status and operation.
    }
    const error = isOpenApiErrorEnvelope(body) ? body.error : undefined
    const message = error !== undefined
      ? error.message
      : `Business Gateway HTTP ${response.status} for ${method} ${path}`
    const retryAfterMs = retryAfterMilliseconds(response.headers.get('retry-after'))
    return new BusinessGatewayError(redact(message, token), {
      code: error?.code ?? defaultErrorCode(response.status),
      status: response.status,
      requestId: error?.requestId ?? response.headers.get('x-request-id') ?? undefined,
      details: error?.details === undefined ? undefined : redactValue(error.details, token),
      ...(error === undefined ? {} : { retryable: error.retryable }),
      ...(retryAfterMs === undefined ? {} : { retryAfterMs }),
    })
  }
}

function redact(value: string, token: string): string {
  return token ? value.replaceAll(token, '[REDACTED]') : value
}

function redactValue(value: JsonValue, token: string): JsonValue {
  if (typeof value === 'string') return redact(value, token)
  if (Array.isArray(value)) return value.map(member => redactValue(member, token))
  if (value !== null && typeof value === 'object') {
    const result: JsonObject = {}
    for (const [key, member] of Object.entries(value)) result[key] = redactValue(member, token)
    return result
  }
  return value
}

export class RagFlowBusinessClient {
  readonly authorization: AuthorizationClient
  readonly datasets: DatasetClient
  readonly documents: DocumentClient
  readonly chunks: ChunkClient
  readonly chats: ChatClient
  readonly sessions: SessionClient
  readonly agents: AgentClient
  readonly memories: MemoryClient
  readonly memoryMessages: MemoryMessageClient
  readonly retrieval: RetrievalClient
  readonly pageIndex: PageIndexClient

  constructor(options: RagFlowBusinessClientOptions) {
    const transport = new BusinessGatewayTransport(options)
    this.authorization = new AuthorizationClient(transport)
    this.datasets = new DatasetClient(transport)
    this.documents = new DocumentClient(transport)
    this.chunks = new ChunkClient(transport)
    this.chats = new ChatClient(transport)
    this.sessions = new SessionClient(transport)
    this.agents = new AgentClient(transport)
    this.memories = new MemoryClient(transport)
    this.memoryMessages = new MemoryMessageClient(transport)
    this.retrieval = new RetrievalClient(transport)
    this.pageIndex = new PageIndexClient(transport)
  }
}

export class AuthorizationClient {
  constructor(private readonly transport: BusinessGatewayTransport) {}

  getContext(options: RequestOptions = {}): Promise<BusinessAuthorizationContext> {
    return this.transport.request('authorization.context', 'GET', '/gateway-context', { options })
  }
}

export class DatasetClient {
  constructor(private readonly transport: BusinessGatewayTransport) {}

  create(request: CreateDatasetRequest, options: RequestOptions): Promise<Dataset> {
    return this.transport.request('datasets.create', 'POST', '/datasets', { json: request, options, idempotencyRequired: true })
  }

  list(request: ListDatasetsRequest = {}, options: RequestOptions = {}): Promise<GatewayResult<Dataset[]>> {
    return this.transport.requestEnvelope('datasets.list', 'GET', '/datasets', {
      query: { ...pageQuery(request), id: request.id, ids: request.ids, name: request.name },
      options,
    })
  }

  get(datasetId: string, options: RequestOptions = {}): Promise<Dataset> {
    return this.transport.request('datasets.get', 'GET', `/datasets/${encodeURIComponent(datasetId)}`, { options })
  }

  async getByName(name: string, options: RequestOptions = {}): Promise<Dataset> {
    const [dataset] = (await this.list({ name, limit: 2 }, options)).data
    if (dataset === undefined) throw new BusinessGatewayError(`Dataset ${JSON.stringify(name)} was not found`, { code: 'RESOURCE_NOT_FOUND', status: 404 })
    return dataset
  }

  update(datasetId: string, patch: OperationBody<'datasets.update'>, options: VersionedRequestOptions): Promise<Dataset> {
    return this.transport.request('datasets.update', 'PATCH', `/datasets/${encodeURIComponent(datasetId)}`, { json: patch, options })
  }

  delete(datasetId: string, options: VersionedRequestOptions): Promise<OperationData<'datasets.delete'>> {
    return this.transport.request('datasets.delete', 'DELETE', `/datasets/${encodeURIComponent(datasetId)}`, { json: {}, options })
  }

  batchDelete(ids: string[], options: RequestOptions): Promise<OperationData<'datasets.batchDelete'>> {
    return this.transport.request('datasets.batchDelete', 'POST', '/datasets:batch-delete', { json: { ids }, options, idempotencyRequired: true })
  }

  getMetadataConfig(datasetId: string, options: RequestOptions = {}): Promise<OperationData<'datasets.getMetadataConfig'>> {
    return this.transport.request('datasets.getMetadataConfig', 'GET', `/datasets/${encodeURIComponent(datasetId)}/metadata-config`, { options })
  }

  updateMetadataConfig(datasetId: string, config: OperationBody<'datasets.updateMetadataConfig'>, options: VersionedRequestOptions): Promise<OperationData<'datasets.updateMetadataConfig'>> {
    return this.transport.request('datasets.updateMetadataConfig', 'PUT', `/datasets/${encodeURIComponent(datasetId)}/metadata-config`, { json: config, options })
  }
}

export class DocumentClient {
  constructor(private readonly transport: BusinessGatewayTransport) {}

  list(request: ListDocumentsRequest, options: RequestOptions = {}): Promise<GatewayResult<Document[]>> {
    return this.transport.requestEnvelope('documents.list', 'GET', `/datasets/${encodeURIComponent(request.datasetId)}/documents`, {
      query: {
        ...pageQuery(request),
        id: request.id,
        ids: request.ids,
        name: request.name,
        keywords: request.keywords,
        createTimeFrom: request.createTimeFrom,
        createTimeTo: request.createTimeTo,
      },
      options,
    })
  }

  get(datasetId: string, documentId: string, options: RequestOptions = {}): Promise<Document> {
    return this.transport.request('documents.get', 'GET', `/datasets/${encodeURIComponent(datasetId)}/documents/${encodeURIComponent(documentId)}`, { options })
  }

  update(datasetId: string, documentId: string, patch: OperationBody<'documents.update'>, options: VersionedRequestOptions): Promise<Document> {
    return this.transport.request('documents.update', 'PATCH', `/datasets/${encodeURIComponent(datasetId)}/documents/${encodeURIComponent(documentId)}`, { json: patch, options })
  }

  delete(datasetId: string, documentId: string, options: VersionedRequestOptions): Promise<OperationData<'documents.delete'>> {
    return this.transport.request('documents.delete', 'DELETE', `/datasets/${encodeURIComponent(datasetId)}/documents/${encodeURIComponent(documentId)}`, { json: {}, options })
  }

  batchDelete(datasetId: string, ids: string[], options: RequestOptions): Promise<OperationData<'documents.batchDelete'>> {
    return this.transport.request('documents.batchDelete', 'POST', `/datasets/${encodeURIComponent(datasetId)}/documents:batch-delete`, {
      json: { ids },
      options,
      idempotencyRequired: true,
    })
  }

  startParse(datasetId: string, documentIds: string[], options: RequestOptions): Promise<OperationData<'documents.startParse'>> {
    return this.transport.request('documents.startParse', 'POST', `/datasets/${encodeURIComponent(datasetId)}/documents:parse`, {
      json: { documentIds },
      options,
      idempotencyRequired: true,
    })
  }

  cancelParse(datasetId: string, documentIds: string[], options: RequestOptions): Promise<OperationData<'documents.cancelParse'>> {
    return this.transport.request('documents.cancelParse', 'POST', `/datasets/${encodeURIComponent(datasetId)}/documents:cancel-parse`, {
      json: { documentIds },
      options,
      idempotencyRequired: true,
    })
  }

  async upload(datasetId: string, documents: UploadDocument[], options: RequestOptions): Promise<Document[]> {
    const form = new FormData()
    for (const document of documents) form.append('file', document.body, document.displayName)
    return this.transport.request('documents.upload', 'POST', `/datasets/${encodeURIComponent(datasetId)}/documents`, {
      body: form,
      options,
      idempotencyRequired: true,
    })
  }

  download(datasetId: string, documentId: string, options: RequestOptions = {}): Promise<Response> {
    return this.transport.raw('GET', `/datasets/${encodeURIComponent(datasetId)}/documents/${encodeURIComponent(documentId)}/content`, { options })
  }

  async parseAndWait(datasetId: string, documentIds: string[], options: RequestOptions & { pollIntervalMs?: number }): Promise<Document[]> {
    await this.startParse(datasetId, documentIds, options)
    const pending = new Set(documentIds)
    const finished: Document[] = []
    const interval = positiveInteger(options.pollIntervalMs ?? 1_000, 'pollIntervalMs')
    while (pending.size > 0) {
      options.signal?.throwIfAborted()
      for (const id of pending) {
        const document = await this.get(datasetId, id, options)
        const state = String(document.run ?? '').toUpperCase()
        if (state === 'DONE' || state === 'FAIL' || state === 'CANCEL' || (document.progress ?? 0) >= 1) {
          finished.push(document)
          pending.delete(id)
        }
      }
      if (pending.size > 0) await delay(interval, options.signal)
    }
    return finished
  }
}

export class ChunkClient {
  constructor(private readonly transport: BusinessGatewayTransport) {}

  list(datasetId: string, documentId: string, request: OperationQuery<'chunks.list'> = {}, options: RequestOptions = {}): Promise<GatewayResult<Chunk[]>> {
    return this.transport.requestEnvelope('chunks.list', 'GET', `/datasets/${encodeURIComponent(datasetId)}/documents/${encodeURIComponent(documentId)}/chunks`, {
      query: { ...pageQuery(request), keywords: request.keywords, id: request.id },
      options,
    })
  }

  get(datasetId: string, documentId: string, chunkId: string, options: RequestOptions = {}): Promise<Chunk> {
    return this.transport.request('chunks.get', 'GET', `/datasets/${encodeURIComponent(datasetId)}/documents/${encodeURIComponent(documentId)}/chunks/${encodeURIComponent(chunkId)}`, { options })
  }

  create(datasetId: string, documentId: string, input: OperationBody<'chunks.create'>, options: RequestOptions): Promise<Chunk> {
    return this.transport.request('chunks.create', 'POST', `/datasets/${encodeURIComponent(datasetId)}/documents/${encodeURIComponent(documentId)}/chunks`, {
      json: input,
      options,
      idempotencyRequired: true,
    })
  }

  update(datasetId: string, documentId: string, chunkId: string, patch: OperationBody<'chunks.update'>, options: VersionedRequestOptions): Promise<Chunk> {
    return this.transport.request('chunks.update', 'PATCH', `/datasets/${encodeURIComponent(datasetId)}/documents/${encodeURIComponent(documentId)}/chunks/${encodeURIComponent(chunkId)}`, { json: patch, options })
  }

  delete(datasetId: string, documentId: string, chunkId: string, options: VersionedRequestOptions): Promise<OperationData<'chunks.delete'>> {
    return this.transport.request('chunks.delete', 'DELETE', `/datasets/${encodeURIComponent(datasetId)}/documents/${encodeURIComponent(documentId)}/chunks/${encodeURIComponent(chunkId)}`, { json: {}, options })
  }

  batchDelete(datasetId: string, documentId: string, ids: string[], options: RequestOptions): Promise<OperationData<'chunks.batchDelete'>> {
    return this.transport.request('chunks.batchDelete', 'POST', `/datasets/${encodeURIComponent(datasetId)}/documents/${encodeURIComponent(documentId)}/chunks:batch-delete`, {
      json: { ids },
      options,
      idempotencyRequired: true,
    })
  }
}

export class ChatClient {
  constructor(private readonly transport: BusinessGatewayTransport) {}

  create(request: CreateChatRequest, options: RequestOptions): Promise<Chat> {
    return this.transport.request('chats.create', 'POST', '/chats', { json: request, options, idempotencyRequired: true })
  }

  list(request: ListChatsRequest = {}, options: RequestOptions = {}): Promise<GatewayResult<Chat[]>> {
    return this.transport.requestEnvelope('chats.list', 'GET', '/chats', {
      query: { ...pageQuery(request), id: request.id, name: request.name, keywords: request.keywords },
      options,
    })
  }

  get(chatId: string, options: RequestOptions = {}): Promise<Chat> {
    return this.transport.request('chats.get', 'GET', `/chats/${encodeURIComponent(chatId)}`, { options })
  }

  update(chatId: string, patch: OperationBody<'chats.update'>, options: VersionedRequestOptions): Promise<Chat> {
    return this.transport.request('chats.update', 'PATCH', `/chats/${encodeURIComponent(chatId)}`, { json: patch, options })
  }

  delete(chatId: string, options: VersionedRequestOptions): Promise<OperationData<'chats.delete'>> {
    return this.transport.request('chats.delete', 'DELETE', `/chats/${encodeURIComponent(chatId)}`, { json: {}, options })
  }

  batchDelete(ids: string[], options: RequestOptions): Promise<OperationData<'chats.batchDelete'>> {
    return this.transport.request('chats.batchDelete', 'POST', '/chats:batch-delete', { json: { ids }, options, idempotencyRequired: true })
  }
}

function sessionPath(target: SessionTarget): string {
  return `/${target.kind === 'chat' ? 'chats' : 'agents'}/${encodeURIComponent(target.ownerId)}/sessions`
}

export class SessionClient {
  constructor(private readonly transport: BusinessGatewayTransport) {}

  create(target: SessionTarget, input: OperationBody<'chatSessions.create'>, options: RequestOptions): Promise<Session> {
    if (target.kind === 'chat') return this.transport.request('chatSessions.create', 'POST', sessionPath(target), { json: input, options, idempotencyRequired: true })
    return this.transport.request('agentSessions.create', 'POST', sessionPath(target), { json: input, options, idempotencyRequired: true })
  }

  list(request: ListSessionsRequest, options: RequestOptions = {}): Promise<GatewayResult<Session[]>> {
    const wire = {
      query: { ...pageQuery(request), id: request.id, name: request.name },
      options,
    }
    if (request.kind === 'chat') return this.transport.requestEnvelope('chatSessions.list', 'GET', sessionPath(request), wire)
    return this.transport.requestEnvelope('agentSessions.list', 'GET', sessionPath(request), wire)
  }

  get(target: SessionTarget, sessionId: string, options: RequestOptions = {}): Promise<Session> {
    const path = `${sessionPath(target)}/${encodeURIComponent(sessionId)}`
    if (target.kind === 'chat') return this.transport.request('chatSessions.get', 'GET', path, { options })
    return this.transport.request('agentSessions.get', 'GET', path, { options })
  }

  update(target: SessionTarget, sessionId: string, patch: OperationBody<'chatSessions.update'>, options: VersionedRequestOptions): Promise<Session> {
    if (target.kind !== 'chat') throw new TypeError('Only chat sessions support update')
    return this.transport.request('chatSessions.update', 'PATCH', `${sessionPath(target)}/${encodeURIComponent(sessionId)}`, { json: patch, options })
  }

  delete(target: SessionTarget, sessionId: string, options: VersionedRequestOptions): Promise<OperationData<'chatSessions.delete'>> {
    const path = `${sessionPath(target)}/${encodeURIComponent(sessionId)}`
    if (target.kind === 'chat') return this.transport.request('chatSessions.delete', 'DELETE', path, { json: {}, options })
    return this.transport.request('agentSessions.delete', 'DELETE', path, { json: {}, options })
  }

  batchDelete(target: SessionTarget, ids: string[], options: RequestOptions): Promise<OperationData<'chatSessions.batchDelete'>> {
    const path = `${sessionPath(target)}:batch-delete`
    const wire = { json: { ids }, options, idempotencyRequired: true }
    if (target.kind === 'chat') return this.transport.request('chatSessions.batchDelete', 'POST', path, wire)
    return this.transport.request('agentSessions.batchDelete', 'POST', path, wire)
  }

  invoke(request: InvokeSessionRequest, options: RequestOptions): Promise<Message> {
    const path = `${sessionPath(request)}/${encodeURIComponent(request.sessionId)}:invoke`
    const wire = {
      json: {
        question: request.question,
        ...(request.inputs === undefined ? {} : { inputs: request.inputs }),
        ...(request.release === undefined ? {} : { release: request.release }),
          ...(request.returnTrace === undefined ? {} : { returnTrace: request.returnTrace }),
        stream: false,
      },
      options,
      idempotencyRequired: true,
    }
    if (request.kind === 'chat') return this.transport.request('chatSessions.invoke', 'POST', path, wire)
    return this.transport.request('agentSessions.invoke', 'POST', path, wire)
  }
}

export class AgentClient {
  constructor(private readonly transport: BusinessGatewayTransport) {}

  list(request: ListAgentsRequest = {}, options: RequestOptions = {}): Promise<GatewayResult<Agent[]>> {
    return this.transport.requestEnvelope('agents.list', 'GET', '/agents', { query: pageQuery(request), options })
  }

  get(agentId: string, options: RequestOptions = {}): Promise<Agent> {
    return this.transport.request('agents.get', 'GET', `/agents/${encodeURIComponent(agentId)}`, { options })
  }

  create(request: CreateAgentRequest, options: RequestOptions): Promise<Agent> {
    return this.transport.request('agents.create', 'POST', '/agents', { json: request, options, idempotencyRequired: true })
  }

  update(agentId: string, patch: OperationBody<'agents.update'>, options: VersionedRequestOptions): Promise<Agent> {
    return this.transport.request('agents.update', 'PATCH', `/agents/${encodeURIComponent(agentId)}`, { json: patch, options })
  }

  delete(agentId: string, options: VersionedRequestOptions): Promise<OperationData<'agents.delete'>> {
    return this.transport.request('agents.delete', 'DELETE', `/agents/${encodeURIComponent(agentId)}`, { json: {}, options })
  }
}

export class MemoryClient {
  constructor(private readonly transport: BusinessGatewayTransport) {}

  create(request: CreateMemoryRequest, options: RequestOptions): Promise<Memory> {
    return this.transport.request('memories.create', 'POST', '/memories', { json: request, options, idempotencyRequired: true })
  }

  list(request: ListMemoriesRequest = {}, options: RequestOptions = {}): Promise<GatewayResult<Memory[]>> {
    return this.transport.requestEnvelope('memories.list', 'GET', '/memories', {
      query: { ...pageQuery(request), memoryType: request.memoryType, storageType: request.storageType, keywords: request.keywords },
      options,
    })
  }

  get(memoryId: string, options: RequestOptions = {}): Promise<Memory> {
    return this.transport.request('memories.get', 'GET', `/memories/${encodeURIComponent(memoryId)}`, { options })
  }

  update(memoryId: string, patch: OperationBody<'memories.update'>, options: VersionedRequestOptions): Promise<Memory> {
    return this.transport.request('memories.update', 'PATCH', `/memories/${encodeURIComponent(memoryId)}`, { json: patch, options })
  }

  delete(memoryId: string, options: VersionedRequestOptions): Promise<OperationData<'memories.delete'>> {
    return this.transport.request('memories.delete', 'DELETE', `/memories/${encodeURIComponent(memoryId)}`, { json: {}, options })
  }

  getConfig(memoryId: string, options: RequestOptions = {}): Promise<Memory> {
    return this.transport.request('memories.getConfig', 'GET', `/memories/${encodeURIComponent(memoryId)}/config`, { options })
  }
}

export class MemoryMessageClient {
  constructor(private readonly transport: BusinessGatewayTransport) {}

  list(memoryId: string, request: PageRequest = {}, options: RequestOptions = {}): Promise<OperationResponse<'memoryMessages.list'>> {
    return this.transport.requestEnvelope('memoryMessages.list', 'GET', `/memories/${encodeURIComponent(memoryId)}/messages`, {
      query: pageQuery(request),
      options,
    })
  }

  create(memoryId: string, request: OperationBody<'memoryMessages.create'>, options: RequestOptions): Promise<OperationData<'memoryMessages.create'>> {
    return this.transport.request('memoryMessages.create', 'POST', `/memories/${encodeURIComponent(memoryId)}/messages`, {
      json: request,
      options,
      idempotencyRequired: true,
    })
  }

  batchCreate(request: OperationBody<'memoryMessages.batchCreate'>, options: RequestOptions): Promise<OperationData<'memoryMessages.batchCreate'>> {
    return this.transport.request('memoryMessages.batchCreate', 'POST', '/memory-messages:batch-create', {
      json: request,
      options,
      idempotencyRequired: true,
    })
  }

  update(memoryId: string, messageId: number, patch: OperationBody<'memoryMessages.update'>, options: VersionedRequestOptions): Promise<OperationData<'memoryMessages.update'>> {
    return this.transport.request('memoryMessages.update', 'PATCH', `/memories/${encodeURIComponent(memoryId)}/messages/${messageId}`, { json: patch, options })
  }

  delete(memoryId: string, messageId: number, options: VersionedRequestOptions): Promise<OperationData<'memoryMessages.delete'>> {
    return this.transport.request('memoryMessages.delete', 'DELETE', `/memories/${encodeURIComponent(memoryId)}/messages/${messageId}`, { json: {}, options })
  }

  getContent(memoryId: string, messageId: number, options: RequestOptions = {}): Promise<OperationData<'memoryMessages.getContent'>> {
    return this.transport.request('memoryMessages.getContent', 'GET', `/memories/${encodeURIComponent(memoryId)}/messages/${messageId}/content`, { options })
  }

  search(request: SearchMemoryMessagesRequest, options: RequestOptions = {}): Promise<OperationData<'memoryMessages.search'>> {
    return this.transport.request('memoryMessages.search', 'GET', '/memory-messages/search', {
      query: {
        query: request.query,
        memoryIds: request.memoryIds,
        agentId: request.agentId,
        sessionId: request.sessionId,
        similarityThreshold: request.similarityThreshold,
        keywordsSimilarityWeight: request.keywordsSimilarityWeight,
        topN: request.topN,
      },
      options,
    })
  }

  recent(request: OperationQuery<'memoryMessages.recent'>, options: RequestOptions = {}): Promise<OperationData<'memoryMessages.recent'>> {
    return this.transport.request('memoryMessages.recent', 'GET', '/memory-messages/recent', {
      query: { memoryIds: request.memoryIds, agentId: request.agentId, sessionId: request.sessionId, limit: request.limit },
      options,
    })
  }
}

export class RetrievalClient {
  constructor(private readonly transport: BusinessGatewayTransport) {}

  search(request: RetrieveRequest, options: RequestOptions = {}): Promise<GatewayResult<RetrievalResult>> {
    return this.transport.requestEnvelope('retrieval.search', 'POST', '/retrieval', {
      json: {
        question: request.question,
        ...(request.datasetIds === undefined ? {} : { datasetIds: request.datasetIds }),
        ...(request.documentIds === undefined ? {} : { documentIds: request.documentIds }),
        ...(request.cursor === undefined ? {} : { cursor: request.cursor }),
        ...(request.limit === undefined ? {} : { limit: request.limit }),
        ...(request.similarityThreshold === undefined ? {} : { similarityThreshold: request.similarityThreshold }),
        ...(request.vectorSimilarityWeight === undefined ? {} : { vectorSimilarityWeight: request.vectorSimilarityWeight }),
        ...(request.topK === undefined ? {} : { topK: request.topK }),
        ...(request.rerankId === undefined ? {} : { rerankId: request.rerankId }),
        ...(request.keyword === undefined ? {} : { keyword: request.keyword }),
        ...(request.crossLanguages === undefined ? {} : { crossLanguages: request.crossLanguages }),
        ...(request.metadataCondition === undefined ? {} : { metadataCondition: request.metadataCondition }),
        ...(request.useKg === undefined ? {} : { useKg: request.useKg }),
        ...(request.tocEnhance === undefined ? {} : { tocEnhance: request.tocEnhance }),
        ...(request.highlight === undefined ? {} : { highlight: request.highlight }),
        ...(request.referenceMetadata === undefined ? {} : { referenceMetadata: request.referenceMetadata }),
      },
      options,
    })
  }
}

export class PageIndexClient {
  constructor(private readonly transport: BusinessGatewayTransport) {}

  get(datasetId: string, documentId: string, options: RequestOptions = {}): Promise<PageIndexResult> {
    return this.transport.request('pageIndex.get', 'GET', `/datasets/${encodeURIComponent(datasetId)}/documents/${encodeURIComponent(documentId)}/page-index`, { options })
  }

  status(datasetId: string, documentId: string, options: RequestOptions = {}): Promise<PageIndexStatus> {
    return this.transport.request('pageIndex.status', 'GET', `/datasets/${encodeURIComponent(datasetId)}/documents/${encodeURIComponent(documentId)}/page-index/status`, { options })
  }

  build(datasetId: string, request: BuildPageIndexRequest, options: RequestOptions): Promise<OperationData<'pageIndex.build'>> {
    return this.transport.request('pageIndex.build', 'POST', `/datasets/${encodeURIComponent(datasetId)}/documents:build-page-index`, {
      json: request,
      options,
      idempotencyRequired: true,
    })
  }

  search(request: SearchPageIndexRequest, options: RequestOptions = {}): Promise<GatewayResult<PageIndexSearchResult>> {
    return this.transport.requestEnvelope('pageIndex.search', 'POST', '/page-index/retrieval', {
      json: {
        datasetIds: request.datasetIds,
        documentIds: request.documentIds,
        question: request.question,
        ...(request.limit === undefined ? {} : { limit: request.limit }),
      },
      options,
    })
  }
}
