import { readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const sourcePath = resolve(root, 'contracts', 'knowledge-gateway.openapi.json')
const typesPath = resolve(root, 'packages', 'dsh-knowledge', 'knowledge-openapi.generated.ts')
const toolSchemasPath = resolve(root, 'packages', 'dsh-knowledge', 'knowledge-tool-schemas.generated.ts')
const manifestPath = resolve(root, 'packages', 'dsh-knowledge', 'knowledge-capabilities.generated.json')
const check = process.argv.includes('--check')
const document = JSON.parse(await readFile(sourcePath, 'utf8'))

if (document.openapi !== '3.1.0') throw new Error('Knowledge Gateway contract must use OpenAPI 3.1.0')

function schemaName(ref) {
  return String(ref).split('/').at(-1)
}

function schemaType(schema, depth = 0) {
  if (schema.$ref) return schemaName(schema.$ref)
  if ('const' in schema) return JSON.stringify(schema.const)
  if (Array.isArray(schema.enum)) return schema.enum.map(value => JSON.stringify(value)).join(' | ')
  if (Array.isArray(schema.oneOf)) return schema.oneOf.map(value => schemaType(value, depth)).join(' | ')
  if (schema.type === 'null') return 'null'
  if (schema.type === 'string') return 'string'
  if (schema.type === 'integer' || schema.type === 'number') return 'number'
  if (schema.type === 'boolean') return 'boolean'
  if (schema.type === 'array') return `Array<${schemaType(schema.items ?? {}, depth + 1)}>`
  if (schema.type === 'object') {
    const required = new Set(schema.required ?? [])
    const indent = '  '.repeat(depth + 1)
    const close = '  '.repeat(depth)
    const entries = Object.entries(schema.properties ?? {}).map(([name, child]) => `${indent}${JSON.stringify(name)}${required.has(name) ? '' : '?'}: ${schemaType(child, depth + 1)}`)
    if (schema.additionalProperties && typeof schema.additionalProperties === 'object') entries.push(`${indent}[key: string]: ${schemaType(schema.additionalProperties, depth + 1)}`)
    return `{\n${entries.join('\n')}\n${close}}`
  }
  return 'unknown'
}

function resolveSchema(schema) {
  if (!schema?.$ref) return schema
  const resolved = document.components?.schemas?.[schemaName(schema.$ref)]
  if (!resolved) throw new Error(`Unknown schema reference ${schema.$ref}`)
  return resolveSchema(resolved)
}

function toolSchema(schemaInput) {
  const schema = resolveSchema(schemaInput)
  if (!schema) throw new Error('Knowledge tool schema is missing')
  if (Array.isArray(schema.oneOf)) return { oneOf: schema.oneOf.map(toolSchema) }
  const type = schema.type ?? (typeof schema.const === 'string' ? 'string' : typeof schema.const === 'boolean' ? 'boolean' : typeof schema.const === 'number' ? 'number' : undefined)
  const result = {}
  // Harness 0.2.9 intentionally supports a small enforced schema DSL. Full
  // OpenAPI bounds remain authoritative and are checked again before dispatch.
  for (const key of ['const', 'enum', 'default']) {
    if (key in schema) result[key] = schema[key]
  }
  const bounds = []
  if (typeof schema.minLength === 'number' || typeof schema.maxLength === 'number') bounds.push(`Length: ${schema.minLength ?? 0} to ${schema.maxLength ?? 'unbounded'} Unicode code points.`)
  if (typeof schema.minimum === 'number' || typeof schema.maximum === 'number') bounds.push(`Range: ${schema.minimum ?? 'unbounded'} to ${schema.maximum ?? 'unbounded'}.`)
  if (typeof schema.minItems === 'number' || typeof schema.maxItems === 'number') bounds.push(`Items: ${schema.minItems ?? 0} to ${schema.maxItems ?? 'unbounded'}.`)
  if (schema.uniqueItems === true) bounds.push('Items must be unique.')
  if (typeof schema.pattern === 'string') bounds.push('Must be a non-whitespace opaque business identifier when applicable.')
  const description = [schema.description, ...bounds].filter(Boolean).join(' ')
  if (description) result.description = description
  if (type) result.type = type
  if (type === 'array' && schema.items) result.items = toolSchema(schema.items)
  if (type === 'object') {
    const required = new Set(schema.required ?? [])
    result.additionalProperties = schema.additionalProperties !== false
    result.properties = Object.fromEntries(Object.entries(schema.properties ?? {}).map(([name, child]) => {
      const converted = toolSchema(child)
      if (required.has(name)) converted.required = true
      return [name, converted]
    }))
  }
  return result
}

function successfulResponse(operation) {
  return Object.entries(operation.responses ?? {}).find(([status]) => /^2\d\d$/u.test(status))?.[1]
}

function responseSchemaName(operation) {
  const schema = successfulResponse(operation)?.content?.['application/json']?.schema
  if (!schema?.$ref) throw new Error(`Operation ${operation.operationId} must declare a referenced JSON success response`)
  return schemaName(schema.$ref)
}

function dataSchemaName(responseName) {
  const data = document.components?.schemas?.[responseName]?.properties?.data
  if (!data?.$ref) throw new Error(`Response ${responseName} must expose data through a schema reference`)
  return schemaName(data.$ref)
}

const requiredHeaders = document['x-nomix-required-headers']
if (!Array.isArray(requiredHeaders) || requiredHeaders.length === 0) throw new Error('Knowledge Gateway contract must declare trusted context headers')
for (const header of requiredHeaders) {
  const parameter = document.components?.parameters?.[header]
  if (!parameter || parameter.in !== 'header' || parameter.required !== true) throw new Error(`Missing required header parameter ${header}`)
}
if (!document.security?.length || !document.components?.securitySchemes?.HarnessServiceToken) throw new Error('Knowledge Gateway contract must require the Harness service token')

const operations = []
const routes = {}
const responseData = {}
const inputSchemas = {}
for (const [path, item] of Object.entries(document.paths ?? {})) {
  for (const method of ['get', 'post', 'put', 'patch', 'delete']) {
    const operation = item[method]
    if (!operation) continue
    if (!path.startsWith('/internal/v1/knowledge/')) throw new Error(`Agent operation escapes the internal knowledge prefix: ${path}`)
    const { operationId } = operation
    if (!operationId || !operation.responses) throw new Error(`Incomplete OpenAPI operation: ${method.toUpperCase()} ${path}`)
    if (routes[operationId]) throw new Error(`Duplicate OpenAPI operationId: ${operationId}`)
    const tool = operation['x-nomix-tool']
    const actions = operation['x-nomix-actions']
    const risk = operation['x-nomix-risk']
    const approval = operation['x-nomix-approval']
    const concurrency = operation['x-nomix-concurrency']
    const toolSchemaName = operation['x-nomix-tool-schema']
    if (!tool || !Array.isArray(actions) || actions.length === 0 || !['read', 'write', 'admin'].includes(risk)) throw new Error(`Incomplete capability metadata for ${operationId}`)
    if (!['allow', 'ask'].includes(approval) || !['parallel', 'exclusive'].includes(concurrency)) throw new Error(`Incomplete Harness policy metadata for ${operationId}`)
    if (!toolSchemaName || !document.components?.schemas?.[toolSchemaName]) throw new Error(`Missing tool schema for ${operationId}`)
    if (inputSchemas[tool]) throw new Error(`Tool ${tool} is mapped more than once`)
    const requestRef = operation.requestBody?.content?.['application/json']?.schema?.$ref
    const requestSchema = requestRef ? schemaName(requestRef) : undefined
    const querySchema = operation['x-nomix-query-schema']
    for (const name of [requestSchema, querySchema].filter(Boolean)) if (!document.components?.schemas?.[name]) throw new Error(`Unknown schema ${name} for ${operationId}`)
    if (method !== 'get' && !requestSchema) throw new Error(`Missing request schema for ${operationId}`)
    const idempotency = operation['x-nomix-idempotency'] ?? 'none'
    if (risk !== 'read' && idempotency !== 'required') throw new Error(`Mutation ${operationId} must require idempotency`)
    if (risk !== 'read' && concurrency !== 'exclusive') throw new Error(`Mutation ${operationId} must be exclusive`)
    const responseSchema = responseSchemaName(operation)
    const dataSchema = dataSchemaName(responseSchema)
    const retrySafe = operation['x-nomix-retry-safe']
    if (typeof retrySafe !== 'boolean' || (risk !== 'read' && retrySafe)) throw new Error(`Invalid transport retry policy for ${operationId}`)
    const parameters = [...(item.parameters ?? []), ...(operation.parameters ?? [])].map(parameter => parameter.$ref ? document.components.parameters[schemaName(parameter.$ref)] : parameter)
    for (const match of path.matchAll(/\{([^}]+)\}/gu)) {
      if (!parameters.some(parameter => parameter.in === 'path' && parameter.name === match[1] && parameter.required === true)) throw new Error(`Missing OpenAPI path parameter for ${operationId}`)
    }
    for (const header of requiredHeaders) {
      if (!parameters.some(parameter => parameter.in === 'header' && parameter.name === document.components.parameters[header].name && parameter.required === true)) throw new Error(`Missing OpenAPI identity header for ${operationId}`)
    }
    if (idempotency === 'required' && !parameters.some(parameter => parameter.in === 'header' && parameter.name === 'Idempotency-Key' && parameter.required === true)) throw new Error(`Missing OpenAPI idempotency header for ${operationId}`)
    if (querySchema) {
      const queryProperties = Object.fromEntries(parameters.filter(parameter => parameter.in === 'query').map(parameter => [parameter.name, parameter.schema]))
      if (JSON.stringify(queryProperties) !== JSON.stringify(document.components.schemas[querySchema].properties)) throw new Error(`OpenAPI query parameters drifted for ${operationId}`)
    }
    routes[operationId] = { method: method.toUpperCase(), path, responseSchema, dataSchema, idempotency, tool, actions, risk, approval, concurrency, retrySafe, toolSchema: toolSchemaName, ...(requestSchema ? { requestSchema } : {}), ...(querySchema ? { querySchema } : {}) }
    responseData[operationId] = dataSchema
    inputSchemas[tool] = toolSchema(document.components.schemas[toolSchemaName])
    operations.push({ operation: operationId, method: method.toUpperCase(), path, tool, actions, risk, approval, concurrency, retrySafe, idempotency, responseSchema: dataSchema, toolSchema: toolSchemaName, ...(requestSchema ? { requestSchema } : {}), ...(querySchema ? { querySchema } : {}) })
  }
}
operations.sort((left, right) => left.operation.localeCompare(right.operation))
if (operations.length !== 20) throw new Error(`Knowledge Gateway contract must expose exactly 20 tools, found ${operations.length}`)
const headerNames = requiredHeaders.map(name => document.components.parameters[name].name)
const expectedHeaderNames = ['X-User-Assertion', 'X-Harness-Session-Id', 'X-Tool-Call-Id', 'X-Request-Id']
if (JSON.stringify(headerNames) !== JSON.stringify(expectedHeaderNames)) throw new Error('Knowledge Gateway trusted headers do not match the finalized identity protocol')
const approvalPolicy = document['x-nomix-business-rules']?.approvalPolicy
for (const approval of ['allow', 'ask']) {
  const declared = approvalPolicy?.[approval]
  const actual = operations.filter(operation => operation.approval === approval).map(operation => operation.tool)
  if (!Array.isArray(declared) || declared.length !== new Set(declared).size || declared.length !== actual.length || actual.some(tool => !declared.includes(tool))) {
    throw new Error(`Business approvalPolicy.${approval} does not match per-tool metadata`)
  }
}
if (document['x-nomix-business-rules']?.writeCardinality !== 'single-resource') throw new Error('Knowledge mutations must use single-resource cardinality')
const lifecycleSchemas = { space: 'SpaceStatus', document: 'DocumentStatus', version: 'VersionStatus', operation: 'OperationStatus' }
for (const [resource, schema] of Object.entries(lifecycleSchemas)) {
  if (JSON.stringify(document['x-nomix-business-rules']?.lifecycle?.[resource]) !== JSON.stringify(document.components.schemas[schema]?.enum)) throw new Error(`${resource} lifecycle metadata has drifted from ${schema}`)
}
function assertPropertyNames(schema, expected, label) {
  const actual = Object.keys(resolveSchema(document.components.schemas[schema])?.properties ?? {})
  if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error(`${label} fields do not match the finalized contract`)
}
assertPropertyNames('KnowledgeSearchToolInput', ['query', 'knowledgeSpaceIds', 'documentIds', 'limit', 'metadataFilter'], 'knowledge_search')
assertPropertyNames('KnowledgeDocumentDownloadToolInput', ['documentId'], 'knowledge_document_download')
assertPropertyNames('KnowledgeSpaceCreateToolInput', ['code', 'name', 'description', 'profileCode', 'defaultSecurityDomainCode'], 'knowledge_space_create')
assertPropertyNames('KnowledgeSpaceUpdateToolInput', ['knowledgeSpaceId', 'name', 'description', 'expectedVersion'], 'knowledge_space_update')
assertPropertyNames('KnowledgeSpaceDeleteToolInput', ['knowledgeSpaceId', 'expectedVersion', 'reason'], 'knowledge_space_delete')

