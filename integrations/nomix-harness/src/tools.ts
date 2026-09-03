import { createHash } from 'node:crypto'
import type { Context } from '@nomix-ai/nomix-harness/plugin'
import { HarnessError } from '@nomix-ai/nomix-harness/plugin/llm'
import { defineTool, type JsonValue, type PreToolDecision, type ToolRunContext, type ToolRuntime } from '@nomix-ai/nomix-harness/plugin/tools'
import type { RagFlowBusinessClient } from './client.js'
import { BusinessGatewayError } from './errors.js'
import { DEFAULT_RAGFLOW_TOOL_TIMEOUT_MS } from './harness-contract.js'
import { INLINE_RAGFLOW_RESULT_MAX_BYTES } from './harness-contract.js'
import { agentCapability } from './manifest.js'
import { isRagFlowAgentToolName, isRagFlowToolConcurrencySafe, resolveRagFlowToolCapabilities } from './tool-actions.js'
import { RAGFLOW_TOOL_INPUT_SCHEMAS, RAGFLOW_TOOL_OUTPUT_SCHEMA } from './tool-contracts.js'
import type {
  BusinessAuthorizationContext,
  Document,
  JsonObject,
  RagFlowToolArtifact,
  RagFlowToolDataEntry,
  RequestOptions,
  SessionTarget,
  ToolOutput,
} from './types.js'

type Input = Record<string, unknown>
type ToolContext = Context & { tools: ToolRuntime; agent?: object }

export interface RagFlowToolServices {
  client(exec: ToolRunContext): Promise<RagFlowBusinessClient>
  spillText(exec: ToolRunContext, input: { name: string; label: string; mimeType: string; content: string }): Promise<RagFlowToolArtifact>
  spillBytes(exec: ToolRunContext, input: { name: string; label: string; mimeType: string; bytes: Uint8Array; sha256?: string }): Promise<RagFlowToolArtifact>
  uploadDocument(exec: ToolRunContext, client: RagFlowBusinessClient, input: {
    datasetId: string
    sourcePath: string
    displayName?: string
    idempotencyKey: string
  }): Promise<Document[]>
  downloadArtifact(exec: ToolRunContext, response: Response, input: { name: string; label: string }): Promise<RagFlowToolArtifact>
}

type RagFlowObservationKind = 'authorization' | 'retrieval' | 'resource' | 'resource-list' | 'mutation' | 'invocation' | 'artifact-reference'
type RagFlowDataEntry = RagFlowToolDataEntry
type RagFlowObservation = ToolOutput

function isInput(value: unknown): value is Input {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function pointerSegment(value: string): string {
  return value.replace(/~/g, '~0').replace(/\//g, '~1')
}

function pointerParts(path: string): string[] {
  if (path === '') return []
  return path.slice(1).split('/').map(value => value.replace(/~1/g, '/').replace(/~0/g, '~'))
}

function flattenJson(value: JsonValue, path = '', entries: RagFlowDataEntry[] = []): RagFlowDataEntry[] {
  if (value === null) entries.push({ path, kind: 'null' })
  else if (typeof value === 'string') entries.push({ path, kind: 'string', stringValue: value })
  else if (typeof value === 'number') entries.push({ path, kind: 'number', numberValue: value })
  else if (typeof value === 'boolean') entries.push({ path, kind: 'boolean', booleanValue: value })
  else if (Array.isArray(value)) {
    entries.push({ path, kind: 'array' })
    value.forEach((child, index) => flattenJson(child, `${path}/${index}`, entries))
  } else {
    entries.push({ path, kind: 'object' })
    for (const key of Object.keys(value).sort()) flattenJson(value[key]!, `${path}/${pointerSegment(key)}`, entries)
  }
  return entries
}

function entryValue(entry: RagFlowDataEntry): JsonValue {
  switch (entry.kind) {
    case 'object': return {}
    case 'array': return []
    case 'null': return null
    case 'string': return entry.stringValue
    case 'number': return entry.numberValue
    case 'boolean': return entry.booleanValue
  }
}

function inflateJson(entries: readonly RagFlowDataEntry[]): JsonValue {
  let root: JsonValue = null
  for (const entry of entries) {
    const value = entryValue(entry)
    const parts = pointerParts(entry.path)
    if (parts.length === 0) {
      root = value
      continue
    }
    let parent = root as JsonObject | JsonValue[]
    for (const part of parts.slice(0, -1)) {
      parent = (Array.isArray(parent) ? parent[Number(part)] : parent[part]) as JsonObject | JsonValue[]
    }
    const last = parts.at(-1)!
    if (Array.isArray(parent)) parent[Number(last)] = value
    else parent[last] = value
  }
  return root
}

const output = {
  schema: RAGFLOW_TOOL_OUTPUT_SCHEMA,
  render: (_args: unknown, raw: JsonValue) => {
    const value = raw as unknown as RagFlowObservation
    const body = value.data.format === 'json-entries'
      ? JSON.stringify(inflateJson(value.data.entries), null, 2)
      : `The complete ${value.data.bytes}-byte RAGFlow result is stored as ${value.data.artifactName}.`
    const parts = [value.summary, body]
    if (value.artifacts.length) {
      parts.push(`Artifacts:\n${value.artifacts.map(artifact => `- ${artifact.name}: ${artifact.locator} (${artifact.mimeType}, ${artifact.bytes} bytes)\n  ${artifact.retrievalHint}`).join('\n')}`)
    }
    if (value.nextActions.length) parts.push(`Next actions:\n${value.nextActions.map(action => `- ${action}`).join('\n')}`)
    return [{ type: 'text' as const, text: parts.join('\n\n') }]
  },
}

function object(value: unknown, label = 'input'): Input {
  if (!isInput(value)) throw new TypeError(`${label} must be an object`)
  return value
}

function string(input: Input, key: string): string {
  const value = input[key]
  if (typeof value !== 'string' || value.length === 0) throw new TypeError(`input.${key} must be a non-empty string`)
  return value
}

function optionalString(input: Input, key: string): string | undefined {
  const value = input[key]
  if (value === undefined) return undefined
  if (typeof value !== 'string') throw new TypeError(`input.${key} must be a string`)
  return value
}

function strings(input: Input, key: string): string[] | undefined {
  const value = input[key]
  if (value === undefined) return undefined
  if (!Array.isArray(value) || value.some(item => typeof item !== 'string')) throw new TypeError(`input.${key} must be a string array`)
  return value
}

function requiredStrings(input: Input, key: string): string[] {
  const value = strings(input, key)
  if (value === undefined || value.length === 0) throw new TypeError(`input.${key} must be a non-empty string array`)
  return value
}

function integer(input: Input, key: string, minimum = 1, maximum = Number.MAX_SAFE_INTEGER): number {
  const value = input[key]
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new TypeError(`input.${key} must be an integer between ${minimum} and ${maximum}`)
  }
  return value
}

function resourceVersion(input: Input): number {
  return integer(input, 'version')
}

function optionalNumber(input: Input, key: string): number | undefined {
  const value = input[key]
  if (value === undefined) return undefined
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new TypeError(`input.${key} must be a finite number`)
  return value
}

function optionalInteger(input: Input, key: string, minimum = 1, maximum = Number.MAX_SAFE_INTEGER): number | undefined {
  if (input[key] === undefined) return undefined
  return integer(input, key, minimum, maximum)
}

function boolean(input: Input, key: string, fallback = false): boolean {
  const value = input[key]
  if (value === undefined) return fallback
  if (typeof value !== 'boolean') throw new TypeError(`input.${key} must be a boolean`)
  return value
}

function json(input: Input, key: string, fallback: JsonObject = {}): JsonObject {
  const value = input[key]
  if (value === undefined) return fallback
  return jsonObject(value, `input.${key}`)
}

function optionalBoolean(input: Input, key: string): boolean | undefined {
  return input[key] === undefined ? undefined : boolean(input, key)
}

function optionalJson(input: Input, key: string): JsonObject | undefined {
  const value = input[key]
  return value === undefined ? undefined : jsonObject(value, `input.${key}`)
}

function toJsonValue(value: unknown): JsonValue {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError('Tool result numbers must be finite')
    return value
  }
  if (Array.isArray(value)) return value.map(toJsonValue)
  if (isInput(value)) {
    const result: JsonObject = {}
    for (const [key, member] of Object.entries(value)) result[key] = toJsonValue(member)
    return result
  }
  throw new TypeError('Tool result must be losslessly JSON serializable')
}

