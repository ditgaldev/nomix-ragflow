import { describe, expect, it, vi } from 'vitest'
import type { ToolDefinition, ToolRunContext } from '@nomix-ai/nomix-harness/plugin/tools'
import { TOOLSET_TOOLS, type KnowledgeAgentToolName } from '../packages/dsh-knowledge/harness-contract.js'
import { knowledgeGatewayCapabilityManifest } from '../src/manifest.js'
import { knowledgeApprovalDecision } from '../packages/dsh-knowledge-policy/policy.js'
import { isKnowledgeToolConcurrencySafe } from '../packages/dsh-knowledge/harness-contract.js'
import { registerKnowledgeTools } from '../packages/dsh-bundle-ragflow-knowledge/tools.js'
import type { KnowledgeToolServices } from '../packages/dsh-knowledge/tool.js'

import { metadata, pagination, documentDetail } from './knowledge-fixtures.js'

const documentId = 'doc-policy'
const operationId = 'operation-70001'
const space = { spaceId: 'company-policy', code: 'company-policy', name: '公司制度', profileCode: 'enterprise-long-document', defaultSecurityDomainCode: 'company', status: 'ACTIVE', version: 1 }
const createdSpace = { spaceId: 'company-policy', code: 'company-policy', name: '公司制度', status: 'ACTIVE', version: 1 }
const version = { versionId: 'version-policy-v1', versionNumber: 1, status: 'READY', fileName: '员工手册.pdf', mimeType: 'application/pdf', fileSize: 1024 }
const document = { documentId, knowledgeSpaceId: 'company-policy', name: '员工手册', status: 'ACTIVE', version: 1, activeVersion: version, metadata }
const operation = { operationId, status: 'PENDING', operationType: 'DOCUMENT_REINDEX', resourceType: 'DOCUMENT', resourceId: documentId, createdAt: '2026-09-04T00:00:00Z' }

function setup(toolset: keyof typeof TOOLSET_TOOLS) {
  const agent = { id: 'session-1' }
  const definitions: ToolDefinition[] = []
  const tools = { register(definition: ToolDefinition) { definitions.push(definition); return () => definitions.splice(definitions.indexOf(definition), 1) } }
  const calls: unknown[][] = []
  const client = new Proxy({}, { get: (_target, name) => name === 'then' ? undefined : async (...args: unknown[]) => {
    calls.push([name, ...args])
    if (name === 'search') return { hits: [], reason: 'NO_AUTHORIZED_RELEVANT_EVIDENCE' }
    if (name === 'listSpaces' || name === 'listDocuments') return { items: [], pagination }
    if (name === 'createSpace') return createdSpace
    if (name === 'getSpace') return space
    if (name === 'updateSpace') return { spaceId: space.spaceId, name: space.name, status: space.status, version: 2 }
    if (name === 'deleteSpace') return { spaceId: 'company-policy', operationId, status: 'PENDING' }
    if (name === 'getDocument') return documentDetail({ documentId })
    if (name === 'updateDocument' || name === 'enableDocument' || name === 'disableDocument') return document
    if (name === 'getCitation') return { citationId: 'citation-1', documentId, versionId: version.versionId, documentName: '员工手册', chapterPath: [], beforeContent: '', matchedContent: '正文', afterContent: '', requestedContextBefore: 1000, requestedContextAfter: 1000, actualContextBefore: 0, actualContextAfter: 0, matchedContentTruncated: false, locationPrecision: 'EXACT_OFFSET' }
    if (name === 'createDownloadLink') return { documentId, versionId: version.versionId, fileName: version.fileName, mimeType: version.mimeType, fileSize: version.fileSize, downloadUrl: 'https://knowledge-gateway.example.com/download/file', expiresAt: '2026-09-04T00:01:00Z', expiresInSeconds: 60 }
    if (name === 'retryOperation') return { operationId: 'operation-70002', parentOperationId: operationId, status: 'PENDING' }
    if (name === 'getOperation' || name === 'cancelOperation') return operation
    return { documentId, operationId, status: 'PENDING' }
  } })
  const spillText = vi.fn(async (_exec, input: { name: string; content: string }) => ({ kind: 'spill' as const, name: input.name, locator: '/spill/full.json', mimeType: 'application/json' as const, encoding: 'utf8' as const, bytes: Buffer.byteLength(input.content), storedBytes: Buffer.byteLength(input.content), retrievalHint: 'read it' }))
  const idempotencyKey = vi.fn(() => 'knowledge:stable-key')
  const services = { knowledge: async () => client, idempotencyKey, spillText } as unknown as KnowledgeToolServices
  const dispose = registerKnowledgeTools({ agent, get: () => tools } as never, services, TOOLSET_TOOLS[toolset], 90_000)
  const exec = (name: string) => ({ agent, name, callId: 'call-1', rootCallId: 'root-1', signal: new AbortController().signal } as unknown as ToolRunContext)
  return { calls, definitions, dispose, exec, idempotencyKey, spillText }
}

