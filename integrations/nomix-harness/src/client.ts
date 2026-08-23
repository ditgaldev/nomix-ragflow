/** TypeScript client for the public RAGFlow HTTP API. */

import { setTimeout as delay } from 'node:timers/promises'

import type {
  Agent,
  AskSessionRequest,
  Chat,
  Chunk,
  CreateAgentRequest,
  CreateChatRequest,
  CreateDatasetRequest,
  CreateMemoryRequest,
  Dataset,
  Document,
  JsonObject,
  JsonValue,
  ListAgentsRequest,
  ListChatsRequest,
  ListDatasetsRequest,
  ListDocumentsRequest,
  ListMemoriesRequest,
  ListSessionsRequest,
  Memory,
  MemoryList,
  Message,
  PageRequest,
  RequestOptions,
  RetrieveRequest,
  SearchMemoryMessagesRequest,
  Session,
  SessionTarget,
  UploadDocument,
} from './types.js'

export type * from './types.js'

/** Client construction options. */
export interface RagFlowClientOptions {
  /** RAGFlow origin, without `/api/v1`. */
  baseURL: string
  /** API key sent as a Bearer credential. */
  apiKey: string
  /** REST API version. */
  apiVersion?: string
  /** Per-request timeout in milliseconds. */
  timeoutMs?: number
  /** Fetch implementation, primarily for controlled runtimes and tests. */
  fetch?: typeof globalThis.fetch
}

interface Envelope<T> {
  code: number
  message?: string
  data?: T
  details?: JsonValue
}

type QueryValue = string | number | boolean | readonly string[] | undefined
type Query = Record<string, QueryValue>

/** Structured RAGFlow response failure with credentials excluded. */
export class RagFlowApiError extends Error {
  readonly status?: number
  readonly code?: number
  readonly details?: JsonValue

  constructor(message: string, options: { status?: number; code?: number; details?: JsonValue; cause?: unknown } = {}) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause })
    this.name = 'RagFlowApiError'
    this.status = options.status
    this.code = options.code
    this.details = options.details
  }
}

function withoutTrailingSlash(value: string): string {
  return value.replace(/\/+$/, '')
}

function positiveInteger(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) throw new TypeError(`${label} must be a positive safe integer`)
  return value
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
  return {
    page: request.page,
    page_size: request.pageSize,
    orderby: request.orderby,
    desc: request.desc,
  }
}

function asRecord(value: unknown, label: string): JsonObject {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new RagFlowApiError(`${label} returned a non-object response`)
  }
  return value as JsonObject
}

function answerOf(target: SessionTarget, value: JsonObject): Message {
  const answer = target.kind === 'agent'
    ? asRecord(value.data, 'agent completion').content
    : value.answer
  if (typeof answer !== 'string') throw new RagFlowApiError(`${target.kind} completion did not return answer text`)
  const reference = value.reference
  return {
    content: answer,
    role: 'assistant',
    ...(reference === undefined ? {} : { reference }),
  }
}

class RagFlowTransport {
  private readonly apiURL: string
  private readonly apiKey: string
  private readonly timeoutMs: number
  private readonly fetcher: typeof globalThis.fetch

  constructor(options: RagFlowClientOptions) {
    if (options.baseURL.trim() === '') throw new TypeError('baseURL must not be empty')
    if (options.apiKey.trim() === '') throw new TypeError('apiKey must not be empty')
    const apiVersion = options.apiVersion ?? 'v1'
    if (!/^[A-Za-z0-9._-]+$/.test(apiVersion)) throw new TypeError('apiVersion contains unsupported characters')
    this.apiURL = `${withoutTrailingSlash(options.baseURL)}/api/${apiVersion}`
    this.apiKey = options.apiKey
    this.timeoutMs = positiveInteger(options.timeoutMs ?? 60_000, 'timeoutMs')
    this.fetcher = options.fetch ?? globalThis.fetch
  }

  private safe(message: string): string {
    return message.replaceAll(this.apiKey, '[REDACTED]')
  }

  private safeDetails(details: JsonValue | undefined): JsonValue | undefined {
    return details === undefined ? undefined : JSON.parse(this.safe(JSON.stringify(details))) as JsonValue
  }

