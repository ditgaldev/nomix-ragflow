/* This file is generated from api/apps/business_gateway/openapi.py. Do not edit manually. */

export type OpenApiJsonPrimitive = string | number | boolean | null
export type OpenApiJsonValue = OpenApiJsonPrimitive | OpenApiJsonValue[] | OpenApiJsonObject
export interface OpenApiJsonObject { [key: string]: OpenApiJsonValue }
export interface OpenApiSchemas {
  "ResourceScope": {
    "mode": "all" | "ids" | "inherit" | "none"
    "ids"?: Array<string>
  }
  "BusinessAuthorizationContext": {
    "subject": string
    "actorSubject": string
    "onBehalfOfSubject": string | null
    "workspaceId": string
    "actions": Array<string>
    "datasetScope": OpenApiSchema<"ResourceScope">
    "documentScope": OpenApiSchema<"ResourceScope">
    "chatScope": OpenApiSchema<"ResourceScope">
    "agentScope": OpenApiSchema<"ResourceScope">
    "memoryScope": OpenApiSchema<"ResourceScope">
    "permissionRef": string | null
    "authenticationType": "token-introspection"
    "requestId": string
    "tokenUse": "data"
    "audience": Array<string>
    "expiresAt": string
    "clientId": string | null
  }
  "SuccessMeta": {
    "requestId": string
    "limit"?: number
    "hasNext"?: boolean
    "nextCursor"?: string | null
  }
  "Dataset": {
    "id": string
    "version": number
    "name": string
    "avatar"?: string | null
    "language"?: string | null
    "description"?: string | null
    "embeddingModel"?: string
    "permission"?: string
    "documentCount"?: number
    "tokenCount"?: number
    "chunkCount"?: number
    "similarityThreshold"?: number
    "vectorSimilarityWeight"?: number
    "chunkMethod"?: string
    "pipelineId"?: string | null
    "parserConfig"?: OpenApiJsonObject
    "autoMetadataConfig"?: OpenApiJsonObject
    "pagerank"?: number
    "status"?: string | null
    "createTime"?: number | null
    "createDate"?: string | null
    "updateTime"?: number | null
    "updateDate"?: string | null
  }
  "Document": {
    "id": string
    "version": number
    "datasetId": string
    "name"?: string | null
    "thumbnail"?: string | null
    "chunkMethod"?: string
    "pipelineId"?: string | null
    "parserConfig"?: OpenApiJsonObject
    "sourceType"?: string
    "type"?: string
    "location"?: string | null
    "size"?: number
    "tokenCount"?: number
    "chunkCount"?: number
    "progress"?: number
    "progressMsg"?: string | null
    "processBeginAt"?: OpenApiJsonValue
    "processDuration"?: number
    "suffix"?: string
    "contentHash"?: string | null
    "run"?: string | null
    "status"?: string | null
    "metaFields"?: OpenApiJsonObject
    "createTime"?: number | null
    "createDate"?: string | null
    "updateTime"?: number | null
    "updateDate"?: string | null
  }
  "Chunk": {
    "id": string
    "version"?: number
    "content": string
    "datasetId"?: string
    "documentId"?: string
    "documentName"?: string | null
    "documentKeyword"?: string | null
    "importantKeywords"?: Array<string>
    "questions"?: Array<string>
    "imageId"?: string | null
    "documentType"?: string | null
    "available"?: boolean
    "positions"?: Array<Array<number>>
    "tags"?: Array<string>
    "tagFeatures"?: OpenApiJsonObject
    "similarity"?: number | null
    "score"?: number | null
    "highlight"?: OpenApiJsonValue
    "metadata"?: OpenApiJsonObject
  }
  "Chat": {
    "id": string
    "version": number
    "name"?: string | null
    "description"?: string | null
    "icon"?: string | null
    "language"?: string | null
    "llmId"?: string
    "llmSetting"?: OpenApiJsonObject
    "promptType"?: string
    "promptConfig"?: OpenApiJsonObject
    "metaDataFilter"?: OpenApiJsonObject
    "similarityThreshold"?: number
    "vectorSimilarityWeight"?: number
    "topN"?: number
    "topK"?: number
    "doRefer"?: string
    "rerankId"?: string
    "datasetIds"?: Array<string>
    "status"?: string | null
    "createTime"?: number | null
    "createDate"?: string | null
    "updateTime"?: number | null
    "updateDate"?: string | null
  }
  "Session": {
    "id": string
    "version": number
    "ownerId": string
    "name"?: string | null
    "message"?: Array<OpenApiJsonValue>
    "reference"?: OpenApiJsonValue
    "tokens"?: number
    "source"?: string | null
    "dsl"?: OpenApiJsonObject
    "duration"?: number
    "round"?: number
    "thumbUp"?: number
    "errors"?: string | null
    "versionTitle"?: string | null
    "createTime"?: number | null
    "createDate"?: string | null
    "updateTime"?: number | null
    "updateDate"?: string | null
  }
  "Agent": {
    "id": string
    "version": number
    "avatar"?: string | null
    "title"?: string | null
    "permission"?: string
    "release"?: boolean
    "description"?: string | null
    "canvasType"?: string | null
    "canvasCategory"?: string
    "tags"?: string
    "dsl"?: OpenApiJsonObject
    "createTime"?: number | null
    "createDate"?: string | null
    "updateTime"?: number | null
    "updateDate"?: string | null
  }
  "Memory": {
    "id": string
    "version": number
    "name": string
    "avatar"?: string | null
    "memoryType"?: Array<string> | number
    "storageType"?: string
    "embdId"?: string
    "embdName"?: string | null
    "llmId"?: string
    "permissions"?: string
    "description"?: string | null
    "memorySize"?: number
    "forgettingPolicy"?: string
    "temperature"?: number
    "systemPrompt"?: string | null
    "userPrompt"?: string | null
    "ownerName"?: string | null
    "createTime"?: number | null
    "createDate"?: string | null
    "updateTime"?: number | null
    "updateDate"?: string | null
  }
  "MemoryMessage": {
    "messageId": number
    "messageType"?: string | null
    "sourceId"?: number | null
    "memoryId": string
    "agentId"?: string | null
    "sessionId"?: string | null
    "validAt"?: OpenApiJsonValue
    "invalidAt"?: OpenApiJsonValue
    "forgetAt"?: OpenApiJsonValue
    "status"?: boolean | null
    "content"?: OpenApiJsonValue
    "extract"?: Array<OpenApiJsonObject>
    "agentName"?: string | null
    "task"?: OpenApiJsonObject
    "similarity"?: number | null
  }
  "MetadataConfig": {
    "metadata"?: Array<OpenApiJsonObject>
    "builtInMetadata"?: Array<string>
  }
  "CommandResult": {
    "successCount": number
  }
  "SessionInvocation": {
    "content": string
    "role": "assistant"
    "sessionId": string
    "reference"?: OpenApiJsonValue
    "trace"?: OpenApiJsonValue
  }
  "RetrievalResult": {
    "chunks": Array<OpenApiSchema<"RetrievalChunk">>
    "total": number
    "docAggs": OpenApiJsonValue
  }
  "RetrievalChunk": {
    "id"?: string
    "version"?: number
    "content": string
    "datasetId"?: string
    "documentId"?: string
    "documentName"?: string | null
    "documentKeyword"?: string | null
    "importantKeywords"?: Array<string>
    "questions"?: Array<string>
    "imageId"?: string | null
    "documentType"?: string | null
    "available"?: boolean
    "positions"?: Array<Array<number>>
    "tags"?: Array<string>
    "tagFeatures"?: OpenApiJsonObject
    "similarity"?: number | null
    "score"?: number | null
    "highlight"?: OpenApiJsonValue
    "metadata"?: OpenApiJsonObject
  }
  "AuthorizationContextResponse": {
    "data": OpenApiSchema<"BusinessAuthorizationContext">
    "meta": OpenApiSchema<"SuccessMeta">
  }
  "RetrievalSearchResponse": {
    "data": OpenApiSchema<"RetrievalResult">
    "meta": OpenApiSchema<"SuccessMeta">
  }
  "DatasetsListResponse": {
    "data": Array<OpenApiSchema<"Dataset">>
    "meta": OpenApiSchema<"SuccessMeta">
  }
  "DatasetsCreateResponse": {
    "data": OpenApiSchema<"Dataset">
    "meta": OpenApiSchema<"SuccessMeta">
  }
  "DatasetsGetResponse": {
    "data": OpenApiSchema<"Dataset">
    "meta": OpenApiSchema<"SuccessMeta">
  }
  "DatasetsUpdateResponse": {
    "data": OpenApiSchema<"Dataset">
    "meta": OpenApiSchema<"SuccessMeta">
  }
  "DatasetsDeleteResponse": {
    "data": OpenApiSchema<"CommandResult">
    "meta": OpenApiSchema<"SuccessMeta">
  }
  "DatasetsBatchDeleteResponse": {
    "data": OpenApiSchema<"CommandResult">
    "meta": OpenApiSchema<"SuccessMeta">
  }
  "DatasetsGetMetadataConfigResponse": {
    "data": OpenApiSchema<"MetadataConfig">
    "meta": OpenApiSchema<"SuccessMeta">
  }
  "DatasetsUpdateMetadataConfigResponse": {
    "data": OpenApiSchema<"MetadataConfig">
    "meta": OpenApiSchema<"SuccessMeta">
  }
  "DocumentsListResponse": {
    "data": Array<OpenApiSchema<"Document">>
    "meta": OpenApiSchema<"SuccessMeta">
  }
  "DocumentsUploadResponse": {
    "data": Array<OpenApiSchema<"Document">>
    "meta": OpenApiSchema<"SuccessMeta">
  }
  "DocumentsGetResponse": {
    "data": OpenApiSchema<"Document">
    "meta": OpenApiSchema<"SuccessMeta">
  }
  "DocumentsUpdateResponse": {
    "data": OpenApiSchema<"Document">
    "meta": OpenApiSchema<"SuccessMeta">
  }
  "DocumentsDeleteResponse": {
    "data": OpenApiSchema<"CommandResult">
    "meta": OpenApiSchema<"SuccessMeta">
  }
  "DocumentsBatchDeleteResponse": {
    "data": OpenApiSchema<"CommandResult">
    "meta": OpenApiSchema<"SuccessMeta">
  }
  "DocumentsStartParseResponse": {
    "data": OpenApiSchema<"CommandResult">
    "meta": OpenApiSchema<"SuccessMeta">
  }
  "DocumentsCancelParseResponse": {
    "data": OpenApiSchema<"CommandResult">
    "meta": OpenApiSchema<"SuccessMeta">
  }
  "ChunksListResponse": {
    "data": Array<OpenApiSchema<"Chunk">>
    "meta": OpenApiSchema<"SuccessMeta">
  }
  "ChunksCreateResponse": {
    "data": OpenApiSchema<"Chunk">
    "meta": OpenApiSchema<"SuccessMeta">
  }
  "ChunksGetResponse": {
    "data": OpenApiSchema<"Chunk">
    "meta": OpenApiSchema<"SuccessMeta">
  }
  "ChunksUpdateResponse": {
    "data": OpenApiSchema<"Chunk">
    "meta": OpenApiSchema<"SuccessMeta">
  }
  "ChunksDeleteResponse": {
    "data": OpenApiSchema<"CommandResult">
    "meta": OpenApiSchema<"SuccessMeta">
  }
  "ChunksBatchDeleteResponse": {
    "data": OpenApiSchema<"CommandResult">
    "meta": OpenApiSchema<"SuccessMeta">
  }
  "ChatsListResponse": {
    "data": Array<OpenApiSchema<"Chat">>
    "meta": OpenApiSchema<"SuccessMeta">
  }
  "ChatsCreateResponse": {
    "data": OpenApiSchema<"Chat">
    "meta": OpenApiSchema<"SuccessMeta">
  }
  "ChatsGetResponse": {
    "data": OpenApiSchema<"Chat">
    "meta": OpenApiSchema<"SuccessMeta">
  }
  "ChatsUpdateResponse": {
    "data": OpenApiSchema<"Chat">
    "meta": OpenApiSchema<"SuccessMeta">
  }
  "ChatsDeleteResponse": {
    "data": OpenApiSchema<"CommandResult">
    "meta": OpenApiSchema<"SuccessMeta">
  }
  "ChatsBatchDeleteResponse": {
    "data": OpenApiSchema<"CommandResult">
    "meta": OpenApiSchema<"SuccessMeta">
  }
  "ChatSessionsListResponse": {
    "data": Array<OpenApiSchema<"Session">>
    "meta": OpenApiSchema<"SuccessMeta">
  }
  "AgentSessionsListResponse": {
    "data": Array<OpenApiSchema<"Session">>
    "meta": OpenApiSchema<"SuccessMeta">
  }
  "ChatSessionsCreateResponse": {
    "data": OpenApiSchema<"Session">
    "meta": OpenApiSchema<"SuccessMeta">
  }
  "ChatSessionsGetResponse": {
    "data": OpenApiSchema<"Session">
    "meta": OpenApiSchema<"SuccessMeta">
  }
  "ChatSessionsUpdateResponse": {
    "data": OpenApiSchema<"Session">
    "meta": OpenApiSchema<"SuccessMeta">
  }
  "AgentSessionsCreateResponse": {
    "data": OpenApiSchema<"Session">
    "meta": OpenApiSchema<"SuccessMeta">
  }
  "AgentSessionsGetResponse": {
    "data": OpenApiSchema<"Session">
    "meta": OpenApiSchema<"SuccessMeta">
  }
  "ChatSessionsDeleteResponse": {
    "data": OpenApiSchema<"CommandResult">
    "meta": OpenApiSchema<"SuccessMeta">
  }
  "ChatSessionsBatchDeleteResponse": {
    "data": OpenApiSchema<"CommandResult">
    "meta": OpenApiSchema<"SuccessMeta">
  }
  "AgentSessionsDeleteResponse": {
    "data": OpenApiSchema<"CommandResult">
    "meta": OpenApiSchema<"SuccessMeta">
  }
  "AgentSessionsBatchDeleteResponse": {
    "data": OpenApiSchema<"CommandResult">
    "meta": OpenApiSchema<"SuccessMeta">
  }
  "ChatSessionsInvokeResponse": {
    "data": OpenApiSchema<"SessionInvocation">
    "meta": OpenApiSchema<"SuccessMeta">
  }
  "AgentSessionsInvokeResponse": {
    "data": OpenApiSchema<"SessionInvocation">
    "meta": OpenApiSchema<"SuccessMeta">
  }
  "AgentsListResponse": {
    "data": Array<OpenApiSchema<"Agent">>
    "meta": OpenApiSchema<"SuccessMeta">
  }
  "AgentsCreateResponse": {
    "data": OpenApiSchema<"Agent">
    "meta": OpenApiSchema<"SuccessMeta">
  }
  "AgentsGetResponse": {
    "data": OpenApiSchema<"Agent">
    "meta": OpenApiSchema<"SuccessMeta">
  }
  "AgentsUpdateResponse": {
    "data": OpenApiSchema<"Agent">
    "meta": OpenApiSchema<"SuccessMeta">
  }
  "AgentsDeleteResponse": {
    "data": OpenApiSchema<"CommandResult">
    "meta": OpenApiSchema<"SuccessMeta">
  }
  "MemoriesListResponse": {
    "data": Array<OpenApiSchema<"Memory">>
    "meta": OpenApiSchema<"SuccessMeta">
  }
  "MemoriesCreateResponse": {
    "data": OpenApiSchema<"Memory">
    "meta": OpenApiSchema<"SuccessMeta">
  }
  "MemoriesGetResponse": {
    "data": OpenApiSchema<"Memory">
    "meta": OpenApiSchema<"SuccessMeta">
  }
  "MemoriesUpdateResponse": {
    "data": OpenApiSchema<"Memory">
    "meta": OpenApiSchema<"SuccessMeta">
  }
  "MemoriesGetConfigResponse": {
    "data": OpenApiSchema<"Memory">
    "meta": OpenApiSchema<"SuccessMeta">
  }
  "MemoriesDeleteResponse": {
    "data": OpenApiSchema<"CommandResult">
    "meta": OpenApiSchema<"SuccessMeta">
  }
  "MemoryMessagesListResponse": {
    "data": Array<OpenApiSchema<"MemoryMessage">>
    "meta": OpenApiSchema<"SuccessMeta">
  }
  "MemoryMessagesSearchResponse": {
    "data": Array<OpenApiSchema<"MemoryMessage">>
    "meta": OpenApiSchema<"SuccessMeta">
  }
  "MemoryMessagesRecentResponse": {
    "data": Array<OpenApiSchema<"MemoryMessage">>
    "meta": OpenApiSchema<"SuccessMeta">
  }
  "MemoryMessagesGetContentResponse": {
    "data": OpenApiSchema<"MemoryMessage">
    "meta": OpenApiSchema<"SuccessMeta">
  }
  "MemoryMessagesCreateResponse": {
    "data": OpenApiSchema<"CommandResult">
    "meta": OpenApiSchema<"SuccessMeta">
  }
  "MemoryMessagesBatchCreateResponse": {
    "data": OpenApiSchema<"CommandResult">
    "meta": OpenApiSchema<"SuccessMeta">
  }
  "MemoryMessagesUpdateResponse": {
    "data": OpenApiSchema<"CommandResult">
    "meta": OpenApiSchema<"SuccessMeta">
  }
  "MemoryMessagesDeleteResponse": {
    "data": OpenApiSchema<"CommandResult">
    "meta": OpenApiSchema<"SuccessMeta">
  }
  "ErrorEnvelope": {
    "error": {
      "code": string
      "message": string
      "requestId": string
      "details"?: OpenApiJsonValue
      "retryable": boolean
    }
  }
}
export type OpenApiSchema<Name extends keyof OpenApiSchemas> = OpenApiSchemas[Name]
export type OpenApiSuccessEnvelope<T = OpenApiJsonValue> = { data: T; meta: OpenApiSchema<"SuccessMeta"> }
export type OpenApiErrorEnvelope = OpenApiSchema<"ErrorEnvelope">
export type OpenApiResourceScope = OpenApiSchema<"ResourceScope">
export type OpenApiBusinessAuthorizationContext = OpenApiSchema<"BusinessAuthorizationContext">

