import { describe, expect, it } from 'vitest'
import { capabilityManifest } from '../src/manifest.js'
import { RAGFLOW_TOOL_INPUT_SCHEMAS, RAGFLOW_TOOL_OUTPUT_SCHEMA } from '../src/tool-contracts.js'

type Schema = Record<string, unknown>

function schemaObject(value: unknown): Schema | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Schema : undefined
}

function visitSchemas(value: unknown, path: string, visitor: (schema: Schema, path: string) => void): void {
  if (Array.isArray(value)) {
    value.forEach((member, index) => visitSchemas(member, `${path}[${index}]`, visitor))
    return
  }
  const schema = schemaObject(value)
  if (!schema) return
  visitor(schema, path)
  for (const [key, member] of Object.entries(schema)) visitSchemas(member, `${path}.${key}`, visitor)
}

function actionSchema(tool: keyof typeof RAGFLOW_TOOL_INPUT_SCHEMAS, action: string): Schema | undefined {
  const root = RAGFLOW_TOOL_INPUT_SCHEMAS[tool] as Schema
  const candidates = Array.isArray(root.oneOf) ? root.oneOf : [root]
  return candidates
    .map(schemaObject)
    .find(candidate => schemaObject(candidate?.properties)?.action !== undefined
      && schemaObject(schemaObject(candidate?.properties)?.action)?.const === action)
}

describe('RAGFlow model-facing tool contracts', () => {
  it('closes every nested object and exposes no trusted authorization fields', () => {
    const openObjects: string[] = []
    visitSchemas({ inputs: RAGFLOW_TOOL_INPUT_SCHEMAS, output: RAGFLOW_TOOL_OUTPUT_SCHEMA }, '$', (schema, path) => {
      if (schema.type === 'object' && schema.additionalProperties !== false) openObjects.push(path)
    })
    expect(openObjects).toEqual([])
    expect(JSON.stringify(RAGFLOW_TOOL_INPUT_SCHEMAS)).not.toMatch(/tenantId|workspaceId|subject|actorSubject|actions|datasetScope|documentScope|chatScope|agentScope|memoryScope|permissionRef/)
  })

  it('uses integer schemas for every integer Gateway field', () => {
    const integerFields = new Set(['limit', 'topK', 'topN', 'messageId', 'version', 'createTimeFrom', 'createTimeTo', 'memorySize', 'pagerank'])
    const mismatches: string[] = []
    visitSchemas(RAGFLOW_TOOL_INPUT_SCHEMAS, '$', (schema, path) => {
      const properties = schemaObject(schema.properties)
      if (!properties) return
      for (const [name, property] of Object.entries(properties)) {
        if (integerFields.has(name) && schemaObject(property)?.type !== 'integer') mismatches.push(`${path}.${name}`)
      }
    })
    expect(mismatches).toEqual([])
  })

  it('requires a stable operationId on every manifest-declared Agent write', () => {
    const missing: string[] = []
    for (const capability of capabilityManifest.operations) {
      if (capability.risk === 'read' || capability.agentTool === undefined || capability.agentAction === undefined) continue
      const schema = actionSchema(capability.agentTool as keyof typeof RAGFLOW_TOOL_INPUT_SCHEMAS, capability.agentAction)
      const operationId = schemaObject(schemaObject(schema?.properties)?.operationId)
      if (operationId?.type !== 'string' || operationId.required !== true) missing.push(capability.operation)
    }
    expect(missing).toEqual([])
  })

  it('marks resource IDs as Gateway-returned values that must not be invented', () => {
    const getDataset = actionSchema('ragflow_manage_datasets', 'get')
    const datasetId = schemaObject(schemaObject(getDataset?.properties)?.datasetId)
    expect(datasetId).toMatchObject({ type: 'string', required: true })
    expect(datasetId?.description).toMatch(/Gateway.*never invent/i)
  })
})