  /** Execute one JSON API request and validate the RAGFlow envelope. */
  async request<T>(method: string, path: string, options: {
    query?: Query
    body?: JsonValue
    signal?: AbortSignal
  } = {}): Promise<T> {
    const response = await this.raw(method, path, {
      query: options.query,
      signal: options.signal,
      ...(options.body === undefined ? {} : {
        body: JSON.stringify(options.body),
        headers: { 'content-type': 'application/json' },
      }),
    })
    const envelope = await this.requestEnvelope<T>(method, path, response)
    return envelope.data as T
  }

  async requestEnvelope<T>(method: string, path: string, responseOrOptions: Response | {
    query?: Query
    body?: JsonValue
    signal?: AbortSignal
  } = {}): Promise<Envelope<T>> {
    const response = responseOrOptions instanceof Response
      ? responseOrOptions
      : await this.raw(method, path, {
          query: responseOrOptions.query,
          signal: responseOrOptions.signal,
          ...(responseOrOptions.body === undefined ? {} : {
            body: JSON.stringify(responseOrOptions.body),
            headers: { 'content-type': 'application/json' },
          }),
        })
    let envelope: Envelope<T>
    try {
      envelope = await response.json() as Envelope<T>
    } catch (cause) {
      throw new RagFlowApiError(`RAGFlow returned invalid JSON for ${method} ${path}`, {
        status: response.status,
        cause,
      })
    }
    if (typeof envelope.code !== 'number') {
      throw new RagFlowApiError(`RAGFlow returned an invalid envelope for ${method} ${path}`, { status: response.status })
    }
    if (envelope.code !== 0) {
      throw new RagFlowApiError(this.safe(envelope.message ?? `RAGFlow API error ${envelope.code}`), {
        status: response.status,
        code: envelope.code,
        details: this.safeDetails(envelope.details),
      })
    }
    return envelope
  }

  /** Execute a raw request for binary and streaming endpoints. */
  async raw(method: string, path: string, options: {
    query?: Query
    body?: BodyInit
    headers?: HeadersInit
    signal?: AbortSignal
  } = {}): Promise<Response> {
    const url = new URL(`${this.apiURL}${path}`)
    appendQuery(url, options.query)
    const timeout = AbortSignal.timeout(this.timeoutMs)
    const signal = options.signal === undefined ? timeout : AbortSignal.any([timeout, options.signal])
    let response: Response
    try {
      response = await this.fetcher(url, {
        method,
        headers: {
          authorization: `Bearer ${this.apiKey}`,
          ...options.headers,
        },
        body: options.body,
        signal,
      })
    } catch (cause) {
      throw new RagFlowApiError(`RAGFlow request failed for ${method} ${path}`, { cause })
    }
    if (!response.ok) {
      let message = `RAGFlow HTTP ${response.status} for ${method} ${path}`
      try {
        const body = await response.clone().json() as { message?: unknown }
        if (typeof body.message === 'string') message = body.message
      } catch {
        // A non-JSON HTTP failure has no safer structured detail to expose.
      }
      throw new RagFlowApiError(this.safe(message), { status: response.status })
    }
    return response
  }
}

/** Public client. Domain properties mirror the public Python SDK. */
export class RagFlowClient {
  readonly datasets: DatasetClient
  readonly documents: DocumentClient
  readonly chunks: ChunkClient
  readonly chats: ChatClient
  readonly sessions: SessionClient
  readonly agents: AgentClient
  readonly memories: MemoryClient
  readonly retrieval: RetrievalClient

  constructor(options: RagFlowClientOptions) {
    const transport = new RagFlowTransport(options)
    this.datasets = new DatasetClient(transport)
    this.documents = new DocumentClient(transport)
    this.chunks = new ChunkClient(transport)
    this.chats = new ChatClient(transport)
    this.sessions = new SessionClient(transport)
    this.agents = new AgentClient(transport)
    this.memories = new MemoryClient(transport)
    this.retrieval = new RetrievalClient(transport)
  }
}

export class DatasetClient {
  constructor(private readonly client: RagFlowTransport) {}

