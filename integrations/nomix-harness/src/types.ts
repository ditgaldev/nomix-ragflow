/** Server SDK types. Native RAGFlow fields, not Agent/Gateway business DTOs. */
export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue }
export type JsonObject = { [key: string]: JsonValue }
export interface RagFlowResult<T = JsonValue> { code: 0; data?: T; message?: JsonValue; total?: number }
export interface RequestOptions { signal?: AbortSignal }
export interface PageRequest {
  page?: number
  page_size?: number
  orderby?: string
  desc?: boolean
  id?: string
  name?: string
  keywords?: string
}
export type NativeQuery = Record<string, string | number | boolean | readonly string[] | undefined>
export type Dataset = JsonObject & { id: string; name: string }
export type Document = JsonObject & { id: string; name: string; run?: string; progress?: number; parser_config?: JsonObject }
export type Chunk = JsonObject & { id: string }
export interface DocumentList { total: number; docs: Document[] }
export interface ChunkList { total: number; chunks: Chunk[]; doc: JsonObject }
export interface StructureGraph {
  templates: Array<{ template_id: string; template_name: string; kind: string; entities: JsonObject[]; relations: JsonObject[] }>
}
export interface UploadDocument { body: Blob; displayName: string }
export interface CreateDatasetRequest {
  name: string
  description?: string
  embedding_model?: string
  permission?: 'me' | 'team'
  chunk_method?: string
  parser_config?: JsonObject
}
export interface UpdateDocumentRequest {
  enabled?: 0 | 1
  name?: string
  chunk_method?: string
  parser_config?: JsonObject
  meta_fields?: JsonObject
}
export interface RetrieveRequest {
  dataset_ids: string[]
  question: string
  document_ids?: string[]
  page?: number
  page_size?: number
  similarity_threshold?: number
  vector_similarity_weight?: number
  knn_top_k?: number
  knn_num_candidates?: number
  rerank_candidates_count?: number
  rerank_id?: string
  keyword?: boolean
  cross_languages?: string[]
  metadata_condition?: JsonObject
  use_kg?: boolean
  toc_enhance?: boolean
  include_knowledge_compilation?: boolean
  highlight?: boolean
}
export interface RetrievalResult { total: number; chunks: JsonObject[]; doc_aggs: JsonValue }
export interface SessionTarget { kind: 'chat' | 'agent'; ownerId: string }
export interface MemoryMessageRequest {
  memory_id: string[]
  agent_id: string
  session_id: string
  user_input: string
  agent_response: string
  user_id?: string
}
