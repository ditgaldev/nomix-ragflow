import { describe, expect, it } from 'vitest'
import { parseKnowledgeToolInput, parseKnowledgeToolResult } from '../packages/dsh-knowledge/knowledge-schema.js'
import { metadata, pagination, documentDetail } from './knowledge-fixtures.js'

// Independent examples from the agreed design, not generated from our schemas.
describe('agreed knowledge business workflows', () => {
  it('searches a space without selecting individual documents', () => {
    expect(() => parseKnowledgeToolInput('knowledge_search', {
      query: '住宿费标准', knowledgeSpaceIds: ['space-10001'], documentIds: [], limit: 8,
    })).not.toThrow()
  })

  it('accepts the agreed search page and empty-evidence reason', () => {
    expect(() => parseKnowledgeToolResult('knowledge_search', {
      query: '住宿费标准', hits: [{ citationId: 'citation-80001', documentId: 'document-50001',
        metadata, documentName: '差旅制度', page: 12, chapterPath: ['第四章'], content: '住宿标准为每天600元。', score: 0.9 }], traceId: 'trace-90001',
    })).not.toThrow()
    expect(() => parseKnowledgeToolResult('knowledge_search', {
      hits: [], reason: 'NO_AUTHORIZED_RELEVANT_EVIDENCE',
    })).not.toThrow()
  })

  it('accepts the space-update acknowledgement without unrelated fields', () => {
    expect(() => parseKnowledgeToolResult('knowledge_space_update', {
      spaceId: 'space-10001', name: '公司规章制度', description: '更新后的描述', status: 'ACTIVE', version: 4,
    })).not.toThrow()
  })

  it('accepts a child-operation acknowledgement, not a full operation detail', () => {
    expect(() => parseKnowledgeToolResult('knowledge_operation_retry', {
      operationId: 'operation-70002', parentOperationId: 'operation-70001', status: 'PENDING',
    })).not.toThrow()
  })

  it('reads a citation without inventing a chapter path', () => {
    expect(() => parseKnowledgeToolResult('knowledge_source_read', {
      citationId: 'citation-80001', documentId: 'document-50001', documentName: '差旅制度', versionId: 'version-60001',
      pageStart: 11, pageEnd: 13, beforeContent: '上文', matchedContent: '住宿标准', afterContent: '下文',
      requestedContextBefore: 1000, requestedContextAfter: 1500, actualContextBefore: 2, actualContextAfter: 2,
      matchedContentTruncated: false, locationPrecision: 'EXACT_OFFSET',
    })).not.toThrow()
  })

  it.each(['CREATING', 'CREATE_FAILED'])('can read a %s document before any version becomes active', status => {
    const document = { documentId: 'document-50001', knowledgeSpaceId: 'space-10001', name: '差旅制度', status, version: 1, activeVersion: null, metadata }
    expect(() => parseKnowledgeToolResult('knowledge_document_get', documentDetail({ status: status as 'CREATING' | 'CREATE_FAILED', searchable: false, activeVersion: null }))).not.toThrow()
    expect(() => parseKnowledgeToolResult('knowledge_document_list', { items: [document], pagination: { ...pagination, totalItems: 1, totalPages: 1 } })).not.toThrow()
  })

  it('can explain automatic retry and whether manual retry is allowed', () => {
    expect(() => parseKnowledgeToolResult('knowledge_operation_get', {
      operationId: 'operation-70001', status: 'FAILED', operationType: 'DOCUMENT_UPLOAD', createdAt: '2026-09-05T00:00:00Z',
      retryable: true, retryCount: 5, lastRetryAt: '2026-09-05T01:00:00Z', nextRetryAt: null,
    })).not.toThrow()
  })

  it('rejects business names beyond the agreed storage boundaries', () => {
    expect(() => parseKnowledgeToolInput('knowledge_space_create', {
      code: 'company-policy', name: 'x'.repeat(129), profileCode: 'enterprise-long-document', defaultSecurityDomainCode: 'tenant-public',
    })).toThrow()
    expect(() => parseKnowledgeToolInput('knowledge_document_upload', {
      knowledgeSpaceId: 'space-10001', fileResourceId: 'file-20001', documentName: 'x'.repeat(256),
    })).toThrow()
  })
})
