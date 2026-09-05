import { NativeTransport, resourceId as id, resourceIds as ids } from './native-transport.js'
import type { RagFlowBusinessClientOptions } from './native-transport.js'
import type { ChunkList, CreateDatasetRequest, Dataset, Document, DocumentList, JsonObject, MemoryMessageRequest, NativeQuery, RequestOptions, RetrievalResult, RetrieveRequest, SessionTarget, StructureGraph, UpdateDocumentRequest, UploadDocument } from './types.js'

export type { RagFlowBusinessClientOptions } from './native-transport.js'

const dataset = (value: string) => `datasets/${id(value)}`
const documents = (value: string) => `${dataset(value)}/documents`
const document = (space: string, value: string) => `${documents(space)}/${id(value)}`
const chunks = (space: string, value: string) => `${document(space, value)}/chunks`
const sessions = (target: SessionTarget) => {
  if (target.kind !== 'chat' && target.kind !== 'agent') throw new TypeError('Session kind must be chat or agent')
  return `${target.kind === 'chat' ? 'chats' : 'agents'}/${id(target.ownerId)}/sessions`
}

/** Server-side native API SDK. Never install this client as an Agent tool provider. */
export class RagFlowBusinessClient {
  private readonly http: NativeTransport
  constructor(options: RagFlowBusinessClientOptions) { this.http = new NativeTransport(options) }

  readonly datasets = {
    list: (query?: NativeQuery, options?: RequestOptions) => this.http.json<Dataset[]>('GET', 'datasets', undefined, query, options),
    get: (value: string, options?: RequestOptions) => this.http.json<Dataset>('GET', dataset(value), undefined, undefined, options),
    create: (body: CreateDatasetRequest, options?: RequestOptions) => this.http.json<Dataset>('POST', 'datasets', body, undefined, options),
    update: (value: string, body: JsonObject, options?: RequestOptions) => this.http.json<Dataset>('PUT', dataset(value), body, undefined, options),
    getMetadataConfig: (value: string, options?: RequestOptions) => this.http.json('GET', `${dataset(value)}/metadata/config`, undefined, undefined, options),
    updateMetadataConfig: (value: string, body: JsonObject, options?: RequestOptions) => this.http.json('PUT', `${dataset(value)}/metadata/config`, body, undefined, options),
    delete: (values: string[], options?: RequestOptions) => this.http.json('DELETE', 'datasets', { ids: ids(values), delete_all: false }, undefined, options),
  }

  readonly documents = {
    list: (space: string, query?: NativeQuery, options?: RequestOptions) => this.http.json<DocumentList>('GET', documents(space), undefined, query, options),
    /** Native metadata lookup returns {total, docs}; GET on the item URL downloads a file. */
    get: (space: string, value: string, options?: RequestOptions) => { id(value); return this.documents.list(space, { id: value }, options) },
    upload: (space: string, files: UploadDocument[], options?: RequestOptions) => {
      if (!Array.isArray(files) || !files.length) throw new TypeError('At least one file is required')
      const form = new FormData()
      for (const file of files) {
        if (!(file.body instanceof Blob) || typeof file.displayName !== 'string' || !file.displayName.trim() || /[\p{Cc}/\\]/u.test(file.displayName)) throw new TypeError('A Blob and filename are required')
        form.append('file', file.body, file.displayName)
      }
      return this.http.json<Document[]>('POST', documents(space), form, undefined, options)
    },
    download: (space: string, value: string, options?: RequestOptions) => this.http.download(document(space, value), options),
    update: (space: string, value: string, body: UpdateDocumentRequest, options?: RequestOptions) => this.http.json<Document>('PATCH', document(space, value), body, undefined, options),
    delete: (space: string, values: string[], options?: RequestOptions) => this.http.json('DELETE', documents(space), { ids: ids(values), delete_all: false }, undefined, options),
    /** Starts asynchronous native parsing, which can remove existing parsing/index artifacts. */
    startParse: (space: string, values: string[], options?: RequestOptions) => this.http.json('POST', `${documents(space)}/parse`, { document_ids: ids(values) }, undefined, options),
    stopParse: (space: string, values: string[], options?: RequestOptions) => this.http.json('POST', `${documents(space)}/stop`, { document_ids: ids(values) }, undefined, options),
  }

  readonly chunks = {
    list: (space: string, doc: string, query?: NativeQuery, options?: RequestOptions) => this.http.json<ChunkList>('GET', chunks(space, doc), undefined, query, options),
    get: (space: string, doc: string, chunk: string, options?: RequestOptions) => this.http.json<JsonObject>('GET', `${chunks(space, doc)}/${id(chunk)}`, undefined, undefined, options),
    create: (space: string, doc: string, body: JsonObject, options?: RequestOptions) => this.http.json<JsonObject>('POST', chunks(space, doc), body, undefined, options),
    update: (space: string, doc: string, chunk: string, body: JsonObject, options?: RequestOptions) => this.http.json('PATCH', `${chunks(space, doc)}/${id(chunk)}`, body, undefined, options),
    delete: (space: string, doc: string, values: string[], options?: RequestOptions) => this.http.json('DELETE', chunks(space, doc), { chunk_ids: ids(values), delete_all: false }, undefined, options),
  }

  readonly retrieval = {
    search: (body: RetrieveRequest, options?: RequestOptions) => {
      ids(body.dataset_ids)
      return this.http.json<RetrievalResult>('POST', 'retrieval', body, undefined, options)
    },
  }
  readonly pageIndex = {
    getStructure: (space: string, doc: string, options?: RequestOptions) => this.http.json<StructureGraph>('GET', `${document(space, doc)}/structure/graph`, undefined, undefined, options),
  }