function jsonObject(value: unknown, label: string): JsonObject {
  const result = toJsonValue(object(value, label))
  if (result === null || typeof result !== 'object' || Array.isArray(result)) throw new TypeError(`${label} must be a JSON object`)
  return result
}

function target(input: Input): SessionTarget {
  const kind = string(input, 'kind')
  if (kind !== 'chat' && kind !== 'agent') throw new TypeError('input.kind must be chat or agent')
  return { kind, ownerId: string(input, 'ownerId') }
}

function safeAuthorizationDiscovery(context: BusinessAuthorizationContext): JsonObject {
  const scope = (value: BusinessAuthorizationContext['datasetScope']): JsonObject => ({
    mode: value.mode,
    idCount: value.ids?.length ?? 0,
  })
  return {
    gateway: 'available',
    authenticationType: context.authenticationType,
    tokenUse: context.tokenUse,
    expiresAt: context.expiresAt,
    audience: context.audience,
    actionCount: context.actions.length,
    scopes: {
      datasets: scope(context.datasetScope),
      documents: scope(context.documentScope),
      chats: scope(context.chatScope),
      agents: scope(context.agentScope),
      memories: scope(context.memoryScope),
    },
  }
}

function boundedApprovalValue(value: unknown): string | undefined {
  if (typeof value === 'string' && value) return value.replace(/[\r\n\t]/gu, ' ').slice(0, 160)
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  return undefined
}

function approvalTarget(input: Input): string {
  const details: string[] = []
  for (const key of [
    'datasetId', 'documentId', 'chunkId', 'chatId', 'sessionId', 'agentId', 'memoryId', 'messageId',
    'ownerId', 'kind', 'name', 'title', 'displayName', 'version', 'operationId',
  ]) {
    const value = boundedApprovalValue(input[key])
    if (value !== undefined) details.push(`${key}=${value}`)
  }
  const sourcePath = boundedApprovalValue(input.sourcePath)
  if (sourcePath !== undefined) details.push(`artifactPath=${sourcePath}`)
  for (const key of ['ids', 'documentIds', 'memoryIds', 'messages']) {
    if (Array.isArray(input[key])) details.push(`${key}Count=${input[key].length}`)
  }
  for (const key of ['patch', 'request', 'config']) {
    const value = input[key]
    if (isInput(value)) details.push(`${key}Fields=${Object.keys(value).sort().slice(0, 12).join(',') || '(none)'}`)
  }
  if (typeof input.content === 'string') details.push(`contentChars=${input.content.length}`)
  return details.length > 0
    ? `Target: ${details.join('; ')}.`
    : 'Target details are available in the presented tool arguments.'
}

export async function writeDecision(name: string, args: unknown, next: () => Promise<PreToolDecision>): Promise<PreToolDecision> {
  if (!isRagFlowAgentToolName(name)) return next()
  const input = object(object(args).input, 'input')
  let capabilities
  try {
    capabilities = resolveRagFlowToolCapabilities(name, input)
  } catch (error) {
    return { kind: 'deny', reason: error instanceof Error ? error.message : `RAGFlow tool ${name} has no canonical capability mapping.` }
  }
  if (capabilities.some(capability => capability.risk !== 'read')) {
    let operationId: string
    try {
      operationId = string(input, 'operationId')
      if (operationId.length > 200) throw new TypeError('input.operationId must not exceed 200 characters')
    } catch (error) {
      return { kind: 'deny', reason: error instanceof Error ? error.message : 'RAGFlow writes require a stable operationId.' }
    }
    const action = name === 'ragflow_retrieval' ? 'search' : String(input.action)
    const operations = capabilities.map(capability => capability.operation).join(', ')
    return { kind: 'ask', reason: `RAGFlow write ${name}.${action} (${operations}) requires one-time approval. ${approvalTarget(input)} Gateway authorization and scope are still enforced after approval.` }
  }
  return next()
}

