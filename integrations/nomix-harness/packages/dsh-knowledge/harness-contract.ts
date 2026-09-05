import { knowledgeGatewayRoutes } from './knowledge-openapi.generated.js'

export const KNOWLEDGE_READ_TOOL_NAMES = [
  'knowledge_space_list',
  'knowledge_space_get',
  'knowledge_document_list',
  'knowledge_document_get',
  'knowledge_search',
  'knowledge_source_read',
  'knowledge_document_download',
  'knowledge_operation_get',
] as const

export const KNOWLEDGE_WRITE_TOOL_NAMES = [
  'knowledge_document_upload',
  'knowledge_document_update',
  'knowledge_document_replace',
  'knowledge_document_enable',
  'knowledge_document_disable',
  'knowledge_document_reindex',
  'knowledge_operation_cancel',
  'knowledge_operation_retry',
] as const

export const KNOWLEDGE_ADMIN_TOOL_NAMES = [
  'knowledge_space_create',
  'knowledge_space_update',
  'knowledge_space_delete',
  'knowledge_document_delete',
] as const

export const KNOWLEDGE_AGENT_TOOL_NAMES = [
  ...KNOWLEDGE_READ_TOOL_NAMES,
  ...KNOWLEDGE_WRITE_TOOL_NAMES,
  ...KNOWLEDGE_ADMIN_TOOL_NAMES,
] as const

export type KnowledgeAgentToolName = typeof KNOWLEDGE_AGENT_TOOL_NAMES[number]
export type KnowledgeToolset = 'read' | 'write' | 'admin'

export const KNOWLEDGE_GATEWAY_PROVIDER_ID = 'knowledge-gateway'
export const DEFAULT_KNOWLEDGE_REQUEST_TIMEOUT_MS = 60_000
export const MAX_KNOWLEDGE_REQUEST_TIMEOUT_MS = 300_000
export const KNOWLEDGE_TOOL_TIMEOUT_GRACE_MS = 30_000
export const DEFAULT_KNOWLEDGE_ARTIFACT_MAX_BYTES = 10 * 1024 * 1024
export const MAX_KNOWLEDGE_ARTIFACT_MAX_BYTES = 64 * 1024 * 1024
export const INLINE_KNOWLEDGE_RESULT_MAX_BYTES = 12_000

export const TOOLSET_TOOLS: Readonly<Record<KnowledgeToolset, readonly KnowledgeAgentToolName[]>> = {
  read: KNOWLEDGE_READ_TOOL_NAMES,
  write: [...KNOWLEDGE_READ_TOOL_NAMES, ...KNOWLEDGE_WRITE_TOOL_NAMES],
  admin: KNOWLEDGE_AGENT_TOOL_NAMES,
}

export interface KnowledgeToolPolicy {
  readonly approval: 'allow' | 'ask'
  readonly concurrency: 'parallel' | 'exclusive'
  readonly risk: 'read' | 'write' | 'admin'
}

const policyEntries = Object.values(knowledgeGatewayRoutes).map(route => [route.tool, {
  approval: route.approval,
  concurrency: route.concurrency,
  risk: route.risk,
}] as const)

export const KNOWLEDGE_TOOL_POLICIES = Object.fromEntries(policyEntries) as unknown as Readonly<Record<KnowledgeAgentToolName, KnowledgeToolPolicy>>

for (const name of KNOWLEDGE_AGENT_TOOL_NAMES) {
  if (!KNOWLEDGE_TOOL_POLICIES[name]) throw new Error(`Knowledge Gateway contract has no policy for ${name}`)
}

export function isKnowledgeToolConcurrencySafe(toolName: string): boolean {
  return KNOWLEDGE_TOOL_POLICIES[toolName as KnowledgeAgentToolName]?.concurrency === 'parallel'
}