  create(request: CreateDatasetRequest, options: RequestOptions = {}): Promise<Dataset> {
    return this.client.request('POST', '/datasets', {
      signal: options.signal,
      body: {
        name: request.name,
        ...(request.avatar === undefined ? {} : { avatar: request.avatar }),
        ...(request.description === undefined ? {} : { description: request.description }),
        ...(request.embeddingModel === undefined ? {} : { embedding_model: request.embeddingModel }),
        permission: request.permission ?? 'me',
        chunk_method: request.chunkMethod ?? 'naive',
        ...(request.parserConfig === undefined ? {} : { parser_config: request.parserConfig }),
        ...(request.autoMetadataConfig === undefined ? {} : { auto_metadata_config: request.autoMetadataConfig }),
      },
    })
  }

  list(request: ListDatasetsRequest = {}, options: RequestOptions = {}): Promise<Dataset[]> {
    return this.client.request('GET', '/datasets', {
      signal: options.signal,
      query: { ...pageQuery(request), id: request.id, ids: request.ids, name: request.name },
    })
  }

  async getByName(name: string, options: RequestOptions = {}): Promise<Dataset> {
    const [dataset] = await this.list({ name }, options)
    if (dataset === undefined) throw new RagFlowApiError(`Dataset ${JSON.stringify(name)} not found`)
    return dataset
  }

  update(datasetId: string, patch: JsonObject, options: RequestOptions = {}): Promise<Dataset> {
    return this.client.request('PUT', `/datasets/${encodeURIComponent(datasetId)}`, { body: patch, signal: options.signal })
  }

  async delete(ids: string[] | undefined, deleteAll = false, options: RequestOptions = {}): Promise<void> {
    await this.client.request('DELETE', '/datasets', { body: { ids: ids ?? null, delete_all: deleteAll }, signal: options.signal })
  }

  getAutoMetadata(datasetId: string, options: RequestOptions = {}): Promise<JsonObject> {
    return this.client.request('GET', `/datasets/${encodeURIComponent(datasetId)}/metadata/config`, { signal: options.signal })
  }

  updateAutoMetadata(datasetId: string, config: JsonObject, options: RequestOptions = {}): Promise<JsonObject> {
    return this.client.request('PUT', `/datasets/${encodeURIComponent(datasetId)}/metadata/config`, { body: config, signal: options.signal })
  }
}

export class DocumentClient {
  constructor(private readonly client: RagFlowTransport) {}

  async list(request: ListDocumentsRequest, options: RequestOptions = {}): Promise<Document[]> {
    if (request.id !== undefined && request.ids !== undefined) throw new TypeError('id and ids are mutually exclusive')
    const data = await this.client.request<{ docs: Document[] }>('GET', `/datasets/${encodeURIComponent(request.datasetId)}/documents`, {
      signal: options.signal,
      query: {
        ...pageQuery(request),
        id: request.id,
        ids: request.ids,
        name: request.name,
        keywords: request.keywords,
        create_time_from: request.createTimeFrom,
        create_time_to: request.createTimeTo,
      },
    })
    return data.docs
  }

  update(datasetId: string, documentId: string, patch: JsonObject, options: RequestOptions = {}): Promise<Document> {
    return this.client.request('PATCH', `/datasets/${encodeURIComponent(datasetId)}/documents/${encodeURIComponent(documentId)}`, {
      body: patch,
      signal: options.signal,
    })
  }

  async delete(datasetId: string, ids: string[] | undefined, deleteAll = false, options: RequestOptions = {}): Promise<void> {
    await this.client.request('DELETE', `/datasets/${encodeURIComponent(datasetId)}/documents`, {
      body: { ids: ids ?? null, delete_all: deleteAll },
      signal: options.signal,
    })
  }

  async startParse(datasetId: string, documentIds: string[], options: RequestOptions = {}): Promise<void> {
    await this.client.request('POST', `/datasets/${encodeURIComponent(datasetId)}/chunks`, {
      body: { document_ids: documentIds }, signal: options.signal,
    })
  }

