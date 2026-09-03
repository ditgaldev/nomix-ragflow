export type JsonPrimitive = OpenApiJsonPrimitive
export type JsonValue = OpenApiJsonValue
export type JsonObject = OpenApiJsonObject

export interface PageRequest {
  cursor?: string
  limit?: number
}

export type PageMeta = OpenApiSchema<'SuccessMeta'>
/** The public Gateway envelope retained by paginated and retrieval methods. */
export type GatewayResult<T> = OpenApiSuccessEnvelope<T>

export type ResourceScopeView = OpenApiResourceScope
/** Verified business claims exposed by GET /api/v1/gateway-context. */
export type BusinessAuthorizationContext = OpenApiBusinessAuthorizationContext
export type Dataset = OpenApiSchema<'Dataset'>
export type Document = OpenApiSchema<'Document'>
export type Chunk = OpenApiSchema<'Chunk'>
export type RetrievalResult = OpenApiSchema<'RetrievalResult'>
export type PageIndexResult = OpenApiSchema<'PageIndexResult'>
export type PageIndexStatus = OpenApiSchema<'PageIndexStatus'>
export type PageIndexSearchResult = OpenApiSchema<'PageIndexSearchResult'>
export type Chat = OpenApiSchema<'Chat'>
export type Agent = OpenApiSchema<'Agent'>
export type Session = OpenApiSchema<'Session'>
export type Memory = OpenApiSchema<'Memory'>
export type MemoryMessage = OpenApiSchema<'MemoryMessage'>
export type Message = OpenApiSchema<'SessionInvocation'>

export type CreateDatasetRequest = OperationBody<'datasets.create'>
export type ListDatasetsRequest = OperationQuery<'datasets.list'>
export type ListDocumentsRequest = OperationQuery<'documents.list'> & OperationPath<'documents.list'>
export type RetrieveRequest = OperationBody<'retrieval.search'>
export type SearchPageIndexRequest = OperationBody<'pageIndex.search'>
export type BuildPageIndexRequest = OperationBody<'pageIndex.build'>
export type CreateChatRequest = OperationBody<'chats.create'>
export type ListChatsRequest = OperationQuery<'chats.list'>
export type CreateAgentRequest = OperationBody<'agents.create'>
export type ListAgentsRequest = OperationQuery<'agents.list'>

export interface SessionTarget {
  kind: 'chat' | 'agent'
  ownerId: string
}

export interface ListSessionsRequest extends PageRequest, SessionTarget {
  id?: string
  name?: string
}

export type InvokeSessionRequest = SessionTarget & { sessionId: string } & Omit<OperationBody<'chatSessions.invoke'>, 'stream'>
export type CreateMemoryRequest = OperationBody<'memories.create'>
export type ListMemoriesRequest = OperationQuery<'memories.list'>
export type SearchMemoryMessagesRequest = OperationQuery<'memoryMessages.search'>

export interface UploadDocument {
  displayName: string
  body: Blob
}

export interface RequestOptions {
  signal?: AbortSignal
  idempotencyKey?: string
  /** Current numeric resource version, sent only as If-Match. */
  version?: number
  /** Per-request response-body ceiling. It may lower, but never raise, the client ceiling. */
  maxResponseBytes?: number
}

export type VersionedRequestOptions = RequestOptions & { version: number }

export type RagFlowToolDataEntry =
  | { path: string; kind: 'object' | 'array' | 'null' }
  | { path: string; kind: 'string'; stringValue: string }
  | { path: string; kind: 'number'; numberValue: number }
  | { path: string; kind: 'boolean'; booleanValue: boolean }

export type RagFlowToolObservationData =
  | {
      kind: 'authorization' | 'retrieval' | 'resource' | 'resource-list' | 'mutation' | 'invocation'
      format: 'json-entries'
      entries: RagFlowToolDataEntry[]
      bytes: number
      truncated: false
    }
  | {
      kind: 'artifact-reference'
      format: 'artifact-reference'
      artifactName: string
      bytes: number
      truncated: true
    }

export interface RagFlowToolArtifact {
  kind: 'spill'
  name: string
  locator: string
  mimeType: string
  encoding: 'utf8' | 'base64'
  originalName?: string
  originalMimeType?: string
  bytes: number
  storedBytes: number
  sha256?: string
  retrievalHint: string
}

export interface ToolOutput {
  status: 'success' | 'warning'
  summary: string
  data: RagFlowToolObservationData
  nextActions: string[]
  artifacts: RagFlowToolArtifact[]
}
import type {
  OpenApiBusinessAuthorizationContext,
  OpenApiJsonObject,
  OpenApiJsonPrimitive,
  OpenApiJsonValue,
  OpenApiResourceScope,
  OpenApiSchema,
  OpenApiSuccessEnvelope,
  OperationBody,
  OperationPath,
  OperationQuery,
} from './openapi.generated.js'

export type {
  BusinessGatewayOperation,
  BusinessGatewayOperationMap,
  BusinessGatewayJsonOperation,
  OpenApiErrorEnvelope,
  OpenApiBusinessAuthorizationContext,
  OpenApiResourceScope,
  OpenApiSuccessEnvelope,
  OpenApiSchema,
  OperationBody,
  OperationPath,
  OperationQuery,
  OperationData,
  OperationResponse,
} from './openapi.generated.js'
