/** Generated from contracts/knowledge-gateway.openapi.json. Do not edit. */
export type KnowledgeSpacePage = {
  "items": Array<KnowledgeSpace>
  "pagination": PaginationMeta
}
export type KnowledgeDocumentPage = {
  "items": Array<KnowledgeDocument>
  "pagination": PaginationMeta
}
export type BusinessId = string
export type Reason = string
export type SpaceStatus = "CREATING" | "ACTIVE" | "CREATE_FAILED" | "DISABLED" | "DELETING" | "DELETED" | "DELETE_FAILED"
export type DocumentStatus = "CREATING" | "ACTIVE" | "CREATE_FAILED" | "DISABLED" | "DELETING" | "DELETED"
export type VersionStatus = "CREATED" | "UPLOADING" | "UPLOADED" | "INGESTING" | "READY" | "FAILED" | "CANCELLED" | "RETIRED" | "DELETED"
export type OperationStatus = "PENDING" | "RUNNING" | "SUCCEEDED" | "FAILED" | "CANCELLED"
export type KnowledgeOperationType = "SPACE_CREATE" | "SPACE_UPDATE" | "SPACE_DELETE" | "DOCUMENT_UPLOAD" | "DOCUMENT_UPDATE" | "DOCUMENT_REPLACE" | "DOCUMENT_ENABLE" | "DOCUMENT_DISABLE" | "DOCUMENT_REINDEX" | "DOCUMENT_DELETE" | "OPERATION_CANCEL" | "OPERATION_RETRY"
export type KnowledgeFailureCode = "KNOWLEDGE_UNAUTHENTICATED" | "KNOWLEDGE_FORBIDDEN" | "KNOWLEDGE_NOT_FOUND" | "KNOWLEDGE_CONFLICT" | "KNOWLEDGE_OPERATION_PENDING" | "KNOWLEDGE_PROVIDER_UNAVAILABLE" | "KNOWLEDGE_INVALID_INPUT"
export type LocationPrecision = "EXACT_OFFSET" | "CHUNK_APPROXIMATE"
export type KnowledgeProfileCode = "enterprise-long-document"
export type SuccessMeta = {
  "success": true
  "requestId": string
  "traceId": string
  "timestamp": string
  "apiVersion": "v1"
  "pagination": null
  "error": null
}
export type DocumentMetadata = {
  "category"?: MetadataText
  "tags"?: Array<MetadataTag>
  "versionLabel"?: MetadataText
  "productCode"?: MetadataText
}
export type ListSpacesRequest = {
  "page"?: number
  "pageSize"?: number
}
export type ListDocumentsRequest = {
  "page"?: number
  "pageSize"?: number
}
export type CitationContextRequest = {
  "contextBefore"?: number
  "contextAfter"?: number
}
export type RetrievalRequest = {
  "query": string
  "knowledgeSpaceIds"?: Array<BusinessId>
  "documentIds"?: Array<BusinessId>
  "limit"?: number
  "metadataFilter"?: MetadataFilter
}
export type KnowledgeSpaceCreateRequest = {
  "code": string
  "name": string
  "description"?: string
  "profileCode": KnowledgeProfileCode
  "defaultSecurityDomainCode": string
}
export type KnowledgeSpaceUpdateRequest = {
  "name"?: string
  "description"?: string
  "expectedVersion": number
}
export type KnowledgeDocumentUploadRequest = {
  "fileResourceId": string
  "documentName": string
  "metadata"?: DocumentMetadata
}
export type KnowledgeDocumentUpdateRequest = {
  "name"?: string
  "metadata"?: DocumentMetadataPatch
  "expectedVersion": number
}
export type KnowledgeDocumentReplaceRequest = {
  "fileResourceId": string
  "expectedVersion": number
  "reason"?: Reason
}
export type VersionedResourceRequest = {
  "expectedVersion": number
  "reason"?: Reason
}
export type DeleteResourceRequest = {
  "expectedVersion": number
  "reason": Reason
}
export type OperationReasonRequest = {
  "reason": Reason
}
export type EmptyRequest = {

}
export type KnowledgeSearchToolInput = RetrievalRequest
export type KnowledgeSpaceListToolInput = ListSpacesRequest
export type KnowledgeSpaceGetToolInput = {
  "knowledgeSpaceId": BusinessId
}
export type KnowledgeSpaceCreateToolInput = KnowledgeSpaceCreateRequest
export type KnowledgeSpaceUpdateToolInput = {
  "knowledgeSpaceId": BusinessId
  "name"?: string
  "description"?: string
  "expectedVersion": number
}
export type KnowledgeSpaceDeleteToolInput = {
  "knowledgeSpaceId": BusinessId
  "expectedVersion": number
  "reason": Reason
}
export type KnowledgeDocumentListToolInput = {
  "knowledgeSpaceId": BusinessId
  "page"?: number
  "pageSize"?: number
}
export type KnowledgeDocumentGetToolInput = {
  "documentId": BusinessId
}
export type KnowledgeDocumentUploadToolInput = {
  "knowledgeSpaceId": BusinessId
  "fileResourceId": string
  "documentName": string
  "metadata"?: DocumentMetadata
}
export type KnowledgeDocumentUpdateToolInput = {
  "documentId": BusinessId
  "name"?: string
  "metadata"?: DocumentMetadataPatch
  "expectedVersion": number
}
export type KnowledgeDocumentReplaceToolInput = {
  "documentId": BusinessId
  "fileResourceId": string
  "expectedVersion": number
  "reason"?: Reason
}
export type KnowledgeDocumentEnableToolInput = {
  "documentId": BusinessId
  "expectedVersion": number
  "reason"?: Reason
}
export type KnowledgeDocumentDisableToolInput = KnowledgeDocumentEnableToolInput
export type KnowledgeDocumentReindexToolInput = KnowledgeDocumentEnableToolInput
export type KnowledgeDocumentDeleteToolInput = {
  "documentId": BusinessId
  "expectedVersion": number
  "reason": Reason
}
export type KnowledgeDocumentDownloadToolInput = KnowledgeDocumentGetToolInput
export type KnowledgeSourceReadToolInput = {
  "citationId": BusinessId
  "contextBefore"?: number
  "contextAfter"?: number
}
export type KnowledgeOperationGetToolInput = {
  "operationId": BusinessId
}
export type KnowledgeOperationCancelToolInput = {
  "operationId": BusinessId
  "reason": Reason
}
export type KnowledgeOperationRetryToolInput = KnowledgeOperationCancelToolInput
export type KnowledgeSpace = {
  "spaceId": BusinessId
  "code": string
  "name": string
  "description"?: string
  "profileCode"?: KnowledgeProfileCode
  "defaultSecurityDomainCode"?: string
  "status": SpaceStatus
  "version": number
}
export type KnowledgeSpaceCreated = {
  "spaceId": BusinessId
  "code": string
  "name": string
  "status": SpaceStatus
  "version": number
}
export type KnowledgeSpaceList = {
  "items": Array<KnowledgeSpace>
}
export type KnowledgeDocumentVersion = {
  "versionId": BusinessId
  "versionNumber": number
  "status": VersionStatus
  "fileName": string
  "mimeType": string
  "fileSize": number
  "failureCode"?: KnowledgeFailureCode
}
export type KnowledgeDocument = {
  "documentId": BusinessId
  "knowledgeSpaceId": BusinessId
  "name": string
  "status": DocumentStatus
  "version": number
  "metadata": DocumentMetadataOutput
  "activeVersion": KnowledgeDocumentVersion | null
}
export type KnowledgeDocumentList = {
  "items": Array<KnowledgeDocument>
}
export type RetrievalHit = {
  "citationId": BusinessId
  "documentId": BusinessId
  "documentName": string
  "chapterPath": Array<string>
  "content": string
  "score": number
  "locationPrecision"?: LocationPrecision
  "page"?: number
  "metadata": DocumentMetadataOutput
}
export type RetrievalResult = RetrievalMatches | RetrievalEmpty
export type CitationSource = {
  "citationId": BusinessId
  "documentId": BusinessId
  "versionId": BusinessId
  "documentName": string
  "chapterPath"?: Array<string>
  "pageStart"?: number
  "pageEnd"?: number
  "beforeContent": string
  "matchedContent": string
  "afterContent": string
  "requestedContextBefore": number
  "requestedContextAfter": number
  "actualContextBefore": number
  "actualContextAfter": number
  "matchedContentTruncated": boolean
  "locationPrecision": LocationPrecision
}
export type DownloadLink = {
  "documentId": BusinessId
  "versionId": BusinessId
  "fileName": string
  "mimeType": string
  "fileSize": number
  "downloadUrl": string
  "expiresAt": string
  "expiresInSeconds": 60
}
export type KnowledgeOperation = {
  "operationId": BusinessId
  "parentOperationId"?: BusinessId
  "status": OperationStatus
  "operationType": KnowledgeOperationType
  "resourceType"?: "SPACE" | "DOCUMENT" | "VERSION" | "OPERATION"
  "resourceId"?: BusinessId
  "manualRetryAttempt"?: number
  "createdAt": string
  "updatedAt"?: string
  "failureCode"?: KnowledgeFailureCode
  "nextPollAfterMs"?: number
  "retryable"?: boolean
  "retryCount"?: number
  "lastRetryAt"?: string | null
  "nextRetryAt"?: string | null
}
export type ManualRetryOperation = {
  "operationId": BusinessId
  "parentOperationId": BusinessId
  "status": OperationStatus
}
export type SpaceOperationAccepted = {
  "spaceId": BusinessId
  "operationId": BusinessId
  "status": OperationStatus
}
export type DocumentOperationAccepted = {
  "documentId": BusinessId
  "operationId": BusinessId
  "status": OperationStatus
}
export type KnowledgeSpaceListResponse = {
  "data": KnowledgeSpaceList
  "meta": ListSuccessMeta
}
export type KnowledgeSpaceResponse = {
  "data": KnowledgeSpace
  "meta": SuccessMeta
}
export type KnowledgeSpaceCreatedResponse = {
  "data": KnowledgeSpaceCreated
  "meta": SuccessMeta
}
export type SpaceOperationAcceptedResponse = {
  "data": SpaceOperationAccepted
  "meta": SuccessMeta
}
export type KnowledgeDocumentListResponse = {
  "data": KnowledgeDocumentList
  "meta": ListSuccessMeta
}
export type KnowledgeDocumentResponse = {
  "data": KnowledgeDocument
  "meta": SuccessMeta
}
export type DocumentOperationAcceptedResponse = {
  "data": DocumentOperationAccepted
  "meta": SuccessMeta
}
export type RetrievalResponse = {
  "data": RetrievalResult
  "meta": SuccessMeta
}
export type CitationSourceResponse = {
  "data": CitationSource
  "meta": SuccessMeta
}
export type DownloadLinkResponse = {
  "data": DownloadLink
  "meta": SuccessMeta
}
export type OperationResponse = {
  "data": KnowledgeOperation
  "meta": SuccessMeta
}
export type ManualRetryOperationResponse = {
  "data": ManualRetryOperation
  "meta": SuccessMeta
}
export type ErrorEnvelope = {
  "data": null
  "meta": ErrorMeta
}
export type RetrievalMatches = {
  "query": string
  "hits": Array<RetrievalHit>
  "traceId": BusinessId
}
export type RetrievalEmpty = {
  "query"?: string
  "hits": Array<RetrievalHit>
  "traceId"?: BusinessId
  "reason": "NO_AUTHORIZED_RELEVANT_EVIDENCE"
}
export type KnowledgeSpaceUpdated = {
  "spaceId": BusinessId
  "name": string
  "description"?: string
  "status": SpaceStatus
  "version": number
}
export type KnowledgeSpaceUpdatedResponse = {
  "data": KnowledgeSpaceUpdated
  "meta": SuccessMeta
}
export type MetadataText = string
export type MetadataTag = string
export type DocumentMetadataPatch = {
  "category"?: MetadataText | null
  "tags"?: Array<MetadataTag>
  "versionLabel"?: MetadataText | null
  "productCode"?: MetadataText | null
}
export type DocumentMetadataOutput = {
  "category": MetadataText | null
  "tags": Array<MetadataTag>
  "versionLabel": MetadataText | null
  "productCode": MetadataText | null
}
export type MetadataFilter = {
  "category"?: Array<MetadataText>
  "tagsAny"?: Array<MetadataTag>
  "tagsAll"?: Array<MetadataTag>
  "versionLabel"?: Array<MetadataText>
  "productCode"?: Array<MetadataText>
}
export type PaginationMeta = {
  "page": number
  "pageSize": number
  "totalItems": number
  "totalPages": number
  "hasNext": boolean
}
export type FieldError = {
  "field": string
  "reason": string
  "message": string
}
export type KnowledgeApiError = {
  "code": string
  "message": string
  "retryable": boolean
  "fieldErrors": Array<FieldError>
}
export type ListSuccessMeta = {
  "success": true
  "requestId": string
  "traceId": string
  "timestamp": string
  "apiVersion": "v1"
  "pagination": PaginationMeta
  "error": null
}
export type ErrorMeta = {
  "success": false
  "requestId": string
  "traceId": string
  "timestamp": string
  "apiVersion": "v1"
  "pagination": null
  "error": KnowledgeApiError
}
export type VersionError = {
  "code": string
  "message": string
  "retryable": boolean
}
export type DocumentVersionDetail = {
  "versionId": BusinessId
  "versionNo": number
  "changeType": "INITIAL_UPLOAD" | "REPLACE" | "REINDEX"
  "status": VersionStatus
  "fileName": string
  "mimeType": string
  "fileSize": number
  "operationId": BusinessId | null
  "operationStatus": OperationStatus | null
  "progressPercent": number | null
  "progressSource": "PROVIDER" | "TERMINAL_STATE" | "UNAVAILABLE"
  "progressUpdatedAt": string | null
  "retryable": boolean
  "error": VersionError | null
  "createdAt": string
  "processingStartedAt": string | null
  "readyAt": string | null
  "activatedAt": string | null
  "failedAt": string | null
  "cancelledAt": string | null
}
export type KnowledgeDocumentDetail = {
  "documentId": BusinessId
  "spaceId": BusinessId
  "name": string
  "status": DocumentStatus
  "searchable": boolean
  "metadata": DocumentMetadataOutput
  "lockVersion": number
  "activeVersion": DocumentVersionDetail | null
  "candidateVersion": DocumentVersionDetail | null
  "createdAt": string
  "updatedAt": string
}
export type KnowledgeDocumentDetailResponse = {
  "data": KnowledgeDocumentDetail
  "meta": SuccessMeta
}
export type DocumentDeleteRequest = {
  "expectedVersion": number
  "reason": Reason
}
export interface KnowledgeGatewayOperationMap {
  "knowledgeCitationRead": { method: "GET"; path: "/internal/v1/knowledge/citations/{citationId}"; tool: "knowledge_source_read"; actions: ["DOCUMENT_VIEW"]; risk: "read"; approval: "allow"; concurrency: "parallel"; response: CitationSource }
  "knowledgeDocumentCreateDownloadLink": { method: "POST"; path: "/internal/v1/knowledge/documents/{documentId}:create-download-link"; tool: "knowledge_document_download"; actions: ["DOCUMENT_DOWNLOAD"]; risk: "read"; approval: "ask"; concurrency: "parallel"; response: DownloadLink }
  "knowledgeDocumentDelete": { method: "POST"; path: "/internal/v1/knowledge/documents/{documentId}:delete"; tool: "knowledge_document_delete"; actions: ["DOCUMENT_DELETE"]; risk: "admin"; approval: "ask"; concurrency: "exclusive"; response: DocumentOperationAccepted }
  "knowledgeDocumentDisable": { method: "POST"; path: "/internal/v1/knowledge/documents/{documentId}:disable"; tool: "knowledge_document_disable"; actions: ["DOCUMENT_UPDATE"]; risk: "write"; approval: "ask"; concurrency: "exclusive"; response: KnowledgeDocument }
  "knowledgeDocumentEnable": { method: "POST"; path: "/internal/v1/knowledge/documents/{documentId}:enable"; tool: "knowledge_document_enable"; actions: ["DOCUMENT_UPDATE"]; risk: "write"; approval: "ask"; concurrency: "exclusive"; response: KnowledgeDocument }
  "knowledgeDocumentGet": { method: "GET"; path: "/internal/v1/knowledge/documents/{documentId}"; tool: "knowledge_document_get"; actions: ["DOCUMENT_VIEW"]; risk: "read"; approval: "allow"; concurrency: "parallel"; response: KnowledgeDocumentDetail }
  "knowledgeDocumentReindex": { method: "POST"; path: "/internal/v1/knowledge/documents/{documentId}:reindex"; tool: "knowledge_document_reindex"; actions: ["DOCUMENT_REINDEX"]; risk: "write"; approval: "ask"; concurrency: "exclusive"; response: DocumentOperationAccepted }
  "knowledgeDocumentReplace": { method: "POST"; path: "/internal/v1/knowledge/documents/{documentId}:replace"; tool: "knowledge_document_replace"; actions: ["DOCUMENT_UPDATE"]; risk: "write"; approval: "ask"; concurrency: "exclusive"; response: DocumentOperationAccepted }
  "knowledgeDocumentsList": { method: "GET"; path: "/internal/v1/knowledge/spaces/{spaceId}/documents"; tool: "knowledge_document_list"; actions: ["DOCUMENT_VIEW"]; risk: "read"; approval: "allow"; concurrency: "parallel"; response: KnowledgeDocumentList }
  "knowledgeDocumentUpdate": { method: "PATCH"; path: "/internal/v1/knowledge/documents/{documentId}"; tool: "knowledge_document_update"; actions: ["DOCUMENT_UPDATE"]; risk: "write"; approval: "allow"; concurrency: "exclusive"; response: KnowledgeDocument }
  "knowledgeDocumentUpload": { method: "POST"; path: "/internal/v1/knowledge/spaces/{spaceId}/documents"; tool: "knowledge_document_upload"; actions: ["DOCUMENT_UPLOAD"]; risk: "write"; approval: "allow"; concurrency: "exclusive"; response: DocumentOperationAccepted }
  "knowledgeOperationCancel": { method: "POST"; path: "/internal/v1/knowledge/operations/{operationId}:cancel"; tool: "knowledge_operation_cancel"; actions: ["ORIGINAL_OPERATION_PERMISSION"]; risk: "write"; approval: "ask"; concurrency: "exclusive"; response: KnowledgeOperation }
  "knowledgeOperationGet": { method: "GET"; path: "/internal/v1/knowledge/operations/{operationId}"; tool: "knowledge_operation_get"; actions: ["RESOURCE_VIEW"]; risk: "read"; approval: "allow"; concurrency: "parallel"; response: KnowledgeOperation }
  "knowledgeOperationRetry": { method: "POST"; path: "/internal/v1/knowledge/operations/{operationId}:retry"; tool: "knowledge_operation_retry"; actions: ["ORIGINAL_OPERATION_PERMISSION","OPERATION_RETRY"]; risk: "write"; approval: "ask"; concurrency: "exclusive"; response: ManualRetryOperation }
  "knowledgeSearch": { method: "POST"; path: "/internal/v1/knowledge/search"; tool: "knowledge_search"; actions: ["KNOWLEDGE_SEARCH"]; risk: "read"; approval: "allow"; concurrency: "parallel"; response: RetrievalResult }
  "knowledgeSpaceCreate": { method: "POST"; path: "/internal/v1/knowledge/spaces"; tool: "knowledge_space_create"; actions: ["SPACE_CREATE"]; risk: "admin"; approval: "ask"; concurrency: "exclusive"; response: KnowledgeSpaceCreated }
  "knowledgeSpaceDelete": { method: "POST"; path: "/internal/v1/knowledge/spaces/{spaceId}:delete"; tool: "knowledge_space_delete"; actions: ["SPACE_DELETE"]; risk: "admin"; approval: "ask"; concurrency: "exclusive"; response: SpaceOperationAccepted }
  "knowledgeSpaceGet": { method: "GET"; path: "/internal/v1/knowledge/spaces/{spaceId}"; tool: "knowledge_space_get"; actions: ["SPACE_VIEW"]; risk: "read"; approval: "allow"; concurrency: "parallel"; response: KnowledgeSpace }
  "knowledgeSpacesList": { method: "GET"; path: "/internal/v1/knowledge/spaces"; tool: "knowledge_space_list"; actions: ["SPACE_VIEW"]; risk: "read"; approval: "allow"; concurrency: "parallel"; response: KnowledgeSpaceList }
  "knowledgeSpaceUpdate": { method: "PATCH"; path: "/internal/v1/knowledge/spaces/{spaceId}"; tool: "knowledge_space_update"; actions: ["SPACE_UPDATE"]; risk: "admin"; approval: "ask"; concurrency: "exclusive"; response: KnowledgeSpaceUpdated }
}
export interface KnowledgeGatewayResponseDataMap {
  "knowledgeSpacesList": KnowledgeSpaceList
  "knowledgeSpaceCreate": KnowledgeSpaceCreated
  "knowledgeSpaceGet": KnowledgeSpace
  "knowledgeSpaceUpdate": KnowledgeSpaceUpdated
  "knowledgeSpaceDelete": SpaceOperationAccepted
  "knowledgeDocumentsList": KnowledgeDocumentList
  "knowledgeDocumentUpload": DocumentOperationAccepted
  "knowledgeDocumentGet": KnowledgeDocumentDetail
  "knowledgeDocumentUpdate": KnowledgeDocument
  "knowledgeDocumentReplace": DocumentOperationAccepted
  "knowledgeDocumentEnable": KnowledgeDocument
  "knowledgeDocumentDisable": KnowledgeDocument
  "knowledgeDocumentReindex": DocumentOperationAccepted
  "knowledgeDocumentDelete": DocumentOperationAccepted
  "knowledgeDocumentCreateDownloadLink": DownloadLink
  "knowledgeSearch": RetrievalResult
  "knowledgeCitationRead": CitationSource
  "knowledgeOperationGet": KnowledgeOperation
  "knowledgeOperationCancel": KnowledgeOperation
  "knowledgeOperationRetry": ManualRetryOperation
}
export type KnowledgeGatewayOperationId = keyof KnowledgeGatewayResponseDataMap
export type KnowledgeGatewayResponseData<Operation extends KnowledgeGatewayOperationId> = KnowledgeGatewayResponseDataMap[Operation]
export type KnowledgeGatewayData = KnowledgeGatewayResponseDataMap[KnowledgeGatewayOperationId] | KnowledgeSpacePage | KnowledgeDocumentPage
export type KnowledgeGatewayOperation = keyof KnowledgeGatewayOperationMap
export type KnowledgeGatewayRisk = KnowledgeGatewayOperationMap[KnowledgeGatewayOperation]['risk']
export const knowledgeGatewayRoutes = {
  "knowledgeSpacesList": {
    "method": "GET",
    "path": "/internal/v1/knowledge/spaces",
    "responseSchema": "KnowledgeSpaceListResponse",
    "dataSchema": "KnowledgeSpaceList",
    "idempotency": "none",
    "tool": "knowledge_space_list",
    "actions": [
      "SPACE_VIEW"
    ],
    "risk": "read",
    "approval": "allow",
    "concurrency": "parallel",
    "retrySafe": true,
    "toolSchema": "KnowledgeSpaceListToolInput",
    "querySchema": "ListSpacesRequest"
  },
  "knowledgeSpaceCreate": {
    "method": "POST",
    "path": "/internal/v1/knowledge/spaces",
    "responseSchema": "KnowledgeSpaceCreatedResponse",
    "dataSchema": "KnowledgeSpaceCreated",
    "idempotency": "required",
    "tool": "knowledge_space_create",
    "actions": [
      "SPACE_CREATE"
    ],
    "risk": "admin",
    "approval": "ask",
    "concurrency": "exclusive",
    "retrySafe": false,
    "toolSchema": "KnowledgeSpaceCreateToolInput",
    "requestSchema": "KnowledgeSpaceCreateRequest"
  },
  "knowledgeSpaceGet": {
    "method": "GET",
    "path": "/internal/v1/knowledge/spaces/{spaceId}",
    "responseSchema": "KnowledgeSpaceResponse",
    "dataSchema": "KnowledgeSpace",
    "idempotency": "none",
    "tool": "knowledge_space_get",
    "actions": [
      "SPACE_VIEW"
    ],
    "risk": "read",
    "approval": "allow",
    "concurrency": "parallel",
    "retrySafe": true,
    "toolSchema": "KnowledgeSpaceGetToolInput"
  },
  "knowledgeSpaceUpdate": {
    "method": "PATCH",
    "path": "/internal/v1/knowledge/spaces/{spaceId}",
    "responseSchema": "KnowledgeSpaceUpdatedResponse",
    "dataSchema": "KnowledgeSpaceUpdated",
    "idempotency": "required",
    "tool": "knowledge_space_update",
    "actions": [
      "SPACE_UPDATE"
    ],
    "risk": "admin",
    "approval": "ask",
    "concurrency": "exclusive",
    "retrySafe": false,
    "toolSchema": "KnowledgeSpaceUpdateToolInput",
    "requestSchema": "KnowledgeSpaceUpdateRequest"
  },
  "knowledgeSpaceDelete": {
    "method": "POST",
    "path": "/internal/v1/knowledge/spaces/{spaceId}:delete",
    "responseSchema": "SpaceOperationAcceptedResponse",
    "dataSchema": "SpaceOperationAccepted",
    "idempotency": "required",
    "tool": "knowledge_space_delete",
    "actions": [
      "SPACE_DELETE"
    ],
    "risk": "admin",
    "approval": "ask",
    "concurrency": "exclusive",
    "retrySafe": false,
    "toolSchema": "KnowledgeSpaceDeleteToolInput",
    "requestSchema": "DeleteResourceRequest"
  },
  "knowledgeDocumentsList": {
    "method": "GET",
    "path": "/internal/v1/knowledge/spaces/{spaceId}/documents",
    "responseSchema": "KnowledgeDocumentListResponse",
    "dataSchema": "KnowledgeDocumentList",
    "idempotency": "none",
    "tool": "knowledge_document_list",
    "actions": [
      "DOCUMENT_VIEW"
    ],
    "risk": "read",
    "approval": "allow",
    "concurrency": "parallel",
    "retrySafe": true,
    "toolSchema": "KnowledgeDocumentListToolInput",
    "querySchema": "ListDocumentsRequest"
  },
  "knowledgeDocumentUpload": {
    "method": "POST",
    "path": "/internal/v1/knowledge/spaces/{spaceId}/documents",
    "responseSchema": "DocumentOperationAcceptedResponse",
    "dataSchema": "DocumentOperationAccepted",
    "idempotency": "required",
    "tool": "knowledge_document_upload",
    "actions": [
      "DOCUMENT_UPLOAD"
    ],
    "risk": "write",
    "approval": "allow",
    "concurrency": "exclusive",
    "retrySafe": false,
    "toolSchema": "KnowledgeDocumentUploadToolInput",
    "requestSchema": "KnowledgeDocumentUploadRequest"
  },
  "knowledgeDocumentGet": {
    "method": "GET",
    "path": "/internal/v1/knowledge/documents/{documentId}",
    "responseSchema": "KnowledgeDocumentDetailResponse",
    "dataSchema": "KnowledgeDocumentDetail",
    "idempotency": "none",
    "tool": "knowledge_document_get",
    "actions": [
      "DOCUMENT_VIEW"
    ],
    "risk": "read",
    "approval": "allow",
    "concurrency": "parallel",
    "retrySafe": true,
    "toolSchema": "KnowledgeDocumentGetToolInput"
  },
  "knowledgeDocumentUpdate": {
    "method": "PATCH",
    "path": "/internal/v1/knowledge/documents/{documentId}",
    "responseSchema": "KnowledgeDocumentResponse",
    "dataSchema": "KnowledgeDocument",
    "idempotency": "required",
    "tool": "knowledge_document_update",
    "actions": [
      "DOCUMENT_UPDATE"
    ],
    "risk": "write",
    "approval": "allow",
    "concurrency": "exclusive",
    "retrySafe": false,
    "toolSchema": "KnowledgeDocumentUpdateToolInput",
    "requestSchema": "KnowledgeDocumentUpdateRequest"
  },
  "knowledgeDocumentReplace": {
    "method": "POST",
    "path": "/internal/v1/knowledge/documents/{documentId}:replace",
    "responseSchema": "DocumentOperationAcceptedResponse",
    "dataSchema": "DocumentOperationAccepted",
    "idempotency": "required",
    "tool": "knowledge_document_replace",
    "actions": [
      "DOCUMENT_UPDATE"
    ],
    "risk": "write",
    "approval": "ask",
    "concurrency": "exclusive",
    "retrySafe": false,
    "toolSchema": "KnowledgeDocumentReplaceToolInput",
    "requestSchema": "KnowledgeDocumentReplaceRequest"
  },
  "knowledgeDocumentEnable": {
    "method": "POST",
    "path": "/internal/v1/knowledge/documents/{documentId}:enable",
    "responseSchema": "KnowledgeDocumentResponse",
    "dataSchema": "KnowledgeDocument",
    "idempotency": "required",
    "tool": "knowledge_document_enable",
    "actions": [
      "DOCUMENT_UPDATE"
    ],
    "risk": "write",
    "approval": "ask",
    "concurrency": "exclusive",
    "retrySafe": false,
    "toolSchema": "KnowledgeDocumentEnableToolInput",
    "requestSchema": "VersionedResourceRequest"
  },
  "knowledgeDocumentDisable": {
    "method": "POST",
    "path": "/internal/v1/knowledge/documents/{documentId}:disable",
    "responseSchema": "KnowledgeDocumentResponse",
    "dataSchema": "KnowledgeDocument",
    "idempotency": "required",
    "tool": "knowledge_document_disable",
    "actions": [
      "DOCUMENT_UPDATE"
    ],
    "risk": "write",
    "approval": "ask",
    "concurrency": "exclusive",
    "retrySafe": false,
    "toolSchema": "KnowledgeDocumentDisableToolInput",
    "requestSchema": "VersionedResourceRequest"
  },
  "knowledgeDocumentReindex": {
    "method": "POST",
    "path": "/internal/v1/knowledge/documents/{documentId}:reindex",
    "responseSchema": "DocumentOperationAcceptedResponse",
    "dataSchema": "DocumentOperationAccepted",
    "idempotency": "required",
    "tool": "knowledge_document_reindex",
    "actions": [
      "DOCUMENT_REINDEX"
    ],
    "risk": "write",
    "approval": "ask",
    "concurrency": "exclusive",
    "retrySafe": false,
    "toolSchema": "KnowledgeDocumentReindexToolInput",
    "requestSchema": "VersionedResourceRequest"
  },
  "knowledgeDocumentDelete": {
    "method": "POST",
    "path": "/internal/v1/knowledge/documents/{documentId}:delete",
    "responseSchema": "DocumentOperationAcceptedResponse",
    "dataSchema": "DocumentOperationAccepted",
    "idempotency": "required",
    "tool": "knowledge_document_delete",
    "actions": [
      "DOCUMENT_DELETE"
    ],
    "risk": "admin",
    "approval": "ask",
    "concurrency": "exclusive",
    "retrySafe": false,
    "toolSchema": "KnowledgeDocumentDeleteToolInput",
    "requestSchema": "DocumentDeleteRequest"
  },
  "knowledgeDocumentCreateDownloadLink": {
    "method": "POST",
    "path": "/internal/v1/knowledge/documents/{documentId}:create-download-link",
    "responseSchema": "DownloadLinkResponse",
    "dataSchema": "DownloadLink",
    "idempotency": "none",
    "tool": "knowledge_document_download",
    "actions": [
      "DOCUMENT_DOWNLOAD"
    ],
    "risk": "read",
    "approval": "ask",
    "concurrency": "parallel",
    "retrySafe": false,
    "toolSchema": "KnowledgeDocumentDownloadToolInput",
    "requestSchema": "EmptyRequest"
  },
  "knowledgeSearch": {
    "method": "POST",
    "path": "/internal/v1/knowledge/search",
    "responseSchema": "RetrievalResponse",
    "dataSchema": "RetrievalResult",
    "idempotency": "none",
    "tool": "knowledge_search",
    "actions": [
      "KNOWLEDGE_SEARCH"
    ],
    "risk": "read",
    "approval": "allow",
    "concurrency": "parallel",
    "retrySafe": true,
    "toolSchema": "KnowledgeSearchToolInput",
    "requestSchema": "RetrievalRequest"
  },
  "knowledgeCitationRead": {
    "method": "GET",
    "path": "/internal/v1/knowledge/citations/{citationId}",
    "responseSchema": "CitationSourceResponse",
    "dataSchema": "CitationSource",
    "idempotency": "none",
    "tool": "knowledge_source_read",
    "actions": [
      "DOCUMENT_VIEW"
    ],
    "risk": "read",
    "approval": "allow",
    "concurrency": "parallel",
    "retrySafe": true,
    "toolSchema": "KnowledgeSourceReadToolInput",
    "querySchema": "CitationContextRequest"
  },
  "knowledgeOperationGet": {
    "method": "GET",
    "path": "/internal/v1/knowledge/operations/{operationId}",
    "responseSchema": "OperationResponse",
    "dataSchema": "KnowledgeOperation",
    "idempotency": "none",
    "tool": "knowledge_operation_get",
    "actions": [
      "RESOURCE_VIEW"
    ],
    "risk": "read",
    "approval": "allow",
    "concurrency": "parallel",
    "retrySafe": true,
    "toolSchema": "KnowledgeOperationGetToolInput"
  },
  "knowledgeOperationCancel": {
    "method": "POST",
    "path": "/internal/v1/knowledge/operations/{operationId}:cancel",
    "responseSchema": "OperationResponse",
    "dataSchema": "KnowledgeOperation",
    "idempotency": "required",
    "tool": "knowledge_operation_cancel",
    "actions": [
      "ORIGINAL_OPERATION_PERMISSION"
    ],
    "risk": "write",
    "approval": "ask",
    "concurrency": "exclusive",
    "retrySafe": false,
    "toolSchema": "KnowledgeOperationCancelToolInput",
    "requestSchema": "OperationReasonRequest"
  },
  "knowledgeOperationRetry": {
    "method": "POST",
    "path": "/internal/v1/knowledge/operations/{operationId}:retry",
    "responseSchema": "ManualRetryOperationResponse",
    "dataSchema": "ManualRetryOperation",
    "idempotency": "required",
    "tool": "knowledge_operation_retry",
    "actions": [
      "ORIGINAL_OPERATION_PERMISSION",
      "OPERATION_RETRY"
    ],
    "risk": "write",
    "approval": "ask",
    "concurrency": "exclusive",
    "retrySafe": false,
    "toolSchema": "KnowledgeOperationRetryToolInput",
    "requestSchema": "OperationReasonRequest"
  }
} as const
export const knowledgeGatewaySchemas = {
  "KnowledgeSpacePage": {
    "type": "object",
    "additionalProperties": false,
    "required": [
      "items",
      "pagination"
    ],
    "properties": {
      "items": {
        "type": "array",
        "maxItems": 20,
        "items": {
          "$ref": "#/components/schemas/KnowledgeSpace"
        }
      },
      "pagination": {
        "$ref": "#/components/schemas/PaginationMeta"
      }
    }
  },
  "KnowledgeDocumentPage": {
    "type": "object",
    "additionalProperties": false,
    "required": [
      "items",
      "pagination"
    ],
    "properties": {
      "items": {
        "type": "array",
        "maxItems": 20,
        "items": {
          "$ref": "#/components/schemas/KnowledgeDocument"
        }
      },
      "pagination": {
        "$ref": "#/components/schemas/PaginationMeta"
      }
    }
  },
  "BusinessId": {
    "type": "string",
    "minLength": 1,
    "maxLength": 256,
    "pattern": "^[^\\s]+$"
  },
  "Reason": {
    "type": "string",
    "minLength": 1,
    "maxLength": 1024
  },
  "SpaceStatus": {
    "type": "string",
    "enum": [
      "CREATING",
      "ACTIVE",
      "CREATE_FAILED",
      "DISABLED",
      "DELETING",
      "DELETED",
      "DELETE_FAILED"
    ]
  },
  "DocumentStatus": {
    "type": "string",
    "enum": [
      "CREATING",
      "ACTIVE",
      "CREATE_FAILED",
      "DISABLED",
      "DELETING",
      "DELETED"
    ]
  },
  "VersionStatus": {
    "type": "string",
    "enum": [
      "CREATED",
      "UPLOADING",
      "UPLOADED",
      "INGESTING",
      "READY",
      "FAILED",
      "CANCELLED",
      "RETIRED",
      "DELETED"
    ]
  },
  "OperationStatus": {
    "type": "string",
    "enum": [
      "PENDING",
      "RUNNING",
      "SUCCEEDED",
      "FAILED",
      "CANCELLED"
    ]
  },
  "KnowledgeOperationType": {
    "type": "string",
    "enum": [
      "SPACE_CREATE",
      "SPACE_UPDATE",
      "SPACE_DELETE",
      "DOCUMENT_UPLOAD",
      "DOCUMENT_UPDATE",
      "DOCUMENT_REPLACE",
      "DOCUMENT_ENABLE",
      "DOCUMENT_DISABLE",
      "DOCUMENT_REINDEX",
      "DOCUMENT_DELETE",
      "OPERATION_CANCEL",
      "OPERATION_RETRY"
    ]
  },
  "KnowledgeFailureCode": {
    "type": "string",
    "enum": [
      "KNOWLEDGE_UNAUTHENTICATED",
      "KNOWLEDGE_FORBIDDEN",
      "KNOWLEDGE_NOT_FOUND",
      "KNOWLEDGE_CONFLICT",
      "KNOWLEDGE_OPERATION_PENDING",
      "KNOWLEDGE_PROVIDER_UNAVAILABLE",
      "KNOWLEDGE_INVALID_INPUT"
    ]
  },
  "LocationPrecision": {
    "type": "string",
    "enum": [
      "EXACT_OFFSET",
      "CHUNK_APPROXIMATE"
    ]
  },
  "KnowledgeProfileCode": {
    "type": "string",
    "const": "enterprise-long-document"
  },
  "SuccessMeta": {
    "type": "object",
    "additionalProperties": false,
    "required": [
      "success",
      "requestId",
      "traceId",
      "timestamp",
      "apiVersion",
      "pagination",
      "error"
    ],
    "properties": {
      "success": {
        "type": "boolean",
        "const": true
      },
      "requestId": {
        "type": "string",
        "minLength": 1,
        "maxLength": 128
      },
      "traceId": {
        "type": "string",
        "minLength": 1,
        "maxLength": 128
      },
      "timestamp": {
        "type": "string",
        "format": "date-time",
        "pattern": "Z$"
      },
      "apiVersion": {
        "type": "string",
        "const": "v1"
      },
      "pagination": {
        "type": "null"
      },
      "error": {
        "type": "null"
      }
    }
  },
  "DocumentMetadata": {
    "type": "object",
    "additionalProperties": false,
    "required": [],
    "properties": {
      "category": {
        "$ref": "#/components/schemas/MetadataText"
      },
      "tags": {
        "type": "array",
        "maxItems": 20,
        "uniqueItems": true,
        "items": {
          "$ref": "#/components/schemas/MetadataTag"
        }
      },
      "versionLabel": {
        "$ref": "#/components/schemas/MetadataText"
      },
      "productCode": {
        "$ref": "#/components/schemas/MetadataText"
      }
    }
  },
  "ListSpacesRequest": {
    "type": "object",
    "additionalProperties": false,
    "required": [],
    "properties": {
      "page": {
        "type": "integer",
        "minimum": 1,
        "default": 1
      },
      "pageSize": {
        "type": "integer",
        "minimum": 1,
        "maximum": 100,
        "default": 20
      }
    }
  },
  "ListDocumentsRequest": {
    "type": "object",
    "additionalProperties": false,
    "required": [],
    "properties": {
      "page": {
        "type": "integer",
        "minimum": 1,
        "default": 1
      },
      "pageSize": {
        "type": "integer",
        "minimum": 1,
        "maximum": 100,
        "default": 20
      }
    }
  },
  "CitationContextRequest": {
    "type": "object",
    "additionalProperties": false,
    "properties": {
      "contextBefore": {
        "type": "integer",
        "minimum": 0,
        "maximum": 5000,
        "default": 1000,
        "description": "Unicode code points before the match in the normalized document."
      },
      "contextAfter": {
        "type": "integer",
        "minimum": 0,
        "maximum": 5000,
        "default": 1000,
        "description": "Unicode code points after the match in the normalized document."
      }
    }
  },
  "RetrievalRequest": {
    "type": "object",
    "additionalProperties": false,
    "required": [
      "query"
    ],
    "properties": {
      "query": {
        "type": "string",
        "minLength": 1,
        "maxLength": 4096
      },
      "knowledgeSpaceIds": {
        "type": "array",
        "minItems": 1,
        "maxItems": 20,
        "uniqueItems": true,
        "items": {
          "$ref": "#/components/schemas/BusinessId"
        }
      },
      "documentIds": {
        "type": "array",
        "minItems": 0,
        "maxItems": 20,
        "uniqueItems": true,
        "items": {
          "$ref": "#/components/schemas/BusinessId"
        }
      },
      "limit": {
        "type": "integer",
        "minimum": 1,
        "maximum": 8,
        "default": 8
      },
      "metadataFilter": {
        "$ref": "#/components/schemas/MetadataFilter"
      }
    }
  },
  "KnowledgeSpaceCreateRequest": {
    "type": "object",
    "additionalProperties": false,
    "required": [
      "code",
      "name",
      "profileCode",
      "defaultSecurityDomainCode"
    ],
    "properties": {
      "code": {
        "type": "string",
        "minLength": 1,
        "maxLength": 64,
        "pattern": "^[^\\s]+$"
      },
      "name": {
        "type": "string",
        "minLength": 1,
        "maxLength": 128
      },
      "description": {
        "type": "string",
        "maxLength": 1000
      },
      "profileCode": {
        "$ref": "#/components/schemas/KnowledgeProfileCode"
      },
      "defaultSecurityDomainCode": {
        "type": "string",
        "minLength": 1,
        "maxLength": 100,
        "pattern": "^[^\\s]+$"
      }
    }
  },
  "KnowledgeSpaceUpdateRequest": {
    "type": "object",
    "additionalProperties": false,
    "required": [
      "expectedVersion"
    ],
    "properties": {
      "name": {
        "type": "string",
        "minLength": 1,
        "maxLength": 128
      },
      "description": {
        "type": "string",
        "maxLength": 1000
      },
      "expectedVersion": {
        "type": "integer",
        "minimum": 1
      }
    }
  },
  "KnowledgeDocumentUploadRequest": {
    "type": "object",
    "additionalProperties": false,
    "required": [
      "fileResourceId",
      "documentName"
    ],
    "properties": {
      "fileResourceId": {
        "type": "string",
        "minLength": 1,
        "maxLength": 128,
        "pattern": "^[^\\s]+$"
      },
      "documentName": {
        "type": "string",
        "minLength": 1,
        "maxLength": 255
      },
      "metadata": {
        "$ref": "#/components/schemas/DocumentMetadata"
      }
    }
  },
  "KnowledgeDocumentUpdateRequest": {
    "type": "object",
    "additionalProperties": false,
    "required": [
      "expectedVersion"
    ],
    "properties": {
      "name": {
        "type": "string",
        "minLength": 1,
        "maxLength": 255
      },
      "metadata": {
        "$ref": "#/components/schemas/DocumentMetadataPatch"
      },
      "expectedVersion": {
        "type": "integer",
        "minimum": 0,
        "description": "Use the document detail lockVersion (or summary version), including zero."
      }
    },
    "examples": [
      {
        "expectedVersion": 0,
        "metadata": {
          "category": "company-policy",
          "versionLabel": null,
          "tags": []
        }
      }
    ]
  },
  "KnowledgeDocumentReplaceRequest": {
    "type": "object",
    "additionalProperties": false,
    "required": [
      "fileResourceId",
      "expectedVersion"
    ],
    "properties": {
      "fileResourceId": {
        "type": "string",
        "minLength": 1,
        "maxLength": 128,
        "pattern": "^[^\\s]+$"
      },
      "expectedVersion": {
        "type": "integer",
        "minimum": 0,
        "description": "Use the document detail lockVersion (or summary version), including zero."
      },
      "reason": {
        "$ref": "#/components/schemas/Reason"
      }
    }
  },
  "VersionedResourceRequest": {
    "type": "object",
    "additionalProperties": false,
    "required": [
      "expectedVersion"
    ],
    "properties": {
      "expectedVersion": {
        "type": "integer",
        "minimum": 0
      },
      "reason": {
        "$ref": "#/components/schemas/Reason"
      }
    }
  },
  "DeleteResourceRequest": {
    "type": "object",
    "additionalProperties": false,
    "required": [
      "expectedVersion",
      "reason"
    ],
    "properties": {
      "expectedVersion": {
        "type": "integer",
        "minimum": 1
      },
      "reason": {
        "$ref": "#/components/schemas/Reason"
      }
    }
  },
  "OperationReasonRequest": {
    "type": "object",
    "additionalProperties": false,
    "required": [
      "reason"
    ],
    "properties": {
      "reason": {
        "$ref": "#/components/schemas/Reason"
      }
    }
  },
  "EmptyRequest": {
    "type": "object",
    "additionalProperties": false,
    "properties": {}
  },
  "KnowledgeSearchToolInput": {
    "$ref": "#/components/schemas/RetrievalRequest"
  },
  "KnowledgeSpaceListToolInput": {
    "$ref": "#/components/schemas/ListSpacesRequest"
  },
  "KnowledgeSpaceGetToolInput": {
    "type": "object",
    "additionalProperties": false,
    "required": [
      "knowledgeSpaceId"
    ],
    "properties": {
      "knowledgeSpaceId": {
        "$ref": "#/components/schemas/BusinessId"
      }
    }
  },
  "KnowledgeSpaceCreateToolInput": {
    "$ref": "#/components/schemas/KnowledgeSpaceCreateRequest"
  },
  "KnowledgeSpaceUpdateToolInput": {
    "type": "object",
    "additionalProperties": false,
    "required": [
      "knowledgeSpaceId",
      "expectedVersion"
    ],
    "properties": {
      "knowledgeSpaceId": {
        "$ref": "#/components/schemas/BusinessId"
      },
      "name": {
        "type": "string",
        "minLength": 1,
        "maxLength": 128
      },
      "description": {
        "type": "string",
        "maxLength": 1000
      },
      "expectedVersion": {
        "type": "integer",
        "minimum": 1
      }
    }
  },
  "KnowledgeSpaceDeleteToolInput": {
    "type": "object",
    "additionalProperties": false,
    "required": [
      "knowledgeSpaceId",
      "expectedVersion",
      "reason"
    ],
    "properties": {
      "knowledgeSpaceId": {
        "$ref": "#/components/schemas/BusinessId"
      },
      "expectedVersion": {
        "type": "integer",
        "minimum": 1
      },
      "reason": {
        "$ref": "#/components/schemas/Reason"
      }
    }
  },
  "KnowledgeDocumentListToolInput": {
    "type": "object",
    "additionalProperties": false,
    "required": [
      "knowledgeSpaceId"
    ],
    "properties": {
      "knowledgeSpaceId": {
        "$ref": "#/components/schemas/BusinessId"
      },
      "page": {
        "type": "integer",
        "minimum": 1,
        "default": 1
      },
      "pageSize": {
        "type": "integer",
        "minimum": 1,
        "maximum": 100,
        "default": 20
      }
    }
  },
  "KnowledgeDocumentGetToolInput": {
    "type": "object",
    "additionalProperties": false,
    "required": [
      "documentId"
    ],
    "properties": {
      "documentId": {
        "$ref": "#/components/schemas/BusinessId"
      }
    }
  },
  "KnowledgeDocumentUploadToolInput": {
    "type": "object",
    "additionalProperties": false,
    "required": [
      "knowledgeSpaceId",
      "fileResourceId",
      "documentName"
    ],
    "properties": {
      "knowledgeSpaceId": {
        "$ref": "#/components/schemas/BusinessId"
      },
      "fileResourceId": {
        "type": "string",
        "minLength": 1,
        "maxLength": 128,
        "pattern": "^[^\\s]+$"
      },
      "documentName": {
        "type": "string",
        "minLength": 1,
        "maxLength": 255
      },
      "metadata": {
        "$ref": "#/components/schemas/DocumentMetadata"
      }
    }
  },
  "KnowledgeDocumentUpdateToolInput": {
    "type": "object",
    "additionalProperties": false,
    "required": [
      "documentId",
      "expectedVersion"
    ],
    "properties": {
      "documentId": {
        "$ref": "#/components/schemas/BusinessId"
      },
      "name": {
        "type": "string",
        "minLength": 1,
        "maxLength": 255
      },
      "metadata": {
        "$ref": "#/components/schemas/DocumentMetadataPatch"
      },
      "expectedVersion": {
        "type": "integer",
        "minimum": 0,
        "description": "Use the document detail lockVersion (or summary version), including zero."
      }
    }
  },
  "KnowledgeDocumentReplaceToolInput": {
    "type": "object",
    "additionalProperties": false,
    "required": [
      "documentId",
      "fileResourceId",
      "expectedVersion"
    ],
    "properties": {
      "documentId": {
        "$ref": "#/components/schemas/BusinessId"
      },
      "fileResourceId": {
        "type": "string",
        "minLength": 1,
        "maxLength": 128,
        "pattern": "^[^\\s]+$"
      },
      "expectedVersion": {
        "type": "integer",
        "minimum": 0,
        "description": "Use the document detail lockVersion (or summary version), including zero."
      },
      "reason": {
        "$ref": "#/components/schemas/Reason"
      }
    }
  },
  "KnowledgeDocumentEnableToolInput": {
    "type": "object",
    "additionalProperties": false,
    "required": [
      "documentId",
      "expectedVersion"
    ],
    "properties": {
      "documentId": {
        "$ref": "#/components/schemas/BusinessId"
      },
      "expectedVersion": {
        "type": "integer",
        "minimum": 0,
        "description": "Use the document detail lockVersion (or summary version), including zero."
      },
      "reason": {
        "$ref": "#/components/schemas/Reason"
      }
    }
  },
  "KnowledgeDocumentDisableToolInput": {
    "$ref": "#/components/schemas/KnowledgeDocumentEnableToolInput"
  },
  "KnowledgeDocumentReindexToolInput": {
    "$ref": "#/components/schemas/KnowledgeDocumentEnableToolInput"
  },
  "KnowledgeDocumentDeleteToolInput": {
    "type": "object",
    "additionalProperties": false,
    "required": [
      "documentId",
      "expectedVersion",
      "reason"
    ],
    "properties": {
      "documentId": {
        "$ref": "#/components/schemas/BusinessId"
      },
      "expectedVersion": {
        "type": "integer",
        "minimum": 0,
        "description": "Use the document detail lockVersion (or summary version), including zero."
      },
      "reason": {
        "$ref": "#/components/schemas/Reason"
      }
    }
  },
  "KnowledgeDocumentDownloadToolInput": {
    "$ref": "#/components/schemas/KnowledgeDocumentGetToolInput"
  },
  "KnowledgeSourceReadToolInput": {
    "type": "object",
    "additionalProperties": false,
    "required": [
      "citationId"
    ],
    "properties": {
      "citationId": {
        "$ref": "#/components/schemas/BusinessId"
      },
      "contextBefore": {
        "type": "integer",
        "minimum": 0,
        "maximum": 5000,
        "default": 1000
      },
      "contextAfter": {
        "type": "integer",
        "minimum": 0,
        "maximum": 5000,
        "default": 1000
      }
    }
  },
  "KnowledgeOperationGetToolInput": {
    "type": "object",
    "additionalProperties": false,
    "required": [
      "operationId"
    ],
    "properties": {
      "operationId": {
        "$ref": "#/components/schemas/BusinessId"
      }
    }
  },
  "KnowledgeOperationCancelToolInput": {
    "type": "object",
    "additionalProperties": false,
    "required": [
      "operationId",
      "reason"
    ],
    "properties": {
      "operationId": {
        "$ref": "#/components/schemas/BusinessId"
      },
      "reason": {
        "$ref": "#/components/schemas/Reason"
      }
    }
  },
  "KnowledgeOperationRetryToolInput": {
    "$ref": "#/components/schemas/KnowledgeOperationCancelToolInput"
  },
  "KnowledgeSpace": {
    "type": "object",
    "additionalProperties": false,
    "required": [
      "spaceId",
      "code",
      "name",
      "status",
      "version"
    ],
    "properties": {
      "spaceId": {
        "$ref": "#/components/schemas/BusinessId"
      },
      "code": {
        "type": "string",
        "minLength": 1,
        "maxLength": 64,
        "pattern": "^[^\\s]+$"
      },
      "name": {
        "type": "string",
        "maxLength": 128
      },
      "description": {
        "type": "string",
        "maxLength": 1000
      },
      "profileCode": {
        "$ref": "#/components/schemas/KnowledgeProfileCode"
      },
      "defaultSecurityDomainCode": {
        "type": "string",
        "minLength": 1,
        "maxLength": 100,
        "pattern": "^[^\\s]+$"
      },
      "status": {
        "$ref": "#/components/schemas/SpaceStatus"
      },
      "version": {
        "type": "integer",
        "minimum": 1
      }
    }
  },
  "KnowledgeSpaceCreated": {
    "type": "object",
    "additionalProperties": false,
    "required": [
      "spaceId",
      "code",
      "name",
      "status",
      "version"
    ],
    "properties": {
      "spaceId": {
        "$ref": "#/components/schemas/BusinessId"
      },
      "code": {
        "type": "string",
        "minLength": 1,
        "maxLength": 64,
        "pattern": "^[^\\s]+$"
      },
      "name": {
        "type": "string",
        "maxLength": 128
      },
      "status": {
        "$ref": "#/components/schemas/SpaceStatus"
      },
      "version": {
        "type": "integer",
        "minimum": 1
      }
    }
  },
  "KnowledgeSpaceList": {
    "type": "object",
    "additionalProperties": false,
    "required": [
      "items"
    ],
    "properties": {
      "items": {
        "type": "array",
        "maxItems": 20,
        "items": {
          "$ref": "#/components/schemas/KnowledgeSpace"
        }
      }
    }
  },
  "KnowledgeDocumentVersion": {
    "type": "object",
    "additionalProperties": false,
    "required": [
      "versionId",
      "versionNumber",
      "status",
      "fileName",
      "mimeType",
      "fileSize"
    ],
    "properties": {
      "versionId": {
        "$ref": "#/components/schemas/BusinessId"
      },
      "versionNumber": {
        "type": "integer",
        "minimum": 1
      },
      "status": {
        "$ref": "#/components/schemas/VersionStatus"
      },
      "fileName": {
        "type": "string",
        "maxLength": 1024
      },
      "mimeType": {
        "type": "string",
        "maxLength": 256
      },
      "fileSize": {
        "type": "integer",
        "minimum": 0
      },
      "failureCode": {
        "$ref": "#/components/schemas/KnowledgeFailureCode"
      }
    }
  },
  "KnowledgeDocument": {
    "type": "object",
    "additionalProperties": false,
    "required": [
      "documentId",
      "knowledgeSpaceId",
      "name",
      "status",
      "version",
      "activeVersion",
      "metadata"
    ],
    "properties": {
      "documentId": {
        "$ref": "#/components/schemas/BusinessId"
      },
      "knowledgeSpaceId": {
        "$ref": "#/components/schemas/BusinessId"
      },
      "name": {
        "type": "string",
        "maxLength": 255
      },
      "status": {
        "$ref": "#/components/schemas/DocumentStatus"
      },
      "version": {
        "type": "integer",
        "minimum": 0
      },
      "metadata": {
        "$ref": "#/components/schemas/DocumentMetadataOutput"
      },
      "activeVersion": {
        "oneOf": [
          {
            "$ref": "#/components/schemas/KnowledgeDocumentVersion"
          },
          {
            "type": "null"
          }
        ]
      }
    }
  },
  "KnowledgeDocumentList": {
    "type": "object",
    "additionalProperties": false,
    "required": [
      "items"
    ],
    "properties": {
      "items": {
        "type": "array",
        "maxItems": 20,
        "items": {
          "$ref": "#/components/schemas/KnowledgeDocument"
        }
      }
    }
  },
  "RetrievalHit": {
    "type": "object",
    "additionalProperties": false,
    "required": [
      "citationId",
      "documentId",
      "documentName",
      "chapterPath",
      "content",
      "score",
      "metadata"
    ],
    "properties": {
      "citationId": {
        "$ref": "#/components/schemas/BusinessId"
      },
      "documentId": {
        "$ref": "#/components/schemas/BusinessId"
      },
      "documentName": {
        "type": "string",
        "maxLength": 255
      },
      "chapterPath": {
        "type": "array",
        "maxItems": 20,
        "items": {
          "type": "string",
          "maxLength": 512
        }
      },
      "content": {
        "type": "string",
        "maxLength": 2500
      },
      "score": {
        "type": "number",
        "minimum": 0,
        "maximum": 1
      },
      "locationPrecision": {
        "$ref": "#/components/schemas/LocationPrecision"
      },
      "page": {
        "type": "integer",
        "minimum": 1
      },
      "metadata": {
        "$ref": "#/components/schemas/DocumentMetadataOutput"
      }
    }
  },
  "RetrievalResult": {
    "oneOf": [
      {
        "$ref": "#/components/schemas/RetrievalMatches"
      },
      {
        "$ref": "#/components/schemas/RetrievalEmpty"
      }
    ]
  },
  "CitationSource": {
    "type": "object",
    "additionalProperties": false,
    "required": [
      "citationId",
      "documentId",
      "versionId",
      "documentName",
      "beforeContent",
      "matchedContent",
      "afterContent",
      "requestedContextBefore",
      "requestedContextAfter",
      "actualContextBefore",
      "actualContextAfter",
      "matchedContentTruncated",
      "locationPrecision"
    ],
    "properties": {
      "citationId": {
        "$ref": "#/components/schemas/BusinessId"
      },
      "documentId": {
        "$ref": "#/components/schemas/BusinessId"
      },
      "versionId": {
        "$ref": "#/components/schemas/BusinessId"
      },
      "documentName": {
        "type": "string",
        "maxLength": 255
      },
      "chapterPath": {
        "type": "array",
        "maxItems": 20,
        "items": {
          "type": "string",
          "maxLength": 512
        }
      },
      "pageStart": {
        "type": "integer",
        "minimum": 1
      },
      "pageEnd": {
        "type": "integer",
        "minimum": 1
      },
      "beforeContent": {
        "type": "string",
        "maxLength": 5000
      },
      "matchedContent": {
        "type": "string",
        "maxLength": 2500
      },
      "afterContent": {
        "type": "string",
        "maxLength": 5000
      },
      "requestedContextBefore": {
        "type": "integer",
        "minimum": 0,
        "maximum": 5000
      },
      "requestedContextAfter": {
        "type": "integer",
        "minimum": 0,
        "maximum": 5000
      },
      "actualContextBefore": {
        "type": "integer",
        "minimum": 0,
        "maximum": 5000
      },
      "actualContextAfter": {
        "type": "integer",
        "minimum": 0,
        "maximum": 5000
      },
      "matchedContentTruncated": {
        "type": "boolean"
      },
      "locationPrecision": {
        "$ref": "#/components/schemas/LocationPrecision"
      }
    }
  },
  "DownloadLink": {
    "type": "object",
    "additionalProperties": false,
    "required": [
      "documentId",
      "versionId",
      "fileName",
      "mimeType",
      "fileSize",
      "downloadUrl",
      "expiresAt",
      "expiresInSeconds"
    ],
    "properties": {
      "documentId": {
        "$ref": "#/components/schemas/BusinessId"
      },
      "versionId": {
        "$ref": "#/components/schemas/BusinessId"
      },
      "fileName": {
        "type": "string",
        "maxLength": 1024
      },
      "mimeType": {
        "type": "string",
        "maxLength": 256
      },
      "fileSize": {
        "type": "integer",
        "minimum": 0
      },
      "downloadUrl": {
        "type": "string",
        "format": "uri",
        "maxLength": 4096
      },
      "expiresAt": {
        "type": "string",
        "format": "date-time"
      },
      "expiresInSeconds": {
        "type": "integer",
        "const": 60
      }
    }
  },
  "KnowledgeOperation": {
    "type": "object",
    "additionalProperties": false,
    "required": [
      "operationId",
      "status",
      "operationType",
      "createdAt"
    ],
    "properties": {
      "operationId": {
        "$ref": "#/components/schemas/BusinessId"
      },
      "parentOperationId": {
        "$ref": "#/components/schemas/BusinessId"
      },
      "status": {
        "$ref": "#/components/schemas/OperationStatus"
      },
      "operationType": {
        "$ref": "#/components/schemas/KnowledgeOperationType"
      },
      "resourceType": {
        "type": "string",
        "enum": [
          "SPACE",
          "DOCUMENT",
          "VERSION",
          "OPERATION"
        ]
      },
      "resourceId": {
        "$ref": "#/components/schemas/BusinessId"
      },
      "manualRetryAttempt": {
        "type": "integer",
        "minimum": 0,
        "maximum": 3
      },
      "createdAt": {
        "type": "string",
        "format": "date-time"
      },
      "updatedAt": {
        "type": "string",
        "format": "date-time"
      },
      "failureCode": {
        "$ref": "#/components/schemas/KnowledgeFailureCode"
      },
      "nextPollAfterMs": {
        "type": "integer",
        "minimum": 0,
        "maximum": 60000
      },
      "retryable": {
        "type": "boolean"
      },
      "retryCount": {
        "type": "integer",
        "minimum": 0,
        "maximum": 5
      },
      "lastRetryAt": {
        "oneOf": [
          {
            "type": "string",
            "format": "date-time"
          },
          {
            "type": "null"
          }
        ]
      },
      "nextRetryAt": {
        "oneOf": [
          {
            "type": "string",
            "format": "date-time"
          },
          {
            "type": "null"
          }
        ]
      }
    }
  },
  "ManualRetryOperation": {
    "type": "object",
    "additionalProperties": false,
    "required": [
      "operationId",
      "parentOperationId",
      "status"
    ],
    "properties": {
      "operationId": {
        "$ref": "#/components/schemas/BusinessId"
      },
      "parentOperationId": {
        "$ref": "#/components/schemas/BusinessId"
      },
      "status": {
        "$ref": "#/components/schemas/OperationStatus"
      }
    }
  },
  "SpaceOperationAccepted": {
    "type": "object",
    "additionalProperties": false,
    "required": [
      "spaceId",
      "operationId",
      "status"
    ],
    "properties": {
      "spaceId": {
        "$ref": "#/components/schemas/BusinessId"
      },
      "operationId": {
        "$ref": "#/components/schemas/BusinessId"
      },
      "status": {
        "$ref": "#/components/schemas/OperationStatus"
      }
    }
  },
  "DocumentOperationAccepted": {
    "type": "object",
    "additionalProperties": false,
    "required": [
      "documentId",
      "operationId",
      "status"
    ],
    "properties": {
      "documentId": {
        "$ref": "#/components/schemas/BusinessId"
      },
      "operationId": {
        "$ref": "#/components/schemas/BusinessId"
      },
      "status": {
        "$ref": "#/components/schemas/OperationStatus"
      }
    }
  },
  "KnowledgeSpaceListResponse": {
    "type": "object",
    "additionalProperties": false,
    "required": [
      "data",
      "meta"
    ],
    "properties": {
      "data": {
        "$ref": "#/components/schemas/KnowledgeSpaceList"
      },
      "meta": {
        "$ref": "#/components/schemas/ListSuccessMeta"
      }
    },
    "examples": [
      {
        "data": {
          "items": []
        },
        "meta": {
          "success": true,
          "requestId": "request-example",
          "traceId": "trace-example",
          "timestamp": "2026-09-05T00:00:00Z",
          "apiVersion": "v1",
          "pagination": {
            "page": 1,
            "pageSize": 20,
            "totalItems": 0,
            "totalPages": 0,
            "hasNext": false
          },
          "error": null
        }
      }
    ]
  },
  "KnowledgeSpaceResponse": {
    "type": "object",
    "additionalProperties": false,
    "required": [
      "data",
      "meta"
    ],
    "properties": {
      "data": {
        "$ref": "#/components/schemas/KnowledgeSpace"
      },
      "meta": {
        "$ref": "#/components/schemas/SuccessMeta"
      }
    }
  },
  "KnowledgeSpaceCreatedResponse": {
    "type": "object",
    "additionalProperties": false,
    "required": [
      "data",
      "meta"
    ],
    "properties": {
      "data": {
        "$ref": "#/components/schemas/KnowledgeSpaceCreated"
      },
      "meta": {
        "$ref": "#/components/schemas/SuccessMeta"
      }
    }
  },
  "SpaceOperationAcceptedResponse": {
    "type": "object",
    "additionalProperties": false,
    "required": [
      "data",
      "meta"
    ],
    "properties": {
      "data": {
        "$ref": "#/components/schemas/SpaceOperationAccepted"
      },
      "meta": {
        "$ref": "#/components/schemas/SuccessMeta"
      }
    }
  },
  "KnowledgeDocumentListResponse": {
    "type": "object",
    "additionalProperties": false,
    "required": [
      "data",
      "meta"
    ],
    "properties": {
      "data": {
        "$ref": "#/components/schemas/KnowledgeDocumentList"
      },
      "meta": {
        "$ref": "#/components/schemas/ListSuccessMeta"
      }
    }
  },
  "KnowledgeDocumentResponse": {
    "type": "object",
    "additionalProperties": false,
    "required": [
      "data",
      "meta"
    ],
    "properties": {
      "data": {
        "$ref": "#/components/schemas/KnowledgeDocument"
      },
      "meta": {
        "$ref": "#/components/schemas/SuccessMeta"
      }
    }
  },
  "DocumentOperationAcceptedResponse": {
    "type": "object",
    "additionalProperties": false,
    "required": [
      "data",
      "meta"
    ],
    "properties": {
      "data": {
        "$ref": "#/components/schemas/DocumentOperationAccepted"
      },
      "meta": {
        "$ref": "#/components/schemas/SuccessMeta"
      }
    }
  },
  "RetrievalResponse": {
    "type": "object",
    "additionalProperties": false,
    "required": [
      "data",
      "meta"
    ],
    "properties": {
      "data": {
        "$ref": "#/components/schemas/RetrievalResult"
      },
      "meta": {
        "$ref": "#/components/schemas/SuccessMeta"
      }
    }
  },
  "CitationSourceResponse": {
    "type": "object",
    "additionalProperties": false,
    "required": [
      "data",
      "meta"
    ],
    "properties": {
      "data": {
        "$ref": "#/components/schemas/CitationSource"
      },
      "meta": {
        "$ref": "#/components/schemas/SuccessMeta"
      }
    }
  },
  "DownloadLinkResponse": {
    "type": "object",
    "additionalProperties": false,
    "required": [
      "data",
      "meta"
    ],
    "properties": {
      "data": {
        "$ref": "#/components/schemas/DownloadLink"
      },
      "meta": {
        "$ref": "#/components/schemas/SuccessMeta"
      }
    }
  },
  "OperationResponse": {
    "type": "object",
    "additionalProperties": false,
    "required": [
      "data",
      "meta"
    ],
    "properties": {
      "data": {
        "$ref": "#/components/schemas/KnowledgeOperation"
      },
      "meta": {
        "$ref": "#/components/schemas/SuccessMeta"
      }
    }
  },
  "ManualRetryOperationResponse": {
    "type": "object",
    "additionalProperties": false,
    "required": [
      "data",
      "meta"
    ],
    "properties": {
      "data": {
        "$ref": "#/components/schemas/ManualRetryOperation"
      },
      "meta": {
        "$ref": "#/components/schemas/SuccessMeta"
      }
    }
  },
  "ErrorEnvelope": {
    "type": "object",
    "additionalProperties": false,
    "required": [
      "data",
      "meta"
    ],
    "properties": {
      "data": {
        "type": "null"
      },
      "meta": {
        "$ref": "#/components/schemas/ErrorMeta"
      }
    },
    "examples": [
      {
        "data": null,
        "meta": {
          "success": false,
          "requestId": "request-example",
          "traceId": "trace-example",
          "timestamp": "2026-09-05T00:00:00Z",
          "apiVersion": "v1",
          "pagination": null,
          "error": {
            "code": "KNOWLEDGE_METADATA_FIELD_NOT_ALLOWED",
            "message": "Unsupported metadata field",
            "retryable": false,
            "fieldErrors": [
              {
                "field": "metadata.department",
                "reason": "FIELD_NOT_ALLOWED",
                "message": "Only category, tags, versionLabel, productCode are allowed."
              }
            ]
          }
        }
      }
    ]
  },
  "RetrievalMatches": {
    "type": "object",
    "additionalProperties": false,
    "required": [
      "query",
      "hits",
      "traceId"
    ],
    "properties": {
      "query": {
        "type": "string",
        "maxLength": 4096
      },
      "hits": {
        "type": "array",
        "maxItems": 8,
        "items": {
          "$ref": "#/components/schemas/RetrievalHit"
        },
        "minItems": 1
      },
      "traceId": {
        "$ref": "#/components/schemas/BusinessId"
      }
    }
  },
  "RetrievalEmpty": {
    "type": "object",
    "additionalProperties": false,
    "required": [
      "hits",
      "reason"
    ],
    "properties": {
      "query": {
        "type": "string",
        "maxLength": 4096
      },
      "hits": {
        "type": "array",
        "maxItems": 0,
        "items": {
          "$ref": "#/components/schemas/RetrievalHit"
        }
      },
      "traceId": {
        "$ref": "#/components/schemas/BusinessId"
      },
      "reason": {
        "type": "string",
        "const": "NO_AUTHORIZED_RELEVANT_EVIDENCE"
      }
    }
  },
  "KnowledgeSpaceUpdated": {
    "type": "object",
    "additionalProperties": false,
    "required": [
      "spaceId",
      "name",
      "status",
      "version"
    ],
    "properties": {
      "spaceId": {
        "$ref": "#/components/schemas/BusinessId"
      },
      "name": {
        "type": "string",
        "maxLength": 128
      },
      "description": {
        "type": "string",
        "maxLength": 1000
      },
      "status": {
        "$ref": "#/components/schemas/SpaceStatus"
      },
      "version": {
        "type": "integer",
        "minimum": 1
      }
    }
  },
  "KnowledgeSpaceUpdatedResponse": {
    "type": "object",
    "additionalProperties": false,
    "required": [
      "data",
      "meta"
    ],
    "properties": {
      "data": {
        "$ref": "#/components/schemas/KnowledgeSpaceUpdated"
      },
      "meta": {
        "$ref": "#/components/schemas/SuccessMeta"
      }
    }
  },
  "MetadataText": {
    "type": "string",
    "minLength": 1,
    "maxLength": 64,
    "pattern": "^[^\\u0000-\\u001f\\u007f-\\u009f]+$",
    "description": "NFC then trim; bounds apply to normalized Unicode code points. Case-sensitive."
  },
  "MetadataTag": {
    "type": "string",
    "minLength": 1,
    "maxLength": 32,
    "pattern": "^[^\\u0000-\\u001f\\u007f-\\u009f]+$",
    "description": "NFC then trim; bounds apply to normalized Unicode code points. Case-sensitive."
  },
  "DocumentMetadataPatch": {
    "type": "object",
    "additionalProperties": false,
    "required": [],
    "properties": {
      "category": {
        "oneOf": [
          {
            "$ref": "#/components/schemas/MetadataText"
          },
          {
            "type": "null"
          }
        ]
      },
      "tags": {
        "type": "array",
        "maxItems": 20,
        "uniqueItems": true,
        "items": {
          "$ref": "#/components/schemas/MetadataTag"
        }
      },
      "versionLabel": {
        "oneOf": [
          {
            "$ref": "#/components/schemas/MetadataText"
          },
          {
            "type": "null"
          }
        ]
      },
      "productCode": {
        "oneOf": [
          {
            "$ref": "#/components/schemas/MetadataText"
          },
          {
            "type": "null"
          }
        ]
      }
    }
  },
  "DocumentMetadataOutput": {
    "type": "object",
    "additionalProperties": false,
    "required": [
      "category",
      "tags",
      "versionLabel",
      "productCode"
    ],
    "properties": {
      "category": {
        "oneOf": [
          {
            "$ref": "#/components/schemas/MetadataText"
          },
          {
            "type": "null"
          }
        ]
      },
      "tags": {
        "type": "array",
        "maxItems": 20,
        "uniqueItems": true,
        "items": {
          "$ref": "#/components/schemas/MetadataTag"
        }
      },
      "versionLabel": {
        "oneOf": [
          {
            "$ref": "#/components/schemas/MetadataText"
          },
          {
            "type": "null"
          }
        ]
      },
      "productCode": {
        "oneOf": [
          {
            "$ref": "#/components/schemas/MetadataText"
          },
          {
            "type": "null"
          }
        ]
      }
    }
  },
  "MetadataFilter": {
    "type": "object",
    "additionalProperties": false,
    "required": [],
    "properties": {
      "category": {
        "type": "array",
        "maxItems": 20,
        "uniqueItems": true,
        "items": {
          "$ref": "#/components/schemas/MetadataText"
        },
        "minItems": 1
      },
      "tagsAny": {
        "type": "array",
        "maxItems": 20,
        "uniqueItems": true,
        "items": {
          "$ref": "#/components/schemas/MetadataTag"
        },
        "minItems": 1
      },
      "tagsAll": {
        "type": "array",
        "maxItems": 20,
        "uniqueItems": true,
        "items": {
          "$ref": "#/components/schemas/MetadataTag"
        },
        "minItems": 1
      },
      "versionLabel": {
        "type": "array",
        "maxItems": 20,
        "uniqueItems": true,
        "items": {
          "$ref": "#/components/schemas/MetadataText"
        },
        "minItems": 1
      },
      "productCode": {
        "type": "array",
        "maxItems": 20,
        "uniqueItems": true,
        "items": {
          "$ref": "#/components/schemas/MetadataText"
        },
        "minItems": 1
      }
    },
    "examples": [
      {
        "category": [
          "company-policy"
        ],
        "tagsAny": [
          "财务"
        ],
        "productCode": [
          "DEVICE-A"
        ]
      }
    ]
  },
  "PaginationMeta": {
    "type": "object",
    "additionalProperties": false,
    "required": [
      "page",
      "pageSize",
      "totalItems",
      "totalPages",
      "hasNext"
    ],
    "properties": {
      "page": {
        "type": "integer",
        "minimum": 1
      },
      "pageSize": {
        "type": "integer",
        "minimum": 1,
        "maximum": 100
      },
      "totalItems": {
        "type": "integer",
        "minimum": 0
      },
      "totalPages": {
        "type": "integer",
        "minimum": 0
      },
      "hasNext": {
        "type": "boolean"
      }
    },
    "description": "page/pageSize echo the request. totalItems counts visible matching resources; totalPages=ceil(totalItems/pageSize); hasNext=page<totalPages. Empty results use totalPages=0; pages beyond totalPages return empty items. Items cannot exceed pageSize or the remaining total."
  },
  "FieldError": {
    "type": "object",
    "additionalProperties": false,
    "required": [
      "field",
      "reason",
      "message"
    ],
    "properties": {
      "field": {
        "type": "string",
        "minLength": 1,
        "maxLength": 256
      },
      "reason": {
        "type": "string",
        "minLength": 1,
        "maxLength": 128
      },
      "message": {
        "type": "string",
        "minLength": 1,
        "maxLength": 2000
      }
    }
  },
  "KnowledgeApiError": {
    "type": "object",
    "additionalProperties": false,
    "required": [
      "code",
      "message",
      "retryable",
      "fieldErrors"
    ],
    "properties": {
      "code": {
        "type": "string",
        "minLength": 1,
        "maxLength": 128
      },
      "message": {
        "type": "string",
        "minLength": 1,
        "maxLength": 2000
      },
      "retryable": {
        "type": "boolean"
      },
      "fieldErrors": {
        "type": "array",
        "maxItems": 100,
        "items": {
          "$ref": "#/components/schemas/FieldError"
        }
      }
    }
  },
  "ListSuccessMeta": {
    "type": "object",
    "additionalProperties": false,
    "required": [
      "success",
      "requestId",
      "traceId",
      "timestamp",
      "apiVersion",
      "pagination",
      "error"
    ],
    "properties": {
      "success": {
        "type": "boolean",
        "const": true
      },
      "requestId": {
        "type": "string",
        "minLength": 1,
        "maxLength": 128
      },
      "traceId": {
        "type": "string",
        "minLength": 1,
        "maxLength": 128
      },
      "timestamp": {
        "type": "string",
        "format": "date-time",
        "pattern": "Z$"
      },
      "apiVersion": {
        "type": "string",
        "const": "v1"
      },
      "pagination": {
        "$ref": "#/components/schemas/PaginationMeta"
      },
      "error": {
        "type": "null"
      }
    }
  },
  "ErrorMeta": {
    "type": "object",
    "additionalProperties": false,
    "required": [
      "success",
      "requestId",
      "traceId",
      "timestamp",
      "apiVersion",
      "pagination",
      "error"
    ],
    "properties": {
      "success": {
        "type": "boolean",
        "const": false
      },
      "requestId": {
        "type": "string",
        "minLength": 1,
        "maxLength": 128
      },
      "traceId": {
        "type": "string",
        "minLength": 1,
        "maxLength": 128
      },
      "timestamp": {
        "type": "string",
        "format": "date-time",
        "pattern": "Z$"
      },
      "apiVersion": {
        "type": "string",
        "const": "v1"
      },
      "pagination": {
        "type": "null"
      },
      "error": {
        "$ref": "#/components/schemas/KnowledgeApiError"
      }
    }
  },
  "VersionError": {
    "type": "object",
    "additionalProperties": false,
    "required": [
      "code",
      "message",
      "retryable"
    ],
    "properties": {
      "code": {
        "type": "string",
        "minLength": 1,
        "maxLength": 64
      },
      "message": {
        "type": "string",
        "minLength": 1,
        "maxLength": 2000
      },
      "retryable": {
        "type": "boolean"
      }
    }
  },
  "DocumentVersionDetail": {
    "type": "object",
    "additionalProperties": false,
    "required": [
      "versionId",
      "versionNo",
      "changeType",
      "status",
      "fileName",
      "mimeType",
      "fileSize",
      "operationId",
      "operationStatus",
      "progressPercent",
      "progressSource",
      "progressUpdatedAt",
      "retryable",
      "error",
      "createdAt",
      "processingStartedAt",
      "readyAt",
      "activatedAt",
      "failedAt",
      "cancelledAt"
    ],
    "properties": {
      "versionId": {
        "$ref": "#/components/schemas/BusinessId"
      },
      "versionNo": {
        "type": "integer",
        "minimum": 1
      },
      "changeType": {
        "type": "string",
        "enum": [
          "INITIAL_UPLOAD",
          "REPLACE",
          "REINDEX"
        ]
      },
      "status": {
        "$ref": "#/components/schemas/VersionStatus"
      },
      "fileName": {
        "type": "string",
        "minLength": 1,
        "maxLength": 255
      },
      "mimeType": {
        "type": "string",
        "minLength": 1,
        "maxLength": 128
      },
      "fileSize": {
        "type": "integer",
        "minimum": 0
      },
      "operationId": {
        "oneOf": [
          {
            "$ref": "#/components/schemas/BusinessId"
          },
          {
            "type": "null"
          }
        ]
      },
      "operationStatus": {
        "oneOf": [
          {
            "$ref": "#/components/schemas/OperationStatus"
          },
          {
            "type": "null"
          }
        ]
      },
      "progressPercent": {
        "oneOf": [
          {
            "type": "integer",
            "minimum": 0,
            "maximum": 100
          },
          {
            "type": "null"
          }
        ]
      },
      "progressSource": {
        "type": "string",
        "enum": [
          "PROVIDER",
          "TERMINAL_STATE",
          "UNAVAILABLE"
        ]
      },
      "progressUpdatedAt": {
        "oneOf": [
          {
            "type": "string",
            "format": "date-time",
            "pattern": "Z$"
          },
          {
            "type": "null"
          }
        ]
      },
      "retryable": {
        "type": "boolean"
      },
      "error": {
        "oneOf": [
          {
            "$ref": "#/components/schemas/VersionError"
          },
          {
            "type": "null"
          }
        ]
      },
      "createdAt": {
        "type": "string",
        "format": "date-time",
        "pattern": "Z$"
      },
      "processingStartedAt": {
        "oneOf": [
          {
            "type": "string",
            "format": "date-time",
            "pattern": "Z$"
          },
          {
            "type": "null"
          }
        ]
      },
      "readyAt": {
        "oneOf": [
          {
            "type": "string",
            "format": "date-time",
            "pattern": "Z$"
          },
          {
            "type": "null"
          }
        ]
      },
      "activatedAt": {
        "oneOf": [
          {
            "type": "string",
            "format": "date-time",
            "pattern": "Z$"
          },
          {
            "type": "null"
          }
        ]
      },
      "failedAt": {
        "oneOf": [
          {
            "type": "string",
            "format": "date-time",
            "pattern": "Z$"
          },
          {
            "type": "null"
          }
        ]
      },
      "cancelledAt": {
        "oneOf": [
          {
            "type": "string",
            "format": "date-time",
            "pattern": "Z$"
          },
          {
            "type": "null"
          }
        ]
      }
    }
  },
  "KnowledgeDocumentDetail": {
    "type": "object",
    "additionalProperties": false,
    "required": [
      "documentId",
      "spaceId",
      "name",
      "status",
      "searchable",
      "metadata",
      "lockVersion",
      "activeVersion",
      "candidateVersion",
      "createdAt",
      "updatedAt"
    ],
    "properties": {
      "documentId": {
        "$ref": "#/components/schemas/BusinessId"
      },
      "spaceId": {
        "$ref": "#/components/schemas/BusinessId"
      },
      "name": {
        "type": "string",
        "minLength": 1,
        "maxLength": 255
      },
      "status": {
        "$ref": "#/components/schemas/DocumentStatus"
      },
      "searchable": {
        "type": "boolean"
      },
      "metadata": {
        "$ref": "#/components/schemas/DocumentMetadataOutput"
      },
      "lockVersion": {
        "type": "integer",
        "minimum": 0
      },
      "activeVersion": {
        "oneOf": [
          {
            "$ref": "#/components/schemas/DocumentVersionDetail"
          },
          {
            "type": "null"
          }
        ]
      },
      "candidateVersion": {
        "oneOf": [
          {
            "$ref": "#/components/schemas/DocumentVersionDetail"
          },
          {
            "type": "null"
          }
        ]
      },
      "createdAt": {
        "type": "string",
        "format": "date-time",
        "pattern": "Z$"
      },
      "updatedAt": {
        "type": "string",
        "format": "date-time",
        "pattern": "Z$"
      }
    }
  },
  "KnowledgeDocumentDetailResponse": {
    "type": "object",
    "additionalProperties": false,
    "required": [
      "data",
      "meta"
    ],
    "properties": {
      "data": {
        "$ref": "#/components/schemas/KnowledgeDocumentDetail"
      },
      "meta": {
        "$ref": "#/components/schemas/SuccessMeta"
      }
    },
    "examples": [
      {
        "data": {
          "documentId": "document-1",
          "spaceId": "space-1",
          "name": "制度",
          "status": "ACTIVE",
          "searchable": true,
          "metadata": {
            "category": null,
            "tags": [],
            "versionLabel": null,
            "productCode": null
          },
          "lockVersion": 0,
          "activeVersion": {
            "versionId": "version-1",
            "versionNo": 1,
            "changeType": "INITIAL_UPLOAD",
            "status": "READY",
            "fileName": "制度.pdf",
            "mimeType": "application/pdf",
            "fileSize": 1024,
            "operationId": "operation-1",
            "operationStatus": "SUCCEEDED",
            "progressPercent": 100,
            "progressSource": "TERMINAL_STATE",
            "progressUpdatedAt": "2026-09-05T00:00:00Z",
            "retryable": false,
            "error": null,
            "createdAt": "2026-09-05T00:00:00Z",
            "processingStartedAt": "2026-09-05T00:00:00Z",
            "readyAt": "2026-09-05T00:00:00Z",
            "activatedAt": "2026-09-05T00:00:00Z",
            "failedAt": null,
            "cancelledAt": null
          },
          "candidateVersion": {
            "versionId": "version-2",
            "versionNo": 2,
            "changeType": "REPLACE",
            "status": "INGESTING",
            "fileName": "制度.pdf",
            "mimeType": "application/pdf",
            "fileSize": 1024,
            "operationId": "operation-2",
            "operationStatus": "RUNNING",
            "progressPercent": null,
            "progressSource": "UNAVAILABLE",
            "progressUpdatedAt": null,
            "retryable": false,
            "error": null,
            "createdAt": "2026-09-05T00:00:00Z",
            "processingStartedAt": "2026-09-05T00:00:00Z",
            "readyAt": null,
            "activatedAt": null,
            "failedAt": null,
            "cancelledAt": null
          },
          "createdAt": "2026-09-05T00:00:00Z",
          "updatedAt": "2026-09-05T00:00:00Z"
        },
        "meta": {
          "success": true,
          "requestId": "request-example",
          "traceId": "trace-example",
          "timestamp": "2026-09-05T00:00:00Z",
          "apiVersion": "v1",
          "pagination": null,
          "error": null
        }
      }
    ]
  },
  "DocumentDeleteRequest": {
    "type": "object",
    "additionalProperties": false,
    "required": [
      "expectedVersion",
      "reason"
    ],
    "properties": {
      "expectedVersion": {
        "type": "integer",
        "minimum": 0
      },
      "reason": {
        "$ref": "#/components/schemas/Reason"
      }
    }
  }
} as const
