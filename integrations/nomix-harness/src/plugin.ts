import type { Context } from '@nomix-ai/cordis'
import { credentialRef } from '@nomix-ai/nomix-credentials'
import type {} from '@nomix-ai/nomix-fs'
import z from '@nomix-ai/schemastery'
import { RagFlowApiError, RagFlowClient } from './client.js'
import { destructiveDecision, registerRagFlowTools } from './tools.js'

export * from './client.js'

/** Stable Cordis plugin name retained by the Harness loader. */
export const name = 'nomix-ragflow'

/** Services used for model tools, approvals, and workspace path resolution. */
export const inject = ['tools', 'fs', 'credentials']

export interface Config {
  /** RAGFlow origin without `/api/v1`. */
  baseURL: string
  /** REST API version (default `v1`). */
  apiVersion?: string
  /** Harness credential reference resolved independently for every REST request. */
  apiKeyRef?: string
  /** REST request timeout in milliseconds. */
  requestTimeoutMs?: number
  /** Harness workspace root for local document transfers. */
  workspaceRoot?: string
  /** Maximum workspace upload size in bytes. */
  maxFileBytes?: number
}

export const Config = z.object({
  baseURL: z.string().required(),
  apiVersion: z.string().default('v1'),
  apiKeyRef: z.string().default('RAGFLOW_API_KEY'),
  requestTimeoutMs: z.number().min(1).default(60_000),
  workspaceRoot: z.string().default('.'),
  maxFileBytes: z.number().step(1).min(1).default(512 * 1024 * 1024),
}) as unknown as z<Config>

function normalizedBaseURL(value: string): string {
  const url = new URL(value)
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new TypeError('baseURL must use http or https')
  if (/\/api\/v\d+\/?$/.test(url.pathname)) throw new TypeError('baseURL must be the RAGFlow service root without /api/v1')
  return value.replace(/\/+$/, '')
}

/** Load the REST client, semantic tools, and approval gate. */
export async function apply(ctx: Context, config: Config): Promise<void> {
  const baseURL = normalizedBaseURL(config.baseURL)
  const apiVersion = config.apiVersion ?? 'v1'
  const apiKeyRef = credentialRef(config.apiKeyRef ?? 'RAGFLOW_API_KEY')
  const client = new RagFlowClient({
    baseURL,
    apiVersion,
    timeoutMs: config.requestTimeoutMs ?? 60_000,
    apiKey: async () => {
      const credential = await ctx.credentials.resolve(apiKeyRef)
      if (credential === undefined) throw new RagFlowApiError(`Credential ${apiKeyRef} is not configured`, { machineCode: 'AUTH' })
      return credential.value
    },
  })

  registerRagFlowTools(ctx, client, {
    workspaceRoot: config.workspaceRoot ?? '.',
    maxFileBytes: config.maxFileBytes ?? 512 * 1024 * 1024,
  })
  ctx.on('tools/pre-execute', (exec, next) => destructiveDecision(exec.name, exec.arguments, next))
}
