import {
  knowledgeGatewayRoutes,
  knowledgeGatewaySchemas,
  type KnowledgeGatewayOperationId,
  type KnowledgeGatewayResponseData,
  type KnowledgeDocumentDetail,
  type DocumentVersionDetail,
  type SuccessMeta,
  type ListSuccessMeta,
  type ErrorEnvelope,
  type PaginationMeta,
} from './knowledge-openapi.generated.js'
import { KnowledgeGatewayError } from './knowledge-errors.js'
import { normalizeMetadata } from './metadata.js'

type Schema = Record<string, unknown>
const schemas = knowledgeGatewaySchemas as unknown as Record<string, Schema>

function codePointLength(value: string): number {
  return Array.from(value).length
}

function fail(path: string): never {
  throw new KnowledgeGatewayError(`The Knowledge Gateway response does not match the business contract at ${path}.`, {
    code: 'KNOWLEDGE_GATEWAY_PROTOCOL_ERROR',
    status: 502,
  })
}

function resolve(schema: Schema, depth = 0): Schema {
  if (depth > 64) return fail('$ref')
  const ref = schema.$ref
  if (typeof ref !== 'string') return schema
  const name = ref.split('/').at(-1)
  const target = name ? schemas[name] : undefined
  if (!target) return fail('$ref')
  return resolve(target, depth + 1)
}

function validate(schemaInput: Schema, value: unknown, path: string, depth = 0): void {
  if (depth > 64) fail(path)
  const schema = resolve(schemaInput)
  if ('const' in schema && !Object.is(value, schema.const)) fail(path)
  if (Array.isArray(schema.enum) && !schema.enum.some(entry => Object.is(entry, value))) fail(path)
  if (Array.isArray(schema.oneOf)) {
    let matches = 0
    for (const branch of schema.oneOf as Schema[]) {
      try { validate(branch, value, path, depth + 1); matches++ } catch (error) {
        if (!(error instanceof KnowledgeGatewayError)) throw error
      }
    }
    if (matches !== 1) fail(path)
    return
  }
  switch (schema.type) {
    case 'null':
      if (value !== null) fail(path)
      break
    case 'string': {
      if (typeof value !== 'string') fail(path)
      const length = codePointLength(value)
      if (typeof schema.minLength === 'number' && length < schema.minLength) fail(path)
      if (typeof schema.maxLength === 'number' && length > schema.maxLength) fail(path)
      if (typeof schema.pattern === 'string' && !new RegExp(schema.pattern, 'u').test(value)) fail(path)
      if (schema.format === 'uuid' && !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(value)) fail(path)
      if (schema.format === 'date-time' && (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/u.test(value) || Number.isNaN(Date.parse(value)))) fail(path)
      if (schema.format === 'uri') {
        try { new URL(value) } catch { fail(path) }
      }
      break
    }
    case 'integer':
    case 'number': {
      if (typeof value !== 'number' || !Number.isFinite(value) || (schema.type === 'integer' && !Number.isSafeInteger(value))) fail(path)
      if (typeof schema.minimum === 'number' && value < schema.minimum) fail(path)
      if (typeof schema.maximum === 'number' && value > schema.maximum) fail(path)
      break
    }
    case 'boolean':
      if (typeof value !== 'boolean') fail(path)
      break
    case 'array': {
      if (!Array.isArray(value)) fail(path)
      if (typeof schema.minItems === 'number' && value.length < schema.minItems) fail(path)
      if (typeof schema.maxItems === 'number' && value.length > schema.maxItems) fail(path)
      if (schema.uniqueItems === true && new Set(value.map(entry => JSON.stringify(entry))).size !== value.length) fail(path)
      const itemSchema = schema.items as Schema | undefined
      if (itemSchema) value.forEach((entry, index) => validate(itemSchema, entry, `${path}[${index}]`, depth + 1))
      break
    }
    case 'object': {
      if (!value || typeof value !== 'object' || Array.isArray(value)) fail(path)
      const record = value as Record<string, unknown>
      const properties = (schema.properties ?? {}) as Record<string, Schema>
      for (const name of (schema.required ?? []) as string[]) if (!Object.hasOwn(record, name)) fail(`${path}.${name}`)
      if (schema.additionalProperties === false) {
        for (const name of Object.keys(record)) if (!Object.hasOwn(properties, name)) fail(path)
      }
      for (const [name, child] of Object.entries(properties)) if (Object.hasOwn(record, name)) validate(child, record[name], `${path}.${name}`, depth + 1)
      break
    }
  }
}