  readonly templateGroups = {
    list: (query?: NativeQuery, options?: RequestOptions) => this.http.json('GET', 'compilation-template-groups', undefined, query, options),
    get: (value: string, options?: RequestOptions) => this.http.json('GET', `compilation-template-groups/${id(value)}`, undefined, undefined, options),
    create: (body: JsonObject, options?: RequestOptions) => this.http.json('POST', 'compilation-template-groups', body, undefined, options),
    update: (value: string, body: JsonObject, options?: RequestOptions) => this.http.json('PUT', `compilation-template-groups/${id(value)}`, body, undefined, options),
    delete: (value: string, options?: RequestOptions) => this.http.json('DELETE', `compilation-template-groups/${id(value)}`, undefined, undefined, options),
  }

  readonly chats = {
    list: (query?: NativeQuery, options?: RequestOptions) => this.http.json('GET', 'chats', undefined, query, options),
    get: (value: string, options?: RequestOptions) => this.http.json('GET', `chats/${id(value)}`, undefined, undefined, options),
    create: (body: JsonObject, options?: RequestOptions) => this.http.json('POST', 'chats', body, undefined, options),
    update: (value: string, body: JsonObject, options?: RequestOptions) => this.http.json('PATCH', `chats/${id(value)}`, body, undefined, options),
    delete: (value: string, options?: RequestOptions) => this.http.json('DELETE', `chats/${id(value)}`, undefined, undefined, options),
    batchDelete: (values: string[], options?: RequestOptions) => this.http.json('DELETE', 'chats', { ids: ids(values), delete_all: false }, undefined, options),
  }
  readonly agents = {
    list: (query?: NativeQuery, options?: RequestOptions) => this.http.json('GET', 'agents', undefined, query, options),
    get: (value: string, options?: RequestOptions) => this.http.json('GET', `agents/${id(value)}`, undefined, undefined, options),
    create: (body: JsonObject, options?: RequestOptions) => this.http.json('POST', 'agents', body, undefined, options),
    update: (value: string, body: JsonObject, options?: RequestOptions) => this.http.json('PUT', `agents/${id(value)}`, body, undefined, options),
    delete: (value: string, options?: RequestOptions) => this.http.json('DELETE', `agents/${id(value)}`, undefined, undefined, options),
  }
  readonly sessions = {
    list: (target: SessionTarget, query?: NativeQuery, options?: RequestOptions) => this.http.json('GET', sessions(target), undefined, query, options),
    get: (target: SessionTarget, value: string, options?: RequestOptions) => this.http.json('GET', `${sessions(target)}/${id(value)}`, undefined, undefined, options),
    create: (target: SessionTarget, body: JsonObject, options?: RequestOptions) => this.http.json('POST', sessions(target), body, undefined, options),
    updateChat: (chatId: string, value: string, body: JsonObject, options?: RequestOptions) => this.http.json('PATCH', `${sessions({ kind: 'chat', ownerId: chatId })}/${id(value)}`, body, undefined, options),
    delete: (target: SessionTarget, values: string[], options?: RequestOptions) => this.http.json('DELETE', sessions(target), { ids: ids(values), delete_all: false }, undefined, options),
    invoke: (target: SessionTarget, body: JsonObject, options?: RequestOptions) => {
      sessions(target)
      return this.http.json('POST', target.kind === 'chat' ? 'chat/completions' : 'agents/chat/completions', { ...body, [target.kind === 'chat' ? 'chat_id' : 'agent_id']: target.ownerId, stream: false }, undefined, options)
    },
  }
  readonly memories = {
    list: (query?: NativeQuery, options?: RequestOptions) => this.http.json('GET', 'memories', undefined, query, options),
    getConfig: (value: string, options?: RequestOptions) => this.http.json('GET', `memories/${id(value)}/config`, undefined, undefined, options),
    create: (body: JsonObject, options?: RequestOptions) => this.http.json('POST', 'memories', body, undefined, options),
    update: (value: string, body: JsonObject, options?: RequestOptions) => this.http.json('PUT', `memories/${id(value)}`, body, undefined, options),
    delete: (value: string, options?: RequestOptions) => this.http.json('DELETE', `memories/${id(value)}`, undefined, undefined, options),
  }
  readonly memoryMessages = {
    list: (value: string, query?: NativeQuery, options?: RequestOptions) => this.http.json('GET', `memories/${id(value)}`, undefined, query, options),
    create: (body: MemoryMessageRequest, options?: RequestOptions) => { ids(body.memory_id); return this.http.json('POST', 'messages', body, undefined, options) },
    get: (memory: string, message: string, options?: RequestOptions) => this.http.json('GET', `messages/${id(memory)}:${id(message)}/content`, undefined, undefined, options),
    setStatus: (memory: string, message: string, status: boolean, options?: RequestOptions) => this.http.json('PUT', `messages/${id(memory)}:${id(message)}`, { status }, undefined, options),
    delete: (memory: string, message: string, options?: RequestOptions) => this.http.json('DELETE', `messages/${id(memory)}:${id(message)}`, undefined, undefined, options),
    search: (query: NativeQuery, options?: RequestOptions) => this.http.json('GET', 'messages/search', undefined, query, options),
    recent: (query: NativeQuery, options?: RequestOptions) => this.http.json('GET', 'messages', undefined, query, options),
  }
}
