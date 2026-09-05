import { createHash } from 'node:crypto'
import { Schema as z, type Context } from '@nomix-ai/nomix-harness/plugin'
import type { Agent, AgentRegistry } from '@nomix-ai/nomix-harness/plugin/agent'
import type { CredentialProvider } from '@nomix-ai/nomix-harness/plugin/credentials'
import type { SpillStore } from '@nomix-ai/nomix-harness/plugin/spill'
import type { SystemPrompt } from '@nomix-ai/nomix-harness/plugin/system-prompt'
import type { PreToolDecision, ToolExecution, ToolRuntime, ToolRunContext } from '@nomix-ai/nomix-harness/plugin/tools'
import type { BusinessIdentityRuntime } from '../dsh-business-identity/business-identity.js'
import { DEFAULT_KNOWLEDGE_ARTIFACT_MAX_BYTES, DEFAULT_KNOWLEDGE_REQUEST_TIMEOUT_MS, KNOWLEDGE_TOOL_TIMEOUT_GRACE_MS, MAX_KNOWLEDGE_ARTIFACT_MAX_BYTES, MAX_KNOWLEDGE_REQUEST_TIMEOUT_MS, TOOLSET_TOOLS, type KnowledgeToolset } from '../dsh-knowledge/harness-contract.js'
import { stableIdempotencyKey } from '../dsh-knowledge/execution-identity.js'
import { KnowledgeGatewayError } from '../dsh-knowledge/knowledge-errors.js'
import { assertKnowledgeEvidencePrompt, knowledgeApprovalDecision, KNOWLEDGE_EVIDENCE_INSTRUCTIONS } from '../dsh-knowledge-policy/policy.js'
import type { KnowledgeRuntime } from '../dsh-knowledge/service.js'
import { registerKnowledgeTools } from './tools.js'
import type { KnowledgeToolServices } from '../dsh-knowledge/tool.js'
import type { KnowledgeToolArtifact } from '../dsh-knowledge/knowledge-types.js'

export const name = 'nomix-knowledge-tool-consumer'
export const inject = ['knowledge', 'businessIdentity', 'agents', 'tools', 'credentials', 'spillStore', 'systemPrompt']

export interface AgentToolsetConfig { agentPreset: string; toolset: KnowledgeToolset }
export interface Config {
  agentToolsets: AgentToolsetConfig[]
  requestTimeoutMs?: number
  artifactMaxBytes?: number
}

const toolsetSchema = z.object({ agentPreset: z.string().required(), toolset: z.union(['read', 'write', 'admin'] as const).required() })
export const Config = z.object({
  agentToolsets: z.array(toolsetSchema).required(),
  requestTimeoutMs: z.number().step(1).min(1).max(MAX_KNOWLEDGE_REQUEST_TIMEOUT_MS).default(DEFAULT_KNOWLEDGE_REQUEST_TIMEOUT_MS),
  artifactMaxBytes: z.number().step(1).min(1).max(MAX_KNOWLEDGE_ARTIFACT_MAX_BYTES).default(DEFAULT_KNOWLEDGE_ARTIFACT_MAX_BYTES),
}) as unknown as z<Config>

type ConsumerContext = Context & {
  knowledge: KnowledgeRuntime
  businessIdentity: BusinessIdentityRuntime
  agents: AgentRegistry
  agent?: Agent
  tools: ToolRuntime
  credentials: CredentialProvider
  spillStore: SpillStore
  systemPrompt: SystemPrompt
  on(name: 'agent/created' | 'agent/disposed', listener: (payload: { agent: Agent }) => void): () => void
  on(name: 'tools/pre-execute', listener: (exec: ToolExecution, next: () => Promise<PreToolDecision>) => Promise<PreToolDecision>): () => void
}

export function assertKnowledgeConsumerConfiguration(config: Config): void {
  if (!Array.isArray(config.agentToolsets) || config.agentToolsets.length === 0) throw new KnowledgeGatewayError('agentToolsets must select at least one Agent preset.', { code: 'KNOWLEDGE_INVALID_INPUT', status: 422 })
  const presets = new Set<string>()
  for (const entry of config.agentToolsets) {
    if (!entry.agentPreset.trim() || entry.agentPreset !== entry.agentPreset.trim() || presets.has(entry.agentPreset)) throw new KnowledgeGatewayError('agentToolsets must use unique, trimmed Agent preset names.', { code: 'KNOWLEDGE_INVALID_INPUT', status: 422 })
    if (!(entry.toolset in TOOLSET_TOOLS)) throw new KnowledgeGatewayError('agentToolsets contains an unknown toolset.', { code: 'KNOWLEDGE_INVALID_INPUT', status: 422 })
    presets.add(entry.agentPreset)
  }
  const artifactMaxBytes = config.artifactMaxBytes ?? DEFAULT_KNOWLEDGE_ARTIFACT_MAX_BYTES
  if (!Number.isSafeInteger(artifactMaxBytes) || artifactMaxBytes < 1 || artifactMaxBytes > MAX_KNOWLEDGE_ARTIFACT_MAX_BYTES) throw new KnowledgeGatewayError('artifactMaxBytes is outside the supported range.', { code: 'KNOWLEDGE_INVALID_INPUT', status: 422 })
  const requestTimeoutMs = config.requestTimeoutMs ?? DEFAULT_KNOWLEDGE_REQUEST_TIMEOUT_MS
  if (!Number.isSafeInteger(requestTimeoutMs) || requestTimeoutMs < 1 || requestTimeoutMs > MAX_KNOWLEDGE_REQUEST_TIMEOUT_MS) throw new KnowledgeGatewayError('requestTimeoutMs is outside the supported range.', { code: 'KNOWLEDGE_INVALID_INPUT', status: 422 })
}

