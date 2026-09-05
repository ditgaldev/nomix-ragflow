import { afterEach, describe, expect, it, vi } from 'vitest'
import { KnowledgeGatewayClient } from '../packages/dsh-knowledge-gateway/knowledge-client.js'
import { parseKnowledgeToolInput, parseKnowledgeToolResult } from '../packages/dsh-knowledge/knowledge-schema.js'
import { knowledgeOutput, observeKnowledge } from '../packages/dsh-knowledge/knowledge-observation.js'
import { knowledgeToolDataSchemas } from '../packages/dsh-knowledge/knowledge-tool-schemas.generated.js'
import { documentDetail, versionDetail, success, failure, metadata, pagination } from './knowledge-fixtures.js'

const context = { serviceToken: 'test-service', userAssertion: 'test-user', sessionId: 's', toolCallId: 'c', requestId: 'r' }
const client = () => new KnowledgeGatewayClient('https://gateway.example', context, 1000, 100000)
const candidate = (status: 'UPLOADING' | 'INGESTING' | 'FAILED' | 'CANCELLED') => versionDetail({
  versionId: 'v-2', versionNo: 2, changeType: 'REPLACE', status, operationId: 'op-2', operationStatus: status === 'FAILED' || status === 'CANCELLED' ? status : 'RUNNING',
  progressPercent: null, progressSource: 'UNAVAILABLE', progressUpdatedAt: null, readyAt: null, activatedAt: null,
  ...(status === 'FAILED' ? { retryable: true, error: { code: 'RAGFLOW_INGESTION_TIMEOUT', message: '文档处理超时', retryable: true }, failedAt: '2026-09-05T00:00:00Z' } : {}),
})
afterEach(() => vi.unstubAllGlobals())

describe('formal active/candidate version contract', () => {
  it.each(['UPLOADING', 'INGESTING', 'FAILED', 'CANCELLED'] as const)('keeps the active version visible while candidate is %s', async status => {
    const detail = documentDetail({ candidateVersion: candidate(status) })
    vi.stubGlobal('fetch', vi.fn(async () => Response.json(success(detail))))
    expect(await client().getDocument(detail.documentId)).toEqual(detail)
    expect(parseKnowledgeToolResult('knowledge_document_get', detail)).toEqual(detail)
  })
  it('supports reindex, reliable zero progress, terminal activation, and first-upload failure', () => {
    const detail = documentDetail({ candidateVersion: { ...candidate('INGESTING'), changeType: 'REINDEX', progressPercent: 0, progressSource: 'PROVIDER' } })
    expect(() => parseKnowledgeToolResult('knowledge_document_get', detail)).not.toThrow()
    expect(() => parseKnowledgeToolResult('knowledge_document_get', documentDetail({ activeVersion: versionDetail({ versionId: 'v-2', versionNo: 2 }), candidateVersion: null }))).not.toThrow()
    expect(() => parseKnowledgeToolResult('knowledge_document_get', documentDetail({ status: 'CREATE_FAILED', searchable: false, activeVersion: null, candidateVersion: { ...candidate('FAILED'), changeType: 'INITIAL_UPLOAD' } }))).not.toThrow()
  })
  it.each([
    { candidateVersion: versionDetail() },
    { searchable: false },
    { candidateVersion: { ...candidate('INGESTING'), progressPercent: 0 } },
    { candidateVersion: { ...candidate('INGESTING'), progressPercent: 101, progressSource: 'PROVIDER' } },
    { candidateVersion: { ...candidate('FAILED'), retryable: false } },
    { activeVersion: versionDetail({ progressPercent: 99 }) },
    { candidateVersion: [candidate('INGESTING'), candidate('UPLOADING')] },
  ])('rejects inconsistent version slots, progress, and retryability: %j', patch => {
    expect(() => parseKnowledgeToolResult('knowledge_document_get', { ...documentDetail(), ...patch })).toThrow()
  })
  it('renders both versions, unknown progress, and retry operation without claiming zero percent', async () => {
    const detail = documentDetail({ candidateVersion: candidate('FAILED') })
    const output = await observeKnowledge({ spillText: vi.fn() }, { callId: 'c' } as never, 'knowledge_document_get', 'document-detail', detail)
    const render = knowledgeOutput(['document-detail'], knowledgeToolDataSchemas.KnowledgeDocumentDetail).render
    const text = JSON.stringify(render({}, output as never))
    for (const expected of ['当前生效版本', 'V1', '待生效版本', 'V2', 'Provider 未提供可靠百分比', '文档处理超时', 'op-2', '是否可重试：是']) expect(text).toContain(expected)
    expect(text).not.toContain('处理进度：0%')
  })
  it('retains candidate status and operation ID in the summary when full detail spills', async () => {
    const failed = candidate('FAILED')
    const detail = documentDetail({ name: '文'.repeat(255), activeVersion: versionDetail({ fileName: '😀'.repeat(255) }), candidateVersion: { ...failed, fileName: '😀'.repeat(255), error: { ...failed.error!, message: '😀'.repeat(2000) } }, metadata: { ...metadata, tags: Array.from({ length: 20 }, (_, i) => `${i}${'文'.repeat(30)}`) } })
    parseKnowledgeToolResult('knowledge_document_get', detail)
    const spillText = vi.fn(async (_exec, input: { name: string; content: string }) => ({ kind: 'spill' as const, name: input.name, locator: 'spill://detail', mimeType: 'application/json' as const, encoding: 'utf8' as const, bytes: new TextEncoder().encode(input.content).byteLength, storedBytes: new TextEncoder().encode(input.content).byteLength, retrievalHint: 'Read full JSON' }))
    const output = await observeKnowledge({ spillText }, { callId: 'c' } as never, 'knowledge_document_get', 'document-detail', detail)
    expect(output.data.kind).toBe('artifact-reference')
    expect(output.summary).toContain('待生效版本：V2')
    expect(output.summary).toContain('操作编号：op-2')
    expect(JSON.parse(spillText.mock.calls[0]![1].content)).toEqual(detail)
  })
})

