import { describe, expect, it } from 'vitest'
import { validateArgs } from '@nomix-ai/nomix-harness/plugin/tools'
import {
  KNOWLEDGE_ADMIN_TOOL_NAMES,
  KNOWLEDGE_AGENT_TOOL_NAMES,
  KNOWLEDGE_READ_TOOL_NAMES,
  KNOWLEDGE_WRITE_TOOL_NAMES,
  TOOLSET_TOOLS,
} from '../packages/dsh-knowledge/harness-contract.js'
import { knowledgeGatewayCapabilityManifest, knowledgeHarnessCapabilityManifest } from '../src/manifest.js'
import { knowledgeGatewayRoutes, knowledgeGatewaySchemas } from '../packages/dsh-knowledge/knowledge-openapi.generated.js'
import { parseKnowledgeToolInput } from '../packages/dsh-knowledge/knowledge-schema.js'
import { FORBIDDEN_AGENT_INPUT_FIELDS, KNOWLEDGE_TOOL_INPUT_SCHEMAS } from '../packages/dsh-knowledge/tool-contracts.js'

function propertyNames(schema: { properties?: Record<string, unknown> }): string[] {
  return Object.keys(schema.properties ?? {})
}

describe('Agent-facing knowledge contract', () => {
  it('publishes exactly 20 finalized tools and the read/maintenance/admin visibility', () => {
    expect(KNOWLEDGE_READ_TOOL_NAMES).toEqual([
      'knowledge_space_list', 'knowledge_space_get', 'knowledge_document_list', 'knowledge_document_get',
      'knowledge_search', 'knowledge_source_read', 'knowledge_document_download', 'knowledge_operation_get',
    ])
    expect(KNOWLEDGE_WRITE_TOOL_NAMES).toEqual([
      'knowledge_document_upload', 'knowledge_document_update', 'knowledge_document_replace', 'knowledge_document_enable',
      'knowledge_document_disable', 'knowledge_document_reindex', 'knowledge_operation_cancel', 'knowledge_operation_retry',
    ])
    expect(KNOWLEDGE_ADMIN_TOOL_NAMES).toEqual([
      'knowledge_space_create', 'knowledge_space_update', 'knowledge_space_delete', 'knowledge_document_delete',
    ])
    expect(KNOWLEDGE_AGENT_TOOL_NAMES).toHaveLength(20)
    expect(TOOLSET_TOOLS.read).toEqual(KNOWLEDGE_READ_TOOL_NAMES)
    expect(TOOLSET_TOOLS.write).toEqual([...KNOWLEDGE_READ_TOOL_NAMES, ...KNOWLEDGE_WRITE_TOOL_NAMES])
    expect(TOOLSET_TOOLS.write).not.toContain('knowledge_document_delete')
    expect(TOOLSET_TOOLS.admin).toEqual(KNOWLEDGE_AGENT_TOOL_NAMES)
  })

  it('generates routes, capability policy, and correlation headers from one OpenAPI source', () => {
    expect(knowledgeHarnessCapabilityManifest.endpointPrefix).toBe('/internal/v1/knowledge/')
    expect(knowledgeGatewayCapabilityManifest.operations).toHaveLength(20)
    expect(new Set(knowledgeGatewayCapabilityManifest.operations.map(operation => operation.tool))).toEqual(new Set(KNOWLEDGE_AGENT_TOOL_NAMES))
    expect(new Set(knowledgeGatewayCapabilityManifest.operations.map(operation => operation.operation))).toEqual(new Set(Object.keys(knowledgeGatewayRoutes)))
    for (const operation of knowledgeGatewayCapabilityManifest.operations) {
      expect(operation.path).toMatch(/^\/internal\/v1\/knowledge\//u)
      expect(operation.toolSchema).toBeTruthy()
      expect(operation.actions.length).toBeGreaterThan(0)
      if (operation.risk !== 'read') {
        expect(operation.idempotency).toBe('required')
        expect(operation.concurrency).toBe('exclusive')
      }
      if (operation.method !== 'GET') expect(operation.requestSchema).toBeTruthy()
    }
    expect(knowledgeGatewayCapabilityManifest.requiredHeaders).toEqual([
      'X-User-Assertion', 'X-Harness-Session-Id', 'X-Tool-Call-Id', 'X-Request-Id',
    ])
    expect(knowledgeGatewayCapabilityManifest.businessRules).toMatchObject({
      identitySource: 'dsh-business-identity-session-binding',
      pageIndex: { owner: 'ragflow', treeExposure: 'none', tuningExposure: 'none' },
      searchEligibility: { documentStatus: 'ACTIVE', activeVersionStatus: 'READY' },
      searchLimits: { maximumHits: 8, maximumHitsPerDocument: 4, maximumTotalCodePoints: 16000 },
      download: { activeVersionOnly: true, fixedExpirySeconds: 60, binaryTransfer: false },
      writeCardinality: 'single-resource',
      idempotency: 'tool-call-derived-header',
      automaticRetry: { owner: 'gateway-worker', sameOperation: true, maximumAttempts: 5 },
      manualRetry: { createsChildOperation: true, maximumAttempts: 3 },
    })
    expect(knowledgeGatewayCapabilityManifest.businessRules.approvalPolicy.ask).toEqual([
      'knowledge_document_download', 'knowledge_document_replace', 'knowledge_document_enable', 'knowledge_document_disable',
      'knowledge_document_reindex', 'knowledge_operation_cancel', 'knowledge_operation_retry', 'knowledge_space_create',
      'knowledge_space_update', 'knowledge_space_delete', 'knowledge_document_delete',
    ])
  })

  it('uses the finalized route grammar without batch, sources, or download-reference endpoints', () => {
    const routes = Object.values(knowledgeGatewayRoutes)
    const paths = routes.map(route => route.path)
    expect(paths).toContain('/internal/v1/knowledge/documents/{documentId}:create-download-link')
    expect(paths).toContain('/internal/v1/knowledge/citations/{citationId}')
    expect(paths).toContain('/internal/v1/knowledge/operations/{operationId}:cancel')
    expect(paths).toContain('/internal/v1/knowledge/operations/{operationId}:retry')
    expect(paths).toContain('/internal/v1/knowledge/documents/{documentId}:enable')
    expect(paths).toContain('/internal/v1/knowledge/documents/{documentId}:disable')
    expect(paths.some(path => path.includes('batch'))).toBe(false)
    expect(paths.some(path => path.includes('/sources/'))).toBe(false)
    expect(paths.some(path => path.includes('download-reference'))).toBe(false)
  })

  it('keeps every model input closed and excludes provider, ACL, low-level tuning, path, and binary fields', () => {
    const text = JSON.stringify(KNOWLEDGE_TOOL_INPUT_SCHEMAS)
    for (const field of FORBIDDEN_AGENT_INPUT_FIELDS) expect(text, field).not.toContain(`"${field}"`)
    expect(propertyNames(KNOWLEDGE_TOOL_INPUT_SCHEMAS.knowledge_search)).toEqual(['query', 'knowledgeSpaceIds', 'documentIds', 'limit', 'metadataFilter'])
    expect(propertyNames(KNOWLEDGE_TOOL_INPUT_SCHEMAS.knowledge_document_download)).toEqual(['documentId'])
    expect(propertyNames(KNOWLEDGE_TOOL_INPUT_SCHEMAS.knowledge_space_create)).toEqual(['code', 'name', 'description', 'profileCode', 'defaultSecurityDomainCode'])
    expect(propertyNames(KNOWLEDGE_TOOL_INPUT_SCHEMAS.knowledge_space_update)).toEqual(['knowledgeSpaceId', 'name', 'description', 'expectedVersion'])
    expect(propertyNames(KNOWLEDGE_TOOL_INPUT_SCHEMAS.knowledge_space_delete)).toEqual(['knowledgeSpaceId', 'expectedVersion', 'reason'])
    for (const schema of Object.values(KNOWLEDGE_TOOL_INPUT_SCHEMAS)) expect(schema.additionalProperties).toBe(false)
    for (const field of FORBIDDEN_AGENT_INPUT_FIELDS) {
      expect(validateArgs({ input: KNOWLEDGE_TOOL_INPUT_SCHEMAS.knowledge_search }, { input: { query: 'q', [field]: 'forbidden' } }), field).not.toEqual([])
    }
  })

  it('accepts opaque operation IDs and rejects out-of-contract bounds before Gateway dispatch', () => {
    expect(() => parseKnowledgeToolInput('knowledge_operation_get', { operationId: 'operation-70001' })).not.toThrow()
    expect(() => parseKnowledgeToolInput('knowledge_search', { query: 'q', limit: 9 })).toThrow(expect.objectContaining({ code: 'KNOWLEDGE_INVALID_INPUT' }))
    expect(() => parseKnowledgeToolInput('knowledge_source_read', { citationId: 'citation-1', contextBefore: 5001 })).toThrow(expect.objectContaining({ code: 'KNOWLEDGE_INVALID_INPUT' }))
    expect(() => parseKnowledgeToolInput('knowledge_document_upload', { knowledgeSpaceId: 'space', fileResourceId: 'file', documentName: 'x'.repeat(1025) })).toThrow(expect.objectContaining({ code: 'KNOWLEDGE_INVALID_INPUT' }))
    expect(() => parseKnowledgeToolInput('knowledge_space_delete', { knowledgeSpaceId: 'space', expectedVersion: 1, reason: 'r', force: true })).toThrow(expect.objectContaining({ code: 'KNOWLEDGE_INVALID_INPUT' }))
  })

  it('separates space, document, version, and operation lifecycles', () => {
    expect(knowledgeGatewaySchemas.SpaceStatus.enum).toEqual(['CREATING', 'ACTIVE', 'CREATE_FAILED', 'DISABLED', 'DELETING', 'DELETED', 'DELETE_FAILED'])
    expect(knowledgeGatewaySchemas.DocumentStatus.enum).toEqual(['CREATING', 'ACTIVE', 'CREATE_FAILED', 'DISABLED', 'DELETING', 'DELETED'])
    expect(knowledgeGatewaySchemas.VersionStatus.enum).toEqual(['CREATED', 'UPLOADING', 'UPLOADED', 'INGESTING', 'READY', 'FAILED', 'CANCELLED', 'RETIRED', 'DELETED'])
    expect(knowledgeGatewaySchemas.OperationStatus.enum).toEqual(['PENDING', 'RUNNING', 'SUCCEEDED', 'FAILED', 'CANCELLED'])
    expect(Object.keys(knowledgeGatewaySchemas.KnowledgeSpaceCreated.properties)).toEqual(['spaceId', 'code', 'name', 'status', 'version'])
    expect(knowledgeGatewaySchemas.ManualRetryOperation.required).toContain('parentOperationId')
    expect(knowledgeGatewaySchemas.ManualRetryOperation.required).toEqual(['operationId', 'parentOperationId', 'status'])
    expect(JSON.stringify(knowledgeGatewaySchemas.KnowledgeOperation)).not.toContain('failureReason')
    expect(JSON.stringify(knowledgeGatewaySchemas.KnowledgeOperationType)).not.toMatch(/MODEL|PIPELINE|RAGFLOW/u)
  })
})
