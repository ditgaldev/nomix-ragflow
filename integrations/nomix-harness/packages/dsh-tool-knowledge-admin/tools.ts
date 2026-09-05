import { makeTool, outputs, string, number, optionalString, mutationOptions, type KnowledgeToolServices } from '../dsh-knowledge/tool.js'
import type { KnowledgeSpaceCreateRequest, KnowledgeSpaceUpdateRequest, DeleteResourceRequest, DocumentDeleteRequest } from '../dsh-knowledge/knowledge-openapi.generated.js'
import { KnowledgeGatewayError } from '../dsh-knowledge/knowledge-errors.js'

export function adminToolDefinitions(services: KnowledgeToolServices, timeoutMs: number) {
  return {
    knowledge_space_create: makeTool(services, timeoutMs, 'knowledge_space_create', 'Create one enterprise-long-document knowledge space after explicit approval.', 'space-created', outputs.spaceCreated, (input, exec, knowledge) => {
      const payload: KnowledgeSpaceCreateRequest = {
        code: string(input, 'code'),
        name: string(input, 'name'),
        ...(optionalString(input, 'description') === undefined ? {} : { description: optionalString(input, 'description') }),
        profileCode: 'enterprise-long-document',
        defaultSecurityDomainCode: string(input, 'defaultSecurityDomainCode'),
      }
      return knowledge.createSpace(payload, mutationOptions(services, exec))
    }),
    knowledge_space_update: makeTool(services, timeoutMs, 'knowledge_space_update', 'Update only one space name or description using optimistic versioning after explicit approval.', 'space', outputs.spaceUpdated, (input, exec, knowledge) => {
      const name = optionalString(input, 'name')
      const description = optionalString(input, 'description')
      if (name === undefined && description === undefined) throw new KnowledgeGatewayError('Knowledge-space update must change name or description.', { code: 'KNOWLEDGE_INVALID_INPUT', status: 422 })
      const payload: KnowledgeSpaceUpdateRequest = { expectedVersion: number(input, 'expectedVersion'), ...(name === undefined ? {} : { name }), ...(description === undefined ? {} : { description }) }
      return knowledge.updateSpace(string(input, 'knowledgeSpaceId'), payload, mutationOptions(services, exec))
    }),
    knowledge_space_delete: makeTool(services, timeoutMs, 'knowledge_space_delete', 'Delete one empty knowledge space with no pending operations. Cascade, force, and delete-all modes do not exist.', 'space-operation', outputs.spaceOperation, (input, exec, knowledge) => {
      const payload: DeleteResourceRequest = { expectedVersion: number(input, 'expectedVersion'), reason: string(input, 'reason') }
      return knowledge.deleteSpace(string(input, 'knowledgeSpaceId'), payload, mutationOptions(services, exec))
    }),
    knowledge_document_delete: makeTool(services, timeoutMs, 'knowledge_document_delete', 'Delete one versioned business document for a stated reason after explicit approval.', 'document-operation', outputs.documentOperation, (input, exec, knowledge) => {
      const payload: DocumentDeleteRequest = { expectedVersion: number(input, 'expectedVersion'), reason: string(input, 'reason') }
      return knowledge.deleteDocument(string(input, 'documentId'), payload, mutationOptions(services, exec))
    }),
  }
}
