import { readFileSync } from 'node:fs'
import { Ajv2020 } from 'ajv/dist/2020.js'
import addFormats from 'ajv-formats'
import { describe, expect, it } from 'vitest'

const document = JSON.parse(readFileSync(new URL('../contracts/knowledge-gateway.openapi.json', import.meta.url), 'utf8'))
const gatewayGuide = readFileSync(new URL('../contracts/GATEWAY-INTEGRATION.md', import.meta.url), 'utf8').replaceAll('\r\n', '\n')
const ajv = new Ajv2020({ strict: false, allErrors: true })
// OpenAPI 3.1 schemas are JSON Schema 2020-12. Use an independent validator,
// not the plugin's generated schemas or its hand-written runtime validator.
addFormats.default(ajv)
ajv.addSchema({ $id: 'urn:nomix:knowledge', components: document.components })

describe('standard Knowledge Gateway contract', () => {
  it('keeps the packaged Gateway endpoint table aligned with the HTTP and tool contract', () => {
    const rows = [...gatewayGuide.matchAll(/^\| `(knowledge_\w+)` \| `(GET|POST|PATCH) ([^`]+)` \| (\d+) \| (allow|ask) \| (.+) \|$/gmu)]
      .map(([, tool, method, path, status, approval, description]) => ({
        tool: tool!, method, path, status, approval,
        actions: [...description!.matchAll(/`([A-Z_]+)`/gu)].map(([, action]) => action),
      }))
    const expected = []
    for (const [path, item] of Object.entries(document.paths) as Array<[string, Record<string, any>]>) {
      for (const method of ['get', 'post', 'patch']) {
        const operation = item[method]
        if (!operation) continue
        expected.push({
          tool: operation['x-nomix-tool'],
          method: method.toUpperCase(),
          path: path.replace('/internal/v1/knowledge', ''),
          status: Object.keys(operation.responses).find(value => /^2\d\d$/u.test(value)),
          approval: operation['x-nomix-approval'],
          actions: operation['x-nomix-actions'],
        })
      }
    }
    const byTool = (a: { tool: string }, b: { tool: string }) => a.tool.localeCompare(b.tool)
    expect(rows).toHaveLength(20)
    expect(rows.sort(byTool)).toEqual(expected.sort(byTool))
  })

  it('validates the Gateway guide JSON responses with the published schemas', () => {
    const examples = [...gatewayGuide.matchAll(/<!-- schema: (\w+) -->\s*```json\n([\s\S]*?)\n```/gu)]
    expect(examples).toHaveLength(3)
    for (const [, schema, json] of examples) {
      const validate = ajv.compile({ $ref: `urn:nomix:knowledge#/components/schemas/${schema}` })
      expect(validate(JSON.parse(json!)), JSON.stringify(validate.errors)).toBe(true)
    }
  })

  it('validates every published component and HTTP example against its formal schema', () => {
    let count = 0
    const check = (schema: object, example: unknown) => {
      const validate = ajv.compile({ ...schema, $id: `urn:nomix:example:${count++}`, components: document.components })
      expect(validate(example), JSON.stringify(validate.errors)).toBe(true)
    }
    for (const [name, schema] of Object.entries(document.components.schemas) as Array<[string, { examples?: unknown[] }]>) {
      for (const example of schema.examples ?? []) check({ $ref: `urn:nomix:knowledge#/components/schemas/${name}` }, example)
    }
    for (const item of Object.values(document.paths) as Array<Record<string, any>>) {
      for (const method of ['get', 'post', 'patch']) {
        const operation = item[method]
        if (!operation) continue
        const messages = [operation.requestBody, ...Object.values(operation.responses)]
        for (const message of messages) {
          const json = message?.content?.['application/json']
          if (!json) continue
          for (const example of Object.values(json.examples ?? {}) as Array<{ value: unknown }>) check(json.schema, example.value)
        }
      }
    }
    expect(count).toBeGreaterThanOrEqual(6)
  })
  it('compiles every component as JSON Schema 2020-12', () => {
    for (const name of Object.keys(document.components.schemas)) {
      expect(() => ajv.compile({ $ref: `urn:nomix:knowledge#/components/schemas/${name}` }), name).not.toThrow()
    }
  })

  it('exposes all HTTP inputs through standard OpenAPI fields', () => {
    let count = 0
    for (const [path, item] of Object.entries(document.paths) as Array<[string, Record<string, any>]>) {
      for (const method of ['get', 'post', 'patch', 'delete']) {
        const operation = item[method]
        if (!operation) continue
        count++
        expect(operation['x-nomix-request-schema']).toBeUndefined()
        const parameters = [...item.parameters, ...(operation.parameters ?? [])].map(value => value.$ref ? document.components.parameters[value.$ref.split('/').at(-1)] : value)
        for (const [, name] of path.matchAll(/\{([^}]+)\}/gu)) {
          expect(parameters).toContainEqual(expect.objectContaining({ in: 'path', name, required: true }))
        }
        for (const name of ['X-User-Assertion', 'X-Harness-Session-Id', 'X-Tool-Call-Id', 'X-Request-Id']) {
          expect(parameters).toContainEqual(expect.objectContaining({ in: 'header', name, required: true }))
        }
        if (method !== 'get') {
          expect(operation.requestBody.required).toBe(true)
          expect(operation.requestBody.content['application/json'].schema.$ref).toMatch(/^#\/components\/schemas\//u)
        }
      }
    }
    expect(count).toBe(20)
  })

  it.each([
    ['RetrievalRequest', { query: '制度', knowledgeSpaceIds: ['space-1'], documentIds: [], limit: 8 }],
    ['RetrievalResult', { hits: [], reason: 'NO_AUTHORIZED_RELEVANT_EVIDENCE' }],
    ['ManualRetryOperation', { operationId: 'child', parentOperationId: 'parent', status: 'PENDING' }],
    ['KnowledgeDocument', { documentId: 'doc', knowledgeSpaceId: 'space', name: '文档', status: 'CREATING', version: 1, activeVersion: null, metadata: { category: null, tags: [], versionLabel: null, productCode: null } }],
  ])('accepts independent business examples through standard %s validation', (schema, value) => {
    const validate = ajv.compile({ $ref: `urn:nomix:knowledge#/components/schemas/${schema}` })
    expect(validate(value), JSON.stringify(validate.errors)).toBe(true)
  })
})