function requestId(sessionId: string, callId: string): string {
  return `knowledge-${createHash('sha256').update(sessionId).update('\0').update(callId).digest('hex').slice(0, 32)}`
}

function servicesFor(agent: Agent, config: Config): KnowledgeToolServices {
  const agentCtx = agent.ctx as ConsumerContext
  const runtime = agentCtx.get('knowledge', true)
  const businessIdentity = agentCtx.get('businessIdentity', true)
  const credentials = agentCtx.get('credentials', true)
  const spillStore = agentCtx.get('spillStore', true)
  if (!runtime || !businessIdentity || !credentials || !spillStore) throw new KnowledgeGatewayError('The Agent is missing a required knowledge-plugin dependency.', { code: 'KNOWLEDGE_PROVIDER_UNAVAILABLE', status: 503 })
  const maxBytes = config.artifactMaxBytes ?? DEFAULT_KNOWLEDGE_ARTIFACT_MAX_BYTES
  const assertOwned = (exec: ToolRunContext) => {
    if (exec.agent !== agent) throw new KnowledgeGatewayError('The tool call does not belong to this Agent context.', { code: 'KNOWLEDGE_FORBIDDEN', status: 403 })
  }
  return {
    async knowledge(exec) {
      assertOwned(exec)
      const sessionId = String(agent.id)
      const callId = String(exec.callId)
      return runtime.forOperation({ context: agentCtx, credentials, businessIdentity, signal: exec.signal, sessionId, toolCallId: callId, requestId: requestId(sessionId, callId) })
    },
    idempotencyKey(exec) {
      assertOwned(exec)
      return stableIdempotencyKey({ sessionId: String(agent.id), rootCallId: String(exec.rootCallId), toolCallId: String(exec.callId), toolName: exec.name })
    },
    async spillText(exec, input) {
      assertOwned(exec)
      const bytes = new TextEncoder().encode(input.content).byteLength
      if (bytes > maxBytes) throw new KnowledgeGatewayError('The complete knowledge result exceeds artifactMaxBytes.', { code: 'KNOWLEDGE_INVALID_INPUT', status: 422 })
      try {
        const ref = await spillStore.saveText({ owner: { sessionId: agent.id }, source: { toolName: exec.name, callId: exec.callId, label: input.label }, suggestedName: input.name, content: input.content })
        return { kind: 'spill', name: input.name, locator: String(ref.locator), mimeType: 'application/json', encoding: 'utf8', bytes, storedBytes: ref.bytes, retrievalHint: ref.retrievalHint } satisfies KnowledgeToolArtifact
      } catch (cause) {
        throw new KnowledgeGatewayError('The full knowledge result could not be stored.', { code: 'KNOWLEDGE_PROVIDER_UNAVAILABLE', status: 503, retryable: true, cause })
      }
    },
  }
}

function install(agent: Agent, toolset: KnowledgeToolset, config: Config): () => void {
  const ctx = agent.ctx as ConsumerContext
  const services = servicesFor(agent, config)
  const disposers: Array<() => void> = []
  const dispose = () => { for (const release of disposers.splice(0).reverse()) release() }
  try {
    disposers.push(ctx.systemPrompt.section({ name: 'knowledge:evidence', order: 50, text: KNOWLEDGE_EVIDENCE_INSTRUCTIONS }))
    disposers.push(ctx.on('llm/stream', async function* (request, next) {
      // llm/stream is unfiltered: route explicitly by the loop's session identity.
      if (request.sessionId === agent.id) assertKnowledgeEvidencePrompt(request)
      yield* next()
    }))
    disposers.push(registerKnowledgeTools(ctx, services, TOOLSET_TOOLS[toolset], (config.requestTimeoutMs ?? DEFAULT_KNOWLEDGE_REQUEST_TIMEOUT_MS) + KNOWLEDGE_TOOL_TIMEOUT_GRACE_MS))
    disposers.push(ctx.on('tools/pre-execute', (exec, next) => knowledgeApprovalDecision(exec.name, next)))
    return dispose
  } catch (error) {
    dispose()
    throw error
  }
}

export function applyKnowledgeConsumer(ctx: Context, config: Config): void {
  assertKnowledgeConsumerConfiguration(config)
  const root = ctx as ConsumerContext
  const selected = new Map(config.agentToolsets.map(entry => [entry.agentPreset, entry.toolset]))
  const owned = new Map<Agent, () => void>()
  const maybeInstall = (agent: Agent) => {
    const preset = agent.session.header.agentPreset
    const toolset = typeof preset === 'string' ? selected.get(preset) : undefined
    if (!toolset || owned.has(agent)) return
    const disposeEffect = root.effect(() => { const dispose = install(agent, toolset, config); return () => { dispose(); owned.delete(agent) } }, `knowledge.installAgent(${String(agent.id)})`)
    owned.set(agent, () => void disposeEffect())
  }
  if (root.agent) { maybeInstall(root.agent); return }
  for (const agent of root.agents.list()) maybeInstall(agent)
  root.on('agent/created', ({ agent }) => maybeInstall(agent))
  root.on('agent/disposed', ({ agent }) => owned.get(agent)?.())
}

export function apply(ctx: Context, config: Config): void { applyKnowledgeConsumer(ctx, config) }
