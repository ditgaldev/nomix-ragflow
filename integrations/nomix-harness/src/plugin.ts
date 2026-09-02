/** Composition plugin: one Business Gateway Provider plus Agent-scoped Consumer. */
import { Schema as z, type Context } from '@nomix-ai/nomix-harness/plugin'
import { applyRagFlowConsumer, assertRagFlowConsumerConfiguration } from './consumer.js'
import {
  DEFAULT_RAGFLOW_AGENT_ARTIFACT_MAX_BYTES,
  DEFAULT_RAGFLOW_MAX_FILE_BYTES,
  DEFAULT_RAGFLOW_REQUEST_TIMEOUT_MS,
  MAX_RAGFLOW_AGENT_UPLOAD_BYTES,
  MAX_RAGFLOW_AGENT_ARTIFACT_MAX_BYTES,
  MAX_RAGFLOW_REQUEST_TIMEOUT_MS,
  RAGFLOW_BUSINESS_GATEWAY_PROVIDER_ID,
  RAGFLOW_TOOL_TIMEOUT_GRACE_MS,
} from './harness-contract.js'
import { applyRagFlowProvider, type Config as ProviderPluginConfig } from './provider.js'

export * from './client.js'
export const name = 'nomix-ragflow'
export const inject = ['ragflow', 'agents', 'tools', 'credentials', 'fs', 'spillStore']

export interface Config extends ProviderPluginConfig {
  /** Agent preset allow-list. Required at root unless attachToAllAgents is true. */
  agentPresets?: string[]
  /** Explicitly attach the Consumer to every live and future Agent. */
  attachToAllAgents?: boolean
  workspaceRoot?: string
  maxFileBytes?: number
  artifactMaxBytes?: number
}

export const Config: z<Config> = z.object({
  providerId: z.string().default(RAGFLOW_BUSINESS_GATEWAY_PROVIDER_ID),
  baseURL: z.string().required(),
  accessTokenRef: z.string().required(),
  requestTimeoutMs: z.number().step(1).min(1).max(MAX_RAGFLOW_REQUEST_TIMEOUT_MS).default(DEFAULT_RAGFLOW_REQUEST_TIMEOUT_MS),
  agentPresets: z.array(z.string()),
  attachToAllAgents: z.boolean().default(false),
  workspaceRoot: z.string().default('.'),
  maxFileBytes: z.number().step(1).min(1).max(MAX_RAGFLOW_AGENT_UPLOAD_BYTES).default(DEFAULT_RAGFLOW_MAX_FILE_BYTES),
  artifactMaxBytes: z.number().step(1).min(1).max(MAX_RAGFLOW_AGENT_ARTIFACT_MAX_BYTES).default(DEFAULT_RAGFLOW_AGENT_ARTIFACT_MAX_BYTES),
})

export function apply(ctx: Context, config: Config): void {
  const providerId = config.providerId ?? RAGFLOW_BUSINESS_GATEWAY_PROVIDER_ID
  const requestTimeoutMs = config.requestTimeoutMs ?? DEFAULT_RAGFLOW_REQUEST_TIMEOUT_MS
  if (!Number.isSafeInteger(requestTimeoutMs) || requestTimeoutMs < 1 || requestTimeoutMs > MAX_RAGFLOW_REQUEST_TIMEOUT_MS) {
    throw new TypeError(`requestTimeoutMs must be an integer between 1 and ${MAX_RAGFLOW_REQUEST_TIMEOUT_MS}`)
  }
  const consumerConfig = {
    providerId,
    ...(config.agentPresets ? { agentPresets: config.agentPresets } : {}),
    attachToAllAgents: config.attachToAllAgents === true,
    ...(config.workspaceRoot !== undefined ? { workspaceRoot: config.workspaceRoot } : {}),
    ...(config.maxFileBytes !== undefined ? { maxFileBytes: config.maxFileBytes } : {}),
    ...(config.artifactMaxBytes !== undefined ? { artifactMaxBytes: config.artifactMaxBytes } : {}),
    toolTimeoutMs: requestTimeoutMs + RAGFLOW_TOOL_TIMEOUT_GRACE_MS,
  }
  assertRagFlowConsumerConfiguration(ctx, consumerConfig)
  applyRagFlowProvider(ctx, { ...config, providerId, requestTimeoutMs })
  applyRagFlowConsumer(ctx, consumerConfig)
}
