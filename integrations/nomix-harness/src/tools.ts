import type { Context } from '@nomix-ai/cordis'
import { HarnessError } from '@nomix-ai/nomix-llm'
import { defineTool, type JsonValue, type PreToolDecision } from '@nomix-ai/nomix-tools'
import { RagFlowApiError, type RagFlowClient } from './client.js'
import { uploadWorkspaceDocument, type TransferOptions } from './files.js'
import type { JsonObject, SessionTarget } from './types.js'

type Input = Record<string, unknown>

const requiredString = { type: 'string', required: true } as const
const requiredNumber = { type: 'number', required: true } as const
const requiredJson = { type: 'json', required: true } as const
const stringArray = { type: 'array', items: { type: 'string' } } as const
const requiredStringArray = { ...stringArray, required: true } as const
const numberInput = { type: 'number' } as const
const booleanInput = { type: 'boolean' } as const
const pageProperties = {
  page: numberInput,
  pageSize: numberInput,
  orderby: { type: 'string' },
  desc: booleanInput,
} as const
const TOOL_TIMEOUT_MS = 5 * 60_000

function actionInput<const A extends string, const P extends Record<string, object>>(action: A, properties: P) {
  return {
    type: 'object' as const,
    additionalProperties: false,
    properties: {
      action: { type: 'string' as const, const: action, required: true as const },
      ...properties,
    },
  }
}

const output = {
  schema: { type: 'json' } as const,
  render: (_args: unknown, value: JsonValue) => [{ type: 'text' as const, text: JSON.stringify(value, null, 2) }],
}