  /** Start parsing and poll until every document reaches a terminal state. */
  async parseAndWait(datasetId: string, documentIds: string[], options: RequestOptions & { pollIntervalMs?: number } = {}): Promise<Array<{
    documentId: string
    state: string
    chunkCount?: number
    tokenCount?: number
  }>> {
    await this.startParse(datasetId, documentIds, options)
    const pending = new Set(documentIds)
    const finished: Array<{ documentId: string; state: string; chunkCount?: number; tokenCount?: number }> = []
    const interval = positiveInteger(options.pollIntervalMs ?? 1_000, 'pollIntervalMs')
    while (pending.size > 0) {
      options.signal?.throwIfAborted()
      for (const documentId of pending) {
        const [document] = await this.list({ datasetId, id: documentId }, options)
        if (document === undefined) continue
        const state = typeof document.run === 'string' ? document.run.toUpperCase() : ''
        if (state === 'DONE' || state === 'FAIL' || state === 'CANCEL' || (document.progress ?? 0) >= 1) {
          finished.push({
            documentId,
            state: state || 'DONE',
            ...(document.chunk_count === undefined ? {} : { chunkCount: document.chunk_count }),
            ...(document.token_count === undefined ? {} : { tokenCount: document.token_count }),
          })
          pending.delete(documentId)
        }
      }
      if (pending.size > 0) await delay(interval, undefined, { signal: options.signal })
    }
    return finished
  }

  async cancelParse(datasetId: string, documentIds: string[], options: RequestOptions = {}): Promise<void> {
    await this.client.request('DELETE', `/datasets/${encodeURIComponent(datasetId)}/chunks`, {
      body: { document_ids: documentIds }, signal: options.signal,
    })
  }

  async upload(datasetId: string, documents: UploadDocument[], options: RequestOptions = {}): Promise<Document[]> {
    const form = new FormData()
    for (const document of documents) form.append('file', document.body, document.displayName)
    const response = await this.client.raw('POST', `/datasets/${encodeURIComponent(datasetId)}/documents`, {
      body: form,
      signal: options.signal,
    })
    const envelope = await this.client.requestEnvelope<Document[]>('POST', `/datasets/${encodeURIComponent(datasetId)}/documents`, response)
    if (!Array.isArray(envelope.data)) throw new RagFlowApiError('RAGFlow document upload returned invalid data')
    return envelope.data
  }

  download(datasetId: string, documentId: string, options: RequestOptions = {}): Promise<Response> {
    return this.client.raw('GET', `/datasets/${encodeURIComponent(datasetId)}/documents/${encodeURIComponent(documentId)}`, {
      signal: options.signal,
    })
  }
}

export class ChunkClient {
  constructor(private readonly client: RagFlowTransport) {}

  async list(datasetId: string, documentId: string, request: PageRequest & { keywords?: string; id?: string } = {}, options: RequestOptions = {}): Promise<Chunk[]> {
    const data = await this.client.request<{ chunks: Chunk[] }>('GET', `/datasets/${encodeURIComponent(datasetId)}/documents/${encodeURIComponent(documentId)}/chunks`, {
      signal: options.signal,
      query: { ...pageQuery(request), keywords: request.keywords, id: request.id },
    })
    return data.chunks
  }

  async add(datasetId: string, documentId: string, request: {
    content: string
    importantKeywords?: string[]
    questions?: string[]
    imageBase64?: string
    tagKeywords?: string[]
  }, options: RequestOptions = {}): Promise<Chunk> {
    const data = await this.client.request<{ chunk: Chunk }>('POST', `/datasets/${encodeURIComponent(datasetId)}/documents/${encodeURIComponent(documentId)}/chunks`, {
      signal: options.signal,
      body: {
        content: request.content,
        important_keywords: request.importantKeywords ?? [],
        questions: request.questions ?? [],
        tag_kwd: request.tagKeywords ?? [],
        ...(request.imageBase64 === undefined ? {} : { image_base64: request.imageBase64 }),
      },
    })
    return data.chunk
  }

  async update(datasetId: string, documentId: string, chunkId: string, patch: JsonObject, options: RequestOptions = {}): Promise<void> {
    await this.client.request('PATCH', `/datasets/${encodeURIComponent(datasetId)}/documents/${encodeURIComponent(documentId)}/chunks/${encodeURIComponent(chunkId)}`, {
      body: patch, signal: options.signal,
    })
  }