export interface BusinessGatewayOperationMap {
  "authorization.context": {
    method: "GET"
    path: "/api/v1/gateway-context"
    pathParameters: Record<string, never>
    query: Record<string, never>
    body: never
    response: OpenApiSchema<"AuthorizationContextResponse">
  }
  "retrieval.search": {
    method: "POST"
    path: "/api/v1/retrieval"
    pathParameters: Record<string, never>
    query: Record<string, never>
    body: {
  "datasetIds"?: Array<string>
  "documentIds"?: Array<string>
  "question": string
  "cursor"?: string
  "limit"?: number
  "similarityThreshold"?: number
  "vectorSimilarityWeight"?: number
  "topK"?: number
  "rerankId"?: string
  "keyword"?: boolean
  "crossLanguages"?: Array<string>
  "metadataCondition"?: OpenApiJsonObject
  "useKg"?: boolean
  "tocEnhance"?: boolean
  "highlight"?: boolean
  "referenceMetadata"?: {
    "include": boolean
    "fields"?: Array<string>
  }
}
    response: OpenApiSchema<"RetrievalSearchResponse">
  }
  "datasets.list": {
    method: "GET"
    path: "/api/v1/datasets"
    pathParameters: Record<string, never>
    query: {
      "cursor"?: string
      "limit"?: number
      "id"?: string
      "ids"?: Array<string>
      "name"?: string
    }
    body: never
    response: OpenApiSchema<"DatasetsListResponse">
  }
  "datasets.create": {
    method: "POST"
    path: "/api/v1/datasets"
    pathParameters: Record<string, never>
    query: Record<string, never>
    body: {
  "name": string
  "avatar"?: string
  "description"?: string
  "embeddingModel"?: string
  "chunkMethod"?: string
  "parserConfig"?: OpenApiJsonObject
  "autoMetadataConfig"?: OpenApiJsonObject
  "language"?: string
  "pagerank"?: number
  "pipelineId"?: string
}
    response: OpenApiSchema<"DatasetsCreateResponse">
  }
  "datasets.get": {
    method: "GET"
    path: "/api/v1/datasets/{datasetId}"
    pathParameters: {
      "datasetId": string
    }
    query: Record<string, never>
    body: never
    response: OpenApiSchema<"DatasetsGetResponse">
  }
  "datasets.update": {
    method: "PATCH"
    path: "/api/v1/datasets/{datasetId}"
    pathParameters: {
      "datasetId": string
    }
    query: Record<string, never>
    body: {
  "name"?: string
  "avatar"?: string
  "description"?: string
  "embeddingModel"?: string
  "chunkMethod"?: string
  "parserConfig"?: OpenApiJsonObject
  "autoMetadataConfig"?: OpenApiJsonObject
  "language"?: string
  "pagerank"?: number
  "pipelineId"?: string
}
    response: OpenApiSchema<"DatasetsUpdateResponse">
  }
  "datasets.delete": {
    method: "DELETE"
    path: "/api/v1/datasets/{datasetId}"
    pathParameters: {
      "datasetId": string
    }
    query: Record<string, never>
    body: Record<string, never>
    response: OpenApiSchema<"DatasetsDeleteResponse">
  }
  "datasets.batchDelete": {
    method: "POST"
    path: "/api/v1/datasets:batch-delete"
    pathParameters: Record<string, never>
    query: Record<string, never>
    body: {
  "ids": Array<string>
}
    response: OpenApiSchema<"DatasetsBatchDeleteResponse">
  }
  "datasets.getMetadataConfig": {
    method: "GET"
    path: "/api/v1/datasets/{datasetId}/metadata-config"
    pathParameters: {
      "datasetId": string
    }
    query: Record<string, never>
    body: never
    response: OpenApiSchema<"DatasetsGetMetadataConfigResponse">
  }
  "datasets.updateMetadataConfig": {
    method: "PUT"
    path: "/api/v1/datasets/{datasetId}/metadata-config"
    pathParameters: {
      "datasetId": string
    }
    query: Record<string, never>
    body: {
  "metadata"?: Array<OpenApiJsonObject>
  "builtInMetadata"?: Array<string>
}
    response: OpenApiSchema<"DatasetsUpdateMetadataConfigResponse">
  }
  "documents.list": {
    method: "GET"
    path: "/api/v1/datasets/{datasetId}/documents"
    pathParameters: {
      "datasetId": string
    }
    query: {
      "cursor"?: string
      "limit"?: number
      "id"?: string
      "ids"?: Array<string>
      "name"?: string
      "keywords"?: string
      "createTimeFrom"?: number
      "createTimeTo"?: number
    }
    body: never
    response: OpenApiSchema<"DocumentsListResponse">
  }
  "documents.upload": {
    method: "POST"
    path: "/api/v1/datasets/{datasetId}/documents"
    pathParameters: {
      "datasetId": string
    }
    query: Record<string, never>
    body: {
  "file": Array<Blob>
}
    response: OpenApiSchema<"DocumentsUploadResponse">
  }
  "documents.get": {
    method: "GET"
    path: "/api/v1/datasets/{datasetId}/documents/{documentId}"
    pathParameters: {
      "datasetId": string
      "documentId": string
    }
    query: Record<string, never>
    body: never
    response: OpenApiSchema<"DocumentsGetResponse">
  }
  "documents.update": {
    method: "PATCH"
    path: "/api/v1/datasets/{datasetId}/documents/{documentId}"
    pathParameters: {
      "datasetId": string
      "documentId": string
    }
    query: Record<string, never>
    body: {
  "name"?: string
  "chunkMethod"?: string
  "parserConfig"?: OpenApiJsonObject
  "pipelineId"?: string
  "enabled"?: boolean
  "metaFields"?: OpenApiJsonObject
}
    response: OpenApiSchema<"DocumentsUpdateResponse">
  }
  "documents.delete": {
    method: "DELETE"
    path: "/api/v1/datasets/{datasetId}/documents/{documentId}"
    pathParameters: {
      "datasetId": string
      "documentId": string
    }
    query: Record<string, never>
    body: Record<string, never>
    response: OpenApiSchema<"DocumentsDeleteResponse">
  }
  "documents.batchDelete": {
    method: "POST"
    path: "/api/v1/datasets/{datasetId}/documents:batch-delete"
    pathParameters: {
      "datasetId": string
    }
    query: Record<string, never>
    body: {
  "ids": Array<string>
}
    response: OpenApiSchema<"DocumentsBatchDeleteResponse">
  }
  "documents.download": {
    method: "GET"
    path: "/api/v1/datasets/{datasetId}/documents/{documentId}/content"
    pathParameters: {
      "datasetId": string
      "documentId": string
    }
    query: Record<string, never>
    body: never
    response: Blob
  }
  "documents.startParse": {
    method: "POST"
    path: "/api/v1/datasets/{datasetId}/documents:parse"
    pathParameters: {
      "datasetId": string
    }
    query: Record<string, never>
    body: {
  "documentIds": Array<string>
}
    response: OpenApiSchema<"DocumentsStartParseResponse">
  }
  "documents.cancelParse": {
    method: "POST"
    path: "/api/v1/datasets/{datasetId}/documents:cancel-parse"
    pathParameters: {
      "datasetId": string
    }
    query: Record<string, never>
    body: {
  "documentIds": Array<string>
}
    response: OpenApiSchema<"DocumentsCancelParseResponse">
  }
  "chunks.list": {
    method: "GET"
    path: "/api/v1/datasets/{datasetId}/documents/{documentId}/chunks"
    pathParameters: {
      "datasetId": string
      "documentId": string
    }
    query: {
      "cursor"?: string
      "limit"?: number
      "id"?: string
      "keywords"?: string
    }
    body: never
    response: OpenApiSchema<"ChunksListResponse">
  }
  "chunks.create": {
    method: "POST"
    path: "/api/v1/datasets/{datasetId}/documents/{documentId}/chunks"
    pathParameters: {
      "datasetId": string
      "documentId": string
    }
    query: Record<string, never>
    body: {
  "content": string
  "importantKeywords"?: Array<string>
  "questions"?: Array<string>
  "available"?: boolean
  "positions"?: Array<Array<number>>
}
    response: OpenApiSchema<"ChunksCreateResponse">
  }
  "chunks.get": {
    method: "GET"
    path: "/api/v1/datasets/{datasetId}/documents/{documentId}/chunks/{chunkId}"
    pathParameters: {
      "datasetId": string
      "documentId": string
      "chunkId": string
    }
    query: Record<string, never>
    body: never
    response: OpenApiSchema<"ChunksGetResponse">
  }
  "chunks.update": {
    method: "PATCH"
    path: "/api/v1/datasets/{datasetId}/documents/{documentId}/chunks/{chunkId}"
    pathParameters: {
      "datasetId": string
      "documentId": string
      "chunkId": string
    }
    query: Record<string, never>
    body: {
  "content"?: string
  "importantKeywords"?: Array<string>
  "questions"?: Array<string>
  "available"?: boolean
  "positions"?: Array<Array<number>>
}
    response: OpenApiSchema<"ChunksUpdateResponse">
  }
  "chunks.delete": {
    method: "DELETE"
    path: "/api/v1/datasets/{datasetId}/documents/{documentId}/chunks/{chunkId}"
    pathParameters: {
      "datasetId": string
      "documentId": string
      "chunkId": string
    }
    query: Record<string, never>
    body: Record<string, never>
    response: OpenApiSchema<"ChunksDeleteResponse">
  }
  "chunks.batchDelete": {
    method: "POST"
    path: "/api/v1/datasets/{datasetId}/documents/{documentId}/chunks:batch-delete"
    pathParameters: {
      "datasetId": string
      "documentId": string
    }
    query: Record<string, never>
    body: {
  "ids": Array<string>
}
    response: OpenApiSchema<"ChunksBatchDeleteResponse">
  }
  "chats.list": {
    method: "GET"
    path: "/api/v1/chats"
    pathParameters: Record<string, never>
    query: {
      "cursor"?: string
      "limit"?: number
      "id"?: string
      "name"?: string
      "keywords"?: string
    }
    body: never
    response: OpenApiSchema<"ChatsListResponse">
  }
  "chats.create": {
    method: "POST"
    path: "/api/v1/chats"
    pathParameters: Record<string, never>
    query: Record<string, never>
    body: {
  "name": string
  "icon"?: string
  "description"?: string
  "datasetIds"?: Array<string>
  "llmId"?: string
  "llmSetting"?: OpenApiJsonObject
  "promptConfig"?: OpenApiJsonObject
  "topN"?: number
  "topK"?: number
  "similarityThreshold"?: number
  "vectorSimilarityWeight"?: number
  "rerankId"?: string
}
    response: OpenApiSchema<"ChatsCreateResponse">
  }
  "chats.get": {
    method: "GET"
    path: "/api/v1/chats/{chatId}"
    pathParameters: {
      "chatId": string
    }
    query: Record<string, never>
    body: never
    response: OpenApiSchema<"ChatsGetResponse">
  }
  "chats.update": {
    method: "PATCH"
    path: "/api/v1/chats/{chatId}"
    pathParameters: {
      "chatId": string
    }
    query: Record<string, never>
    body: {
  "name"?: string
  "icon"?: string
  "description"?: string
  "datasetIds"?: Array<string>
  "llmId"?: string
  "llmSetting"?: OpenApiJsonObject
  "promptConfig"?: OpenApiJsonObject
  "topN"?: number
  "topK"?: number
  "similarityThreshold"?: number
  "vectorSimilarityWeight"?: number
  "rerankId"?: string
}
    response: OpenApiSchema<"ChatsUpdateResponse">
  }
  "chats.delete": {
    method: "DELETE"
    path: "/api/v1/chats/{chatId}"
    pathParameters: {
      "chatId": string
    }
    query: Record<string, never>
    body: Record<string, never>
    response: OpenApiSchema<"ChatsDeleteResponse">
  }
  "chats.batchDelete": {
    method: "POST"
    path: "/api/v1/chats:batch-delete"
    pathParameters: Record<string, never>
    query: Record<string, never>
    body: {
  "ids": Array<string>
}
    response: OpenApiSchema<"ChatsBatchDeleteResponse">
  }
  "chatSessions.list": {
    method: "GET"
    path: "/api/v1/chats/{chatId}/sessions"
    pathParameters: {
      "chatId": string
    }
    query: {
      "cursor"?: string
      "limit"?: number
      "id"?: string
      "name"?: string
    }
    body: never
    response: OpenApiSchema<"ChatSessionsListResponse">
  }
  "chatSessions.create": {
    method: "POST"
    path: "/api/v1/chats/{chatId}/sessions"
    pathParameters: {
      "chatId": string
    }
    query: Record<string, never>
    body: {
  "name"?: string
  "inputs"?: OpenApiJsonObject
}
    response: OpenApiSchema<"ChatSessionsCreateResponse">
  }
  "chatSessions.get": {
    method: "GET"
    path: "/api/v1/chats/{chatId}/sessions/{sessionId}"
    pathParameters: {
      "chatId": string
      "sessionId": string
    }
    query: Record<string, never>
    body: never
    response: OpenApiSchema<"ChatSessionsGetResponse">
  }
  "chatSessions.update": {
    method: "PATCH"
    path: "/api/v1/chats/{chatId}/sessions/{sessionId}"
    pathParameters: {
      "chatId": string
      "sessionId": string
    }
    query: Record<string, never>
    body: {
  "name"?: string
}
    response: OpenApiSchema<"ChatSessionsUpdateResponse">
  }
  "chatSessions.delete": {
    method: "DELETE"
    path: "/api/v1/chats/{chatId}/sessions/{sessionId}"
    pathParameters: {
      "chatId": string
      "sessionId": string
    }
    query: Record<string, never>
    body: Record<string, never>
    response: OpenApiSchema<"ChatSessionsDeleteResponse">
  }
  "chatSessions.batchDelete": {
    method: "POST"
    path: "/api/v1/chats/{chatId}/sessions:batch-delete"
    pathParameters: {
      "chatId": string
    }
    query: Record<string, never>
    body: {
  "ids": Array<string>
}
    response: OpenApiSchema<"ChatSessionsBatchDeleteResponse">
  }
  "chatSessions.invoke": {
    method: "POST"
    path: "/api/v1/chats/{chatId}/sessions/{sessionId}:invoke"
    pathParameters: {
      "chatId": string
    }
    query: Record<string, never>
    body: {
  "question": string
  "inputs"?: OpenApiJsonObject
  "release"?: boolean
  "returnTrace"?: boolean
  "stream"?: boolean
}
    response: OpenApiSchema<"ChatSessionsInvokeResponse">
  }
  "agents.list": {
    method: "GET"
    path: "/api/v1/agents"
    pathParameters: Record<string, never>
    query: {
      "cursor"?: string
      "limit"?: number
    }
    body: never
    response: OpenApiSchema<"AgentsListResponse">
  }
  "agents.create": {
    method: "POST"
    path: "/api/v1/agents"
    pathParameters: Record<string, never>
    query: Record<string, never>
    body: {
  "title": string
  "dsl": OpenApiJsonObject
  "description"?: string
  "canvasType"?: string
  "release"?: boolean
}
    response: OpenApiSchema<"AgentsCreateResponse">
  }
  "agents.get": {
    method: "GET"
    path: "/api/v1/agents/{agentId}"
    pathParameters: {
      "agentId": string
    }
    query: Record<string, never>
    body: never
    response: OpenApiSchema<"AgentsGetResponse">
  }
  "agents.update": {
    method: "PATCH"
    path: "/api/v1/agents/{agentId}"
    pathParameters: {
      "agentId": string
    }
    query: Record<string, never>
    body: {
  "title"?: string
  "dsl"?: OpenApiJsonObject
  "description"?: string
  "canvasType"?: string
  "release"?: boolean
}
    response: OpenApiSchema<"AgentsUpdateResponse">
  }
  "agents.delete": {
    method: "DELETE"
    path: "/api/v1/agents/{agentId}"
    pathParameters: {
      "agentId": string
    }
    query: Record<string, never>
    body: Record<string, never>
    response: OpenApiSchema<"AgentsDeleteResponse">
  }
  "agentSessions.list": {
    method: "GET"
    path: "/api/v1/agents/{agentId}/sessions"
    pathParameters: {
      "agentId": string
    }
    query: {
      "cursor"?: string
      "limit"?: number
      "id"?: string
      "name"?: string
    }
    body: never
    response: OpenApiSchema<"AgentSessionsListResponse">
  }
  "agentSessions.create": {
    method: "POST"
    path: "/api/v1/agents/{agentId}/sessions"
    pathParameters: {
      "agentId": string
    }
    query: Record<string, never>
    body: {
  "name"?: string
  "inputs"?: OpenApiJsonObject
}
    response: OpenApiSchema<"AgentSessionsCreateResponse">
  }
  "agentSessions.get": {
    method: "GET"
    path: "/api/v1/agents/{agentId}/sessions/{sessionId}"
    pathParameters: {
      "agentId": string
      "sessionId": string
    }
    query: Record<string, never>
    body: never
    response: OpenApiSchema<"AgentSessionsGetResponse">
  }
  "agentSessions.delete": {
    method: "DELETE"
    path: "/api/v1/agents/{agentId}/sessions/{sessionId}"
    pathParameters: {
      "agentId": string
      "sessionId": string
    }
    query: Record<string, never>
    body: Record<string, never>
    response: OpenApiSchema<"AgentSessionsDeleteResponse">
  }
  "agentSessions.batchDelete": {
    method: "POST"
    path: "/api/v1/agents/{agentId}/sessions:batch-delete"
    pathParameters: {
      "agentId": string
    }
    query: Record<string, never>
    body: {
  "ids": Array<string>
}
    response: OpenApiSchema<"AgentSessionsBatchDeleteResponse">
  }
  "agentSessions.invoke": {
    method: "POST"
    path: "/api/v1/agents/{agentId}/sessions/{sessionId}:invoke"
    pathParameters: {
      "agentId": string
    }
    query: Record<string, never>
    body: {
  "question": string
  "inputs"?: OpenApiJsonObject
  "release"?: boolean
  "returnTrace"?: boolean
  "stream"?: boolean
}
    response: OpenApiSchema<"AgentSessionsInvokeResponse">
  }
  "memories.list": {
    method: "GET"
    path: "/api/v1/memories"
    pathParameters: Record<string, never>
    query: {
      "cursor"?: string
      "limit"?: number
      "memoryType"?: Array<string>
      "storageType"?: string
      "keywords"?: string
    }
    body: never
    response: OpenApiSchema<"MemoriesListResponse">
  }
  "memories.create": {
    method: "POST"
    path: "/api/v1/memories"
    pathParameters: Record<string, never>
    query: Record<string, never>
    body: {
  "name": string
  "memoryType": Array<string>
  "embdId": string
  "llmId": string
  "description"?: string
  "memorySize"?: number
  "forgettingPolicy"?: string
  "temperature"?: number
  "avatar"?: string
  "systemPrompt"?: string
  "userPrompt"?: string
}
    response: OpenApiSchema<"MemoriesCreateResponse">
  }
  "memories.get": {
    method: "GET"
    path: "/api/v1/memories/{memoryId}"
    pathParameters: {
      "memoryId": string
    }
    query: Record<string, never>
    body: never
    response: OpenApiSchema<"MemoriesGetResponse">
  }
  "memories.update": {
    method: "PATCH"
    path: "/api/v1/memories/{memoryId}"
    pathParameters: {
      "memoryId": string
    }
    query: Record<string, never>
    body: {
  "name"?: string
  "memoryType"?: Array<string>
  "embdId"?: string
  "llmId"?: string
  "description"?: string
  "memorySize"?: number
  "forgettingPolicy"?: string
  "temperature"?: number
  "avatar"?: string
  "systemPrompt"?: string
  "userPrompt"?: string
}
    response: OpenApiSchema<"MemoriesUpdateResponse">
  }
  "memories.delete": {
    method: "DELETE"
    path: "/api/v1/memories/{memoryId}"
    pathParameters: {
      "memoryId": string
    }
    query: Record<string, never>
    body: Record<string, never>
    response: OpenApiSchema<"MemoriesDeleteResponse">
  }
  "memories.getConfig": {
    method: "GET"
    path: "/api/v1/memories/{memoryId}/config"
    pathParameters: {
      "memoryId": string
    }
    query: Record<string, never>
    body: never
    response: OpenApiSchema<"MemoriesGetConfigResponse">
  }
  "memoryMessages.list": {
    method: "GET"
    path: "/api/v1/memories/{memoryId}/messages"
    pathParameters: {
      "memoryId": string
    }
    query: {
      "cursor"?: string
      "limit"?: number
    }
    body: never
    response: OpenApiSchema<"MemoryMessagesListResponse">
  }
  "memoryMessages.create": {
    method: "POST"
    path: "/api/v1/memories/{memoryId}/messages"
    pathParameters: {
      "memoryId": string
    }
    query: Record<string, never>
    body: {
  "agentId": string
  "sessionId": string
  "userInput": string
  "agentResponse": string
  "messageId"?: number
  "status"?: boolean
}
    response: OpenApiSchema<"MemoryMessagesCreateResponse">
  }
  "memoryMessages.batchCreate": {
    method: "POST"
    path: "/api/v1/memory-messages:batch-create"
    pathParameters: Record<string, never>
    query: Record<string, never>
    body: {
  "memoryIds": Array<string>
  "agentId": string
  "sessionId": string
  "userInput": string
  "agentResponse": string
  "messageId"?: number
  "status"?: boolean
}
    response: OpenApiSchema<"MemoryMessagesBatchCreateResponse">
  }
  "memoryMessages.search": {
    method: "GET"
    path: "/api/v1/memory-messages/search"
    pathParameters: Record<string, never>
    query: {
      "query": string
      "memoryIds": Array<string>
      "agentId"?: string
      "sessionId"?: string
      "similarityThreshold"?: number
      "keywordsSimilarityWeight"?: number
      "topN"?: number
    }
    body: never
    response: OpenApiSchema<"MemoryMessagesSearchResponse">
  }
  "memoryMessages.recent": {
    method: "GET"
    path: "/api/v1/memory-messages/recent"
    pathParameters: Record<string, never>
    query: {
      "memoryIds": Array<string>
      "agentId"?: string
      "sessionId"?: string
      "limit"?: number
    }
    body: never
    response: OpenApiSchema<"MemoryMessagesRecentResponse">
  }
  "memoryMessages.getContent": {
    method: "GET"
    path: "/api/v1/memories/{memoryId}/messages/{messageId}/content"
    pathParameters: {
      "memoryId": string
      "messageId": string
    }
    query: Record<string, never>
    body: never
    response: OpenApiSchema<"MemoryMessagesGetContentResponse">
  }
  "memoryMessages.update": {
    method: "PATCH"
    path: "/api/v1/memories/{memoryId}/messages/{messageId}"
    pathParameters: {
      "memoryId": string
      "messageId": string
    }
    query: Record<string, never>
    body: {
  "status": boolean
}
    response: OpenApiSchema<"MemoryMessagesUpdateResponse">
  }
  "memoryMessages.delete": {
    method: "DELETE"
    path: "/api/v1/memories/{memoryId}/messages/{messageId}"
    pathParameters: {
      "memoryId": string
      "messageId": string
    }
    query: Record<string, never>
    body: Record<string, never>
    response: OpenApiSchema<"MemoryMessagesDeleteResponse">
  }
}

