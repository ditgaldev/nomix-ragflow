export const RAGFLOW_AGENT_TOOL_NAMES = [
  'ragflow_discover',
  'ragflow_retrieval',
  'ragflow_page_index',
  'ragflow_manage_datasets',
  'ragflow_manage_documents',
  'ragflow_transfer_documents',
  'ragflow_manage_chunks',
  'ragflow_manage_chats',
  'ragflow_manage_sessions',
  'ragflow_manage_agents',
  'ragflow_manage_memories',
] as const

export type RagFlowAgentToolName = typeof RAGFLOW_AGENT_TOOL_NAMES[number]

export const RAGFLOW_BUSINESS_GATEWAY_PROVIDER_ID = 'nomix-ragflow-business-gateway'
export const DEFAULT_RAGFLOW_REQUEST_TIMEOUT_MS = 60_000
export const MAX_RAGFLOW_REQUEST_TIMEOUT_MS = 300_000
/** Covers Agent credential lookup, bounded artifact preparation, and cleanup outside the HTTP deadline. */
export const RAGFLOW_TOOL_TIMEOUT_GRACE_MS = 30_000
export const DEFAULT_RAGFLOW_TOOL_TIMEOUT_MS = DEFAULT_RAGFLOW_REQUEST_TIMEOUT_MS + RAGFLOW_TOOL_TIMEOUT_GRACE_MS
export const MAX_RAGFLOW_TOOL_TIMEOUT_MS = MAX_RAGFLOW_REQUEST_TIMEOUT_MS + RAGFLOW_TOOL_TIMEOUT_GRACE_MS
/**
 * Agent uploads are currently materialized in memory by the Harness FileSystem
 * and Fetch implementations. Keep this ceiling bounded until Harness exposes a
 * workspace-safe streaming binary reader.
 */
export const MAX_RAGFLOW_AGENT_UPLOAD_BYTES = 64 * 1024 * 1024
export const DEFAULT_RAGFLOW_MAX_FILE_BYTES = MAX_RAGFLOW_AGENT_UPLOAD_BYTES
export const DEFAULT_RAGFLOW_AGENT_ARTIFACT_MAX_BYTES = 10 * 1024 * 1024
export const MAX_RAGFLOW_AGENT_ARTIFACT_MAX_BYTES = 64 * 1024 * 1024
export const INLINE_RAGFLOW_RESULT_MAX_BYTES = 12_000

/** Maximum raw bytes that fit in a text-only SpillStore after base64 encoding. */
export function effectiveBinaryArtifactBytes(maxStoredBytes: number): number {
  return Math.floor(maxStoredBytes / 4) * 3
}
