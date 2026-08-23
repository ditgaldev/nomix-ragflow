import type { Context } from '@nomix-ai/cordis'
import { defineTool, type JsonValue, type PreToolDecision } from '@nomix-ai/nomix-tools'
import type { RagFlowClient } from './client.js'
import { downloadWorkspaceDocument, uploadWorkspaceDocument, type TransferOptions } from './files.js'
import type { JsonObject, SessionTarget } from './types.js'

type Input = Record<string, unknown>

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

function target(input: Input): SessionTarget {
  const kind = string(input, 'kind')
  if (kind !== 'chat' && kind !== 'agent') throw new TypeError('input.kind must be chat or agent')
  return { kind, ownerId: string(input, 'ownerId') }
}

function done(): JsonValue { return { ok: true } }

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
  const action = object(args).action
  if (typeof action === 'string' && actions.has(action)) {
    return { kind: 'ask', reason: `RAGFlow action ${name}.${action} is destructive and requires one-time approval.` }
  }
  return next()
}

function register(ctx: Context, definition: ReturnType<typeof defineTool>): void {
  ctx.effect(() => ctx.tools.register(definition))
}

export function registerManagementTools(ctx: Context, client: RagFlowClient, transfer: TransferOptions): void {
  register(ctx, defineTool({
    name: 'ragflow_manage_datasets',
    description: 'Manage RAGFlow datasets. action=create input={name,...}; list/get input filters; update input={datasetId,patch}; delete input={ids?,deleteAll?}.',
    parameters: { action: { type: 'string', enum: ['list', 'get', 'create', 'update', 'delete'], required: true }, input: { type: 'json', required: true } }, output,
    async execute(args, exec) {
      const input = object(args.input)
      switch (args.action) {
        case 'list': return client.datasets.list(input, { signal: exec.signal }) as Promise<JsonValue>
        case 'get': return client.datasets.getByName(string(input, 'name'), { signal: exec.signal }) as Promise<JsonValue>
        case 'create': return client.datasets.create({ ...input, name: string(input, 'name') } as never, { signal: exec.signal }) as Promise<JsonValue>
        case 'update': return client.datasets.update(string(input, 'datasetId'), json(input, 'patch'), { signal: exec.signal }) as Promise<JsonValue>
        case 'delete': await client.datasets.delete(strings(input, 'ids'), boolean(input, 'deleteAll'), { signal: exec.signal }); return done()
      }
    },
  }))

  register(ctx, defineTool({
    name: 'ragflow_manage_documents',
    description: 'Manage dataset documents. Actions: list, update, delete, start_parse, cancel_parse, get_auto_metadata, update_auto_metadata. IDs and patch/config belong in input.',
    parameters: { action: { type: 'string', enum: ['list', 'update', 'delete', 'start_parse', 'cancel_parse', 'get_auto_metadata', 'update_auto_metadata'], required: true }, input: { type: 'json', required: true } }, output,
    async execute(args, exec) {
      const input = object(args.input); const datasetId = string(input, 'datasetId')
      switch (args.action) {
        case 'list': return client.documents.list(input as never, { signal: exec.signal }) as Promise<JsonValue>
        case 'update': return client.documents.update(datasetId, string(input, 'documentId'), json(input, 'patch'), { signal: exec.signal }) as Promise<JsonValue>
        case 'delete': await client.documents.delete(datasetId, strings(input, 'ids'), boolean(input, 'deleteAll'), { signal: exec.signal }); return done()
        case 'start_parse': await client.documents.startParse(datasetId, requiredStrings(input, 'documentIds'), { signal: exec.signal }); return done()
        case 'cancel_parse': await client.documents.cancelParse(datasetId, requiredStrings(input, 'documentIds'), { signal: exec.signal }); return done()
        case 'get_auto_metadata': return client.datasets.getAutoMetadata(datasetId, { signal: exec.signal }) as Promise<JsonValue>
        case 'update_auto_metadata': return client.datasets.updateAutoMetadata(datasetId, json(input, 'config'), { signal: exec.signal }) as Promise<JsonValue>
      }
    },
  }))

  register(ctx, defineTool({
    name: 'ragflow_transfer_documents',
    description: 'Stream documents between the Harness workspace and RAGFlow REST. upload input={datasetId,sourcePath,displayName?}; download input={datasetId,documentId,destinationPath}. Existing files are never overwritten.',
    parameters: { action: { type: 'string', enum: ['upload', 'download'], required: true }, input: { type: 'json', required: true } }, output,
    async execute(args, exec) {
      const input = object(args.input); const datasetId = string(input, 'datasetId')
      return args.action === 'upload'
        ? uploadWorkspaceDocument(ctx, client, transfer, datasetId, string(input, 'sourcePath'), optionalString(input, 'displayName'), exec.signal) as Promise<JsonValue>
        : downloadWorkspaceDocument(ctx, client, transfer, datasetId, string(input, 'documentId'), string(input, 'destinationPath'), exec.signal) as Promise<JsonValue>
    },
  }))

  register(ctx, defineTool({
    name: 'ragflow_manage_chunks',
    description: 'Manage chunks. action=list/add/update/delete; input requires datasetId and documentId, plus chunk fields, chunkId, ids, or deleteAll as appropriate.',
    parameters: { action: { type: 'string', enum: ['list', 'add', 'update', 'delete'], required: true }, input: { type: 'json', required: true } }, output,
    async execute(args, exec) {
      const input = object(args.input); const datasetId = string(input, 'datasetId'); const documentId = string(input, 'documentId')
      switch (args.action) {
        case 'list': return client.chunks.list(datasetId, documentId, input, { signal: exec.signal }) as Promise<JsonValue>
        case 'add': return client.chunks.add(datasetId, documentId, { ...input, content: string(input, 'content') } as never, { signal: exec.signal }) as Promise<JsonValue>
        case 'update': await client.chunks.update(datasetId, documentId, string(input, 'chunkId'), json(input, 'patch'), { signal: exec.signal }); return done()
        case 'delete': await client.chunks.delete(datasetId, documentId, strings(input, 'ids'), boolean(input, 'deleteAll'), { signal: exec.signal }); return done()
      }
    },
  }))

  register(ctx, defineTool({
    name: 'ragflow_manage_chats', description: 'Manage chats. action=list/get/create/update/delete and place filters, chatId, request, patch, ids or deleteAll in input.',
    parameters: { action: { type: 'string', enum: ['list', 'get', 'create', 'update', 'delete'], required: true }, input: { type: 'json', required: true } }, output,
    async execute(args, exec) {
      const input = object(args.input)
      switch (args.action) {
        case 'list': return client.chats.list(input, { signal: exec.signal }) as Promise<JsonValue>
        case 'get': return client.chats.get(string(input, 'chatId'), { signal: exec.signal }) as Promise<JsonValue>
        case 'create': { const request = json(input, 'request', input as JsonObject); string(request, 'name'); return client.chats.create(request as never, { signal: exec.signal }) as Promise<JsonValue> }
        case 'update': await client.chats.update(string(input, 'chatId'), json(input, 'patch'), { signal: exec.signal }); return done()
        case 'delete': await client.chats.delete(strings(input, 'ids'), boolean(input, 'deleteAll'), { signal: exec.signal }); return done()
      }
    },
  }))

  register(ctx, defineTool({
    name: 'ragflow_manage_sessions', description: 'Manage chat or agent sessions. action=create/list/update/delete/ask. input.kind is chat|agent and input.ownerId identifies its owner.',
    parameters: { action: { type: 'string', enum: ['create', 'list', 'update', 'delete', 'ask'], required: true }, input: { type: 'json', required: true } }, output,
    async execute(args, exec) {
      const input = object(args.input); const owner = target(input)
      switch (args.action) {
        case 'create': return client.sessions.create(owner, json(input, 'request'), { signal: exec.signal }) as Promise<JsonValue>
        case 'list': return client.sessions.list(input as never, { signal: exec.signal }) as Promise<JsonValue>
        case 'update': if (owner.kind !== 'chat') throw new TypeError('RAGFlow only supports updating chat sessions'); await client.sessions.updateChat(owner.ownerId, string(input, 'sessionId'), json(input, 'patch'), { signal: exec.signal }); return done()
        case 'delete': await client.sessions.delete(owner, strings(input, 'ids'), boolean(input, 'deleteAll'), { signal: exec.signal }); return done()
        case 'ask': string(input, 'sessionId'); return client.sessions.ask(input as never, { signal: exec.signal }) as Promise<JsonValue>
      }
    },
  }))

  register(ctx, defineTool({
    name: 'ragflow_manage_agents', description: 'Manage RAGFlow agents. action=list/get/create/update/delete; input carries filters, agentId, request, or patch.',
    parameters: { action: { type: 'string', enum: ['list', 'get', 'create', 'update', 'delete'], required: true }, input: { type: 'json', required: true } }, output,
    async execute(args, exec) {
      const input = object(args.input)
      switch (args.action) {
        case 'list': return client.agents.list(input, { signal: exec.signal }) as Promise<JsonValue>
        case 'get': return client.agents.get(string(input, 'agentId'), { signal: exec.signal }) as Promise<JsonValue>
        case 'create': { const request = json(input, 'request', input as JsonObject); string(request, 'title'); json(request, 'dsl'); return client.agents.create(request as never, { signal: exec.signal }) as Promise<JsonValue> }
        case 'update': await client.agents.update(string(input, 'agentId'), json(input, 'patch'), { signal: exec.signal }); return done()
        case 'delete': await client.agents.delete(string(input, 'agentId'), { signal: exec.signal }); return done()
      }
    },
  }))

  register(ctx, defineTool({
    name: 'ragflow_manage_memories', description: 'Manage memories and their messages. Actions: create/list/update/delete/get_config/list_messages/forget_message/update_message_status/get_message_content/add_message/search_messages/recent_messages.',
    parameters: { action: { type: 'string', enum: ['create', 'list', 'update', 'delete', 'get_config', 'list_messages', 'forget_message', 'update_message_status', 'get_message_content', 'add_message', 'search_messages', 'recent_messages'], required: true }, input: { type: 'json', required: true } }, output,
    async execute(args, exec) {
      const input = object(args.input); const options = { signal: exec.signal }
      switch (args.action) {
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
      }
    },
  }))
}