  async delete(datasetId: string, documentId: string, ids: string[] | undefined, deleteAll = false, options: RequestOptions = {}): Promise<void> {
    await this.client.request('DELETE', `/datasets/${encodeURIComponent(datasetId)}/documents/${encodeURIComponent(documentId)}/chunks`, {
      body: { chunk_ids: ids ?? null, delete_all: deleteAll }, signal: options.signal,
    })
  }
}

export class ChatClient {
  constructor(private readonly client: RagFlowTransport) {}

  create(request: CreateChatRequest, options: RequestOptions = {}): Promise<Chat> {
    return this.client.request('POST', '/chats', { body: request as unknown as JsonObject, signal: options.signal })
  }

  async list(request: ListChatsRequest = {}, options: RequestOptions = {}): Promise<Chat[]> {
    const data = await this.client.request<{ chats: Chat[] }>('GET', '/chats', {
      signal: options.signal,
      query: { ...pageQuery(request), id: request.id, name: request.name, keywords: request.keywords, owner_ids: request.ownerIds },
    })
    return data.chats
  }

  get(chatId: string, options: RequestOptions = {}): Promise<Chat> {
    return this.client.request('GET', `/chats/${encodeURIComponent(chatId)}`, { signal: options.signal })
  }

  async update(chatId: string, patch: JsonObject, options: RequestOptions = {}): Promise<void> {
    await this.client.request('PATCH', `/chats/${encodeURIComponent(chatId)}`, { body: patch, signal: options.signal })
  }

  async delete(ids: string[] | undefined, deleteAll = false, options: RequestOptions = {}): Promise<void> {
    await this.client.request('DELETE', '/chats', { body: { ids: ids ?? null, delete_all: deleteAll }, signal: options.signal })
  }
}

function sessionPath(target: SessionTarget): string {
  return `/${target.kind === 'chat' ? 'chats' : 'agents'}/${encodeURIComponent(target.ownerId)}/sessions`
}

export class SessionClient {
  constructor(private readonly client: RagFlowTransport) {}

  create(target: SessionTarget, input: JsonObject = {}, options: RequestOptions = {}): Promise<Session> {
    return this.client.request('POST', sessionPath(target), { body: input, signal: options.signal })
  }

  list(request: ListSessionsRequest, options: RequestOptions = {}): Promise<Session[]> {
    return this.client.request('GET', sessionPath(request), {
      signal: options.signal,
      query: { ...pageQuery(request), id: request.id, name: request.name, user_id: request.userId },
    })
  }

  async updateChat(chatId: string, sessionId: string, patch: JsonObject, options: RequestOptions = {}): Promise<void> {
    await this.client.request('PATCH', `/chats/${encodeURIComponent(chatId)}/sessions/${encodeURIComponent(sessionId)}`, {
      body: patch, signal: options.signal,
    })
  }

  async delete(target: SessionTarget, ids: string[] | undefined, deleteAll = false, options: RequestOptions = {}): Promise<void> {
    await this.client.request('DELETE', sessionPath(target), {
      body: { ids: ids ?? null, delete_all: deleteAll }, signal: options.signal,
    })
  }

  async ask(request: AskSessionRequest, options: RequestOptions = {}): Promise<Message> {
    const { path, body } = this.completion(request, false)
    const data = await this.client.request<JsonObject>('POST', path, { body, signal: options.signal })
    return answerOf(request, data)
  }

  /** Yield normalized assistant messages from RAGFlow's SSE completion stream. */
  async *askStream(request: AskSessionRequest, options: RequestOptions = {}): AsyncIterable<Message> {
    const { path, body } = this.completion(request, true)
    const response = await this.client.raw('POST', path, {
      body: JSON.stringify(body),
      headers: { 'content-type': 'application/json' },
      signal: options.signal,
    })
    if (response.body === null) throw new RagFlowApiError('RAGFlow completion returned an empty stream')
    const reader = response.body.pipeThrough(new TextDecoderStream()).getReader()
    let buffer = ''
    try {
      while (true) {
        const { value, done } = await reader.read()
        buffer += value ?? ''
        if (done && buffer !== '') buffer += '\n'
        const lines = buffer.split(/\r?\n/)
        buffer = lines.pop() ?? ''
        for (const rawLine of lines) {
          const line = rawLine.trim()
          if (line === '') continue
          const content = line.startsWith('data:') ? line.slice(5).trim() : line
          if (content === '[DONE]') return
          let event: JsonObject
          try { event = asRecord(JSON.parse(content), 'completion stream') } catch { continue }
          if (typeof event.event === 'string' && event.event !== 'message' && event.event !== 'message_end') continue
          if (request.kind === 'agent' && event.event === 'message_end') return
          if (request.kind === 'chat' && event.data === true) return
          yield answerOf(request, request.kind === 'chat' ? asRecord(event.data, 'chat completion') : event)
        }
        if (done) return
      }
    } finally {
      reader.releaseLock()
    }
  }