function validateSearchResult(value: unknown): void {
  const result = value as { hits: Array<{ documentId: string; content: string }> }
  const perDocument = new Map<string, number>()
  let totalCodePoints = 0
  for (const hit of result.hits) {
    const count = (perDocument.get(hit.documentId) ?? 0) + 1
    if (count > 4) fail('$.data.hits')
    perDocument.set(hit.documentId, count)
    totalCodePoints += codePointLength(hit.content)
  }
  if (totalCodePoints > 16_000) fail('$.data.hits')
}

function validateCitationResult(value: unknown): void {
  const result = value as {
    beforeContent: string
    matchedContent: string
    afterContent: string
    requestedContextBefore: number
    requestedContextAfter: number
    actualContextBefore: number
    actualContextAfter: number
    pageStart?: number
    pageEnd?: number
  }
  const before = codePointLength(result.beforeContent)
  const matched = codePointLength(result.matchedContent)
  const after = codePointLength(result.afterContent)
  if (before + matched + after > 12_500) fail('$.data')
  if (result.actualContextBefore !== before || result.actualContextAfter !== after) fail('$.data.actualContext')
  if (result.actualContextBefore > result.requestedContextBefore || result.actualContextAfter > result.requestedContextAfter) fail('$.data.actualContext')
  if (result.pageStart !== undefined && result.pageEnd !== undefined && result.pageEnd < result.pageStart) fail('$.data.pageEnd')
}

function validateOperationData(operationId: KnowledgeGatewayOperationId, value: unknown): void {
  const dataSchema = knowledgeGatewayRoutes[operationId].dataSchema
  validate(schemas[dataSchema]!, value, '$.data')
  validateMetadataOutputs(value)
  if (operationId === 'knowledgeDocumentGet') validateDocumentDetail(value as KnowledgeDocumentDetail)
  if (operationId === 'knowledgeSearch') validateSearchResult(value)
  if (operationId === 'knowledgeCitationRead') validateCitationResult(value)
  if (operationId === 'knowledgeDocumentCreateDownloadLink') {
    const url = new URL((value as { downloadUrl: string }).downloadUrl)
    const local = url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '[::1]'
    if (url.protocol !== 'https:' && !(local && url.protocol === 'http:')) fail('$.data.downloadUrl')
  }
}

export type KnowledgeResponseMeta = SuccessMeta | ListSuccessMeta

function validatePage(items: unknown[], pagination: PaginationMeta): void {
  const { page, pageSize, totalItems, totalPages, hasNext } = pagination
  if (totalPages !== Math.ceil(totalItems / pageSize) || hasNext !== (page < totalPages)) fail('$.pagination')
  const remaining = page > totalPages ? 0 : totalItems - (page - 1) * pageSize
  if (items.length > Math.min(pageSize, remaining)) fail('$.items')
}

function validateMetadataOutputs(value: unknown): void {
  if (!value || typeof value !== 'object') return
  if (Array.isArray(value)) { value.forEach(validateMetadataOutputs); return }
  for (const [key, child] of Object.entries(value)) {
    if (key === 'metadata') {
      try {
        const normalized = normalizeMetadata(child, 'output')
        for (const field of Object.keys(normalized)) if (JSON.stringify(normalized[field]) !== JSON.stringify((child as Record<string, unknown>)[field])) fail('$.data.metadata')
      } catch { fail('$.data.metadata') }
    } else validateMetadataOutputs(child)
  }
}