function resultCount(value: JsonValue): number | undefined {
  if (Array.isArray(value)) return value.length
  if (value === null || typeof value !== 'object') return undefined
  for (const key of ['data', 'chunks', 'documents', 'datasets', 'sessions', 'messages']) {
    const member = value[key]
    if (Array.isArray(member)) return member.length
  }
  if (value.data !== undefined && value.data !== value) return resultCount(value.data)
  return typeof value.total === 'number' ? value.total : undefined
}

interface ObservationDetails {
  summary: string
  data: JsonValue
  nextActions: string[]
  artifacts: RagFlowToolArtifact[]
  kind: RagFlowObservationKind
}

function observationDetails(name: string, args: unknown, data: JsonValue, artifacts: RagFlowToolArtifact[] = []): ObservationDetails {
  const input = object(object(args).input, 'input')
  const action = name === 'ragflow_retrieval' ? 'search' : String(input.action)
  const count = resultCount(data)
  const selectedCount = [input.ids, input.documentIds, input.memoryIds].find(Array.isArray)?.length
  const quantity = count ?? selectedCount
  const resources: Record<string, string> = {
    ragflow_retrieval: 'authorized knowledge chunk',
    ragflow_page_index: 'PageIndex result',
    ragflow_discover: 'business authorization context',
    ragflow_manage_datasets: 'dataset',
    ragflow_manage_documents: 'document',
    ragflow_transfer_documents: 'document',
    ragflow_manage_chunks: 'chunk',
    ragflow_manage_chats: 'chat',
    ragflow_manage_sessions: 'session',
    ragflow_manage_agents: 'agent',
    ragflow_manage_memories: 'memory resource',
  }
  const resource = resources[name] ?? 'RAGFlow resource'
  const prefix = quantity === undefined ? '' : `${quantity} `
  let summary = `${name}.${action} completed through the RAGFlow Business Gateway.`
  let nextActions: string[] = []
  if (action === 'search') summary = `Retrieved ${prefix}${resource}(s) within the authorized scope.`
  else if (name === 'ragflow_discover' && action === 'context') summary = 'Loaded the verified Business Gateway authorization context.'
  else if (action === 'list' || action === 'list_messages' || action === 'recent_messages') summary = `Returned ${prefix}authorized ${resource}(s).`
  else if (action === 'get' || action === 'get_config' || action === 'get_auto_metadata' || action === 'get_message_content') summary = `Loaded the authorized ${resource}.`
  else if (action === 'create' || action === 'add' || action === 'add_message') summary = `Created ${prefix}${resource}(s).`
  else if (action === 'upload') {
    summary = `Uploaded ${prefix}document(s) to the authorized dataset.`
    nextActions = ['Use ragflow_page_index.build for chapter-tree retrieval, or start_parse for ordinary chunk retrieval.']
  } else if (action === 'start_parse') {
    summary = `Started parsing ${prefix}document(s).`
    nextActions = ['List the documents to observe parsing progress before retrieval.']
  } else if (name === 'ragflow_page_index' && action === 'build') {
    summary = `Configured PageIndex and started parsing ${prefix}document(s).`
    nextActions = ['Poll ragflow_page_index.status until state is ready, failed, or cancelled; inspect phase and errorCode on failure.']
  } else if (name === 'ragflow_page_index' && action === 'status') {
    summary = 'Loaded the authorized PageIndex build status.'
    const state = data !== null && typeof data === 'object' && !Array.isArray(data) ? data.state : undefined
    if (state === 'not_configured') nextActions = ['Use ragflow_page_index.build with a stable operationId to configure and start PageIndex parsing.']
    else if (state === 'ready') nextActions = ['Use ragflow_page_index.get or ragflow_page_index.search.']
    else if (state === 'failed') nextActions = ['Inspect phase, errorCode, and errorMessage; fix the reported dependency or document issue, then start a new build with a new operationId.']
    else if (state === 'cancelled') nextActions = ['Start a new build with a new operationId when PageIndex is still required.']
    else nextActions = ['Poll this document status until it reaches ready, failed, or cancelled.']
  } else if (action === 'download') summary = 'Downloaded the authorized document into the Agent-scoped Harness artifact plane.'
  else if (action === 'cancel_parse') summary = `Requested parsing cancellation for ${prefix}document(s).`
  else if (action === 'update' || action === 'update_auto_metadata' || action === 'update_message_status') summary = `Updated the authorized ${resource}.`
  else if (action === 'delete' || action === 'forget_message') summary = `Deleted ${prefix}${resource}(s).`
  else if (action === 'ask') {
    summary = 'Invoked the authorized RAGFlow session.'
    nextActions = ['Continue with the same sessionId when the conversation needs another turn.']
  }
  if (name === 'ragflow_manage_datasets' && action === 'create') nextActions = ['Upload documents before attempting retrieval.']
  if (name === 'ragflow_manage_chats' && action === 'create') nextActions = ['Create a chat session before invoking the chat.']
  if (name === 'ragflow_manage_agents' && action === 'create') nextActions = ['Create an agent session before invoking the agent.']
  let kind: RagFlowObservationKind = 'resource'
  if (name === 'ragflow_discover') kind = 'authorization'
  else if (name === 'ragflow_retrieval') kind = 'retrieval'
  else if (name === 'ragflow_page_index' && action === 'search') kind = 'retrieval'
  else if (action === 'download') kind = 'artifact-reference'
  else if (action === 'list' || action === 'list_messages' || action === 'search_messages' || action === 'recent_messages') kind = 'resource-list'
  else if (action === 'ask') kind = 'invocation'
  else if (resolveRagFlowToolCapabilities(name, input).some(capability => capability.risk !== 'read')) kind = 'mutation'
  return { summary, data, nextActions, artifacts, kind }
}