  private completion(request: AskSessionRequest, stream: boolean): { path: string; body: JsonObject } {
    const extra = request.extra ?? {}
    const body: JsonObject = request.kind === 'chat'
      ? { ...extra, question: request.question ?? '', stream, session_id: request.sessionId }
      : {
          ...extra,
          agent_id: request.ownerId,
          query: request.question ?? '',
          stream,
          session_id: request.sessionId,
          'openai-compatible': false,
          ...(request.inputs === undefined ? {} : { inputs: request.inputs }),
          ...(request.release === undefined ? {} : { release: request.release }),
          ...(request.returnTrace === undefined ? {} : { return_trace: request.returnTrace }),
        }
    const path = request.kind === 'chat'
      ? `/chats/${encodeURIComponent(request.ownerId)}/completions`
      : '/agents/chat/completions'
    return { path, body }
  }
}

export class AgentClient {
  constructor(private readonly client: RagFlowTransport) {}

  async list(request: ListAgentsRequest = {}, options: RequestOptions = {}): Promise<Agent[]> {
    const data = await this.client.request<{ canvas: Agent[] }>('GET', '/agents', {
      query: pageQuery(request), signal: options.signal,
    })
    return data.canvas
  }

  get(agentId: string, options: RequestOptions = {}): Promise<Agent> {
    return this.client.request('GET', `/agents/${encodeURIComponent(agentId)}`, { signal: options.signal })
  }

  async create(request: CreateAgentRequest, options: RequestOptions = {}): Promise<JsonValue> {
    return await this.client.request('POST', '/agents', {
      signal: options.signal,
      body: {
        title: request.title,
        dsl: request.dsl,
        ...(request.description === undefined ? {} : { description: request.description }),
        ...(request.canvasType === undefined ? {} : { canvas_type: request.canvasType }),
      },
    })
  }

  async update(agentId: string, patch: JsonObject, options: RequestOptions = {}): Promise<void> {
    await this.client.request('PUT', `/agents/${encodeURIComponent(agentId)}`, { body: patch, signal: options.signal })
  }

  async delete(agentId: string, options: RequestOptions = {}): Promise<void> {
    await this.client.request('DELETE', `/agents/${encodeURIComponent(agentId)}`, { body: {}, signal: options.signal })
  }
}

export class MemoryClient {
  constructor(private readonly client: RagFlowTransport) {}

  create(request: CreateMemoryRequest, options: RequestOptions = {}): Promise<Memory> {
    return this.client.request('POST', '/memories', {
      signal: options.signal,
      body: { name: request.name, memory_type: request.memoryType, embd_id: request.embdId, llm_id: request.llmId },
    })
  }

  async list(request: ListMemoriesRequest = {}, options: RequestOptions = {}): Promise<MemoryList> {
    const data = await this.client.request<{ memory_list: Memory[]; total_count: number }>('GET', '/memories', {
      signal: options.signal,
      query: {
        page: request.page,
        page_size: request.pageSize,
        tenant_id: request.tenantId,
        memory_type: request.memoryType,
        storage_type: request.storageType,
        keywords: request.keywords,
      },
    })
    return { memoryList: data.memory_list, totalCount: data.total_count }
  }

  update(memoryId: string, patch: JsonObject, options: RequestOptions = {}): Promise<Memory> {
    return this.client.request('PUT', `/memories/${encodeURIComponent(memoryId)}`, { body: patch, signal: options.signal })
  }