const manifestValue = {
  standardVersion: 'v1',
  service: 'knowledge-gateway',
  source: 'Knowledge Gateway OpenAPI',
  requiredHeaders: requiredHeaders.map(name => document.components.parameters[name].name),
  businessRules: document['x-nomix-business-rules'],
  operations,
}
const manifest = `${JSON.stringify(manifestValue, null, 2)}\n`
const members = operations.map(item => `  ${JSON.stringify(item.operation)}: { method: ${JSON.stringify(item.method)}; path: ${JSON.stringify(item.path)}; tool: ${JSON.stringify(item.tool)}; actions: ${JSON.stringify(item.actions)}; risk: ${JSON.stringify(item.risk)}; approval: ${JSON.stringify(item.approval)}; concurrency: ${JSON.stringify(item.concurrency)}; response: ${item.responseSchema} }`).join('\n')
const schemas = Object.entries(document.components?.schemas ?? {}).map(([name, schema]) => `export type ${name} = ${schemaType(schema)}`).join('\n')
const responseMembers = Object.entries(responseData).map(([operation, schema]) => `  ${JSON.stringify(operation)}: ${schema}`).join('\n')
const types = `/** Generated from contracts/knowledge-gateway.openapi.json. Do not edit. */
${schemas}
export interface KnowledgeGatewayOperationMap {
${members}
}
export interface KnowledgeGatewayResponseDataMap {
${responseMembers}
}
export type KnowledgeGatewayOperationId = keyof KnowledgeGatewayResponseDataMap
export type KnowledgeGatewayResponseData<Operation extends KnowledgeGatewayOperationId> = KnowledgeGatewayResponseDataMap[Operation]
export type KnowledgeGatewayData = KnowledgeGatewayResponseDataMap[KnowledgeGatewayOperationId] | KnowledgeSpacePage | KnowledgeDocumentPage
export type KnowledgeGatewayOperation = keyof KnowledgeGatewayOperationMap
export type KnowledgeGatewayRisk = KnowledgeGatewayOperationMap[KnowledgeGatewayOperation]['risk']
export const knowledgeGatewayRoutes = ${JSON.stringify(routes, null, 2)} as const
export const knowledgeGatewaySchemas = ${JSON.stringify(document.components?.schemas ?? {}, null, 2)} as const
`
const toolSchemas = `/** Generated from contracts/knowledge-gateway.openapi.json. Do not edit. */
export const knowledgeToolInputSchemas = ${JSON.stringify(inputSchemas, null, 2)} as const
export const knowledgeToolDataSchemas = ${JSON.stringify(Object.fromEntries([...new Set([...Object.values(responseData), 'KnowledgeSpacePage', 'KnowledgeDocumentPage'])].map(name => [name, toolSchema(document.components.schemas[name])])), null, 2)} as const
`

if (check) {
  const stale = []
  if ((await readFile(typesPath, 'utf8').catch(() => '')).replaceAll('\r\n', '\n') !== types) stale.push('packages/dsh-knowledge/knowledge-openapi.generated.ts')
  if ((await readFile(toolSchemasPath, 'utf8').catch(() => '')).replaceAll('\r\n', '\n') !== toolSchemas) stale.push('packages/dsh-knowledge/knowledge-tool-schemas.generated.ts')
  if ((await readFile(manifestPath, 'utf8').catch(() => '')).replaceAll('\r\n', '\n') !== manifest) stale.push('packages/dsh-knowledge/knowledge-capabilities.generated.json')
  if (stale.length) throw new Error(`${stale.join(', ')} stale; run npm run contracts:generate`)
} else {
  await writeFile(typesPath, types)
  await writeFile(toolSchemasPath, toolSchemas)
  await writeFile(manifestPath, manifest)
}
