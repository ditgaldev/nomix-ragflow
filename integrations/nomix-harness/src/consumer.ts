/** Harness Consumer: Agent-scoped RAGFlow tools over the provider-neutral seam. */
import { Schema as z, type Context } from '@nomix-ai/nomix-harness/plugin'
import type { Agent, AgentRegistry } from '@nomix-ai/nomix-harness/plugin/agent'
import type { CredentialProvider } from '@nomix-ai/nomix-harness/plugin/credentials'
import type { FileSystem } from '@nomix-ai/nomix-harness/plugin/fs'
import type { SpillStore } from '@nomix-ai/nomix-harness/plugin/spill'
import type { PreToolDecision, ToolExecution, ToolRuntime, ToolRunContext } from '@nomix-ai/nomix-harness/plugin/tools'
import type { RagFlowBusinessClient } from './client.js'
import { BusinessGatewayError } from './errors.js'
import { readDownloadedDocument, uploadWorkspaceDocument } from './files.js'
import {
  DEFAULT_RAGFLOW_AGENT_ARTIFACT_MAX_BYTES,
  DEFAULT_RAGFLOW_MAX_FILE_BYTES,
  DEFAULT_RAGFLOW_TOOL_TIMEOUT_MS,
  effectiveBinaryArtifactBytes,
  MAX_RAGFLOW_AGENT_UPLOAD_BYTES,
  MAX_RAGFLOW_AGENT_ARTIFACT_MAX_BYTES,
  MAX_RAGFLOW_TOOL_TIMEOUT_MS,
} from './harness-contract.js'
import type { RagFlowRuntime } from './service.js'
import { registerRagFlowTools, writeDecision, type RagFlowToolServices } from './tools.js'
import type { RagFlowToolArtifact } from './types.js'

export const name = 'nomix-ragflow-tool-consumer'
export const inject = ['ragflow', 'agents', 'tools', 'credentials', 'fs', 'spillStore']

export interface Config {
  /** Explicit provider binding; required when multiple Providers are mounted. */
  providerId?: string
  /** Install tools only for Agents created from these presets. */
  agentPresets?: string[]
  /** Explicitly attach to every live and future Agent. */
  attachToAllAgents?: boolean
  /** Upload root relative to the owning Agent session cwd. */
  workspaceRoot?: string
  /** Maximum bytes read for one upload. */
  maxFileBytes?: number
  /** Maximum bytes persisted for one Agent result artifact. */
  artifactMaxBytes?: number
  /** Harness execution budget; composition derives it from requestTimeoutMs. */
  toolTimeoutMs?: number
}

export const Config = z.object({
  providerId: z.string(),
  agentPresets: z.array(z.string()),
  attachToAllAgents: z.boolean().default(false),
  workspaceRoot: z.string().default('.'),
  maxFileBytes: z.number().step(1).min(1).max(MAX_RAGFLOW_AGENT_UPLOAD_BYTES).default(DEFAULT_RAGFLOW_MAX_FILE_BYTES),
  artifactMaxBytes: z.number().step(1).min(1).max(MAX_RAGFLOW_AGENT_ARTIFACT_MAX_BYTES).default(DEFAULT_RAGFLOW_AGENT_ARTIFACT_MAX_BYTES),
  toolTimeoutMs: z.number().step(1).min(1).max(MAX_RAGFLOW_TOOL_TIMEOUT_MS).default(DEFAULT_RAGFLOW_TOOL_TIMEOUT_MS),
}) as unknown as z<Config>

type ConsumerContext = Context & {
  ragflow: RagFlowRuntime
  agents: AgentRegistry
  agent?: Agent
  tools: ToolRuntime
  credentials: CredentialProvider
  fs: FileSystem
  spillStore: SpillStore
  on(name: 'agent/created' | 'agent/disposed', listener: (payload: { agent: Agent }) => void): () => void
  on(name: 'tools/pre-execute', listener: (exec: ToolExecution, next: () => Promise<PreToolDecision>) => Promise<PreToolDecision>): () => void
}

