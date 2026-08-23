import type { Context } from '@nomix-ai/cordis'
import { launchEnvironmentOf } from '@nomix-ai/nomix-launch-environment'
import { apply as applyMcpClient, type ReconnectConfig } from '@nomix-ai/nomix-mcp-client'
import z from '@nomix-ai/schemastery'
import { RagFlowClient } from './client.js'
import { destructiveDecision, registerManagementTools } from './tools.js'

export * from './client.js'
export type * from './types.js'

/** Stable Cordis plugin name retained by the Harness loader. */
export const name = 'nomix-ragflow'

/** Services used for model tools, approvals, and workspace path resolution. */
export const inject = ['tools', 'fs']

export interface Config {
  /** RAGFlow origin without `/api/v1`. */
  baseURL: string
  /** REST API version (default `v1`). */
  apiVersion?: string
  /** MCP Streamable HTTP endpoint; defaults to `${baseURL}/api/v1/mcp`. */
  mcpURL?: string
  /** Explicit API key; otherwise `RAGFLOW_API_KEY` is read from the launch environment. */
  apiKey?: string
  /** MCP public tool namespace. */
  serverName?: string
  /** REST request timeout in milliseconds. */
  requestTimeoutMs?: number
  /** MCP tool-call timeout in milliseconds. */
  mcpToolCallTimeoutMs?: number
  /** Fail plugin startup when MCP discovery cannot complete. */
  failOnMcpStartupError?: boolean
  /** MCP reconnect policy. */
  reconnect?: ReconnectConfig
  /** Harness workspace root for local document transfers. */
  workspaceRoot?: string
  /** Maximum upload or download size in bytes. */
  maxFileBytes?: number
}

const Reconnect = z.object({
  enabled: z.boolean().default(true),
  initialDelayMs: z.number().min(1).default(500),
  maxDelayMs: z.number().min(1).default(30_000),
  maxAttempts: z.number().step(1).min(1).default(10),
})

export const Config = z.object({
  baseURL: z.string().required(),
  apiVersion: z.string().default('v1'),
  mcpURL: z.string(),
  apiKey: z.string().role('secret'),
  serverName: z.string().default('ragflow'),
  requestTimeoutMs: z.number().min(1).default(60_000),
  mcpToolCallTimeoutMs: z.number().min(1).default(60_000),
  failOnMcpStartupError: z.boolean().default(true),
  reconnect: Reconnect,
  workspaceRoot: z.string().default('.'),
  maxFileBytes: z.number().step(1).min(1).default(512 * 1024 * 1024),
}) as unknown as z<Config>

function normalizedBaseURL(value: string): string {
  const url = new URL(value)
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new TypeError('baseURL must use http or https')
  if (/\/api\/v\d+\/?$/.test(url.pathname)) throw new TypeError('baseURL must be the RAGFlow service root without /api/v1')
  return value.replace(/\/+$/, '')
}

/** Load the REST client, dynamic MCP tools, grouped management tools, and approval gate. */
export async function apply(ctx: Context, config: Config): Promise<void> {
  const apiKey = config.apiKey ?? launchEnvironmentOf(ctx).get('RAGFLOW_API_KEY')?.value
  if (apiKey === undefined || apiKey.length === 0) throw new Error('RAGFLOW_API_KEY is required (set Config.apiKey or the launch environment variable)')
  const baseURL = normalizedBaseURL(config.baseURL)
  const apiVersion = config.apiVersion ?? 'v1'
  const client = new RagFlowClient({ baseURL, apiVersion, apiKey, timeoutMs: config.requestTimeoutMs ?? 60_000 })

  registerManagementTools(ctx, client, {
    workspaceRoot: config.workspaceRoot ?? '.',
    maxFileBytes: config.maxFileBytes ?? 512 * 1024 * 1024,
  })
  ctx.on('tools/pre-execute', (exec, next) => destructiveDecision(exec.name, exec.arguments, next))

  await applyMcpClient(ctx, {
    transport: 'streamable-http',
    serverName: config.serverName ?? 'ragflow',
    url: config.mcpURL ?? `${baseURL}/api/${apiVersion}/mcp`,
    headers: { Authorization: `Bearer ${apiKey}` },
    toolCallTimeoutMs: config.mcpToolCallTimeoutMs ?? 60_000,
    failOnStartupError: config.failOnMcpStartupError ?? true,
    reconnect: config.reconnect,
  })
}
