/** JSON values accepted and returned by RAGFlow APIs. */
export type JsonPrimitive = string | number | boolean | null
export type JsonValue = JsonPrimitive | JsonValue[] | JsonObject
export interface JsonObject { [key: string]: JsonValue }
/** Extensible server view whose optional fields may be absent. */
export interface JsonView { [key: string]: JsonValue | undefined }

/** Shared pagination accepted by list APIs. */
export interface PageRequest {
  page?: number
  pageSize?: number
  orderby?: string
  desc?: boolean
}

/** RAGFlow dataset view. Unknown server additions remain available. */
export interface Dataset extends JsonView {
  id: string
  name: string
  description?: string
  embedding_model?: string
  permission?: string
  document_count?: number
  chunk_count?: number
}

/** RAGFlow document view. */
export interface Document extends JsonView {
  id: string
  name: string
  dataset_id: string
  size?: number
  token_count?: number
  chunk_count?: number
  progress?: number
  run?: string
}

/** RAGFlow chunk or retrieval hit. */
export interface Chunk extends JsonView {
  id: string
  content: string
  dataset_id?: string
  document_id?: string
  document_name?: string
  similarity?: number
}

/** Chat assistant view. */
export interface Chat extends JsonView {
  id: string
  name: string
  dataset_ids?: JsonValue[]
}

/** Agent canvas view. */
export interface Agent extends JsonView {
  id: string
  title?: string
  description?: string
  dsl?: JsonObject
}

/** Chat or agent session view. */
export interface Session extends JsonView {
  id: string
  name?: string
  chat_id?: string
  agent_id?: string
}

/** Memory view. */
export interface Memory extends JsonView {
  id: string
  name: string
  memory_type?: JsonValue[]
  embd_id?: string
  llm_id?: string
}

/** Normalized assistant answer returned by chat and agent completion APIs. */
export interface Message extends JsonView {
  content: string
  role: 'assistant'
  reference?: JsonValue
}

export interface CreateDatasetRequest {
  name: string
  avatar?: string
  description?: string
  embeddingModel?: string
  permission?: string
  chunkMethod?: string
  parserConfig?: JsonObject
  autoMetadataConfig?: JsonObject
}

export interface ListDatasetsRequest extends PageRequest {
  id?: string
  ids?: string[]
  name?: string
}

export interface ListDocumentsRequest extends PageRequest {
  datasetId: string
  id?: string
  ids?: string[]
  name?: string
  keywords?: string
  createTimeFrom?: number
  createTimeTo?: number
}

export interface RetrieveRequest extends PageRequest {
  datasetIds: string[]
  documentIds?: string[]
  question: string
  similarityThreshold?: number
  vectorSimilarityWeight?: number
  topK?: number
  rerankId?: string
  keyword?: boolean
  crossLanguages?: string[]
  metadataCondition?: JsonObject
  useKg?: boolean
  tocEnhance?: boolean
}

export interface CreateChatRequest extends JsonView {
  name: string
  icon?: string
  dataset_ids?: JsonValue[]
  llm_id?: string
  llm_setting?: JsonObject
  prompt_config?: JsonObject
}

export interface ListChatsRequest extends PageRequest {
  id?: string
  name?: string
  keywords?: string
  ownerIds?: string | string[]
}

export interface CreateAgentRequest {
  title: string
  dsl: JsonObject
  description?: string
  canvasType?: string
}

export interface ListAgentsRequest extends PageRequest {}

export interface SessionTarget {
  kind: 'chat' | 'agent'
  ownerId: string
}

export interface ListSessionsRequest extends PageRequest, SessionTarget {
  id?: string
  name?: string
  userId?: string
}

export interface AskSessionRequest extends SessionTarget {
  sessionId: string
  question?: string
  inputs?: JsonObject
  release?: boolean
  returnTrace?: boolean
  extra?: JsonObject
}

export interface CreateMemoryRequest {
  name: string
  memoryType: string[]
  embdId: string
  llmId: string
}

export interface ListMemoriesRequest {
  page?: number
  pageSize?: number
  tenantId?: string | string[]
  memoryType?: string | string[]
  storageType?: string
  keywords?: string
}

export interface MemoryList {
  memoryList: Memory[]
  totalCount: number
  message?: string
}

export interface SearchMemoryMessagesRequest {
  query: string
  memoryIds: string[]
  agentId?: string
  sessionId?: string
  userId?: string
  similarityThreshold?: number
  keywordsSimilarityWeight?: number
  topN?: number
}

export interface UploadDocument {
  displayName: string
  body: Blob
}

export interface RequestOptions {
  signal?: AbortSignal
}