function byName(definitions: ToolDefinition[]): Record<string, ToolDefinition> {
  return Object.fromEntries(definitions.map(definition => [definition.name, definition]))
}

describe('knowledge tool installation and policy', () => {
  it('rolls back a partially registered tool group on failure', () => {
    const active = new Set<string>()
    const runtime = { register(definition: ToolDefinition) {
      if (active.size === 2) throw new Error('registration failed')
      active.add(definition.name)
      return () => active.delete(definition.name)
    } }
    expect(() => registerKnowledgeTools({ get: () => runtime } as never, {} as KnowledgeToolServices, TOOLSET_TOOLS.read)).toThrow('registration failed')
    expect(active.size).toBe(0)
  })

  it.each(['read', 'write', 'admin'] as const)('installs exactly the %s toolset with contract-defined concurrency', toolset => {
    const value = setup(toolset)
    expect(value.definitions.map(definition => definition.name)).toEqual(TOOLSET_TOOLS[toolset])
    expect(value.definitions.every(definition => (definition.output.schema as { additionalProperties?: boolean }).additionalProperties === false)).toBe(true)
    for (const definition of value.definitions) expect(definition.isConcurrencySafe?.({})).toBe(isKnowledgeToolConcurrencySafe(definition.name))
    expect(byName(value.definitions).knowledge_document_download?.isConcurrencySafe?.({})).toBe(true)
    value.dispose()
    expect(value.definitions).toEqual([])
  })

  it('applies approval independently from read/write concurrency and never requires a model UUID', async () => {
    const next = vi.fn(async () => ({ kind: 'allow' as const }))
    const ask = knowledgeGatewayCapabilityManifest.operations.filter(operation => operation.approval === 'ask').map(operation => operation.tool)
    const allow = knowledgeGatewayCapabilityManifest.operations.filter(operation => operation.approval === 'allow').map(operation => operation.tool)
    for (const name of ask) await expect(knowledgeApprovalDecision(name, next)).resolves.toMatchObject({ kind: 'ask' })
    for (const name of allow) await expect(knowledgeApprovalDecision(name, next)).resolves.toEqual({ kind: 'allow' })
    expect(ask).toContain('knowledge_document_download')
    expect(allow).toContain('knowledge_document_upload')
    expect(allow).toContain('knowledge_document_update')
    await expect(knowledgeApprovalDecision('knowledge_space_delete', async () => ({ kind: 'deny', reason: 'global policy' }))).resolves.toEqual({ kind: 'deny', reason: 'global policy' })
  })

  it('keeps maintenance tools away from administrator deletion and space management', () => {
    const write = setup('write').definitions.map(definition => definition.name)
    expect(write).not.toContain('knowledge_document_delete')
    expect(write).not.toContain('knowledge_space_create')
    expect(setup('admin').definitions.map(definition => definition.name)).toContain('knowledge_document_delete')
  })

  it('dispatches single-resource methods and derives every mutation idempotency key from execution context', async () => {
    const value = setup('admin')
    const tools = byName(value.definitions)
    const run = (name: KnowledgeAgentToolName, input: Record<string, unknown>) => tools[name]!.execute({ input }, value.exec(name))
    await run('knowledge_document_upload', { knowledgeSpaceId: 'company-policy', fileResourceId: 'file-policy-v1', documentName: '员工手册.pdf' })
    await run('knowledge_document_update', { documentId, expectedVersion: 1, name: '新版员工手册' })
    await run('knowledge_document_replace', { documentId, expectedVersion: 2, fileResourceId: 'file-policy-v2' })
    await run('knowledge_document_enable', { documentId, expectedVersion: 3 })
    await run('knowledge_document_disable', { documentId, expectedVersion: 4, reason: '临时下线' })
    await run('knowledge_document_reindex', { documentId, expectedVersion: 5 })
    await run('knowledge_operation_cancel', { operationId, reason: '取消本次操作' })
    await run('knowledge_operation_retry', { operationId, reason: '已排除失败原因' })
    await run('knowledge_space_create', { code: 'company-policy', name: '公司制度', profileCode: 'enterprise-long-document', defaultSecurityDomainCode: 'company' })
    await run('knowledge_space_update', { knowledgeSpaceId: 'company-policy', expectedVersion: 1, description: '公司制度库' })
    await run('knowledge_space_delete', { knowledgeSpaceId: 'company-policy', expectedVersion: 2, reason: '空间已清空' })
    await run('knowledge_document_delete', { documentId, expectedVersion: 6, reason: '文档作废' })
    expect(value.calls.map(call => call[0])).toEqual([
      'uploadDocument', 'updateDocument', 'replaceDocument', 'enableDocument', 'disableDocument', 'reindexDocument',
      'cancelOperation', 'retryOperation', 'createSpace', 'updateSpace', 'deleteSpace', 'deleteDocument',
    ])
    expect(value.idempotencyKey).toHaveBeenCalledTimes(12)
    expect(JSON.stringify(value.calls)).not.toContain('operationId":"aaaaaaaa')
    expect(JSON.stringify(value.calls)).not.toContain('sourcePath')
    expect(JSON.stringify(value.calls)).not.toContain('base64')
    expect(value.calls[0]).toEqual(['uploadDocument', 'company-policy', { fileResourceId: 'file-policy-v1', documentName: '员工手册.pdf' }, expect.objectContaining({ idempotencyKey: 'knowledge:stable-key' })])
  })

  it('enforces OpenAPI bounds and closed inputs before dispatch', async () => {
    const value = setup('admin')
    const tools = byName(value.definitions)
    await expect(tools.knowledge_search!.execute({ input: { query: 'q', limit: 9 } }, value.exec('knowledge_search'))).rejects.toMatchObject({ code: 'KNOWLEDGE_INVALID_INPUT' })
    await expect(tools.knowledge_document_upload!.execute({ input: { knowledgeSpaceId: 'space', items: [{ fileResourceId: 'file' }] } }, value.exec('knowledge_document_upload'))).rejects.toMatchObject({ code: 'KNOWLEDGE_INVALID_INPUT' })
    await expect(tools.knowledge_document_update!.execute({ input: { documentId, expectedVersion: 1 } }, value.exec('knowledge_document_update'))).rejects.toMatchObject({ code: 'KNOWLEDGE_INVALID_INPUT' })
    await expect(tools.knowledge_document_update!.execute({ input: { documentId, expectedVersion: 1, metadata: {} } }, value.exec('knowledge_document_update'))).rejects.toMatchObject({ code: 'KNOWLEDGE_INVALID_INPUT' })
    await expect(tools.knowledge_space_delete!.execute({ input: { knowledgeSpaceId: 'space', expectedVersion: 1, reason: 'r', cascade: true } }, value.exec('knowledge_space_delete'))).rejects.toMatchObject({ code: 'KNOWLEDGE_INVALID_INPUT' })
    await expect(tools.knowledge_operation_get!.execute({ input: { operationId: 'operation-opaque' } }, value.exec('knowledge_operation_get'))).resolves.toBeTruthy()
  })

  it('renders bounded search evidence and citation locations', () => {
    const search = byName(setup('read').definitions).knowledge_search!
    const render = search.output.render
    const [block] = render({}, { status: 'success', summary: 'done', data: { kind: 'inline', format: 'structured', resultKind: 'retrieval', result: { query: '休假', hits: [{ citationId: 'cit-policy-1', documentId, documentName: '员工手册', page: 12, chapterPath: ['休假制度'], content: '提交申请。', score: 0.9, locationPrecision: 'EXACT_OFFSET' }], traceId: 'trace-1' }, bytes: 10, truncated: false }, nextActions: [], artifacts: [] })
    expect(block).toMatchObject({ type: 'text' })
    expect('text' in block! ? block.text : '').toContain('【证据 1】员工手册 · 休假制度 · 第 12 页')
    expect('text' in block! ? block.text : '').toContain('引用：cit-policy-1')
  })

  it.each([
    ['knowledge_search', { query: 'q' }],
    ['knowledge_source_read', { citationId: 'citation-1' }],
  ] as const)('spills a large valid %s result as UTF-8 JSON without Base64', async (name, input) => {
    const agent = { id: 'session-1' }
    const definitions: ToolDefinition[] = []
    const tools = { register(definition: ToolDefinition) { definitions.push(definition); return () => undefined } }
    const search = { query: 'q', traceId: 'trace', hits: Array.from({ length: 6 }, (_, index) => ({ citationId: `citation-${index}`, documentId: `doc-${index % 2}`, metadata, documentName: 'Doc', chapterPath: [], content: 'x'.repeat(2_000), score: 0.8, locationPrecision: 'EXACT_OFFSET' })) }
    const citation = { citationId: 'citation-1', documentId, versionId: version.versionId, documentName: 'Doc', chapterPath: [], beforeContent: 'a'.repeat(5_000), matchedContent: 'b'.repeat(2_500), afterContent: 'c'.repeat(5_000), requestedContextBefore: 5_000, requestedContextAfter: 5_000, actualContextBefore: 5_000, actualContextAfter: 5_000, matchedContentTruncated: true, locationPrecision: 'CHUNK_APPROXIMATE' }
    const client = new Proxy({}, { get: (_target, key) => key === 'then' ? undefined : async () => key === 'search' ? search : citation })
    const spillText = vi.fn(async (_exec, value: { name: string; content: string }) => ({ kind: 'spill' as const, name: value.name, locator: '/spill/full.json', mimeType: 'application/json' as const, encoding: 'utf8' as const, bytes: Buffer.byteLength(value.content), storedBytes: Buffer.byteLength(value.content), retrievalHint: 'read it' }))
    registerKnowledgeTools({ agent, get: () => tools } as never, { knowledge: async () => client, idempotencyKey: () => 'knowledge:key', spillText } as unknown as KnowledgeToolServices, [name], 90_000)
    const result = await definitions[0]!.execute({ input }, ({ agent, name, callId: 'call-large', rootCallId: 'root-large', signal: new AbortController().signal } as unknown as ToolRunContext))
    expect(result).toMatchObject({ data: { kind: 'artifact-reference' }, artifacts: [{ encoding: 'utf8', mimeType: 'application/json' }] })
    expect(JSON.stringify(result)).not.toContain('base64')
    expect(spillText).toHaveBeenCalledOnce()
  })

  it('rejects an out-of-contract provider result before it can spill', async () => {
    const agent = { id: 'session-1' }
    const definitions: ToolDefinition[] = []
    const tools = { register(definition: ToolDefinition) { definitions.push(definition); return () => undefined } }
    const result = { query: 'q', traceId: 'trace', hits: Array.from({ length: 5 }, (_, index) => ({ citationId: `citation-${index}`, documentId: 'same-document', metadata, documentName: 'Doc', chapterPath: [], content: 'x'.repeat(2_500), score: 0.8 })) }
    const spillText = vi.fn()
    registerKnowledgeTools({ agent, get: () => tools } as never, { knowledge: async () => ({ search: async () => result }), idempotencyKey: () => 'knowledge:key', spillText } as unknown as KnowledgeToolServices, ['knowledge_search'], 90_000)
    await expect(definitions[0]!.execute({ input: { query: 'q' } }, ({ agent, name: 'knowledge_search', callId: 'call-invalid', rootCallId: 'root-invalid', signal: new AbortController().signal } as unknown as ToolRunContext))).rejects.toMatchObject({ code: 'KNOWLEDGE_GATEWAY_PROTOCOL_ERROR' })
    expect(spillText).not.toHaveBeenCalled()
  })
})