function assertOwnedExecution(agent: Agent, exec: ToolRunContext): void {
  if (exec.agent !== agent) {
    throw new BusinessGatewayError('RAGFlow tools require the Agent context that registered them', {
      code: 'RAGFLOW_AGENT_CONTEXT_REQUIRED',
      status: 403,
    })
  }
}

export function assertRagFlowConsumerConfiguration(ctx: Context, config: Config = {}): void {
  const artifactMaxBytes = config.artifactMaxBytes ?? DEFAULT_RAGFLOW_AGENT_ARTIFACT_MAX_BYTES
  if (!Number.isSafeInteger(artifactMaxBytes) || artifactMaxBytes < 1 || artifactMaxBytes > MAX_RAGFLOW_AGENT_ARTIFACT_MAX_BYTES) {
    throw new BusinessGatewayError(`RAGFlow artifactMaxBytes must be an integer between 1 and ${MAX_RAGFLOW_AGENT_ARTIFACT_MAX_BYTES}`, {
      code: 'RAGFLOW_CONSUMER_CONFIG_INVALID',
      status: 422,
    })
  }
  const maxFileBytes = config.maxFileBytes ?? DEFAULT_RAGFLOW_MAX_FILE_BYTES
  if (!Number.isSafeInteger(maxFileBytes) || maxFileBytes < 1 || maxFileBytes > MAX_RAGFLOW_AGENT_UPLOAD_BYTES) {
    throw new BusinessGatewayError(`RAGFlow maxFileBytes must be an integer between 1 and ${MAX_RAGFLOW_AGENT_UPLOAD_BYTES}`, {
      code: 'RAGFLOW_CONSUMER_CONFIG_INVALID',
      status: 422,
    })
  }
  const toolTimeoutMs = config.toolTimeoutMs ?? DEFAULT_RAGFLOW_TOOL_TIMEOUT_MS
  if (!Number.isSafeInteger(toolTimeoutMs) || toolTimeoutMs < 1 || toolTimeoutMs > MAX_RAGFLOW_TOOL_TIMEOUT_MS) {
    throw new BusinessGatewayError(`RAGFlow toolTimeoutMs must be an integer between 1 and ${MAX_RAGFLOW_TOOL_TIMEOUT_MS}`, {
      code: 'RAGFLOW_CONSUMER_CONFIG_INVALID',
      status: 422,
    })
  }
  const workspaceRoot = config.workspaceRoot ?? '.'
  if (!workspaceRoot || workspaceRoot !== workspaceRoot.trim()) {
    throw new BusinessGatewayError('RAGFlow workspaceRoot must be non-empty without surrounding whitespace', {
      code: 'RAGFLOW_CONSUMER_CONFIG_INVALID',
      status: 422,
    })
  }
  if (config.providerId !== undefined && (!config.providerId.trim() || config.providerId !== config.providerId.trim())) {
    throw new BusinessGatewayError('RAGFlow providerId must be non-empty without surrounding whitespace', {
      code: 'RAGFLOW_CONSUMER_CONFIG_INVALID',
      status: 422,
    })
  }
  const presets = config.agentPresets ?? []
  if (presets.some(preset => !preset.trim() || preset !== preset.trim()) || new Set(presets).size !== presets.length) {
    throw new BusinessGatewayError('RAGFlow agentPresets must contain unique non-empty names without surrounding whitespace', {
      code: 'RAGFLOW_CONSUMER_CONFIG_INVALID',
      status: 422,
    })
  }
  if (config.attachToAllAgents && presets.length) {
    throw new BusinessGatewayError('RAGFlow Consumer must select either agentPresets or attachToAllAgents=true, not both', {
      code: 'RAGFLOW_AGENT_SELECTION_CONFLICT',
      status: 422,
    })
  }
  if (!(ctx as ConsumerContext).agent && !config.attachToAllAgents && presets.length === 0) {
    throw new BusinessGatewayError('Root-scoped RAGFlow Consumer requires agentPresets or explicit attachToAllAgents=true', {
      code: 'RAGFLOW_AGENT_SELECTION_REQUIRED',
      status: 422,
    })
  }
}