function validateDocumentDetail(value: KnowledgeDocumentDetail): void {
  const { activeVersion: active, candidateVersion: candidate } = value
  if (value.searchable !== (value.status === 'ACTIVE' && active?.status === 'READY')) fail('$.data.searchable')
  if (active && candidate && active.versionId === candidate.versionId) fail('$.data.candidateVersion')
  if (candidate && ['RETIRED', 'DELETED'].includes(candidate.status)) fail('$.data.candidateVersion.status')
  const version = (entry: DocumentVersionDetail | null) => {
    if (!entry) return
    const terminal = entry.status === 'READY' || entry.status === 'RETIRED'
    if (terminal && (entry.progressPercent !== 100 || entry.progressSource !== 'TERMINAL_STATE')) fail('$.data.version.progressPercent')
    if (!terminal && entry.progressSource === 'TERMINAL_STATE') fail('$.data.version.progressSource')
    if ((entry.progressSource === 'UNAVAILABLE') !== (entry.progressPercent === null)) fail('$.data.version.progressPercent')
    if (entry.status !== 'FAILED' && (entry.error !== null || entry.retryable)) fail('$.data.version.error')
    if (entry.status === 'FAILED' && entry.error === null) fail('$.data.version.error')
    if (entry.error && entry.retryable !== entry.error.retryable) fail('$.data.version.retryable')
  }
  version(active); version(candidate)
}

export function parseKnowledgeErrorEnvelope(value: unknown): ErrorEnvelope {
  validate(schemas.ErrorEnvelope!, value, '$')
  return value as ErrorEnvelope
}

export function parseKnowledgeToolInput<Value>(toolName: string, value: unknown): Value {
  const route = Object.values(knowledgeGatewayRoutes).find(candidate => candidate.tool === toolName)
  if (!route) throw new KnowledgeGatewayError('The requested knowledge tool is not part of the Gateway contract.', { code: 'KNOWLEDGE_INVALID_INPUT', status: 422 })
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const input = value as Record<string, unknown>
    value = { ...input,
      ...(Object.hasOwn(input, 'metadata') && ['knowledge_document_upload', 'knowledge_document_update'].includes(toolName) ? { metadata: normalizeMetadata(input.metadata, toolName === 'knowledge_document_update' ? 'patch' : 'input') } : {}),
      ...(Object.hasOwn(input, 'metadataFilter') && toolName === 'knowledge_search' ? { metadataFilter: normalizeMetadata(input.metadataFilter, 'filter') } : {}),
    }
  }
  try {
    validate(schemas[route.toolSchema]!, value, '$.input')
  } catch (cause) {
    if (!(cause instanceof KnowledgeGatewayError)) throw cause
    throw new KnowledgeGatewayError('The knowledge tool input does not match the business contract.', { code: 'KNOWLEDGE_INVALID_INPUT', status: 422, cause })
  }
  return value as Value
}

export function parseKnowledgeToolResult<Value>(toolName: string, value: unknown): Value {
  const entry = Object.entries(knowledgeGatewayRoutes).find(([, route]) => route.tool === toolName)
  if (!entry) throw new KnowledgeGatewayError('The requested knowledge tool is not part of the Gateway contract.', { code: 'KNOWLEDGE_INVALID_INPUT', status: 422 })
  if (toolName === 'knowledge_space_list' || toolName === 'knowledge_document_list') {
    validate(schemas[toolName === 'knowledge_space_list' ? 'KnowledgeSpacePage' : 'KnowledgeDocumentPage']!, value, '$.data')
    validateMetadataOutputs(value)
    const page = value as { items: unknown[]; pagination: PaginationMeta }
    validatePage(page.items, page.pagination)
    return value as Value
  }
  validateOperationData(entry[0] as KnowledgeGatewayOperationId, value)
  return value as Value
}

export function parseKnowledgeEnvelope<Operation extends KnowledgeGatewayOperationId>(
  operationId: Operation,
  value: unknown,
): { data: KnowledgeGatewayResponseData<Operation>; meta: KnowledgeResponseMeta } {
  const responseSchema = knowledgeGatewayRoutes[operationId].responseSchema
  validate(schemas[responseSchema]!, value, '$')
  const envelope = value as { data: KnowledgeGatewayResponseData<Operation>; meta: KnowledgeResponseMeta }
  validateOperationData(operationId, envelope.data)
  if (envelope.meta.pagination) validatePage((envelope.data as { items: unknown[] }).items, envelope.meta.pagination)
  return envelope
}

export function parseKnowledgeResponse<Operation extends KnowledgeGatewayOperationId>(
  operationId: Operation,
  value: unknown,
): KnowledgeGatewayResponseData<Operation> {
  return parseKnowledgeEnvelope(operationId, value).data
}