export type BusinessGatewayOperation = keyof BusinessGatewayOperationMap
export type BusinessGatewayJsonOperation = "authorization.context" | "retrieval.search" | "datasets.list" | "datasets.create" | "datasets.get" | "datasets.update" | "datasets.delete" | "datasets.batchDelete" | "datasets.getMetadataConfig" | "datasets.updateMetadataConfig" | "documents.list" | "documents.upload" | "documents.get" | "documents.update" | "documents.delete" | "documents.batchDelete" | "documents.startParse" | "documents.cancelParse" | "chunks.list" | "chunks.create" | "chunks.get" | "chunks.update" | "chunks.delete" | "chunks.batchDelete" | "chats.list" | "chats.create" | "chats.get" | "chats.update" | "chats.delete" | "chats.batchDelete" | "chatSessions.list" | "chatSessions.create" | "chatSessions.get" | "chatSessions.update" | "chatSessions.delete" | "chatSessions.batchDelete" | "chatSessions.invoke" | "agents.list" | "agents.create" | "agents.get" | "agents.update" | "agents.delete" | "agentSessions.list" | "agentSessions.create" | "agentSessions.get" | "agentSessions.delete" | "agentSessions.batchDelete" | "agentSessions.invoke" | "memories.list" | "memories.create" | "memories.get" | "memories.update" | "memories.delete" | "memories.getConfig" | "memoryMessages.list" | "memoryMessages.create" | "memoryMessages.batchCreate" | "memoryMessages.search" | "memoryMessages.recent" | "memoryMessages.getContent" | "memoryMessages.update" | "memoryMessages.delete"
export interface BusinessGatewayOperationDataMap {
  "authorization.context": OpenApiSchema<"BusinessAuthorizationContext">
  "retrieval.search": OpenApiSchema<"RetrievalResult">
  "datasets.list": Array<OpenApiSchema<"Dataset">>
  "datasets.create": OpenApiSchema<"Dataset">
  "datasets.get": OpenApiSchema<"Dataset">
  "datasets.update": OpenApiSchema<"Dataset">
  "datasets.delete": OpenApiSchema<"CommandResult">
  "datasets.batchDelete": OpenApiSchema<"CommandResult">
  "datasets.getMetadataConfig": OpenApiSchema<"MetadataConfig">
  "datasets.updateMetadataConfig": OpenApiSchema<"MetadataConfig">
  "documents.list": Array<OpenApiSchema<"Document">>
  "documents.upload": Array<OpenApiSchema<"Document">>
  "documents.get": OpenApiSchema<"Document">
  "documents.update": OpenApiSchema<"Document">
  "documents.delete": OpenApiSchema<"CommandResult">
  "documents.batchDelete": OpenApiSchema<"CommandResult">
  "documents.startParse": OpenApiSchema<"CommandResult">
  "documents.cancelParse": OpenApiSchema<"CommandResult">
  "chunks.list": Array<OpenApiSchema<"Chunk">>
  "chunks.create": OpenApiSchema<"Chunk">
  "chunks.get": OpenApiSchema<"Chunk">
  "chunks.update": OpenApiSchema<"Chunk">
  "chunks.delete": OpenApiSchema<"CommandResult">
  "chunks.batchDelete": OpenApiSchema<"CommandResult">
  "chats.list": Array<OpenApiSchema<"Chat">>
  "chats.create": OpenApiSchema<"Chat">
  "chats.get": OpenApiSchema<"Chat">
  "chats.update": OpenApiSchema<"Chat">
  "chats.delete": OpenApiSchema<"CommandResult">
  "chats.batchDelete": OpenApiSchema<"CommandResult">
  "chatSessions.list": Array<OpenApiSchema<"Session">>
  "chatSessions.create": OpenApiSchema<"Session">
  "chatSessions.get": OpenApiSchema<"Session">
  "chatSessions.update": OpenApiSchema<"Session">
  "chatSessions.delete": OpenApiSchema<"CommandResult">
  "chatSessions.batchDelete": OpenApiSchema<"CommandResult">
  "chatSessions.invoke": OpenApiSchema<"SessionInvocation">
  "agents.list": Array<OpenApiSchema<"Agent">>
  "agents.create": OpenApiSchema<"Agent">
  "agents.get": OpenApiSchema<"Agent">
  "agents.update": OpenApiSchema<"Agent">
  "agents.delete": OpenApiSchema<"CommandResult">
  "agentSessions.list": Array<OpenApiSchema<"Session">>
  "agentSessions.create": OpenApiSchema<"Session">
  "agentSessions.get": OpenApiSchema<"Session">
  "agentSessions.delete": OpenApiSchema<"CommandResult">
  "agentSessions.batchDelete": OpenApiSchema<"CommandResult">
  "agentSessions.invoke": OpenApiSchema<"SessionInvocation">
  "memories.list": Array<OpenApiSchema<"Memory">>
  "memories.create": OpenApiSchema<"Memory">
  "memories.get": OpenApiSchema<"Memory">
  "memories.update": OpenApiSchema<"Memory">
  "memories.delete": OpenApiSchema<"CommandResult">
  "memories.getConfig": OpenApiSchema<"Memory">
  "memoryMessages.list": Array<OpenApiSchema<"MemoryMessage">>
  "memoryMessages.create": OpenApiSchema<"CommandResult">
  "memoryMessages.batchCreate": OpenApiSchema<"CommandResult">
  "memoryMessages.search": Array<OpenApiSchema<"MemoryMessage">>
  "memoryMessages.recent": Array<OpenApiSchema<"MemoryMessage">>
  "memoryMessages.getContent": OpenApiSchema<"MemoryMessage">
  "memoryMessages.update": OpenApiSchema<"CommandResult">
  "memoryMessages.delete": OpenApiSchema<"CommandResult">
}
export type OperationBody<O extends BusinessGatewayOperation> = BusinessGatewayOperationMap[O]['body']
export type OperationQuery<O extends BusinessGatewayOperation> = BusinessGatewayOperationMap[O]['query']
export type OperationPath<O extends BusinessGatewayOperation> = BusinessGatewayOperationMap[O]['pathParameters']
export type OperationResponse<O extends BusinessGatewayOperation> = BusinessGatewayOperationMap[O]['response']
export type OperationData<O extends BusinessGatewayJsonOperation> = BusinessGatewayOperationDataMap[O]