function servicesFor(agent: Agent, config: Config): RagFlowToolServices {
  const agentCtx = agent.ctx as ConsumerContext
  const ragflow = agentCtx.get('ragflow', true)
  const credentials = agentCtx.get('credentials', true)
  const fs = agentCtx.get('fs', true)
  const spillStore = agentCtx.get('spillStore', true)
  if (!ragflow || !credentials || !fs || !spillStore) {
    throw new BusinessGatewayError('The selected Agent does not provide every RAGFlow Consumer dependency', {
      code: 'RAGFLOW_CONSUMER_DEPENDENCY_UNAVAILABLE',
      status: 503,
      retryable: false,
    })
  }
  const cwd = agent.session.header.cwd
  const artifactMaxBytes = config.artifactMaxBytes ?? DEFAULT_RAGFLOW_AGENT_ARTIFACT_MAX_BYTES
  const binaryArtifactMaxBytes = effectiveBinaryArtifactBytes(artifactMaxBytes)
  const transfer = {
    workspaceRoot: config.workspaceRoot ?? '.',
    maxFileBytes: config.maxFileBytes ?? DEFAULT_RAGFLOW_MAX_FILE_BYTES,
  }

  const spillText = async (
    exec: ToolRunContext,
    input: { name: string; label: string; mimeType: string; content: string },
  ): Promise<RagFlowToolArtifact> => {
    assertOwnedExecution(agent, exec)
    const bytes = new TextEncoder().encode(input.content).byteLength
    if (bytes > artifactMaxBytes) {
      throw new BusinessGatewayError(`RAGFlow artifact exceeds the ${artifactMaxBytes}-byte persisted-artifact limit`, {
        code: 'RAGFLOW_ARTIFACT_TOO_LARGE',
        status: 422,
      })
    }
    try {
      const ref = await spillStore.saveText({
        owner: { sessionId: agent.id },
        source: { toolName: exec.name, callId: exec.callId, label: input.label },
        suggestedName: input.name,
        content: input.content,
      })
      return {
        kind: 'spill',
        name: input.name,
        locator: String(ref.locator),
        mimeType: input.mimeType,
        encoding: 'utf8',
        bytes,
        storedBytes: ref.bytes,
        retrievalHint: ref.retrievalHint,
      }
    } catch (cause) {
      if (cause instanceof BusinessGatewayError) throw cause
      throw new BusinessGatewayError('The RAGFlow result could not be stored in the Harness spill plane', {
        code: 'RAGFLOW_ARTIFACT_STORE_UNAVAILABLE',
        status: 503,
        retryable: true,
        cause,
      })
    }
  }

  const spillBytes = async (
    exec: ToolRunContext,
    input: { name: string; label: string; mimeType: string; bytes: Uint8Array; sha256?: string },
  ): Promise<RagFlowToolArtifact> => {
    assertOwnedExecution(agent, exec)
    if (input.bytes.byteLength > binaryArtifactMaxBytes) {
      throw new BusinessGatewayError(`RAGFlow binary artifact exceeds the ${binaryArtifactMaxBytes}-byte effective Agent limit`, {
        code: 'RAGFLOW_ARTIFACT_TOO_LARGE',
        status: 422,
      })
    }
    const encoded = Buffer.from(input.bytes).toString('base64')
    const encodedBytes = Buffer.byteLength(encoded, 'utf8')
    if (encodedBytes > artifactMaxBytes) {
      throw new BusinessGatewayError(`Base64 RAGFlow artifact requires ${encodedBytes} stored bytes and exceeds the ${artifactMaxBytes}-byte persisted-artifact limit`, {
        code: 'RAGFLOW_ARTIFACT_TOO_LARGE',
        status: 422,
      })
    }
    try {
      const storedName = `${input.name}.base64`
      const ref = await spillStore.saveText({
        owner: { sessionId: agent.id },
        source: { toolName: exec.name, callId: exec.callId, label: input.label },
        suggestedName: storedName,
        content: encoded,
      })
      return {
        kind: 'spill',
        name: storedName,
        locator: String(ref.locator),
        mimeType: 'text/plain',
        encoding: 'base64',
        originalName: input.name,
        originalMimeType: input.mimeType,
        bytes: input.bytes.byteLength,
        storedBytes: ref.bytes,
        ...(input.sha256 ? { sha256: input.sha256 } : {}),
        retrievalHint: `${ref.retrievalHint} This is a text-only fallback: decode the stored base64 text to ${input.name} (${input.mimeType}) before opening it.`,
      }
    } catch (cause) {
      if (cause instanceof BusinessGatewayError) throw cause
      throw new BusinessGatewayError('The RAGFlow binary result could not be stored in the Harness spill plane', {
        code: 'RAGFLOW_ARTIFACT_STORE_UNAVAILABLE',
        status: 503,
        retryable: true,
        cause,
      })
    }
  }

  return {
    async client(exec) {
      assertOwnedExecution(agent, exec)
      return ragflow.clientFor({
        context: agentCtx,
        credentials,
        signal: exec.signal,
        ...(config.providerId ? { providerId: config.providerId } : {}),
      })
    },
    spillText,
    spillBytes,
    async uploadDocument(exec, client: RagFlowBusinessClient, input) {
      assertOwnedExecution(agent, exec)
      try {
        return await uploadWorkspaceDocument(
          fs,
          cwd,
          client,
          transfer,
          input.datasetId,
          input.sourcePath,
          input.displayName,
          exec.signal,
          input.idempotencyKey,
        )
      } catch (cause) {
        if (cause instanceof BusinessGatewayError || cause instanceof TypeError) throw cause
        throw new BusinessGatewayError('The RAGFlow upload source could not be read through the Agent filesystem plane', {
          code: 'RAGFLOW_ARTIFACT_INPUT_UNAVAILABLE',
          status: 422,
          cause,
        })
      }
    },
    async downloadArtifact(exec, response, input) {
      assertOwnedExecution(agent, exec)
      const downloaded = await readDownloadedDocument(response, binaryArtifactMaxBytes, input.name, exec.signal)
      return spillBytes(exec, {
        name: downloaded.name,
        label: input.label,
        mimeType: downloaded.mimeType,
        bytes: downloaded.bytes,
        sha256: downloaded.sha256,
      })
    },
  }
}

