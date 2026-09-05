import { makeTool, outputs, string, number, optionalString, optionalMetadata, optionalMetadataPatch, versioned, mutationOptions, type KnowledgeToolServices } from '../dsh-knowledge/tool.js'
import type { KnowledgeDocumentUploadRequest, KnowledgeDocumentUpdateRequest, KnowledgeDocumentReplaceRequest, OperationReasonRequest } from '../dsh-knowledge/knowledge-openapi.generated.js'
import { KnowledgeGatewayError } from '../dsh-knowledge/knowledge-errors.js'

export function writeToolDefinitions(services: KnowledgeToolServices, timeoutMs: number) {
  return {
    knowledge_document_upload: makeTool(services, timeoutMs, 'knowledge_document_upload', 'Submit one trusted fileResourceId for ingestion. The plugin never reads a local path or transfers binary content.', 'document-operation', outputs.documentOperation, (input, exec, knowledge) => {
      const metadata = optionalMetadata(input)
      const payload: KnowledgeDocumentUploadRequest = { fileResourceId: string(input, 'fileResourceId'), documentName: string(input, 'documentName'), ...(metadata === undefined ? {} : { metadata }) }
      return knowledge.uploadDocument(string(input, 'knowledgeSpaceId'), payload, mutationOptions(services, exec))
    }),
    knowledge_document_update: makeTool(services, timeoutMs, 'knowledge_document_update', 'Update one document name or safe business metadata using optimistic versioning.', 'document', outputs.document, (input, exec, knowledge) => {
      const name = optionalString(input, 'name')
      const metadata = optionalMetadataPatch(input)
      if (name === undefined && (metadata === undefined || Object.keys(metadata).length === 0)) throw new KnowledgeGatewayError('Document update must change name or at least one metadata field.', { code: 'KNOWLEDGE_INVALID_INPUT', status: 422 })
      const payload: KnowledgeDocumentUpdateRequest = { expectedVersion: number(input, 'expectedVersion'), ...(name === undefined ? {} : { name }), ...(metadata === undefined ? {} : { metadata }) }
      return knowledge.updateDocument(string(input, 'documentId'), payload, mutationOptions(services, exec))
    }),
    knowledge_document_replace: makeTool(services, timeoutMs, 'knowledge_document_replace', 'Replace one document through a new version while preserving the current READY version until ingestion succeeds.', 'document-operation', outputs.documentOperation, (input, exec, knowledge) => {
      const payload: KnowledgeDocumentReplaceRequest = { fileResourceId: string(input, 'fileResourceId'), ...versioned(input) }
      return knowledge.replaceDocument(string(input, 'documentId'), payload, mutationOptions(services, exec))
    }),
    knowledge_document_enable: makeTool(services, timeoutMs, 'knowledge_document_enable', 'Enable one versioned business document after explicit approval.', 'document', outputs.document, (input, exec, knowledge) => knowledge.enableDocument(string(input, 'documentId'), versioned(input), mutationOptions(services, exec))),
    knowledge_document_disable: makeTool(services, timeoutMs, 'knowledge_document_disable', 'Disable one versioned business document after explicit approval.', 'document', outputs.document, (input, exec, knowledge) => knowledge.disableDocument(string(input, 'documentId'), versioned(input), mutationOptions(services, exec))),
    knowledge_document_reindex: makeTool(services, timeoutMs, 'knowledge_document_reindex', 'Request Gateway-managed reindexing for one document. Parser, PageIndex, retrieval, and model settings are not model inputs.', 'document-operation', outputs.documentOperation, (input, exec, knowledge) => knowledge.reindexDocument(string(input, 'documentId'), versioned(input), mutationOptions(services, exec))),
    knowledge_operation_cancel: makeTool(services, timeoutMs, 'knowledge_operation_cancel', 'Cancel one cancellable operation using its original resource permission after explicit approval.', 'operation', outputs.operation, (input, exec, knowledge) => {
      const payload: OperationReasonRequest = { reason: string(input, 'reason') }
      return knowledge.cancelOperation(string(input, 'operationId'), payload, mutationOptions(services, exec))
    }),
    knowledge_operation_retry: makeTool(services, timeoutMs, 'knowledge_operation_retry', 'Manually retry one failed operation after explicit approval. The Gateway enforces original permission plus OPERATION_RETRY and creates a bounded child operation.', 'operation', outputs.retry, (input, exec, knowledge) => {
      const payload: OperationReasonRequest = { reason: string(input, 'reason') }
      return knowledge.retryOperation(string(input, 'operationId'), payload, mutationOptions(services, exec))
    }),
  }
}
