import { spawnSync } from 'node:child_process'
import { readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const repositoryRoot = resolve(packageRoot, '..', '..')
const outputPath = resolve(packageRoot, 'src', 'openapi.generated.ts')
const manifestSourcePath = resolve(repositoryRoot, 'api', 'apps', 'business_gateway', 'capabilities.v1.json')
const manifestOutputPath = resolve(packageRoot, 'src', 'capabilities.generated.json')
const check = process.argv.includes('--check')

const pythonSource = String.raw`
import importlib
import json
import sys
import types
from importlib.util import module_from_spec, spec_from_file_location
from pathlib import Path

source = Path.cwd() / "api" / "apps" / "business_gateway"
quart = types.ModuleType("quart")
quart.jsonify = lambda value: value
sys.modules.setdefault("quart", quart)
package_name = "_business_gateway_openapi_codegen"
spec = spec_from_file_location(package_name, source / "__init__.py", submodule_search_locations=[str(source)])
if spec is None or spec.loader is None:
    raise RuntimeError("Unable to load Business Gateway package")
package = module_from_spec(spec)
sys.modules[package_name] = package
spec.loader.exec_module(package)
openapi = importlib.import_module(f"{package_name}.openapi")
print(json.dumps(openapi.build_openapi(), ensure_ascii=False, separators=(",", ":")))
`

function openApiDocument() {
  const candidates = [...new Set([process.env.PYTHON, process.platform === 'win32' ? 'python' : 'python3', 'python'].filter(Boolean))]
  const failures = []
  for (const command of candidates) {
    const result = spawnSync(command, ['-c', pythonSource], { cwd: repositoryRoot, encoding: 'utf8' })
    if (result.status === 0) return JSON.parse(result.stdout)
    failures.push(`${command}: ${(result.stderr || result.error?.message || `exit ${result.status}`).trim()}`)
  }
  throw new Error(`Unable to build the canonical Business Gateway OpenAPI document. ${failures.join(' | ')}`)
}

function literal(value) {
  return JSON.stringify(value)
}

function schemaType(schema, depth = 0) {
  if (!schema || typeof schema !== 'object' || Object.keys(schema).length === 0) return 'OpenApiJsonValue'
  if (Array.isArray(schema.oneOf)) return schema.oneOf.map(member => schemaType(member, depth)).join(' | ') || 'never'
  if (Array.isArray(schema.anyOf)) return schema.anyOf.map(member => schemaType(member, depth)).join(' | ') || 'never'
  if (Array.isArray(schema.allOf)) return schema.allOf.map(member => schemaType(member, depth)).join(' & ') || 'never'
  if (schema.const !== undefined) return literal(schema.const)
  if (Array.isArray(schema.enum)) return schema.enum.map(literal).join(' | ') || 'never'
  if (Array.isArray(schema.type)) return schema.type.map(type => schemaType({ ...schema, type }, depth)).join(' | ')
  if (schema.$ref) {
    const name = String(schema.$ref).split('/').at(-1)
    return `OpenApiSchema<${literal(name)}>`
  }
  if (schema.type === 'string') return schema.format === 'binary' ? 'Blob' : 'string'
  if (schema.type === 'number' || schema.type === 'integer') return 'number'
  if (schema.type === 'boolean') return 'boolean'
  if (schema.type === 'null') return 'null'
  if (schema.type === 'array') return `Array<${schemaType(schema.items ?? {}, depth + 1)}>`
  if (schema.type === 'object') {
    const entries = Object.entries(schema.properties ?? {})
    if (entries.length === 0) return schema.additionalProperties === false ? 'Record<string, never>' : 'OpenApiJsonObject'
    const required = new Set(schema.required ?? [])
    const indent = '  '.repeat(depth + 1)
    const closing = '  '.repeat(depth)
    const members = entries.map(([name, member]) => `${indent}${literal(name)}${required.has(name) ? '' : '?'}: ${schemaType(member, depth + 1)}`)
    const shape = `{\n${members.join('\n')}\n${closing}}`
    if (schema.additionalProperties === true || schema.additionalProperties === undefined) return `${shape} & OpenApiJsonObject`
    if (schema.additionalProperties && typeof schema.additionalProperties === 'object') {
      return `${shape} & Record<string, ${schemaType(schema.additionalProperties, depth + 1)}>`
    }
    return shape
  }
  return 'OpenApiJsonValue'
}

function objectType(properties, required = new Set()) {
  const entries = Object.entries(properties)
  if (entries.length === 0) return 'Record<string, never>'
  return `{\n${entries.map(([name, schema]) => `      ${literal(name)}${required.has(name) ? '' : '?'}: ${schemaType(schema, 3)}`).join('\n')}\n    }`
}

function generate(document) {
  const schemas = document.components?.schemas ?? {}
  const resolveSchema = (schema) => {
    if (typeof schema?.$ref !== 'string') return schema ?? {}
    return schemas[schema.$ref.split('/').at(-1)] ?? {}
  }
  const operations = []
  for (const [path, methods] of Object.entries(document.paths)) {
    for (const [method, operation] of Object.entries(methods)) {
      const parameters = operation.parameters ?? []
      const pathParameters = parameters.filter(parameter => parameter.in === 'path')
      const queryParameters = parameters.filter(parameter => parameter.in === 'query')
      const pathType = objectType(Object.fromEntries(pathParameters.map(parameter => [parameter.name, parameter.schema ?? {}])), new Set(pathParameters.filter(parameter => parameter.required).map(parameter => parameter.name)))
      const queryType = objectType(Object.fromEntries(queryParameters.map(parameter => [parameter.name, parameter.schema ?? {}])), new Set(queryParameters.filter(parameter => parameter.required).map(parameter => parameter.name)))
      let bodyType = 'never'
      if (operation.requestBody) {
        const content = operation.requestBody.content ?? {}
        const media = content['application/json'] ?? content['multipart/form-data'] ?? Object.values(content)[0]
        bodyType = schemaType(media?.schema ?? {})
      }
      const success = Object.entries(operation.responses).find(([status]) => status.startsWith('2'))?.[1]
      const successContent = success?.content ?? {}
      const responseType = successContent['application/octet-stream']
        ? 'Blob'
        : schemaType(successContent['application/json']?.schema ?? {})
      const responseSchema = resolveSchema(successContent['application/json']?.schema)
      const responseDataType = responseType === 'Blob'
        ? 'never'
        : schemaType(responseSchema.properties?.data ?? {})
      operations.push({ id: operation.operationId, method: method.toUpperCase(), path, pathType, queryType, bodyType, responseType, responseDataType })
    }
  }
  const members = operations.map(operation => `  ${literal(operation.id)}: {\n    method: ${literal(operation.method)}\n    path: ${literal(operation.path)}\n    pathParameters: ${operation.pathType}\n    query: ${operation.queryType}\n    body: ${operation.bodyType}\n    response: ${operation.responseType}\n  }`).join('\n')
  const schemaMembers = Object.entries(schemas)
    .map(([name, schema]) => `  ${literal(name)}: ${schemaType(schema, 1)}`)
    .join('\n')
  const jsonOperations = operations.filter(operation => operation.responseType !== 'Blob').map(operation => literal(operation.id)).join(' | ')
  const dataMembers = operations
    .filter(operation => operation.responseType !== 'Blob')
    .map(operation => `  ${literal(operation.id)}: ${operation.responseDataType}`)
    .join('\n')
  const responseSchemas = Object.fromEntries(operations
    .filter(operation => operation.responseType !== 'Blob')
    .map(operation => {
      const source = document.paths[operation.path][operation.method.toLowerCase()]
      const success = Object.entries(source.responses).find(([status]) => status.startsWith('2'))?.[1]
      return [operation.id, success?.content?.['application/json']?.schema ?? {}]
    }))
  return `/* This file is generated from api/apps/business_gateway/openapi.py. Do not edit manually. */

export type OpenApiJsonPrimitive = string | number | boolean | null
export type OpenApiJsonValue = OpenApiJsonPrimitive | OpenApiJsonValue[] | OpenApiJsonObject
export interface OpenApiJsonObject { [key: string]: OpenApiJsonValue }
export interface OpenApiSchemas {
${schemaMembers}
}
export type OpenApiSchema<Name extends keyof OpenApiSchemas> = OpenApiSchemas[Name]
export type OpenApiSuccessEnvelope<T = OpenApiJsonValue> = { data: T; meta: OpenApiSchema<"SuccessMeta"> }
export type OpenApiErrorEnvelope = OpenApiSchema<"ErrorEnvelope">
export type OpenApiResourceScope = OpenApiSchema<"ResourceScope">
export type OpenApiBusinessAuthorizationContext = OpenApiSchema<"BusinessAuthorizationContext">

export interface BusinessGatewayOperationMap {
${members}
}

export type BusinessGatewayOperation = keyof BusinessGatewayOperationMap
export type BusinessGatewayJsonOperation = ${jsonOperations || 'never'}
export interface BusinessGatewayOperationDataMap {
${dataMembers}
}
export type OperationBody<O extends BusinessGatewayOperation> = BusinessGatewayOperationMap[O]['body']
export type OperationQuery<O extends BusinessGatewayOperation> = BusinessGatewayOperationMap[O]['query']
export type OperationPath<O extends BusinessGatewayOperation> = BusinessGatewayOperationMap[O]['pathParameters']
export type OperationResponse<O extends BusinessGatewayOperation> = BusinessGatewayOperationMap[O]['response']
export type OperationData<O extends BusinessGatewayJsonOperation> = BusinessGatewayOperationDataMap[O]

const OPENAPI_COMPONENT_SCHEMAS: Record<string, unknown> = ${JSON.stringify(schemas)}
const OPERATION_RESPONSE_SCHEMAS: Record<string, unknown> = ${JSON.stringify(responseSchemas)}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function matchesType(value: unknown, type: unknown): boolean {
  if (Array.isArray(type)) return type.some(member => matchesType(value, member))
  if (type === 'null') return value === null
  if (type === 'array') return Array.isArray(value)
  if (type === 'object') return record(value)
  if (type === 'integer') return typeof value === 'number' && Number.isSafeInteger(value)
  if (type === 'number') return typeof value === 'number' && Number.isFinite(value)
  return typeof type !== 'string' || typeof value === type
}

function matchesSchema(value: unknown, schema: unknown): boolean {
  if (!record(schema) || Object.keys(schema).length === 0) return true
  if (typeof schema.$ref === 'string') {
    const target = OPENAPI_COMPONENT_SCHEMAS[schema.$ref.split('/').at(-1) ?? '']
    return target !== undefined && matchesSchema(value, target)
  }
  if (Array.isArray(schema.oneOf) && !schema.oneOf.some(member => matchesSchema(value, member))) return false
  if (Array.isArray(schema.anyOf) && !schema.anyOf.some(member => matchesSchema(value, member))) return false
  if (Array.isArray(schema.allOf) && !schema.allOf.every(member => matchesSchema(value, member))) return false
  if (Object.hasOwn(schema, 'const') && !Object.is(value, schema.const)) return false
  if (Array.isArray(schema.enum) && !schema.enum.some(member => Object.is(value, member))) return false
  if (schema.type !== undefined && !matchesType(value, schema.type)) return false
  if (Array.isArray(value)) {
    return schema.items === undefined || value.every(member => matchesSchema(member, schema.items))
  }
  if (!record(value)) return true
  const properties = record(schema.properties) ? schema.properties : {}
  if (Array.isArray(schema.required)) {
    for (const name of schema.required) if (typeof name !== 'string' || !Object.hasOwn(value, name)) return false
  }
  for (const [name, member] of Object.entries(value)) {
    if (Object.hasOwn(properties, name)) {
      if (!matchesSchema(member, properties[name])) return false
    } else if (schema.additionalProperties === false) {
      return false
    } else if (record(schema.additionalProperties) && !matchesSchema(member, schema.additionalProperties)) {
      return false
    }
  }
  return true
}

export function assertOperationResponse<O extends BusinessGatewayJsonOperation>(
  operation: O,
  value: unknown,
): asserts value is OpenApiSuccessEnvelope<OperationData<O>> {
  const schema = OPERATION_RESPONSE_SCHEMAS[operation]
  if (schema === undefined || !matchesSchema(value, schema)) {
    throw new TypeError('Business Gateway response does not match the generated ' + operation + ' schema')
  }
}

export function isOpenApiErrorEnvelope(value: unknown): value is OpenApiErrorEnvelope {
  return matchesSchema(value, OPENAPI_COMPONENT_SCHEMAS.ErrorEnvelope)
}
`
}

const generated = generate(openApiDocument()).replaceAll('\r\n', '\n')
const rawManifest = JSON.parse(await readFile(manifestSourcePath, 'utf8'))
// The package-level RAGFlow client retains transport capabilities, but Agent
// bindings belong exclusively to the business Knowledge Gateway in v2.
const clientManifest = {
  ...rawManifest,
  operations: rawManifest.operations.map(({ agentTool: _tool, agentAction: _action, agentKind: _kind, ...operation }) => operation),
}
const manifestGenerated = `${JSON.stringify(clientManifest, null, 2)}\n`
if (check) {
  const current = await readFile(outputPath, 'utf8').catch(() => '')
  const manifestCurrent = await readFile(manifestOutputPath, 'utf8').catch(() => '')
  const stale = []
  if (current.replaceAll('\r\n', '\n') !== generated) stale.push('src/openapi.generated.ts')
  if (manifestCurrent.replaceAll('\r\n', '\n') !== manifestGenerated) stale.push('src/capabilities.generated.json')
  if (stale.length > 0) {
    throw new Error(`${stale.join(', ')} stale; run npm run contracts:generate`)
  }
} else {
  await writeFile(outputPath, generated)
  await writeFile(manifestOutputPath, manifestGenerated)
}