function installForAgent(agent: Agent, config: Config): () => void {
  const agentCtx = agent.ctx as ConsumerContext
  const disposeTools = registerRagFlowTools(agentCtx, servicesFor(agent, config), {
    timeoutMs: config.toolTimeoutMs ?? DEFAULT_RAGFLOW_TOOL_TIMEOUT_MS,
  })
  const disposeApproval = agentCtx.on('tools/pre-execute', (exec, next) => writeDecision(exec.name, exec.arguments, next))
  let disposed = false
  return () => {
    if (disposed) return
    disposed = true
    disposeApproval()
    disposeTools()
  }
}

function matchesPreset(agent: Agent, presets: readonly string[]): boolean {
  const preset = agent.session.header.agentPreset
  return typeof preset === 'string' && presets.includes(preset)
}

export function applyRagFlowConsumer(ctx: Context, config: Config = {}): void {
  assertRagFlowConsumerConfiguration(ctx, config)
  const consumerCtx = ctx as ConsumerContext
  const owned = new Map<Agent, () => void>()
  const install = (agent: Agent): void => {
    if (owned.has(agent)) return
    const disposeEffect = consumerCtx.effect(() => {
      const dispose = installForAgent(agent, config)
      return () => {
        dispose()
        owned.delete(agent)
      }
    }, `ragflow.installAgent(${String(agent.id)})`)
    owned.set(agent, () => void disposeEffect())
  }

  if (consumerCtx.agent) {
    install(consumerCtx.agent)
    return
  }

  const presets = config.agentPresets ?? []
  const selected = (agent: Agent): boolean => config.attachToAllAgents === true || matchesPreset(agent, presets)
  for (const agent of consumerCtx.agents.list()) if (selected(agent)) install(agent)
  consumerCtx.on('agent/created', ({ agent }) => { if (selected(agent)) install(agent) })
  consumerCtx.on('agent/disposed', ({ agent }) => owned.get(agent)?.())
}

export function apply(ctx: Context, config: Config): void {
  applyRagFlowConsumer(ctx, config)
}
