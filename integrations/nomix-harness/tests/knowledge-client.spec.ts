import { afterEach, describe, expect, it, vi } from 'vitest'
import { KnowledgeGatewayClient } from '../packages/dsh-knowledge-gateway/knowledge-client.js'

import { stableIdempotencyKey } from '../packages/dsh-knowledge/execution-identity.js'
import { metadata, meta, pagination, success, failure, documentDetail } from './knowledge-fixtures.js'

const context = {
  serviceToken: 'service-secret',
  userAssertion: 'user-assertion',
  sessionId: 'session-1',
  toolCallId: 'call-1',
  requestId: 'request-1',
}
const idempotencyKey = stableIdempotencyKey({ sessionId: 'session-1', rootCallId: 'root-1', toolCallId: 'call-1', toolName: 'knowledge_document_upload' })
const operation = { operationId: 'operation-70001', status: 'PENDING' as const, operationType: 'DOCUMENT_UPLOAD', resourceType: 'DOCUMENT' as const, resourceId: 'doc-policy', createdAt: '2026-09-04T00:00:00Z' }
const accepted = { documentId: 'doc-policy', operationId: operation.operationId, status: 'PENDING' as const }
const space = { spaceId: 'company-policy', code: 'company-policy', name: '公司制度', profileCode: 'enterprise-long-document' as const, defaultSecurityDomainCode: 'company', status: 'ACTIVE' as const, version: 1 }
const createdSpace = { spaceId: 'company-policy', code: 'company-policy', name: '公司制度', status: 'ACTIVE' as const, version: 1 }
const version = { versionId: 'version-policy-v1', versionNumber: 1, status: 'READY' as const, fileName: '员工手册.pdf', mimeType: 'application/pdf', fileSize: 1024 }
const document = { documentId: 'doc-policy', knowledgeSpaceId: 'company-policy', name: '员工手册', status: 'ACTIVE' as const, version: 1, activeVersion: version, metadata }
const envelope = (data: unknown, status = 200) => new Response(JSON.stringify(success(data, data && typeof data === 'object' && 'items' in data ? pagination : undefined)), { status, headers: { 'content-type': 'application/json' } })
const client = () => new KnowledgeGatewayClient('https://knowledge-gateway.example.com', context, 1_000, 128 * 1024)

afterEach(() => vi.unstubAllGlobals())