const OPENAPI_COMPONENT_SCHEMAS: Record<string, unknown> = {"ResourceScope":{"type":"object","additionalProperties":false,"required":["mode"],"properties":{"mode":{"type":"string","enum":["all","ids","inherit","none"]},"ids":{"type":"array","items":{"type":"string"},"uniqueItems":true}}},"BusinessAuthorizationContext":{"type":"object","additionalProperties":false,"required":["subject","actorSubject","onBehalfOfSubject","workspaceId","actions","datasetScope","documentScope","chatScope","agentScope","memoryScope","permissionRef","authenticationType","requestId","tokenUse","audience","expiresAt","clientId"],"properties":{"subject":{"type":"string"},"actorSubject":{"type":"string"},"onBehalfOfSubject":{"type":["string","null"]},"workspaceId":{"type":"string"},"actions":{"type":"array","items":{"type":"string"},"uniqueItems":true},"datasetScope":{"$ref":"#/components/schemas/ResourceScope"},"documentScope":{"$ref":"#/components/schemas/ResourceScope"},"chatScope":{"$ref":"#/components/schemas/ResourceScope"},"agentScope":{"$ref":"#/components/schemas/ResourceScope"},"memoryScope":{"$ref":"#/components/schemas/ResourceScope"},"permissionRef":{"type":["string","null"]},"authenticationType":{"type":"string","const":"token-introspection"},"requestId":{"type":"string"},"tokenUse":{"type":"string","const":"data"},"audience":{"type":"array","items":{"type":"string"}},"expiresAt":{"type":"string","format":"date-time"},"clientId":{"type":["string","null"]}}},"SuccessMeta":{"type":"object","additionalProperties":false,"required":["requestId"],"properties":{"requestId":{"type":"string"},"limit":{"type":"integer"},"hasNext":{"type":"boolean"},"nextCursor":{"type":["string","null"]}}},"Dataset":{"type":"object","additionalProperties":false,"properties":{"id":{"type":"string"},"version":{"type":"integer"},"name":{"type":"string"},"avatar":{"type":["string","null"]},"language":{"type":["string","null"]},"description":{"type":["string","null"]},"embeddingModel":{"type":"string"},"permission":{"type":"string"},"documentCount":{"type":"integer"},"tokenCount":{"type":"integer"},"chunkCount":{"type":"integer"},"similarityThreshold":{"type":"number"},"vectorSimilarityWeight":{"type":"number"},"chunkMethod":{"type":"string"},"pipelineId":{"type":["string","null"]},"parserConfig":{"type":"object","additionalProperties":true},"autoMetadataConfig":{"type":"object","additionalProperties":true},"pagerank":{"type":"integer"},"status":{"type":["string","null"]},"createTime":{"type":["integer","null"]},"createDate":{"type":["string","null"]},"updateTime":{"type":["integer","null"]},"updateDate":{"type":["string","null"]}},"required":["id","version","name"]},"Document":{"type":"object","additionalProperties":false,"properties":{"id":{"type":"string"},"version":{"type":"integer"},"datasetId":{"type":"string"},"name":{"type":["string","null"]},"thumbnail":{"type":["string","null"]},"chunkMethod":{"type":"string"},"pipelineId":{"type":["string","null"]},"parserConfig":{"type":"object","additionalProperties":true},"sourceType":{"type":"string"},"type":{"type":"string"},"location":{"type":["string","null"]},"size":{"type":"integer"},"tokenCount":{"type":"integer"},"chunkCount":{"type":"integer"},"progress":{"type":"number"},"progressMsg":{"type":["string","null"]},"processBeginAt":{},"processDuration":{"type":"number"},"suffix":{"type":"string"},"contentHash":{"type":["string","null"]},"run":{"type":["string","null"]},"status":{"type":["string","null"]},"metaFields":{"type":"object","additionalProperties":true},"createTime":{"type":["integer","null"]},"createDate":{"type":["string","null"]},"updateTime":{"type":["integer","null"]},"updateDate":{"type":["string","null"]}},"required":["id","version","datasetId"]},"Chunk":{"type":"object","additionalProperties":false,"properties":{"id":{"type":"string"},"version":{"type":"integer"},"content":{"type":"string"},"datasetId":{"type":"string"},"documentId":{"type":"string"},"documentName":{"type":["string","null"]},"documentKeyword":{"type":["string","null"]},"importantKeywords":{"type":"array","items":{"type":"string"}},"questions":{"type":"array","items":{"type":"string"}},"imageId":{"type":["string","null"]},"documentType":{"type":["string","null"]},"available":{"type":"boolean"},"positions":{"type":"array","items":{"type":"array","items":{"type":"integer"}}},"tags":{"type":"array","items":{"type":"string"}},"tagFeatures":{"type":"object","additionalProperties":true},"similarity":{"type":["number","null"]},"score":{"type":["number","null"]},"highlight":{},"metadata":{"type":"object","additionalProperties":true}},"required":["id","content"]},"Chat":{"type":"object","additionalProperties":false,"properties":{"id":{"type":"string"},"version":{"type":"integer"},"name":{"type":["string","null"]},"description":{"type":["string","null"]},"icon":{"type":["string","null"]},"language":{"type":["string","null"]},"llmId":{"type":"string"},"llmSetting":{"type":"object","additionalProperties":true},"promptType":{"type":"string"},"promptConfig":{"type":"object","additionalProperties":true},"metaDataFilter":{"type":"object","additionalProperties":true},"similarityThreshold":{"type":"number"},"vectorSimilarityWeight":{"type":"number"},"topN":{"type":"integer"},"topK":{"type":"integer"},"doRefer":{"type":"string"},"rerankId":{"type":"string"},"datasetIds":{"type":"array","items":{"type":"string"}},"status":{"type":["string","null"]},"createTime":{"type":["integer","null"]},"createDate":{"type":["string","null"]},"updateTime":{"type":["integer","null"]},"updateDate":{"type":["string","null"]}},"required":["id","version"]},"Session":{"type":"object","additionalProperties":false,"properties":{"id":{"type":"string"},"version":{"type":"integer"},"ownerId":{"type":"string"},"name":{"type":["string","null"]},"message":{"type":"array","items":{}},"reference":{},"tokens":{"type":"integer"},"source":{"type":["string","null"]},"dsl":{"type":"object","additionalProperties":true},"duration":{"type":"number"},"round":{"type":"integer"},"thumbUp":{"type":"integer"},"errors":{"type":["string","null"]},"versionTitle":{"type":["string","null"]},"createTime":{"type":["integer","null"]},"createDate":{"type":["string","null"]},"updateTime":{"type":["integer","null"]},"updateDate":{"type":["string","null"]}},"required":["id","version","ownerId"]},"Agent":{"type":"object","additionalProperties":false,"properties":{"id":{"type":"string"},"version":{"type":"integer"},"avatar":{"type":["string","null"]},"title":{"type":["string","null"]},"permission":{"type":"string"},"release":{"type":"boolean"},"description":{"type":["string","null"]},"canvasType":{"type":["string","null"]},"canvasCategory":{"type":"string"},"tags":{"type":"string"},"dsl":{"type":"object","additionalProperties":true},"createTime":{"type":["integer","null"]},"createDate":{"type":["string","null"]},"updateTime":{"type":["integer","null"]},"updateDate":{"type":["string","null"]}},"required":["id","version"]},"Memory":{"type":"object","additionalProperties":false,"properties":{"id":{"type":"string"},"version":{"type":"integer"},"name":{"type":"string"},"avatar":{"type":["string","null"]},"memoryType":{"type":["array","integer"],"items":{"type":"string"}},"storageType":{"type":"string"},"embdId":{"type":"string"},"embdName":{"type":["string","null"]},"llmId":{"type":"string"},"permissions":{"type":"string"},"description":{"type":["string","null"]},"memorySize":{"type":"integer"},"forgettingPolicy":{"type":"string"},"temperature":{"type":"number"},"systemPrompt":{"type":["string","null"]},"userPrompt":{"type":["string","null"]},"ownerName":{"type":["string","null"]},"createTime":{"type":["integer","null"]},"createDate":{"type":["string","null"]},"updateTime":{"type":["integer","null"]},"updateDate":{"type":["string","null"]}},"required":["id","version","name"]},"MemoryMessage":{"type":"object","additionalProperties":false,"properties":{"messageId":{"type":"integer"},"messageType":{"type":["string","null"]},"sourceId":{"type":["integer","null"]},"memoryId":{"type":"string"},"agentId":{"type":["string","null"]},"sessionId":{"type":["string","null"]},"validAt":{},"invalidAt":{},"forgetAt":{},"status":{"type":["boolean","null"]},"content":{},"extract":{"type":"array","items":{"type":"object","additionalProperties":true}},"agentName":{"type":["string","null"]},"task":{"type":"object","additionalProperties":true},"similarity":{"type":["number","null"]}},"required":["messageId","memoryId"]},"MetadataConfig":{"type":"object","additionalProperties":false,"properties":{"metadata":{"type":"array","items":{"type":"object","additionalProperties":true}},"builtInMetadata":{"type":"array","items":{"type":"string"}}}},"CommandResult":{"type":"object","additionalProperties":false,"properties":{"successCount":{"type":"integer"}},"required":["successCount"]},"SessionInvocation":{"type":"object","additionalProperties":false,"properties":{"content":{"type":"string"},"role":{"type":"string","const":"assistant"},"sessionId":{"type":"string"},"reference":{},"trace":{}},"required":["content","role","sessionId"]},"RetrievalResult":{"type":"object","additionalProperties":false,"properties":{"chunks":{"type":"array","items":{"$ref":"#/components/schemas/RetrievalChunk"}},"total":{"type":"integer"},"docAggs":{}},"required":["chunks","total","docAggs"]},"RetrievalChunk":{"type":"object","additionalProperties":false,"properties":{"id":{"type":"string"},"version":{"type":"integer"},"content":{"type":"string"},"datasetId":{"type":"string"},"documentId":{"type":"string"},"documentName":{"type":["string","null"]},"documentKeyword":{"type":["string","null"]},"importantKeywords":{"type":"array","items":{"type":"string"}},"questions":{"type":"array","items":{"type":"string"}},"imageId":{"type":["string","null"]},"documentType":{"type":["string","null"]},"available":{"type":"boolean"},"positions":{"type":"array","items":{"type":"array","items":{"type":"integer"}}},"tags":{"type":"array","items":{"type":"string"}},"tagFeatures":{"type":"object","additionalProperties":true},"similarity":{"type":["number","null"]},"score":{"type":["number","null"]},"highlight":{},"metadata":{"type":"object","additionalProperties":true}},"required":["content"]},"AuthorizationContextResponse":{"type":"object","additionalProperties":false,"properties":{"data":{"$ref":"#/components/schemas/BusinessAuthorizationContext"},"meta":{"$ref":"#/components/schemas/SuccessMeta"}},"required":["data","meta"]},"RetrievalSearchResponse":{"type":"object","additionalProperties":false,"properties":{"data":{"$ref":"#/components/schemas/RetrievalResult"},"meta":{"$ref":"#/components/schemas/SuccessMeta"}},"required":["data","meta"]},"DatasetsListResponse":{"type":"object","additionalProperties":false,"properties":{"data":{"type":"array","items":{"$ref":"#/components/schemas/Dataset"}},"meta":{"$ref":"#/components/schemas/SuccessMeta"}},"required":["data","meta"]},"DatasetsCreateResponse":{"type":"object","additionalProperties":false,"properties":{"data":{"$ref":"#/components/schemas/Dataset"},"meta":{"$ref":"#/components/schemas/SuccessMeta"}},"required":["data","meta"]},"DatasetsGetResponse":{"type":"object","additionalProperties":false,"properties":{"data":{"$ref":"#/components/schemas/Dataset"},"meta":{"$ref":"#/components/schemas/SuccessMeta"}},"required":["data","meta"]},"DatasetsUpdateResponse":{"type":"object","additionalProperties":false,"properties":{"data":{"$ref":"#/components/schemas/Dataset"},"meta":{"$ref":"#/components/schemas/SuccessMeta"}},"required":["data","meta"]},"DatasetsDeleteResponse":{"type":"object","additionalProperties":false,"properties":{"data":{"$ref":"#/components/schemas/CommandResult"},"meta":{"$ref":"#/components/schemas/SuccessMeta"}},"required":["data","meta"]},"DatasetsBatchDeleteResponse":{"type":"object","additionalProperties":false,"properties":{"data":{"$ref":"#/components/schemas/CommandResult"},"meta":{"$ref":"#/components/schemas/SuccessMeta"}},"required":["data","meta"]},"DatasetsGetMetadataConfigResponse":{"type":"object","additionalProperties":false,"properties":{"data":{"$ref":"#/components/schemas/MetadataConfig"},"meta":{"$ref":"#/components/schemas/SuccessMeta"}},"required":["data","meta"]},"DatasetsUpdateMetadataConfigResponse":{"type":"object","additionalProperties":false,"properties":{"data":{"$ref":"#/components/schemas/MetadataConfig"},"meta":{"$ref":"#/components/schemas/SuccessMeta"}},"required":["data","meta"]},"DocumentsListResponse":{"type":"object","additionalProperties":false,"properties":{"data":{"type":"array","items":{"$ref":"#/components/schemas/Document"}},"meta":{"$ref":"#/components/schemas/SuccessMeta"}},"required":["data","meta"]},"DocumentsUploadResponse":{"type":"object","additionalProperties":false,"properties":{"data":{"type":"array","items":{"$ref":"#/components/schemas/Document"}},"meta":{"$ref":"#/components/schemas/SuccessMeta"}},"required":["data","meta"]},"DocumentsGetResponse":{"type":"object","additionalProperties":false,"properties":{"data":{"$ref":"#/components/schemas/Document"},"meta":{"$ref":"#/components/schemas/SuccessMeta"}},"required":["data","meta"]},"DocumentsUpdateResponse":{"type":"object","additionalProperties":false,"properties":{"data":{"$ref":"#/components/schemas/Document"},"meta":{"$ref":"#/components/schemas/SuccessMeta"}},"required":["data","meta"]},"DocumentsDeleteResponse":{"type":"object","additionalProperties":false,"properties":{"data":{"$ref":"#/components/schemas/CommandResult"},"meta":{"$ref":"#/components/schemas/SuccessMeta"}},"required":["data","meta"]},"DocumentsBatchDeleteResponse":{"type":"object","additionalProperties":false,"properties":{"data":{"$ref":"#/components/schemas/CommandResult"},"meta":{"$ref":"#/components/schemas/SuccessMeta"}},"required":["data","meta"]},"DocumentsStartParseResponse":{"type":"object","additionalProperties":false,"properties":{"data":{"$ref":"#/components/schemas/CommandResult"},"meta":{"$ref":"#/components/schemas/SuccessMeta"}},"required":["data","meta"]},"DocumentsCancelParseResponse":{"type":"object","additionalProperties":false,"properties":{"data":{"$ref":"#/components/schemas/CommandResult"},"meta":{"$ref":"#/components/schemas/SuccessMeta"}},"required":["data","meta"]},"ChunksListResponse":{"type":"object","additionalProperties":false,"properties":{"data":{"type":"array","items":{"$ref":"#/components/schemas/Chunk"}},"meta":{"$ref":"#/components/schemas/SuccessMeta"}},"required":["data","meta"]},"ChunksCreateResponse":{"type":"object","additionalProperties":false,"properties":{"data":{"$ref":"#/components/schemas/Chunk"},"meta":{"$ref":"#/components/schemas/SuccessMeta"}},"required":["data","meta"]},"ChunksGetResponse":{"type":"object","additionalProperties":false,"properties":{"data":{"$ref":"#/components/schemas/Chunk"},"meta":{"$ref":"#/components/schemas/SuccessMeta"}},"required":["data","meta"]},"ChunksUpdateResponse":{"type":"object","additionalProperties":false,"properties":{"data":{"$ref":"#/components/schemas/Chunk"},"meta":{"$ref":"#/components/schemas/SuccessMeta"}},"required":["data","meta"]},"ChunksDeleteResponse":{"type":"object","additionalProperties":false,"properties":{"data":{"$ref":"#/components/schemas/CommandResult"},"meta":{"$ref":"#/components/schemas/SuccessMeta"}},"required":["data","meta"]},"ChunksBatchDeleteResponse":{"type":"object","additionalProperties":false,"properties":{"data":{"$ref":"#/components/schemas/CommandResult"},"meta":{"$ref":"#/components/schemas/SuccessMeta"}},"required":["data","meta"]},"ChatsListResponse":{"type":"object","additionalProperties":false,"properties":{"data":{"type":"array","items":{"$ref":"#/components/schemas/Chat"}},"meta":{"$ref":"#/components/schemas/SuccessMeta"}},"required":["data","meta"]},"ChatsCreateResponse":{"type":"object","additionalProperties":false,"properties":{"data":{"$ref":"#/components/schemas/Chat"},"meta":{"$ref":"#/components/schemas/SuccessMeta"}},"required":["data","meta"]},"ChatsGetResponse":{"type":"object","additionalProperties":false,"properties":{"data":{"$ref":"#/components/schemas/Chat"},"meta":{"$ref":"#/components/schemas/SuccessMeta"}},"required":["data","meta"]},"ChatsUpdateResponse":{"type":"object","additionalProperties":false,"properties":{"data":{"$ref":"#/components/schemas/Chat"},"meta":{"$ref":"#/components/schemas/SuccessMeta"}},"required":["data","meta"]},"ChatsDeleteResponse":{"type":"object","additionalProperties":false,"properties":{"data":{"$ref":"#/components/schemas/CommandResult"},"meta":{"$ref":"#/components/schemas/SuccessMeta"}},"required":["data","meta"]},"ChatsBatchDeleteResponse":{"type":"object","additionalProperties":false,"properties":{"data":{"$ref":"#/components/schemas/CommandResult"},"meta":{"$ref":"#/components/schemas/SuccessMeta"}},"required":["data","meta"]},"ChatSessionsListResponse":{"type":"object","additionalProperties":false,"properties":{"data":{"type":"array","items":{"$ref":"#/components/schemas/Session"}},"meta":{"$ref":"#/components/schemas/SuccessMeta"}},"required":["data","meta"]},"AgentSessionsListResponse":{"type":"object","additionalProperties":false,"properties":{"data":{"type":"array","items":{"$ref":"#/components/schemas/Session"}},"meta":{"$ref":"#/components/schemas/SuccessMeta"}},"required":["data","meta"]},"ChatSessionsCreateResponse":{"type":"object","additionalProperties":false,"properties":{"data":{"$ref":"#/components/schemas/Session"},"meta":{"$ref":"#/components/schemas/SuccessMeta"}},"required":["data","meta"]},"ChatSessionsGetResponse":{"type":"object","additionalProperties":false,"properties":{"data":{"$ref":"#/components/schemas/Session"},"meta":{"$ref":"#/components/schemas/SuccessMeta"}},"required":["data","meta"]},"ChatSessionsUpdateResponse":{"type":"object","additionalProperties":false,"properties":{"data":{"$ref":"#/components/schemas/Session"},"meta":{"$ref":"#/components/schemas/SuccessMeta"}},"required":["data","meta"]},"AgentSessionsCreateResponse":{"type":"object","additionalProperties":false,"properties":{"data":{"$ref":"#/components/schemas/Session"},"meta":{"$ref":"#/components/schemas/SuccessMeta"}},"required":["data","meta"]},"AgentSessionsGetResponse":{"type":"object","additionalProperties":false,"properties":{"data":{"$ref":"#/components/schemas/Session"},"meta":{"$ref":"#/components/schemas/SuccessMeta"}},"required":["data","meta"]},"ChatSessionsDeleteResponse":{"type":"object","additionalProperties":false,"properties":{"data":{"$ref":"#/components/schemas/CommandResult"},"meta":{"$ref":"#/components/schemas/SuccessMeta"}},"required":["data","meta"]},"ChatSessionsBatchDeleteResponse":{"type":"object","additionalProperties":false,"properties":{"data":{"$ref":"#/components/schemas/CommandResult"},"meta":{"$ref":"#/components/schemas/SuccessMeta"}},"required":["data","meta"]},"AgentSessionsDeleteResponse":{"type":"object","additionalProperties":false,"properties":{"data":{"$ref":"#/components/schemas/CommandResult"},"meta":{"$ref":"#/components/schemas/SuccessMeta"}},"required":["data","meta"]},"AgentSessionsBatchDeleteResponse":{"type":"object","additionalProperties":false,"properties":{"data":{"$ref":"#/components/schemas/CommandResult"},"meta":{"$ref":"#/components/schemas/SuccessMeta"}},"required":["data","meta"]},"ChatSessionsInvokeResponse":{"type":"object","additionalProperties":false,"properties":{"data":{"$ref":"#/components/schemas/SessionInvocation"},"meta":{"$ref":"#/components/schemas/SuccessMeta"}},"required":["data","meta"]},"AgentSessionsInvokeResponse":{"type":"object","additionalProperties":false,"properties":{"data":{"$ref":"#/components/schemas/SessionInvocation"},"meta":{"$ref":"#/components/schemas/SuccessMeta"}},"required":["data","meta"]},"AgentsListResponse":{"type":"object","additionalProperties":false,"properties":{"data":{"type":"array","items":{"$ref":"#/components/schemas/Agent"}},"meta":{"$ref":"#/components/schemas/SuccessMeta"}},"required":["data","meta"]},"AgentsCreateResponse":{"type":"object","additionalProperties":false,"properties":{"data":{"$ref":"#/components/schemas/Agent"},"meta":{"$ref":"#/components/schemas/SuccessMeta"}},"required":["data","meta"]},"AgentsGetResponse":{"type":"object","additionalProperties":false,"properties":{"data":{"$ref":"#/components/schemas/Agent"},"meta":{"$ref":"#/components/schemas/SuccessMeta"}},"required":["data","meta"]},"AgentsUpdateResponse":{"type":"object","additionalProperties":false,"properties":{"data":{"$ref":"#/components/schemas/Agent"},"meta":{"$ref":"#/components/schemas/SuccessMeta"}},"required":["data","meta"]},"AgentsDeleteResponse":{"type":"object","additionalProperties":false,"properties":{"data":{"$ref":"#/components/schemas/CommandResult"},"meta":{"$ref":"#/components/schemas/SuccessMeta"}},"required":["data","meta"]},"MemoriesListResponse":{"type":"object","additionalProperties":false,"properties":{"data":{"type":"array","items":{"$ref":"#/components/schemas/Memory"}},"meta":{"$ref":"#/components/schemas/SuccessMeta"}},"required":["data","meta"]},"MemoriesCreateResponse":{"type":"object","additionalProperties":false,"properties":{"data":{"$ref":"#/components/schemas/Memory"},"meta":{"$ref":"#/components/schemas/SuccessMeta"}},"required":["data","meta"]},"MemoriesGetResponse":{"type":"object","additionalProperties":false,"properties":{"data":{"$ref":"#/components/schemas/Memory"},"meta":{"$ref":"#/components/schemas/SuccessMeta"}},"required":["data","meta"]},"MemoriesUpdateResponse":{"type":"object","additionalProperties":false,"properties":{"data":{"$ref":"#/components/schemas/Memory"},"meta":{"$ref":"#/components/schemas/SuccessMeta"}},"required":["data","meta"]},"MemoriesGetConfigResponse":{"type":"object","additionalProperties":false,"properties":{"data":{"$ref":"#/components/schemas/Memory"},"meta":{"$ref":"#/components/schemas/SuccessMeta"}},"required":["data","meta"]},"MemoriesDeleteResponse":{"type":"object","additionalProperties":false,"properties":{"data":{"$ref":"#/components/schemas/CommandResult"},"meta":{"$ref":"#/components/schemas/SuccessMeta"}},"required":["data","meta"]},"MemoryMessagesListResponse":{"type":"object","additionalProperties":false,"properties":{"data":{"type":"array","items":{"$ref":"#/components/schemas/MemoryMessage"}},"meta":{"$ref":"#/components/schemas/SuccessMeta"}},"required":["data","meta"]},"MemoryMessagesSearchResponse":{"type":"object","additionalProperties":false,"properties":{"data":{"type":"array","items":{"$ref":"#/components/schemas/MemoryMessage"}},"meta":{"$ref":"#/components/schemas/SuccessMeta"}},"required":["data","meta"]},"MemoryMessagesRecentResponse":{"type":"object","additionalProperties":false,"properties":{"data":{"type":"array","items":{"$ref":"#/components/schemas/MemoryMessage"}},"meta":{"$ref":"#/components/schemas/SuccessMeta"}},"required":["data","meta"]},"MemoryMessagesGetContentResponse":{"type":"object","additionalProperties":false,"properties":{"data":{"$ref":"#/components/schemas/MemoryMessage"},"meta":{"$ref":"#/components/schemas/SuccessMeta"}},"required":["data","meta"]},"MemoryMessagesCreateResponse":{"type":"object","additionalProperties":false,"properties":{"data":{"$ref":"#/components/schemas/CommandResult"},"meta":{"$ref":"#/components/schemas/SuccessMeta"}},"required":["data","meta"]},"MemoryMessagesBatchCreateResponse":{"type":"object","additionalProperties":false,"properties":{"data":{"$ref":"#/components/schemas/CommandResult"},"meta":{"$ref":"#/components/schemas/SuccessMeta"}},"required":["data","meta"]},"MemoryMessagesUpdateResponse":{"type":"object","additionalProperties":false,"properties":{"data":{"$ref":"#/components/schemas/CommandResult"},"meta":{"$ref":"#/components/schemas/SuccessMeta"}},"required":["data","meta"]},"MemoryMessagesDeleteResponse":{"type":"object","additionalProperties":false,"properties":{"data":{"$ref":"#/components/schemas/CommandResult"},"meta":{"$ref":"#/components/schemas/SuccessMeta"}},"required":["data","meta"]},"ErrorEnvelope":{"type":"object","additionalProperties":false,"required":["error"],"properties":{"error":{"type":"object","additionalProperties":false,"required":["code","message","requestId","retryable"],"properties":{"code":{"type":"string"},"message":{"type":"string"},"requestId":{"type":"string"},"details":{},"retryable":{"type":"boolean"}}}}}}
const OPERATION_RESPONSE_SCHEMAS: Record<string, unknown> = {"authorization.context":{"$ref":"#/components/schemas/AuthorizationContextResponse"},"retrieval.search":{"$ref":"#/components/schemas/RetrievalSearchResponse"},"datasets.list":{"$ref":"#/components/schemas/DatasetsListResponse"},"datasets.create":{"$ref":"#/components/schemas/DatasetsCreateResponse"},"datasets.get":{"$ref":"#/components/schemas/DatasetsGetResponse"},"datasets.update":{"$ref":"#/components/schemas/DatasetsUpdateResponse"},"datasets.delete":{"$ref":"#/components/schemas/DatasetsDeleteResponse"},"datasets.batchDelete":{"$ref":"#/components/schemas/DatasetsBatchDeleteResponse"},"datasets.getMetadataConfig":{"$ref":"#/components/schemas/DatasetsGetMetadataConfigResponse"},"datasets.updateMetadataConfig":{"$ref":"#/components/schemas/DatasetsUpdateMetadataConfigResponse"},"documents.list":{"$ref":"#/components/schemas/DocumentsListResponse"},"documents.upload":{"$ref":"#/components/schemas/DocumentsUploadResponse"},"documents.get":{"$ref":"#/components/schemas/DocumentsGetResponse"},"documents.update":{"$ref":"#/components/schemas/DocumentsUpdateResponse"},"documents.delete":{"$ref":"#/components/schemas/DocumentsDeleteResponse"},"documents.batchDelete":{"$ref":"#/components/schemas/DocumentsBatchDeleteResponse"},"documents.startParse":{"$ref":"#/components/schemas/DocumentsStartParseResponse"},"documents.cancelParse":{"$ref":"#/components/schemas/DocumentsCancelParseResponse"},"chunks.list":{"$ref":"#/components/schemas/ChunksListResponse"},"chunks.create":{"$ref":"#/components/schemas/ChunksCreateResponse"},"chunks.get":{"$ref":"#/components/schemas/ChunksGetResponse"},"chunks.update":{"$ref":"#/components/schemas/ChunksUpdateResponse"},"chunks.delete":{"$ref":"#/components/schemas/ChunksDeleteResponse"},"chunks.batchDelete":{"$ref":"#/components/schemas/ChunksBatchDeleteResponse"},"chats.list":{"$ref":"#/components/schemas/ChatsListResponse"},"chats.create":{"$ref":"#/components/schemas/ChatsCreateResponse"},"chats.get":{"$ref":"#/components/schemas/ChatsGetResponse"},"chats.update":{"$ref":"#/components/schemas/ChatsUpdateResponse"},"chats.delete":{"$ref":"#/components/schemas/ChatsDeleteResponse"},"chats.batchDelete":{"$ref":"#/components/schemas/ChatsBatchDeleteResponse"},"chatSessions.list":{"$ref":"#/components/schemas/ChatSessionsListResponse"},"chatSessions.create":{"$ref":"#/components/schemas/ChatSessionsCreateResponse"},"chatSessions.get":{"$ref":"#/components/schemas/ChatSessionsGetResponse"},"chatSessions.update":{"$ref":"#/components/schemas/ChatSessionsUpdateResponse"},"chatSessions.delete":{"$ref":"#/components/schemas/ChatSessionsDeleteResponse"},"chatSessions.batchDelete":{"$ref":"#/components/schemas/ChatSessionsBatchDeleteResponse"},"chatSessions.invoke":{"$ref":"#/components/schemas/ChatSessionsInvokeResponse"},"agents.list":{"$ref":"#/components/schemas/AgentsListResponse"},"agents.create":{"$ref":"#/components/schemas/AgentsCreateResponse"},"agents.get":{"$ref":"#/components/schemas/AgentsGetResponse"},"agents.update":{"$ref":"#/components/schemas/AgentsUpdateResponse"},"agents.delete":{"$ref":"#/components/schemas/AgentsDeleteResponse"},"agentSessions.list":{"$ref":"#/components/schemas/AgentSessionsListResponse"},"agentSessions.create":{"$ref":"#/components/schemas/AgentSessionsCreateResponse"},"agentSessions.get":{"$ref":"#/components/schemas/AgentSessionsGetResponse"},"agentSessions.delete":{"$ref":"#/components/schemas/AgentSessionsDeleteResponse"},"agentSessions.batchDelete":{"$ref":"#/components/schemas/AgentSessionsBatchDeleteResponse"},"agentSessions.invoke":{"$ref":"#/components/schemas/AgentSessionsInvokeResponse"},"memories.list":{"$ref":"#/components/schemas/MemoriesListResponse"},"memories.create":{"$ref":"#/components/schemas/MemoriesCreateResponse"},"memories.get":{"$ref":"#/components/schemas/MemoriesGetResponse"},"memories.update":{"$ref":"#/components/schemas/MemoriesUpdateResponse"},"memories.delete":{"$ref":"#/components/schemas/MemoriesDeleteResponse"},"memories.getConfig":{"$ref":"#/components/schemas/MemoriesGetConfigResponse"},"memoryMessages.list":{"$ref":"#/components/schemas/MemoryMessagesListResponse"},"memoryMessages.create":{"$ref":"#/components/schemas/MemoryMessagesCreateResponse"},"memoryMessages.batchCreate":{"$ref":"#/components/schemas/MemoryMessagesBatchCreateResponse"},"memoryMessages.search":{"$ref":"#/components/schemas/MemoryMessagesSearchResponse"},"memoryMessages.recent":{"$ref":"#/components/schemas/MemoryMessagesRecentResponse"},"memoryMessages.getContent":{"$ref":"#/components/schemas/MemoryMessagesGetContentResponse"},"memoryMessages.update":{"$ref":"#/components/schemas/MemoryMessagesUpdateResponse"},"memoryMessages.delete":{"$ref":"#/components/schemas/MemoryMessagesDeleteResponse"}}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function matchesType(value: unknown, type: unknown): boolean {
  if (Array.isArray(type)) return type.some(member => matchesType(value, member))
  if (type === 'null') return value === null
  if (type === 'array') return Array.isArray(value)
  if (type === 'object') return record(value)
  if (type === 'integer') return typeof value === 'number' && Number.isSafeInteger(value)
  if (type === 'number') return typeof value === 'number' && Number.isFinite(value)
  return typeof type !== 'string' || typeof value === type
}

