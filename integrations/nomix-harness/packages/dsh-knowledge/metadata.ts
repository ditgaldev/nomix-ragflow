import { KnowledgeGatewayError, type KnowledgeErrorCode } from './knowledge-errors.js'

function invalid(code: KnowledgeErrorCode = 'KNOWLEDGE_METADATA_VALUE_INVALID'): never {
  throw new KnowledgeGatewayError('Knowledge metadata does not satisfy the declared business contract.', { code, status: 400 })
}

/** Validate normalized values without guessing business classifications or dropping fields. */
export function normalizeMetadata(value: unknown, mode: 'input' | 'patch' | 'output' | 'filter'): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid()
  const allowed = mode === 'filter' ? ['category', 'tagsAny', 'tagsAll', 'versionLabel', 'productCode'] : ['category', 'tags', 'versionLabel', 'productCode']
  const result: Record<string, unknown> = {}
  const text = (entry: unknown, max: number) => {
    if (typeof entry !== 'string') invalid()
    const normalized = entry.normalize('NFC').trim()
    if (!normalized || Array.from(normalized).length > max || /\p{Cc}/u.test(normalized)) invalid()
    return normalized
  }
  for (const [key, entry] of Object.entries(value)) {
    if (!allowed.includes(key)) invalid(mode === 'filter' ? 'KNOWLEDGE_METADATA_FILTER_FIELD_NOT_ALLOWED' : 'KNOWLEDGE_METADATA_FIELD_NOT_ALLOWED')
    const array = mode === 'filter' || key === 'tags'
    if (array) {
      if (!Array.isArray(entry) || entry.length > 20 || (mode === 'filter' && entry.length === 0)) invalid()
      const values = entry.map(item => text(item, key.startsWith('tags') ? 32 : 64))
      if (new Set(values).size !== values.length) invalid()
      result[key] = values
    } else {
      result[key] = entry === null && (mode === 'patch' || mode === 'output') ? null : text(entry, 64)
    }
  }
  if (mode === 'output' && allowed.some(key => !Object.hasOwn(result, key))) invalid()
  if (mode !== 'filter' && new TextEncoder().encode(JSON.stringify(result)).byteLength > 4096) invalid('KNOWLEDGE_METADATA_TOO_LARGE')
  return result
}