function createObservation(services: RagFlowToolServices, exec: ToolRunContext) {
  return async (details: ObservationDetails): Promise<RagFlowObservation> => {
    const { summary, data, nextActions, artifacts, kind } = details
    if (kind === 'artifact-reference') {
      const artifact = artifacts[0]
      if (!artifact) {
        throw new BusinessGatewayError('RAGFlow artifact observation has no stored artifact', {
          code: 'RAGFLOW_ARTIFACT_STORE_UNAVAILABLE',
          status: 503,
          retryable: true,
        })
      }
      return {
        status: 'success',
        summary,
        data: { kind, format: 'artifact-reference', artifactName: artifact.name, bytes: artifact.bytes, truncated: true },
        nextActions,
        artifacts,
      } satisfies RagFlowObservation
    }

    const content = JSON.stringify(data, null, 2) ?? 'null'
    const bytes = new TextEncoder().encode(content).byteLength
    const entries = flattenJson(data)
    const canonicalBytes = new TextEncoder().encode(JSON.stringify(entries)).byteLength
    if (canonicalBytes <= INLINE_RAGFLOW_RESULT_MAX_BYTES) {
      return {
        status: 'success',
        summary,
        data: { kind, format: 'json-entries', entries, bytes, truncated: false },
        nextActions,
        artifacts,
      } satisfies RagFlowObservation
    }

    const suffix = createHash('sha256').update(String(exec.callId)).digest('hex').slice(0, 12)
    const artifact = await services.spillText(exec, {
      name: `${exec.name}-${suffix}.json`,
      label: 'full-result',
      mimeType: 'application/json',
      content,
    })
    return {
      status: 'success',
      summary,
      data: { kind: 'artifact-reference', format: 'artifact-reference', artifactName: artifact.name, bytes, truncated: true },
      nextActions: [...nextActions, 'Use the artifact retrieval hint when the complete result is required.'],
      artifacts: [...artifacts, artifact],
    } satisfies RagFlowObservation
  }
}

function gatewayHarnessError(error: BusinessGatewayError): HarnessError {
  const request = error.requestId === undefined ? '' : ` Request: ${error.requestId}.`
  return new HarnessError(`${error.message} Root cause: ${error.rootCauseHint} Safe retry: ${error.retryHint} Stop condition: ${error.stopCondition}${request}`, error.code, { cause: error })
}

function register(ctx: ToolContext, definition: ReturnType<typeof defineTool>, timeoutMs: number): () => void {
  const execute = definition.execute
  const tools = ctx.get('tools', true)
  if (!tools) {
    throw new BusinessGatewayError('The selected Agent does not provide the Harness tool runtime', {
      code: 'RAGFLOW_CONSUMER_DEPENDENCY_UNAVAILABLE',
      status: 503,
    })
  }
  return tools.register({
    ...definition,
    timeoutMs: definition.timeoutMs ?? timeoutMs,
    async execute(args, exec) {
      try {
        return await execute(args, exec)
      } catch (error) {
        if (error instanceof BusinessGatewayError) throw gatewayHarnessError(error)
        if (error instanceof TypeError) {
          throw new HarnessError(`${error.message} Root cause: the Agent tool input or artifact violated the selected RAGFlow action contract. Safe retry: inspect the tool schema and retry once with only supported fields or a valid Agent filesystem path. Stop condition: stop when the same validation failure repeats after correcting the input.`, 'RAGFLOW_TOOL_INPUT_INVALID', { cause: error })
        }
        if (error instanceof HarnessError) throw error
        throw new HarnessError('The RAGFlow tool failed unexpectedly. Root cause: an internal plugin or dependency failure occurred outside the declared Business Gateway contract. Safe retry: retry the same read once; for writes, inspect RAGFlow state before retrying. Stop condition: stop after one repeated internal failure and report the tool name and call ID without credentials.', 'RAGFLOW_TOOL_INTERNAL', { cause: error })
      }
    },
  })
}

interface ArtifactExecutionResult {
  readonly kind: 'ragflow-artifact-result'
  readonly data: JsonValue
  readonly artifacts: RagFlowToolArtifact[]
}

async function executeBusinessTool(
  services: RagFlowToolServices,
  exec: ToolRunContext,
  name: string,
  args: unknown,
  body: () => Promise<unknown>,
): Promise<RagFlowObservation> {
  const value = await body()
  const artifactResult = value as Partial<ArtifactExecutionResult> | null | undefined
  const details = artifactResult?.kind === 'ragflow-artifact-result'
    ? observationDetails(name, args, toJsonValue(artifactResult.data ?? null), artifactResult.artifacts ?? [])
    : observationDetails(name, args, toJsonValue(value ?? null))
  return createObservation(services, exec)(details)
}

function requestOptions(exec: ToolRunContext, operation: string, name: string, input: Input): RequestOptions {
  const action = name === 'ragflow_retrieval' ? 'search' : string(input, 'action')
  const kind = input.kind === 'chat' || input.kind === 'agent' ? input.kind : undefined
  const capability = agentCapability(operation, name, action, kind)
  const result: RequestOptions = { signal: exec.signal }
  if (capability.risk !== 'read') {
    const operationId = string(input, 'operationId')
    if (operationId.length > 200) throw new TypeError('input.operationId must not exceed 200 characters')
    const digest = createHash('sha256')
      .update(operation)
      .update('\0')
      .update(String(exec.agent?.id ?? 'unscoped'))
      .update('\0')
      .update(operationId)
      .digest('hex')
    result.idempotencyKey = `agent:${digest}`
  }
  return result
}

function versionedRequestOptions(exec: ToolRunContext, operation: string, name: string, input: Input): RequestOptions & { version: number } {
  return { ...requestOptions(exec, operation, name, input), version: resourceVersion(input) }
}