describe('formal HTTP envelope and metadata contract', () => {
  it.each([
    { ...pagination, totalItems: 42, totalPages: 1 },
    { ...pagination, hasNext: true },
    { ...pagination, page: 2 },
    { ...pagination, pageSize: 10 },
  ])('rejects inconsistent or unrequested pagination: %j', async page => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json(success({ items: [] }, page))))
    await expect(client().listSpaces({})).rejects.toMatchObject({ code: 'KNOWLEDGE_GATEWAY_PROTOCOL_ERROR', retryable: false })
  })
  it('accepts an empty out-of-range page and rejects items beyond the total', async () => {
    const page = { ...pagination, page: 3, totalItems: 21, totalPages: 2 }
    vi.stubGlobal('fetch', vi.fn(async () => Response.json(success({ items: [] }, page))))
    await expect(client().listSpaces({ page: 3 })).resolves.toMatchObject({ items: [], pagination: page })
    const item = { spaceId: 's', code: 's', name: 'Space', version: 1, status: 'ACTIVE' }
    expect(() => parseKnowledgeToolResult('knowledge_space_list', { items: [item], pagination: page })).toThrow()
    expect(() => parseKnowledgeToolResult('knowledge_space_list', { items: [item, item], pagination: { ...page, page: 2 } })).toThrow()
  })
  it('round-trips zero document locks in every versioned input without loosening space locks', () => {
    for (const name of ['update', 'replace', 'enable', 'disable', 'reindex', 'delete']) {
      const input = { documentId: 'doc-1', expectedVersion: 0, ...(name === 'replace' ? { fileResourceId: 'file-1' } : {}), ...(name === 'delete' ? { reason: 'cleanup' } : {}) }
      expect(() => parseKnowledgeToolInput(`knowledge_document_${name}`, input)).not.toThrow()
      expect(() => parseKnowledgeToolInput(`knowledge_document_${name}`, { ...input, expectedVersion: -1 })).toThrow()
    }
    for (const name of ['update', 'delete']) expect(() => parseKnowledgeToolInput(`knowledge_space_${name}`, { knowledgeSpaceId: 's', expectedVersion: 0, ...(name === 'delete' ? { reason: 'cleanup' } : {}) })).toThrow()
  })
  it.each([
    { items: [] },
    { data: { items: [] } },
    { ...success({ items: [] }, pagination), result: {} },
    { data: {}, meta: { ...success({}).meta, success: false } },
    { data: null, meta: success({}).meta },
    { data: {}, meta: { ...success({}).meta, apiVersion: 'v2' } },
    { data: {}, meta: { ...success({}).meta, timestamp: '2026-09-05T08:00:00+08:00' } },
    success({ items: [] }),
  ])('rejects incomplete or inconsistent envelopes without compatibility: %j', body => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json(body)))
    return expect(client().listSpaces({})).rejects.toMatchObject({ code: 'KNOWLEDGE_GATEWAY_PROTOCOL_ERROR', retryable: false })
  })
  it('preserves pagination from HTTP meta in the provider-neutral page result', async () => {
    const fetch = vi.fn(async (_url: unknown) => Response.json(success({ items: [] }, pagination)))
    vi.stubGlobal('fetch', fetch)
    expect(await client().listSpaces({ page: 1, pageSize: 20 })).toEqual({ items: [], pagination })
    expect(String(fetch.mock.calls[0]?.[0])).toContain('?page=1&pageSize=20')
  })
  it('maps new business errors from meta.error without exposing remote field errors', async () => {
    const body = failure('KNOWLEDGE_METADATA_FIELD_NOT_ALLOWED')
    body.meta.error.message = 'private provider URL or API key'
    vi.stubGlobal('fetch', vi.fn(async () => Response.json(body, { status: 400 })))
    const error = await client().listSpaces({}).catch(error => error)
    expect(error.code).toBe('KNOWLEDGE_METADATA_FIELD_NOT_ALLOWED')
    expect(String(error)).not.toContain('private provider')
  })
  it('normalizes NFC and trim, preserves case and patch clearing semantics', () => {
    expect(parseKnowledgeToolInput('knowledge_document_update', { documentId: 'd', expectedVersion: 1, metadata: { productCode: ' device-a ', category: 'e\u0301', versionLabel: null, tags: [] } })).toEqual({ documentId: 'd', expectedVersion: 1, metadata: { productCode: 'device-a', category: 'é', versionLabel: null, tags: [] } })
    expect(parseKnowledgeToolInput('knowledge_search', { query: 'q', metadataFilter: { tagsAll: [' 设备 '], tagsAny: ['售后'], productCode: ['device-a'] } })).toEqual({ query: 'q', metadataFilter: { tagsAll: ['设备'], tagsAny: ['售后'], productCode: ['device-a'] } })
  })
  it.each([
    [{ department: 'finance' }, 'KNOWLEDGE_METADATA_FIELD_NOT_ALLOWED'],
    [{ tenantId: 't' }, 'KNOWLEDGE_METADATA_FIELD_NOT_ALLOWED'],
    [{ tags: ['财务', ' 财务 '] }, 'KNOWLEDGE_METADATA_VALUE_INVALID'],
    [{ tags: ['é', 'e\u0301'] }, 'KNOWLEDGE_METADATA_VALUE_INVALID'],
    [{ tags: Array.from({ length: 21 }, (_, i) => String(i)) }, 'KNOWLEDGE_METADATA_VALUE_INVALID'],
    [{ tags: null }, 'KNOWLEDGE_METADATA_VALUE_INVALID'],
    [{ tags: [''] }, 'KNOWLEDGE_METADATA_VALUE_INVALID'],
    [{ category: 'x'.repeat(65) }, 'KNOWLEDGE_METADATA_VALUE_INVALID'],
    [{ productCode: 'a\u0000b' }, 'KNOWLEDGE_METADATA_VALUE_INVALID'],
    [{ category: '\ud800'.repeat(64), versionLabel: '\ud801'.repeat(64), productCode: '\ud802'.repeat(64), tags: Array.from({ length: 20 }, (_, i) => String.fromCharCode(0xd800 + i).repeat(32)) }, 'KNOWLEDGE_METADATA_TOO_LARGE'],
  ])('rejects invalid metadata: %j', (input, code) => {
    try { parseKnowledgeToolInput('knowledge_document_update', { documentId: 'd', expectedVersion: 1, metadata: input }); throw new Error('accepted') } catch (error) { expect(error).toMatchObject({ code, status: 400 }) }
  })
  it('rejects metadata filters outside the fixed vocabulary and metadata on replacement/reindex', () => {
    expect(() => parseKnowledgeToolInput('knowledge_search', { query: 'q', metadataFilter: { department: ['finance'] } })).toThrow()
    for (const tool of ['knowledge_document_replace', 'knowledge_document_reindex']) expect(() => parseKnowledgeToolInput(tool, { documentId: 'd', expectedVersion: 1, fileResourceId: 'f', metadata })).toThrow()
    for (const input of [{ cursor: 'old' }, { limit: 20 }, { page: 0 }, { pageSize: 101 }]) expect(() => parseKnowledgeToolInput('knowledge_space_list', input)).toThrow()
  })
})