  async delete(memoryId: string, options: RequestOptions = {}): Promise<void> {
    await this.client.request('DELETE', `/memories/${encodeURIComponent(memoryId)}`, { body: {}, signal: options.signal })
  }

  getConfig(memoryId: string, options: RequestOptions = {}): Promise<Memory> {
    return this.client.request('GET', `/memories/${encodeURIComponent(memoryId)}/config`, { signal: options.signal })
  }

  listMessages(memoryId: string, request: { agentId?: string | string[]; keywords?: string; page?: number; pageSize?: number } = {}, options: RequestOptions = {}): Promise<JsonValue> {
    return this.client.request('GET', `/memories/${encodeURIComponent(memoryId)}`, {
      signal: options.signal,
      query: { agent_id: request.agentId, keywords: request.keywords, page: request.page, page_size: request.pageSize },
    })
  }

  async forgetMessage(memoryId: string, messageId: number, options: RequestOptions = {}): Promise<void> {
    await this.client.request('DELETE', `/messages/${encodeURIComponent(memoryId)}:${messageId}`, { body: {}, signal: options.signal })
  }

  async updateMessageStatus(memoryId: string, messageId: number, status: boolean, options: RequestOptions = {}): Promise<void> {
    await this.client.request('PUT', `/messages/${encodeURIComponent(memoryId)}:${messageId}`, { body: { status }, signal: options.signal })
  }

  getMessageContent(memoryId: string, messageId: number, options: RequestOptions = {}): Promise<JsonObject> {
    return this.client.request('GET', `/messages/${encodeURIComponent(memoryId)}:${messageId}/content`, { signal: options.signal })
  }

  async addMessage(request: { memoryIds: string[]; agentId: string; sessionId: string; userInput: string; agentResponse: string; userId?: string }, options: RequestOptions = {}): Promise<string> {
    const envelope = await this.client.requestEnvelope<never>('POST', '/messages', {
      signal: options.signal,
      body: {
        memory_id: request.memoryIds,
        agent_id: request.agentId,
        session_id: request.sessionId,
        user_input: request.userInput,
        agent_response: request.agentResponse,
        user_id: request.userId ?? '',
      },
    })
    return envelope.message ?? ''
  }

  searchMessages(request: SearchMemoryMessagesRequest, options: RequestOptions = {}): Promise<JsonObject[]> {
    return this.client.request('GET', '/messages/search', {
      signal: options.signal,
      query: {
        query: request.query,
        memory_id: request.memoryIds,
        agent_id: request.agentId,
        session_id: request.sessionId,
        user_id: request.userId,
        similarity_threshold: request.similarityThreshold,
        keywords_similarity_weight: request.keywordsSimilarityWeight,
        top_n: request.topN,
      },
    })
  }

  recentMessages(request: { memoryIds: string[]; agentId?: string; sessionId?: string; limit?: number }, options: RequestOptions = {}): Promise<JsonObject[]> {
    return this.client.request('GET', '/messages', {
      signal: options.signal,
      query: { memory_id: request.memoryIds, agent_id: request.agentId, session_id: request.sessionId, limit: request.limit },
    })
  }
}

export class RetrievalClient {
  constructor(private readonly client: RagFlowTransport) {}

  async search(request: RetrieveRequest, options: RequestOptions = {}): Promise<Chunk[]> {
    const data = await this.client.request<{ chunks: Chunk[] }>('POST', '/retrieval', {
      signal: options.signal,
      body: {
        dataset_ids: request.datasetIds,
        document_ids: request.documentIds ?? [],
        question: request.question,
        page: request.page ?? 1,
        page_size: request.pageSize ?? 30,
        similarity_threshold: request.similarityThreshold ?? 0.2,
        vector_similarity_weight: request.vectorSimilarityWeight ?? 0.3,
        top_k: request.topK ?? 1024,
        ...(request.rerankId === undefined ? {} : { rerank_id: request.rerankId }),
        keyword: request.keyword ?? false,
        ...(request.crossLanguages === undefined ? {} : { cross_languages: request.crossLanguages }),
        ...(request.metadataCondition === undefined ? {} : { metadata_condition: request.metadataCondition }),
        use_kg: request.useKg ?? false,
        toc_enhance: request.tocEnhance ?? false,
      },
    })
    return data.chunks
  }
}