describe('KnowledgeGatewayClient', () => {
  it('sends only the finalized identity headers and a Harness-derived idempotency key', async () => {
    const calls: Array<{ url: string; method?: string; headers: Headers; body?: BodyInit | null }> = []
    vi.stubGlobal('fetch', vi.fn(async (input, init) => {
      calls.push({ url: String(input), method: init?.method, headers: new Headers(init?.headers), body: init?.body })
      return envelope(accepted, 202)
    }))
    await client().uploadDocument('company-policy', { fileResourceId: 'file-policy-v1', documentName: '员工手册.pdf' }, { idempotencyKey })
    expect(calls[0]?.url).toBe('https://knowledge-gateway.example.com/internal/v1/knowledge/spaces/company-policy/documents')
    expect(calls[0]?.method).toBe('POST')
    expect(calls[0]?.headers.get('authorization')).toBe('Bearer service-secret')
    expect(calls[0]?.headers.get('x-user-assertion')).toBe('user-assertion')
    expect(calls[0]?.headers.get('x-harness-session-id')).toBe('session-1')
    expect(calls[0]?.headers.get('x-tool-call-id')).toBe('call-1')
    expect(calls[0]?.headers.get('x-request-id')).toBe('request-1')
    expect(calls[0]?.headers.get('x-root-call-id')).toBeNull()
    expect(calls[0]?.headers.get('traceparent')).toBeNull()
    expect(calls[0]?.headers.get('idempotency-key')).toBe(idempotencyKey)
    expect(JSON.parse(String(calls[0]?.body))).toEqual({ fileResourceId: 'file-policy-v1', documentName: '员工手册.pdf' })
    expect(String(calls[0]?.body)).not.toContain('operationId')
  })

  it('forwards only the four bounded business search inputs', async () => {
    let body: unknown
    vi.stubGlobal('fetch', vi.fn(async (_input, init) => {
      body = JSON.parse(String(init?.body))
      return envelope({ query: '休假怎么申请', hits: [{ citationId: 'cit-policy-1', documentId: 'doc-policy', metadata, documentName: '员工手册', page: 12, chapterPath: ['休假制度', '申请流程'], content: '提交申请。', score: 0.9, locationPrecision: 'EXACT_OFFSET' }], traceId: 'trace-search-1' })
    }))
    const result = await client().search({ query: '休假怎么申请', knowledgeSpaceIds: ['company-policy'], documentIds: ['doc-policy'], limit: 8 })
    expect(body).toEqual({ query: '休假怎么申请', knowledgeSpaceIds: ['company-policy'], documentIds: ['doc-policy'], limit: 8 })
    expect(result.hits[0]?.citationId).toBe('cit-policy-1')
  })

  it('uses the finalized download, citation, space, document, and operation routes', async () => {
    const calls: Array<{ url: string; method?: string; body?: string }> = []
    vi.stubGlobal('fetch', vi.fn(async (input, init) => {
      const url = String(input)
      calls.push({ url, method: init?.method, body: init?.body === undefined ? undefined : String(init.body) })
      if (url.endsWith(':create-download-link')) return envelope({ documentId: 'doc-policy', versionId: version.versionId, fileName: version.fileName, mimeType: version.mimeType, fileSize: version.fileSize, downloadUrl: 'https://knowledge-gateway.example.com/download/doc-policy', expiresAt: '2026-09-04T00:01:00Z', expiresInSeconds: 60 })
      if (url.includes('/citations/')) return envelope({ citationId: 'citation-1', documentId: 'doc-policy', versionId: version.versionId, documentName: '员工手册', chapterPath: ['休假'], pageStart: 12, pageEnd: 12, beforeContent: '上文', matchedContent: '正文', afterContent: '下文', requestedContextBefore: 300, requestedContextAfter: 500, actualContextBefore: 2, actualContextAfter: 2, matchedContentTruncated: false, locationPrecision: 'EXACT_OFFSET' })
      if (url.includes('/operations/') && url.endsWith(':retry')) return envelope({ operationId: 'operation-70002', parentOperationId: operation.operationId, status: 'PENDING' })
      if (url.includes('/operations/')) return envelope(operation)
      if (url.includes('/spaces/company-policy:delete')) return envelope({ spaceId: 'company-policy', operationId: operation.operationId, status: 'PENDING' }, 202)
      if (url.includes('/spaces/company-policy') && init?.method === 'PATCH') return envelope({ spaceId: space.spaceId, name: space.name, status: space.status, version: 2 })
      if (url.endsWith('/spaces')) return envelope(createdSpace, 201)
      if (url.includes('/documents/doc-policy')) return envelope(document)
      return envelope({ items: [] })
    }))
    const value = client()
    await value.createDownloadLink('doc-policy')
    await value.getCitation('citation-1', { contextBefore: 300, contextAfter: 500 })
    await value.retryOperation(operation.operationId, { reason: '人工确认后重试' }, { idempotencyKey })
    await value.createSpace({ code: 'company-policy', name: '公司制度', profileCode: 'enterprise-long-document', defaultSecurityDomainCode: 'company' }, { idempotencyKey })
    await value.updateSpace('company-policy', { name: '公司制度库', expectedVersion: 1 }, { idempotencyKey })
    await value.deleteSpace('company-policy', { expectedVersion: 2, reason: '已清空' }, { idempotencyKey })
    expect(calls.map(call => [call.method, call.url])).toEqual([
      ['POST', 'https://knowledge-gateway.example.com/internal/v1/knowledge/documents/doc-policy:create-download-link'],
      ['GET', 'https://knowledge-gateway.example.com/internal/v1/knowledge/citations/citation-1?contextBefore=300&contextAfter=500'],
      ['POST', 'https://knowledge-gateway.example.com/internal/v1/knowledge/operations/operation-70001:retry'],
      ['POST', 'https://knowledge-gateway.example.com/internal/v1/knowledge/spaces'],
      ['PATCH', 'https://knowledge-gateway.example.com/internal/v1/knowledge/spaces/company-policy'],
      ['POST', 'https://knowledge-gateway.example.com/internal/v1/knowledge/spaces/company-policy:delete'],
    ])
    expect(calls[0]?.body).toBe('{}')
    expect(calls[2]?.body).toBe(JSON.stringify({ reason: '人工确认后重试' }))
  })

  it('forwards cancellation and normalizes opaque failures', async () => {
    let seenSignal: AbortSignal | null | undefined
    vi.stubGlobal('fetch', vi.fn(async (_input, init) => { seenSignal = init?.signal; return new Response('RAGFlow https://internal.example datasetId=secret', { status: 403 }) }))
    const controller = new AbortController()
    await expect(client().search({ query: 'q', limit: 8 }, { signal: controller.signal })).rejects.toMatchObject({ code: 'KNOWLEDGE_GATEWAY_PROTOCOL_ERROR' })
    controller.abort()
    expect(seenSignal?.aborted).toBe(true)
  })

  it('fails closed for provider fields, response drift, and search-limit violations', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => envelope({ datasetId: 'raw-id' })))
    await expect(client().listSpaces({ pageSize: 20 })).rejects.toMatchObject({ code: 'KNOWLEDGE_GATEWAY_PROTOCOL_ERROR' })
    vi.stubGlobal('fetch', vi.fn(async () => envelope({ items: [{ spaceId: 'space', name: 'missing-fields' }] })))
    await expect(client().listSpaces({ pageSize: 20 })).rejects.toMatchObject({ code: 'KNOWLEDGE_GATEWAY_PROTOCOL_ERROR' })
    vi.stubGlobal('fetch', vi.fn(async () => envelope({ query: 'q', traceId: 'trace', hits: Array.from({ length: 5 }, (_, index) => ({ citationId: `c${index}`, documentId: 'same-doc', metadata, documentName: 'Doc', chapterPath: [], content: 'x', score: 1 })) })))
    await expect(client().search({ query: 'q' })).rejects.toMatchObject({ code: 'KNOWLEDGE_GATEWAY_PROTOCOL_ERROR' })
    vi.stubGlobal('fetch', vi.fn(async () => envelope({ query: 'q', traceId: 'trace', hits: [] })))
    await expect(client().search({ query: 'q' })).rejects.toMatchObject({ code: 'KNOWLEDGE_GATEWAY_PROTOCOL_ERROR' })
  })

  it('validates citation counts in Unicode code points', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => envelope({ citationId: 'citation-emoji', documentId: 'doc-policy', versionId: version.versionId, documentName: '员工手册', chapterPath: [], beforeContent: '😀😀', matchedContent: '正文', afterContent: '文', requestedContextBefore: 2, requestedContextAfter: 1, actualContextBefore: 2, actualContextAfter: 1, matchedContentTruncated: false, locationPrecision: 'CHUNK_APPROXIMATE' })))
    await expect(client().getCitation('citation-emoji', { contextBefore: 2, contextAfter: 1 })).resolves.toMatchObject({ actualContextBefore: 2 })
  })

  it('rejects response identities that do not match the requested business resource', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => envelope(documentDetail({ documentId: 'different-document' }))))
    await expect(client().getDocument('doc-policy')).rejects.toMatchObject({ code: 'KNOWLEDGE_GATEWAY_PROTOCOL_ERROR' })
  })

  it.each([
    ['SPACE_NOT_EMPTY', 'KNOWLEDGE_CONFLICT'],
    ['OPERATION_MANUAL_RETRY_LIMIT_EXCEEDED', 'KNOWLEDGE_CONFLICT'],
    ['INVALID_CONTEXT_RANGE', 'KNOWLEDGE_INVALID_INPUT'],
    ['OPERATION_NOT_FOUND', 'KNOWLEDGE_NOT_FOUND'],
    ['DOCUMENT_NOT_READY', 'KNOWLEDGE_OPERATION_PENDING'],
  ])('maps %s to %s without forwarding remote details', async (remoteCode, expectedCode) => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(failure(remoteCode)), { status: 422 })))
    await expect(client().getOperation('operation-70001')).rejects.toMatchObject({ code: expectedCode })
  })

  it('retries one transient read but leaves all mutation retry to the Gateway workflow', async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify(failure('PROVIDER_TIMEOUT', true)), { status: 503 }))
      .mockResolvedValueOnce(envelope({ items: [] }))
      .mockRejectedValueOnce(new TypeError('network'))
      .mockResolvedValueOnce(envelope(accepted, 202))
    vi.stubGlobal('fetch', fetch)
    await expect(client().listSpaces({ pageSize: 20 })).resolves.toEqual({ items: [], pagination })
    await expect(client().uploadDocument('company-policy', { fileResourceId: 'file-1', documentName: '文档.pdf' }, { idempotencyKey })).rejects.toMatchObject({ code: 'KNOWLEDGE_PROVIDER_UNAVAILABLE', retryable: false })
    await expect(client().uploadDocument('company-policy', { fileResourceId: 'file-1', documentName: '文档.pdf' }, { idempotencyKey })).resolves.toEqual(accepted)
    expect(fetch).toHaveBeenCalledTimes(4)
  })

  it('requires idempotency on every mutation and caps response bytes', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => envelope(accepted, 202)))
    await expect(client().uploadDocument('company-policy', { fileResourceId: 'file-1', documentName: '文档.pdf' }, {})).rejects.toMatchObject({ code: 'KNOWLEDGE_INVALID_INPUT' })
    vi.stubGlobal('fetch', vi.fn(async () => envelope({ items: [], padding: 'x'.repeat(10_000) })))
    const bounded = new KnowledgeGatewayClient('https://knowledge-gateway.example.com', context, 1_000, 256)
    await expect(bounded.listSpaces({ pageSize: 20 })).rejects.toMatchObject({ code: 'KNOWLEDGE_PROVIDER_UNAVAILABLE', status: 502 })
  })

  it('reports only business correlation metadata', async () => {
    const onResponseMeta = vi.fn()
    vi.stubGlobal('fetch', vi.fn(async () => envelope({ items: [] })))
    const observed = new KnowledgeGatewayClient('https://knowledge-gateway.example.com', context, 1_000, 128 * 1024, onResponseMeta)
    await observed.listSpaces({ pageSize: 20 })
    expect(onResponseMeta).toHaveBeenCalledWith({ ...meta, pagination })
    expect(JSON.stringify(onResponseMeta.mock.calls)).not.toContain('service-secret')
    expect(JSON.stringify(onResponseMeta.mock.calls)).not.toContain('user-assertion')
  })
})