function object(value: unknown, label = 'input'): Input {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${label} must be an object`)
  return value as Input
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

function number(input: Input, key: string): number {
  const value = input[key]
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new TypeError(`input.${key} must be a finite number`)
  return value
}

function optionalNumber(input: Input, key: string): number | undefined {
  const value = input[key]
  if (value === undefined) return undefined
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new TypeError(`input.${key} must be a finite number`)
  return value
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
  return object(value, `input.${key}`) as JsonObject
}

function optionalJson(input: Input, key: string): JsonObject | undefined {
  const value = input[key]
  return value === undefined ? undefined : object(value, `input.${key}`) as JsonObject
}

function target(input: Input): SessionTarget {
  const kind = string(input, 'kind')
  if (kind !== 'chat' && kind !== 'agent') throw new TypeError('input.kind must be chat or agent')
  return { kind, ownerId: string(input, 'ownerId') }
}

function done(): JsonValue { return { ok: true } }

function deleteSelection(input: Input): { ids: string[] | undefined; deleteAll: boolean } {
  const ids = strings(input, 'ids')
  const deleteAll = boolean(input, 'deleteAll')
  if (deleteAll && ids !== undefined && ids.length > 0) throw new TypeError('input.ids and input.deleteAll=true are mutually exclusive')
  if (!deleteAll && (ids === undefined || ids.length === 0)) throw new TypeError('delete requires a non-empty input.ids array or explicit input.deleteAll=true')
  return { ids, deleteAll }
}

const destructive: Readonly<Record<string, ReadonlySet<string>>> = {
  ragflow_manage_datasets: new Set(['delete']),
  ragflow_manage_documents: new Set(['delete', 'cancel_parse']),
  ragflow_manage_chunks: new Set(['delete']),
  ragflow_manage_chats: new Set(['delete']),
  ragflow_manage_sessions: new Set(['delete']),
  ragflow_manage_agents: new Set(['delete']),
  ragflow_manage_memories: new Set(['delete', 'forget_message']),
}

export async function destructiveDecision(name: string, args: unknown, next: () => Promise<PreToolDecision>): Promise<PreToolDecision> {
  const actions = destructive[name]
  if (actions === undefined) return next()
  const action = object(object(args).input, 'input').action
  if (typeof action === 'string' && actions.has(action)) {
    const input = object(object(args).input, 'input')
    const ids = [input.ids, input.documentIds]
      .filter(Array.isArray)
      .flat()
      .filter((value): value is string => typeof value === 'string')
    const scope = input.deleteAll === true
      ? 'all matching resources'
      : ids.length > 0
        ? `${ids.length} resource(s): ${ids.slice(0, 5).join(', ')}${ids.length > 5 ? ', …' : ''}`
        : [input.datasetId, input.documentId, input.agentId, input.memoryId, input.messageId].filter(value => value !== undefined).join(' / ') || 'the selected resource'
    return { kind: 'ask', reason: `RAGFlow action ${name}.${action} will affect ${scope} and requires one-time approval.` }
  }
  return next()
}

function register(ctx: Context, definition: ReturnType<typeof defineTool>): void {
  const execute = definition.execute
  ctx.effect(() => ctx.tools.register({
    ...definition,
    timeoutMs: definition.timeoutMs ?? TOOL_TIMEOUT_MS,
    async execute(args, exec) {
      try {
        return await execute(args, exec)
      } catch (error) {
        if (error instanceof RagFlowApiError) throw new HarnessError(error.message, error.machineCode, { cause: error })
        throw error
      }
    },
  }))
}

export function registerRagFlowTools(ctx: Context, client: RagFlowClient, transfer: TransferOptions): void {
  register(ctx, defineTool({
    name: 'ragflow_retrieval',
    description: 'Retrieve relevant RAGFlow chunks by question over selected datasets, or all accessible datasets when datasetIds is omitted.',
    parameters: { input: {
      type: 'object',
      required: true,
      additionalProperties: false,
      properties: {
        question: requiredString,
        datasetIds: stringArray,
        documentIds: stringArray,
        page: numberInput,
        pageSize: numberInput,
        similarityThreshold: numberInput,
        vectorSimilarityWeight: numberInput,
        topK: numberInput,
        rerankId: { type: 'string' },
        keyword: booleanInput,
        crossLanguages: stringArray,
        metadataCondition: { type: 'json' },
        useKg: booleanInput,
        tocEnhance: booleanInput,
        highlight: booleanInput,
        referenceMetadata: {
          type: 'object',
          additionalProperties: false,
          properties: {
            include: { type: 'boolean', required: true },
            fields: stringArray,
          },
        },
      },
    } }, output,
    async execute(args, exec) {
      const input = object(args.input)
      let datasetIds = strings(input, 'datasetIds')
      if (datasetIds === undefined || datasetIds.length === 0) {
        datasetIds = []
        for (let page = 1; ; page += 1) {
          const datasets = await client.datasets.list({ page, pageSize: 100 }, { signal: exec.signal })
          datasetIds.push(...datasets.map(dataset => dataset.id))
          if (datasets.length < 100) break
        }
        datasetIds = [...new Set(datasetIds)]
        if (datasetIds.length === 0) throw new Error('No accessible RAGFlow datasets found')
      }
      const referenceMetadata = input.referenceMetadata === undefined ? undefined : object(input.referenceMetadata, 'input.referenceMetadata')
      return client.retrieval.search({
        datasetIds,
        question: string(input, 'question'),
        documentIds: strings(input, 'documentIds'),
        page: optionalNumber(input, 'page'),
        pageSize: optionalNumber(input, 'pageSize'),
        similarityThreshold: optionalNumber(input, 'similarityThreshold'),
        vectorSimilarityWeight: optionalNumber(input, 'vectorSimilarityWeight'),
        topK: optionalNumber(input, 'topK'),
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
      }, { signal: exec.signal }) as Promise<JsonValue>
    },
  }))

  register(ctx, defineTool({
    name: 'ragflow_manage_datasets',
    description: 'Manage RAGFlow datasets. Select one action-specific input shape.',
    parameters: { input: { oneOf: [
      actionInput('list', { ...pageProperties, id: { type: 'string' }, ids: stringArray, name: { type: 'string' } }),
      actionInput('get', { name: requiredString }),
      actionInput('create', { name: requiredString }),
      actionInput('update', { datasetId: requiredString, patch: requiredJson }),
      actionInput('delete', { ids: stringArray, deleteAll: { type: 'boolean' } }),
    ], required: true } }, output,
    async execute(args, exec) {
      const input = object(args.input)
      switch (string(input, 'action')) {
        case 'list': return client.datasets.list(input, { signal: exec.signal }) as Promise<JsonValue>
        case 'get': return client.datasets.getByName(string(input, 'name'), { signal: exec.signal }) as Promise<JsonValue>
        case 'create': return client.datasets.create({ ...input, name: string(input, 'name') } as never, { signal: exec.signal }) as Promise<JsonValue>
        case 'update': return client.datasets.update(string(input, 'datasetId'), json(input, 'patch'), { signal: exec.signal }) as Promise<JsonValue>
        case 'delete': { const selection = deleteSelection(input); await client.datasets.delete(selection.ids, selection.deleteAll, { signal: exec.signal }); return done() }
        default: throw new TypeError('unsupported dataset action')
      }
    },
  }))

  register(ctx, defineTool({
    name: 'ragflow_manage_documents',
    description: 'Manage dataset documents, parsing, and automatic metadata. Select one action-specific input shape.',
    parameters: { input: { oneOf: [
      actionInput('list', { datasetId: requiredString, ...pageProperties, id: { type: 'string' }, ids: stringArray, name: { type: 'string' }, keywords: { type: 'string' }, createTimeFrom: numberInput, createTimeTo: numberInput }),
      actionInput('update', { datasetId: requiredString, documentId: requiredString, patch: requiredJson }),
      actionInput('delete', { datasetId: requiredString, ids: stringArray, deleteAll: { type: 'boolean' } }),
      actionInput('start_parse', { datasetId: requiredString, documentIds: requiredStringArray }),
      actionInput('cancel_parse', { datasetId: requiredString, documentIds: requiredStringArray }),
      actionInput('get_auto_metadata', { datasetId: requiredString }),
      actionInput('update_auto_metadata', { datasetId: requiredString, config: requiredJson }),
    ], required: true } }, output,
    async execute(args, exec) {
      const input = object(args.input); const datasetId = string(input, 'datasetId')
      switch (string(input, 'action')) {
        case 'list': return client.documents.list(input as never, { signal: exec.signal }) as Promise<JsonValue>
        case 'update': return client.documents.update(datasetId, string(input, 'documentId'), json(input, 'patch'), { signal: exec.signal }) as Promise<JsonValue>
        case 'delete': { const selection = deleteSelection(input); await client.documents.delete(datasetId, selection.ids, selection.deleteAll, { signal: exec.signal }); return done() }
        case 'start_parse': await client.documents.startParse(datasetId, requiredStrings(input, 'documentIds'), { signal: exec.signal }); return done()
        case 'cancel_parse': await client.documents.cancelParse(datasetId, requiredStrings(input, 'documentIds'), { signal: exec.signal }); return done()
        case 'get_auto_metadata': return client.datasets.getAutoMetadata(datasetId, { signal: exec.signal }) as Promise<JsonValue>
        case 'update_auto_metadata': return client.datasets.updateAutoMetadata(datasetId, json(input, 'config'), { signal: exec.signal }) as Promise<JsonValue>
        default: throw new TypeError('unsupported document action')
      }
    },
  }))

  register(ctx, defineTool({
    name: 'ragflow_transfer_documents',
    description: 'Upload a document from the Harness workspace to RAGFlow REST through the sandboxed Harness filesystem.',
    parameters: { input: {
      ...actionInput('upload', { datasetId: requiredString, sourcePath: requiredString, displayName: { type: 'string' } }),
      required: true,
    } }, output,
    async execute(args, exec) {
      const input = object(args.input); const datasetId = string(input, 'datasetId')
      switch (string(input, 'action')) {
        case 'upload': return uploadWorkspaceDocument(ctx, client, transfer, datasetId, string(input, 'sourcePath'), optionalString(input, 'displayName'), exec.signal) as Promise<JsonValue>
        default: throw new TypeError('unsupported document transfer action')
      }
    },
  }))

  register(ctx, defineTool({
    name: 'ragflow_manage_chunks',
    description: 'Manage document chunks. Select one action-specific input shape.',
    parameters: { input: { oneOf: [
      actionInput('list', { datasetId: requiredString, documentId: requiredString, ...pageProperties, keywords: { type: 'string' }, id: { type: 'string' } }),
      actionInput('add', { datasetId: requiredString, documentId: requiredString, content: requiredString }),
      actionInput('update', { datasetId: requiredString, documentId: requiredString, chunkId: requiredString, patch: requiredJson }),
      actionInput('delete', { datasetId: requiredString, documentId: requiredString, ids: stringArray, deleteAll: { type: 'boolean' } }),
    ], required: true } }, output,
    async execute(args, exec) {
      const input = object(args.input); const datasetId = string(input, 'datasetId'); const documentId = string(input, 'documentId')
      switch (string(input, 'action')) {
        case 'list': return client.chunks.list(datasetId, documentId, input, { signal: exec.signal }) as Promise<JsonValue>
        case 'add': return client.chunks.add(datasetId, documentId, { ...input, content: string(input, 'content') } as never, { signal: exec.signal }) as Promise<JsonValue>
        case 'update': await client.chunks.update(datasetId, documentId, string(input, 'chunkId'), json(input, 'patch'), { signal: exec.signal }); return done()
        case 'delete': { const selection = deleteSelection(input); await client.chunks.delete(datasetId, documentId, selection.ids, selection.deleteAll, { signal: exec.signal }); return done() }
        default: throw new TypeError('unsupported chunk action')
      }
    },
  }))

  register(ctx, defineTool({
    name: 'ragflow_manage_chats', description: 'Manage chats. Select one action-specific input shape.',
    parameters: { input: { oneOf: [
      actionInput('list', { ...pageProperties, id: { type: 'string' }, name: { type: 'string' }, keywords: { type: 'string' }, ownerIds: stringArray }),
      actionInput('get', { chatId: requiredString }),
      actionInput('create', { name: requiredString }),
      actionInput('update', { chatId: requiredString, patch: requiredJson }),
      actionInput('delete', { ids: stringArray, deleteAll: { type: 'boolean' } }),
    ], required: true } }, output,
    async execute(args, exec) {
      const input = object(args.input)
      switch (string(input, 'action')) {
        case 'list': return client.chats.list(input, { signal: exec.signal }) as Promise<JsonValue>
        case 'get': return client.chats.get(string(input, 'chatId'), { signal: exec.signal }) as Promise<JsonValue>
        case 'create': return client.chats.create({ name: string(input, 'name') }, { signal: exec.signal }) as Promise<JsonValue>
        case 'update': await client.chats.update(string(input, 'chatId'), json(input, 'patch'), { signal: exec.signal }); return done()
        case 'delete': { const selection = deleteSelection(input); await client.chats.delete(selection.ids, selection.deleteAll, { signal: exec.signal }); return done() }
        default: throw new TypeError('unsupported chat action')
      }
    },
  }))

  register(ctx, defineTool({
    name: 'ragflow_manage_sessions', description: 'Manage chat or agent sessions. Select one action-specific input shape; kind is chat or agent.',
    parameters: { input: { oneOf: [
      actionInput('create', { kind: { type: 'string', enum: ['chat', 'agent'], required: true }, ownerId: requiredString, request: requiredJson }),
      actionInput('list', { kind: { type: 'string', enum: ['chat', 'agent'], required: true }, ownerId: requiredString, ...pageProperties, id: { type: 'string' }, name: { type: 'string' }, userId: { type: 'string' } }),
      actionInput('update', { kind: { type: 'string', const: 'chat', required: true }, ownerId: requiredString, sessionId: requiredString, patch: requiredJson }),
      actionInput('delete', { kind: { type: 'string', enum: ['chat', 'agent'], required: true }, ownerId: requiredString, ids: stringArray, deleteAll: { type: 'boolean' } }),
      actionInput('ask', { kind: { type: 'string', enum: ['chat', 'agent'], required: true }, ownerId: requiredString, sessionId: requiredString, question: { type: 'string' }, inputs: { type: 'json' }, release: booleanInput, returnTrace: booleanInput, extra: { type: 'json' } }),
    ], required: true } }, output,
    async execute(args, exec) {
      const input = object(args.input); const owner = target(input)
      switch (string(input, 'action')) {
        case 'create': return client.sessions.create(owner, json(input, 'request'), { signal: exec.signal }) as Promise<JsonValue>
        case 'list': return client.sessions.list(input as never, { signal: exec.signal }) as Promise<JsonValue>
        case 'update': if (owner.kind !== 'chat') throw new TypeError('RAGFlow only supports updating chat sessions'); await client.sessions.updateChat(owner.ownerId, string(input, 'sessionId'), json(input, 'patch'), { signal: exec.signal }); return done()
        case 'delete': { const selection = deleteSelection(input); await client.sessions.delete(owner, selection.ids, selection.deleteAll, { signal: exec.signal }); return done() }
        case 'ask': string(input, 'sessionId'); return client.sessions.ask(input as never, { signal: exec.signal }) as Promise<JsonValue>
        default: throw new TypeError('unsupported session action')
      }
    },
  }))

  register(ctx, defineTool({
    name: 'ragflow_manage_agents', description: 'Manage RAGFlow agents. Select one action-specific input shape.',
    parameters: { input: { oneOf: [
      actionInput('list', { ...pageProperties }),
      actionInput('get', { agentId: requiredString }),
      actionInput('create', { title: requiredString, dsl: requiredJson }),
      actionInput('update', { agentId: requiredString, patch: requiredJson }),
      actionInput('delete', { agentId: requiredString }),
    ], required: true } }, output,
    async execute(args, exec) {
      const input = object(args.input)
      switch (string(input, 'action')) {
        case 'list': return client.agents.list(input, { signal: exec.signal }) as Promise<JsonValue>
        case 'get': return client.agents.get(string(input, 'agentId'), { signal: exec.signal }) as Promise<JsonValue>
        case 'create': return client.agents.create({ title: string(input, 'title'), dsl: json(input, 'dsl') }, { signal: exec.signal }) as Promise<JsonValue>
        case 'update': await client.agents.update(string(input, 'agentId'), json(input, 'patch'), { signal: exec.signal }); return done()
        case 'delete': await client.agents.delete(string(input, 'agentId'), { signal: exec.signal }); return done()
        default: throw new TypeError('unsupported agent action')
      }
    },
  }))

  register(ctx, defineTool({
    name: 'ragflow_manage_memories', description: 'Manage memories and their messages. Actions: create/list/update/delete/get_config/list_messages/forget_message/update_message_status/get_message_content/add_message/search_messages/recent_messages.',
    parameters: { input: { oneOf: [
      actionInput('create', { name: requiredString, memoryType: requiredStringArray, embdId: requiredString, llmId: requiredString }),
      actionInput('list', { page: numberInput, pageSize: numberInput, tenantId: stringArray, memoryType: stringArray, storageType: { type: 'string' }, keywords: { type: 'string' } }),
      actionInput('update', { memoryId: requiredString, patch: requiredJson }),
      actionInput('delete', { memoryId: requiredString }),
      actionInput('get_config', { memoryId: requiredString }),
      actionInput('list_messages', { memoryId: requiredString, page: numberInput, pageSize: numberInput }),
      actionInput('forget_message', { memoryId: requiredString, messageId: requiredNumber }),
      actionInput('update_message_status', { memoryId: requiredString, messageId: requiredNumber, status: { type: 'boolean', required: true } }),
      actionInput('get_message_content', { memoryId: requiredString, messageId: requiredNumber }),
      actionInput('add_message', { memoryIds: requiredStringArray, agentId: requiredString, sessionId: requiredString, userInput: requiredString, agentResponse: requiredString }),
      actionInput('search_messages', { query: requiredString, memoryIds: requiredStringArray, agentId: { type: 'string' }, sessionId: { type: 'string' }, userId: { type: 'string' }, similarityThreshold: numberInput, keywordsSimilarityWeight: numberInput, topN: numberInput }),
      actionInput('recent_messages', { memoryIds: requiredStringArray, agentId: { type: 'string' }, sessionId: { type: 'string' }, limit: numberInput }),
    ], required: true } }, output,
    async execute(args, exec) {
      const input = object(args.input); const options = { signal: exec.signal }
      switch (string(input, 'action')) {
        case 'create': string(input, 'name'); requiredStrings(input, 'memoryType'); string(input, 'embdId'); string(input, 'llmId'); return client.memories.create(input as never, options) as Promise<JsonValue>
        case 'list': return client.memories.list(input, options) as unknown as Promise<JsonValue>
        case 'update': return client.memories.update(string(input, 'memoryId'), json(input, 'patch'), options) as Promise<JsonValue>
        case 'delete': await client.memories.delete(string(input, 'memoryId'), options); return done()
        case 'get_config': return client.memories.getConfig(string(input, 'memoryId'), options) as Promise<JsonValue>
        case 'list_messages': return client.memories.listMessages(string(input, 'memoryId'), input, options) as Promise<JsonValue>
        case 'forget_message': await client.memories.forgetMessage(string(input, 'memoryId'), number(input, 'messageId'), options); return done()
        case 'update_message_status': await client.memories.updateMessageStatus(string(input, 'memoryId'), number(input, 'messageId'), boolean(input, 'status'), options); return done()
        case 'get_message_content': return client.memories.getMessageContent(string(input, 'memoryId'), number(input, 'messageId'), options) as Promise<JsonValue>
        case 'add_message': requiredStrings(input, 'memoryIds'); string(input, 'agentId'); string(input, 'sessionId'); string(input, 'userInput'); string(input, 'agentResponse'); return client.memories.addMessage(input as never, options) as Promise<JsonValue>
        case 'search_messages': string(input, 'query'); requiredStrings(input, 'memoryIds'); return client.memories.searchMessages(input as never, options) as Promise<JsonValue>
        case 'recent_messages': requiredStrings(input, 'memoryIds'); return client.memories.recentMessages(input as never, options) as Promise<JsonValue>
        default: throw new TypeError('unsupported memory action')
      }
    },
  }))
}