export interface RagFlowToolRegistrationOptions { timeoutMs?: number }

export function registerRagFlowTools(ctx: ToolContext, services: RagFlowToolServices, options: RagFlowToolRegistrationOptions = {}): () => void {
  if (!ctx.agent) {
    throw new BusinessGatewayError('RAGFlow tools must be registered in an Agent-scoped Context', {
      code: 'RAGFLOW_AGENT_CONTEXT_REQUIRED',
      status: 403,
    })
  }
  const timeoutMs = options.timeoutMs ?? DEFAULT_RAGFLOW_TOOL_TIMEOUT_MS
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1) {
    throw new BusinessGatewayError('RAGFlow tool timeout must be a positive safe integer', {
      code: 'RAGFLOW_CONSUMER_CONFIG_INVALID',
      status: 422,
    })
  }
  const disposers: (() => void)[] = []
  disposers.push(register(ctx, defineTool({
    name: 'ragflow_discover',
    description: 'Confirm RAGFlow Business Gateway availability and summarize authorization shape without exposing identity, grants, or raw scope IDs.',
    parameters: { input: RAGFLOW_TOOL_INPUT_SCHEMAS.ragflow_discover },
    output,
    isConcurrencySafe: args => isRagFlowToolConcurrencySafe('ragflow_discover', args.input),
    async execute(args, exec) {
      return executeBusinessTool(services, exec, 'ragflow_discover', args, async () => {
        const input = object(args.input)
        const client = await services.client(exec)
        string(input, 'action')
        const context = await client.authorization.getContext(requestOptions(exec, 'authorization.context', 'ragflow_discover', input))
        return safeAuthorizationDiscovery(context)
      })
    },
  }), timeoutMs))

  disposers.push(register(ctx, defineTool({
    name: 'ragflow_retrieval',
    description: 'Retrieve relevant RAGFlow chunks by question over selected datasets, or all accessible datasets when datasetIds is omitted.',
    parameters: { input: RAGFLOW_TOOL_INPUT_SCHEMAS.ragflow_retrieval }, output,
    isConcurrencySafe: args => isRagFlowToolConcurrencySafe('ragflow_retrieval', args.input),
    async execute(args, exec) {
      return executeBusinessTool(services, exec, 'ragflow_retrieval', args, async () => {
        const input = object(args.input)
        const client = await services.client(exec)
        const referenceMetadata = input.referenceMetadata === undefined ? undefined : object(input.referenceMetadata, 'input.referenceMetadata')
        return client.retrieval.search({
          datasetIds: strings(input, 'datasetIds'),
          question: string(input, 'question'),
          documentIds: strings(input, 'documentIds'),
          cursor: optionalString(input, 'cursor'),
          limit: optionalInteger(input, 'limit', 1, 100),
          similarityThreshold: optionalNumber(input, 'similarityThreshold'),
          vectorSimilarityWeight: optionalNumber(input, 'vectorSimilarityWeight'),
          topK: optionalInteger(input, 'topK', 1, 10_000),
          rerankId: optionalString(input, 'rerankId'),
          keyword: boolean(input, 'keyword'),
          crossLanguages: strings(input, 'crossLanguages'),
          metadataCondition: optionalJson(input, 'metadataCondition'),
          useKg: boolean(input, 'useKg'),
          tocEnhance: boolean(input, 'tocEnhance'),
          highlight: input.highlight === undefined ? undefined : boolean(input, 'highlight'),
          referenceMetadata: referenceMetadata === undefined ? undefined : {
            include: boolean(referenceMetadata, 'include'),
            fields: strings(referenceMetadata, 'fields'),
          },
        }, requestOptions(exec, 'retrieval.search', 'ragflow_retrieval', input))
      })
    },
  }), timeoutMs))

  disposers.push(register(ctx, defineTool({
    name: 'ragflow_page_index',
    description: 'Build PageIndex for uploaded RAGFlow documents, observe parsing readiness, read chapter trees, or retrieve source chunks through matching chapter paths. Build and search are limited to explicitly selected documents.',
    parameters: { input: RAGFLOW_TOOL_INPUT_SCHEMAS.ragflow_page_index }, output,
    isConcurrencySafe: args => isRagFlowToolConcurrencySafe('ragflow_page_index', args.input),
    async execute(args, exec) {
      return executeBusinessTool(services, exec, 'ragflow_page_index', args, async () => {
        const input = object(args.input)
        const client = await services.client(exec)
        switch (string(input, 'action')) {
          case 'get': return client.pageIndex.get(
            string(input, 'datasetId'),
            string(input, 'documentId'),
            requestOptions(exec, 'pageIndex.get', 'ragflow_page_index', input),
          )
          case 'status': return client.pageIndex.status(
            string(input, 'datasetId'),
            string(input, 'documentId'),
            requestOptions(exec, 'pageIndex.status', 'ragflow_page_index', input),
          )
          case 'build': {
            const documentIds = requiredStrings(input, 'documentIds')
            if (documentIds.length > 20) throw new TypeError('input.documentIds must contain between 1 and 20 IDs')
            return client.pageIndex.build(
              string(input, 'datasetId'),
              { documentIds },
              requestOptions(exec, 'pageIndex.build', 'ragflow_page_index', input),
            )
          }
          case 'search': {
            const datasetIds = requiredStrings(input, 'datasetIds')
            if (datasetIds.length > 20) throw new TypeError('input.datasetIds must contain between 1 and 20 IDs')
            const documentIds = requiredStrings(input, 'documentIds')
            if (documentIds.length > 20) throw new TypeError('input.documentIds must contain between 1 and 20 IDs')
            return client.pageIndex.search({
              datasetIds,
              documentIds,
              question: string(input, 'question'),
              limit: optionalInteger(input, 'limit', 1, 100),
            }, requestOptions(exec, 'pageIndex.search', 'ragflow_page_index', input))
          }
          default: throw new TypeError('unsupported PageIndex action')
        }
      })
    },
  }), timeoutMs))

  disposers.push(register(ctx, defineTool({
    name: 'ragflow_manage_datasets',
    description: 'Manage RAGFlow datasets. Select one action-specific input shape.',
    parameters: { input: RAGFLOW_TOOL_INPUT_SCHEMAS.ragflow_manage_datasets }, output,
    isConcurrencySafe: args => isRagFlowToolConcurrencySafe('ragflow_manage_datasets', args.input),
    async execute(args, exec) {
      return executeBusinessTool(services, exec, 'ragflow_manage_datasets', args, async () => {
        const input = object(args.input)
        const client = await services.client(exec)
        switch (string(input, 'action')) {
          case 'list': return client.datasets.list(input, requestOptions(exec, 'datasets.list', 'ragflow_manage_datasets', input))
          case 'get': return client.datasets.get(string(input, 'datasetId'), requestOptions(exec, 'datasets.get', 'ragflow_manage_datasets', input))
          case 'create': return client.datasets.create({ name: string(input, 'name') }, requestOptions(exec, 'datasets.create', 'ragflow_manage_datasets', input))
          case 'update': return client.datasets.update(string(input, 'datasetId'), json(input, 'patch'), versionedRequestOptions(exec, 'datasets.update', 'ragflow_manage_datasets', input))
          case 'delete': return client.datasets.delete(string(input, 'datasetId'), versionedRequestOptions(exec, 'datasets.delete', 'ragflow_manage_datasets', input))
          default: throw new TypeError('unsupported dataset action')
        }
      })
    },
  }), timeoutMs))

  disposers.push(register(ctx, defineTool({
    name: 'ragflow_manage_documents',
    description: 'Manage dataset documents and automatic metadata. Select one action-specific input shape.',
    parameters: { input: RAGFLOW_TOOL_INPUT_SCHEMAS.ragflow_manage_documents }, output,
    isConcurrencySafe: args => isRagFlowToolConcurrencySafe('ragflow_manage_documents', args.input),
    async execute(args, exec) {
      return executeBusinessTool(services, exec, 'ragflow_manage_documents', args, async () => {
        const input = object(args.input); const datasetId = string(input, 'datasetId'); const client = await services.client(exec)
        switch (string(input, 'action')) {
          case 'list': return client.documents.list({
            datasetId,
            cursor: optionalString(input, 'cursor'), limit: optionalInteger(input, 'limit', 1, 100),
            id: optionalString(input, 'id'), ids: strings(input, 'ids'), name: optionalString(input, 'name'),
            keywords: optionalString(input, 'keywords'), createTimeFrom: optionalInteger(input, 'createTimeFrom', 0), createTimeTo: optionalInteger(input, 'createTimeTo', 0),
          }, requestOptions(exec, 'documents.list', 'ragflow_manage_documents', input))
          case 'update': return client.documents.update(datasetId, string(input, 'documentId'), json(input, 'patch'), versionedRequestOptions(exec, 'documents.update', 'ragflow_manage_documents', input))
          case 'delete': return client.documents.delete(datasetId, string(input, 'documentId'), versionedRequestOptions(exec, 'documents.delete', 'ragflow_manage_documents', input))
          case 'get_auto_metadata': return client.datasets.getMetadataConfig(datasetId, requestOptions(exec, 'datasets.getMetadataConfig', 'ragflow_manage_documents', input))
          case 'update_auto_metadata': return client.datasets.updateMetadataConfig(datasetId, json(input, 'config'), versionedRequestOptions(exec, 'datasets.updateMetadataConfig', 'ragflow_manage_documents', input))
          default: throw new TypeError('unsupported document action')
        }
      })
    },
  }), timeoutMs))

  disposers.push(register(ctx, defineTool({
    name: 'ragflow_transfer_documents',
    description: 'Upload or download bounded documents and control document parsing through the Business Gateway.',
    parameters: { input: RAGFLOW_TOOL_INPUT_SCHEMAS.ragflow_transfer_documents }, output,
    isConcurrencySafe: args => isRagFlowToolConcurrencySafe('ragflow_transfer_documents', args.input),
    async execute(args, exec) {
      return executeBusinessTool(services, exec, 'ragflow_transfer_documents', args, async () => {
        const input = object(args.input); const datasetId = string(input, 'datasetId'); const client = await services.client(exec)
        switch (string(input, 'action')) {
          case 'upload': {
            const options = requestOptions(exec, 'documents.upload', 'ragflow_transfer_documents', input)
            if (options.idempotencyKey === undefined) {
              throw new BusinessGatewayError('documents.upload capability must require idempotency', {
                code: 'RAGFLOW_CAPABILITY_MANIFEST_INVALID',
                status: 503,
              })
            }
            return services.uploadDocument(exec, client, {
              datasetId,
              sourcePath: string(input, 'sourcePath'),
              displayName: optionalString(input, 'displayName'),
              idempotencyKey: options.idempotencyKey,
            })
          }
          case 'download': {
            const documentId = string(input, 'documentId')
            const fileName = optionalString(input, 'fileName') ?? `document-${documentId}.bin`
            const response = await client.documents.download(datasetId, documentId, requestOptions(exec, 'documents.download', 'ragflow_transfer_documents', input))
            const artifact = await services.downloadArtifact(exec, response, { name: fileName, label: `document-${documentId}` })
            return {
              kind: 'ragflow-artifact-result',
              data: {
                datasetId,
                documentId,
                bytes: artifact.bytes,
                artifactName: artifact.name,
                mimeType: artifact.originalMimeType ?? artifact.mimeType,
                ...(artifact.sha256 ? { sha256: artifact.sha256 } : {}),
              },
              artifacts: [artifact],
            } satisfies ArtifactExecutionResult
          }
          case 'start_parse': return client.documents.startParse(datasetId, requiredStrings(input, 'documentIds'), requestOptions(exec, 'documents.startParse', 'ragflow_transfer_documents', input))
          case 'cancel_parse': return client.documents.cancelParse(datasetId, requiredStrings(input, 'documentIds'), requestOptions(exec, 'documents.cancelParse', 'ragflow_transfer_documents', input))
          default: throw new TypeError('unsupported document transfer action')
        }
      })
    },
  }), timeoutMs))

  disposers.push(register(ctx, defineTool({
    name: 'ragflow_manage_chunks',
    description: 'Manage document chunks. Select one action-specific input shape.',
    parameters: { input: RAGFLOW_TOOL_INPUT_SCHEMAS.ragflow_manage_chunks }, output,
    isConcurrencySafe: args => isRagFlowToolConcurrencySafe('ragflow_manage_chunks', args.input),
    async execute(args, exec) {
      return executeBusinessTool(services, exec, 'ragflow_manage_chunks', args, async () => {
        const input = object(args.input); const datasetId = string(input, 'datasetId'); const documentId = string(input, 'documentId'); const client = await services.client(exec)
        switch (string(input, 'action')) {
          case 'list': return client.chunks.list(datasetId, documentId, {
            cursor: optionalString(input, 'cursor'), limit: optionalInteger(input, 'limit', 1, 100),
            keywords: optionalString(input, 'keywords'), id: optionalString(input, 'id'),
          }, requestOptions(exec, 'chunks.list', 'ragflow_manage_chunks', input))
          case 'add': return client.chunks.create(datasetId, documentId, { content: string(input, 'content') }, requestOptions(exec, 'chunks.create', 'ragflow_manage_chunks', input))
          case 'update': return client.chunks.update(datasetId, documentId, string(input, 'chunkId'), json(input, 'patch'), versionedRequestOptions(exec, 'chunks.update', 'ragflow_manage_chunks', input))
          case 'delete': return client.chunks.delete(datasetId, documentId, string(input, 'chunkId'), versionedRequestOptions(exec, 'chunks.delete', 'ragflow_manage_chunks', input))
          default: throw new TypeError('unsupported chunk action')
        }
      })
    },
  }), timeoutMs))

  disposers.push(register(ctx, defineTool({
    name: 'ragflow_manage_chats', description: 'Manage chats. Select one action-specific input shape.',
    parameters: { input: RAGFLOW_TOOL_INPUT_SCHEMAS.ragflow_manage_chats }, output,
    isConcurrencySafe: args => isRagFlowToolConcurrencySafe('ragflow_manage_chats', args.input),
    async execute(args, exec) {
      return executeBusinessTool(services, exec, 'ragflow_manage_chats', args, async () => {
        const input = object(args.input)
        const client = await services.client(exec)
        switch (string(input, 'action')) {
          case 'list': return client.chats.list(input, requestOptions(exec, 'chats.list', 'ragflow_manage_chats', input))
          case 'get': return client.chats.get(string(input, 'chatId'), requestOptions(exec, 'chats.get', 'ragflow_manage_chats', input))
          case 'create': return client.chats.create({ name: string(input, 'name') }, requestOptions(exec, 'chats.create', 'ragflow_manage_chats', input))
          case 'update': return client.chats.update(string(input, 'chatId'), json(input, 'patch'), versionedRequestOptions(exec, 'chats.update', 'ragflow_manage_chats', input))
          case 'delete': return client.chats.delete(string(input, 'chatId'), versionedRequestOptions(exec, 'chats.delete', 'ragflow_manage_chats', input))
          default: throw new TypeError('unsupported chat action')
        }
      })
    },
  }), timeoutMs))

  disposers.push(register(ctx, defineTool({
    name: 'ragflow_manage_sessions', description: 'Manage chat or agent sessions. Select one action-specific input shape; kind is chat or agent.',
    parameters: { input: RAGFLOW_TOOL_INPUT_SCHEMAS.ragflow_manage_sessions }, output,
    isConcurrencySafe: args => isRagFlowToolConcurrencySafe('ragflow_manage_sessions', args.input),
    async execute(args, exec) {
      return executeBusinessTool(services, exec, 'ragflow_manage_sessions', args, async () => {
        const input = object(args.input); const owner = target(input); const client = await services.client(exec)
        switch (string(input, 'action')) {
          case 'create': {
            const request = object(input.request, 'input.request')
            return client.sessions.create(owner, { name: optionalString(request, 'name'), inputs: optionalJson(request, 'inputs') }, requestOptions(exec, owner.kind === 'chat' ? 'chatSessions.create' : 'agentSessions.create', 'ragflow_manage_sessions', input))
          }
          case 'list': return client.sessions.list({
            ...owner, cursor: optionalString(input, 'cursor'), limit: optionalInteger(input, 'limit', 1, 100),
            id: optionalString(input, 'id'), name: optionalString(input, 'name'),
          }, requestOptions(exec, owner.kind === 'chat' ? 'chatSessions.list' : 'agentSessions.list', 'ragflow_manage_sessions', input))
          case 'update': return client.sessions.update(owner, string(input, 'sessionId'), json(input, 'patch'), versionedRequestOptions(exec, 'chatSessions.update', 'ragflow_manage_sessions', input))
          case 'delete': return client.sessions.delete(owner, string(input, 'sessionId'), versionedRequestOptions(exec, owner.kind === 'chat' ? 'chatSessions.delete' : 'agentSessions.delete', 'ragflow_manage_sessions', input))
          case 'ask': return client.sessions.invoke({
            ...owner,
            sessionId: string(input, 'sessionId'),
            question: string(input, 'question'),
            inputs: optionalJson(input, 'inputs'),
            release: optionalBoolean(input, 'release'),
            returnTrace: optionalBoolean(input, 'returnTrace'),
          }, requestOptions(exec, owner.kind === 'chat' ? 'chatSessions.invoke' : 'agentSessions.invoke', 'ragflow_manage_sessions', input))
          default: throw new TypeError('unsupported session action')
        }
      })
    },
  }), timeoutMs))

  disposers.push(register(ctx, defineTool({
    name: 'ragflow_manage_agents', description: 'Manage RAGFlow agents. Select one action-specific input shape.',
    parameters: { input: RAGFLOW_TOOL_INPUT_SCHEMAS.ragflow_manage_agents }, output,
    isConcurrencySafe: args => isRagFlowToolConcurrencySafe('ragflow_manage_agents', args.input),
    async execute(args, exec) {
      return executeBusinessTool(services, exec, 'ragflow_manage_agents', args, async () => {
        const input = object(args.input)
        const client = await services.client(exec)
        switch (string(input, 'action')) {
          case 'list': return client.agents.list({ cursor: optionalString(input, 'cursor'), limit: optionalInteger(input, 'limit', 1, 100) }, requestOptions(exec, 'agents.list', 'ragflow_manage_agents', input))
          case 'get': return client.agents.get(string(input, 'agentId'), requestOptions(exec, 'agents.get', 'ragflow_manage_agents', input))
          case 'create': return client.agents.create({ title: string(input, 'title'), dsl: json(input, 'dsl') }, requestOptions(exec, 'agents.create', 'ragflow_manage_agents', input))
          case 'update': return client.agents.update(string(input, 'agentId'), json(input, 'patch'), versionedRequestOptions(exec, 'agents.update', 'ragflow_manage_agents', input))
          case 'delete': return client.agents.delete(string(input, 'agentId'), versionedRequestOptions(exec, 'agents.delete', 'ragflow_manage_agents', input))
          default: throw new TypeError('unsupported agent action')
        }
      })
    },
  }), timeoutMs))

  disposers.push(register(ctx, defineTool({
    name: 'ragflow_manage_memories', description: 'Manage memories and their messages. Actions: create/list/update/delete/get_config/list_messages/forget_message/update_message_status/get_message_content/add_message/search_messages/recent_messages.',
    parameters: { input: RAGFLOW_TOOL_INPUT_SCHEMAS.ragflow_manage_memories }, output,
    isConcurrencySafe: args => isRagFlowToolConcurrencySafe('ragflow_manage_memories', args.input),
    async execute(args, exec) {
      return executeBusinessTool(services, exec, 'ragflow_manage_memories', args, async () => {
        const input = object(args.input)
        const client = await services.client(exec)
        switch (string(input, 'action')) {
          case 'create': {
            const request = {
              name: string(input, 'name'), memoryType: requiredStrings(input, 'memoryType'),
              embdId: string(input, 'embdId'), llmId: string(input, 'llmId'),
            }
            return client.memories.create(request, requestOptions(exec, 'memories.create', 'ragflow_manage_memories', input))
          }
          case 'list': return client.memories.list({
            cursor: optionalString(input, 'cursor'), limit: optionalInteger(input, 'limit', 1, 100),
            memoryType: strings(input, 'memoryType'), storageType: optionalString(input, 'storageType'), keywords: optionalString(input, 'keywords'),
          }, requestOptions(exec, 'memories.list', 'ragflow_manage_memories', input))
          case 'update': return client.memories.update(string(input, 'memoryId'), json(input, 'patch'), versionedRequestOptions(exec, 'memories.update', 'ragflow_manage_memories', input))
          case 'delete': return client.memories.delete(string(input, 'memoryId'), versionedRequestOptions(exec, 'memories.delete', 'ragflow_manage_memories', input))
          case 'get_config': return client.memories.getConfig(string(input, 'memoryId'), requestOptions(exec, 'memories.getConfig', 'ragflow_manage_memories', input))
          case 'list_messages': return client.memoryMessages.list(string(input, 'memoryId'), { cursor: optionalString(input, 'cursor'), limit: optionalInteger(input, 'limit', 1, 100) }, requestOptions(exec, 'memoryMessages.list', 'ragflow_manage_memories', input))
          case 'forget_message': return client.memoryMessages.delete(string(input, 'memoryId'), integer(input, 'messageId'), versionedRequestOptions(exec, 'memoryMessages.delete', 'ragflow_manage_memories', input))
          case 'update_message_status': return client.memoryMessages.update(string(input, 'memoryId'), integer(input, 'messageId'), { status: boolean(input, 'status') }, versionedRequestOptions(exec, 'memoryMessages.update', 'ragflow_manage_memories', input))
          case 'get_message_content': return client.memoryMessages.getContent(string(input, 'memoryId'), integer(input, 'messageId'), requestOptions(exec, 'memoryMessages.getContent', 'ragflow_manage_memories', input))
          case 'add_message': {
            const request = {
              memoryIds: requiredStrings(input, 'memoryIds'), agentId: string(input, 'agentId'), sessionId: string(input, 'sessionId'),
              userInput: string(input, 'userInput'), agentResponse: string(input, 'agentResponse'),
            }
            return client.memoryMessages.batchCreate(request, requestOptions(exec, 'memoryMessages.batchCreate', 'ragflow_manage_memories', input))
          }
          case 'search_messages': return client.memoryMessages.search({
            query: string(input, 'query'), memoryIds: requiredStrings(input, 'memoryIds'),
            agentId: optionalString(input, 'agentId'), sessionId: optionalString(input, 'sessionId'),
            similarityThreshold: optionalNumber(input, 'similarityThreshold'), keywordsSimilarityWeight: optionalNumber(input, 'keywordsSimilarityWeight'), topN: optionalInteger(input, 'topN'),
          }, requestOptions(exec, 'memoryMessages.search', 'ragflow_manage_memories', input))
          case 'recent_messages': return client.memoryMessages.recent({
            memoryIds: requiredStrings(input, 'memoryIds'), agentId: optionalString(input, 'agentId'),
            sessionId: optionalString(input, 'sessionId'), limit: optionalInteger(input, 'limit', 1, 100),
          }, requestOptions(exec, 'memoryMessages.recent', 'ragflow_manage_memories', input))
          default: throw new TypeError('unsupported memory action')
        }
      })
    },
  }), timeoutMs))
  return () => {
    for (const dispose of disposers.reverse()) dispose()
  }
}