function matchesSchema(value: unknown, schema: unknown): boolean {
  if (!record(schema) || Object.keys(schema).length === 0) return true
  if (typeof schema.$ref === 'string') {
    const target = OPENAPI_COMPONENT_SCHEMAS[schema.$ref.split('/').at(-1) ?? '']
    return target !== undefined && matchesSchema(value, target)
  }
  if (Array.isArray(schema.oneOf) && !schema.oneOf.some(member => matchesSchema(value, member))) return false
  if (Array.isArray(schema.anyOf) && !schema.anyOf.some(member => matchesSchema(value, member))) return false
  if (Array.isArray(schema.allOf) && !schema.allOf.every(member => matchesSchema(value, member))) return false
  if (Object.hasOwn(schema, 'const') && !Object.is(value, schema.const)) return false
  if (Array.isArray(schema.enum) && !schema.enum.some(member => Object.is(value, member))) return false
  if (schema.type !== undefined && !matchesType(value, schema.type)) return false
  if (Array.isArray(value)) {
    return schema.items === undefined || value.every(member => matchesSchema(member, schema.items))
  }
  if (!record(value)) return true
  const properties = record(schema.properties) ? schema.properties : {}
  if (Array.isArray(schema.required)) {
    for (const name of schema.required) if (typeof name !== 'string' || !Object.hasOwn(value, name)) return false
  }
  for (const [name, member] of Object.entries(value)) {
    if (Object.hasOwn(properties, name)) {
      if (!matchesSchema(member, properties[name])) return false
    } else if (schema.additionalProperties === false) {
      return false
    } else if (record(schema.additionalProperties) && !matchesSchema(member, schema.additionalProperties)) {
      return false
    }
  }
  return true
}

export function assertOperationResponse<O extends BusinessGatewayJsonOperation>(
  operation: O,
  value: unknown,
): asserts value is OpenApiSuccessEnvelope<OperationData<O>> {
  const schema = OPERATION_RESPONSE_SCHEMAS[operation]
  if (schema === undefined || !matchesSchema(value, schema)) {
    throw new TypeError('Business Gateway response does not match the generated ' + operation + ' schema')
  }
}

export function isOpenApiErrorEnvelope(value: unknown): value is OpenApiErrorEnvelope {
  return matchesSchema(value, OPENAPI_COMPONENT_SCHEMAS.ErrorEnvelope)
}
