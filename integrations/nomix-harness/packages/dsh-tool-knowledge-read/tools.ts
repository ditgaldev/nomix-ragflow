import { makeTool, outputs, string, number, optionalIds, type KnowledgeToolServices } from '../dsh-knowledge/tool.js'
import type { RetrievalRequest, MetadataFilter } from '../dsh-knowledge/knowledge-openapi.generated.js'

export function readToolDefinitions(services: KnowledgeToolServices, timeoutMs: number) {
  return {
    knowledge_search: makeTool(services, timeoutMs, 'knowledge_search', 'Search authorized business knowledge. Ranking, PageIndex compilation, provider choice, thresholds, and ACL filtering remain Gateway-owned.', 'retrieval', outputs.retrieval, async (input, exec, knowledge) => {
      const payload: RetrievalRequest = {
        query: string(input, 'query'),
        ...(optionalIds(input, 'knowledgeSpaceIds') === undefined ? {} : { knowledgeSpaceIds: optionalIds(input, 'knowledgeSpaceIds') }),
        ...(optionalIds(input, 'documentIds') === undefined ? {} : { documentIds: optionalIds(input, 'documentIds') }),
        limit: number(input, 'limit', 8),
        ...(input.metadataFilter === undefined ? {} : { metadataFilter: input.metadataFilter as MetadataFilter }),
      }
      return knowledge.search(payload, { signal: exec.signal })
    }),
    knowledge_space_list: makeTool(services, timeoutMs, 'knowledge_space_list', 'List business knowledge spaces visible to the current session user.', 'space-list', outputs.spaceList, (input, exec, knowledge) => knowledge.listSpaces({ page: number(input, 'page', 1), pageSize: number(input, 'pageSize', 20) }, { signal: exec.signal })),
    knowledge_space_get: makeTool(services, timeoutMs, 'knowledge_space_get', 'Read one visible business knowledge space.', 'space', outputs.space, (input, exec, knowledge) => knowledge.getSpace(string(input, 'knowledgeSpaceId'), { signal: exec.signal })),
    knowledge_document_list: makeTool(services, timeoutMs, 'knowledge_document_list', 'List visible documents in one business knowledge space.', 'document-list', outputs.documentList, (input, exec, knowledge) => knowledge.listDocuments(string(input, 'knowledgeSpaceId'), { page: number(input, 'page', 1), pageSize: number(input, 'pageSize', 20) }, { signal: exec.signal })),
    knowledge_document_get: makeTool(services, timeoutMs, 'knowledge_document_get', 'Read a document with its active and candidate versions, reliable progress, failures and operation IDs.', 'document-detail', outputs.documentDetail, (input, exec, knowledge) => knowledge.getDocument(string(input, 'documentId'), { signal: exec.signal })),
    knowledge_source_read: makeTool(services, timeoutMs, 'knowledge_source_read', 'Read bounded, re-authorized citation context using normalized-document Unicode code-point offsets.', 'citation-source', outputs.citation, (input, exec, knowledge) => knowledge.getCitation(string(input, 'citationId'), { contextBefore: number(input, 'contextBefore', 1000), contextAfter: number(input, 'contextAfter', 1000) }, { signal: exec.signal })),
    knowledge_document_download: makeTool(services, timeoutMs, 'knowledge_document_download', 'Create a 60-second business download link for the current active document version. No bytes, paths, storage keys, version choice, or TTL choice are accepted.', 'download-link', outputs.download, (input, exec, knowledge) => knowledge.createDownloadLink(string(input, 'documentId'), {}, { signal: exec.signal })),
    knowledge_operation_get: makeTool(services, timeoutMs, 'knowledge_operation_get', 'Read an authorized asynchronous knowledge operation.', 'operation', outputs.operation, (input, exec, knowledge) => knowledge.getOperation(string(input, 'operationId'), { signal: exec.signal })),
  }
}
