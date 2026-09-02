import type { ParameterPropertySpec } from '@nomix-ai/nomix-harness/plugin/tools'
import type { RagFlowAgentToolName } from './harness-contract.js'

/**
 * Model-facing schemas are centralized here. Gateway authorization still comes
 * exclusively from the capability manifest and the validated business token.
 */
const requiredString = { type: 'string', required: true } as const
const optionalString = { type: 'string' } as const
const requiredResourceId = {
  type: 'string',
  required: true,
  description: 'RAGFlow resource ID returned by the Business Gateway; never invent or enumerate an ID.',
} as const
const optionalResourceId = {
  type: 'string',
  description: 'RAGFlow resource ID returned by the Business Gateway; never invent or enumerate an ID.',
} as const
const requiredNumber = { type: 'number', required: true } as const
const optionalNumber = { type: 'number' } as const
const optionalInteger = { type: 'integer' } as const
const requiredInteger = { type: 'integer', required: true } as const
const requiredVersion = {
  type: 'integer',
  required: true,
  description: 'Positive resource version returned by the Business Gateway; reload the resource before a retry.',
} as const
const requiredJson = { type: 'json', required: true } as const
const requiredOperationId = {
  type: 'string',
  required: true,
  description: 'Stable business-intent ID; reuse only when retrying the same uncertain write.',
} as const
const booleanInput = { type: 'boolean' } as const
const stringArray = { type: 'array', items: { type: 'string' } } as const
const requiredStringArray = { ...stringArray, required: true } as const
const resourceIdArray = {
  type: 'array',
  items: { type: 'string', description: 'RAGFlow resource ID returned by the Business Gateway.' },
} as const
const requiredResourceIdArray = { ...resourceIdArray, required: true } as const
const pageProperties = {
  cursor: optionalString,
  limit: { type: 'integer', description: 'Page size from 1 to 100.' },
} as const

const datasetPatch = {
  type: 'object',
  additionalProperties: false,
  properties: {
    name: optionalString,
    avatar: optionalString,
    description: optionalString,
    embeddingModel: optionalString,
    chunkMethod: optionalString,
    parserConfig: { type: 'json' },
    autoMetadataConfig: { type: 'json' },
    language: optionalString,
    pagerank: optionalInteger,
    pipelineId: optionalResourceId,
  },
} as const

const documentPatch = {
  type: 'object',
  additionalProperties: false,
  properties: {
    name: optionalString,
    chunkMethod: optionalString,
    parserConfig: { type: 'json' },
    pipelineId: optionalResourceId,
    enabled: booleanInput,
    metaFields: { type: 'json' },
  },
} as const

const chunkPatch = {
  type: 'object',
  additionalProperties: false,
  properties: {
    content: optionalString,
    importantKeywords: stringArray,
    questions: stringArray,
    available: booleanInput,
    positions: { type: 'array', items: { type: 'array', items: { type: 'integer' } } },
  },
} as const

const chatPatch = {
  type: 'object',
  additionalProperties: false,
  properties: {
    name: optionalString,
    icon: optionalString,
    description: optionalString,
    datasetIds: resourceIdArray,
    llmId: optionalResourceId,
    llmSetting: { type: 'json' },
    promptConfig: { type: 'json' },
    topN: optionalInteger,
    topK: optionalInteger,
    similarityThreshold: optionalNumber,
    vectorSimilarityWeight: optionalNumber,
    rerankId: optionalResourceId,
  },
} as const

const sessionCreate = {
  type: 'object',
  additionalProperties: false,
  properties: { name: optionalString, inputs: { type: 'json' } },
} as const

const sessionPatch = {
  type: 'object',
  additionalProperties: false,
  properties: { name: optionalString },
} as const

const agentPatch = {
  type: 'object',
  additionalProperties: false,
  properties: {
    title: optionalString,
    dsl: { type: 'json' },
    description: optionalString,
    canvasType: optionalString,
    release: booleanInput,
  },
} as const

const memoryPatch = {
  type: 'object',
  additionalProperties: false,
  properties: {
    name: optionalString,
    memoryType: stringArray,
    embdId: optionalResourceId,
    llmId: optionalResourceId,
    description: optionalString,
    memorySize: optionalInteger,
    forgettingPolicy: optionalString,
    temperature: optionalNumber,
    avatar: optionalString,
    systemPrompt: optionalString,
    userPrompt: optionalString,
  },
} as const

const metadataConfig = {
  type: 'object',
  additionalProperties: false,
  properties: {
    metadata: { type: 'array', items: { type: 'json' } },
    builtInMetadata: stringArray,
  },
} as const

function actionInput<const A extends string, const P extends Record<string, ParameterPropertySpec>>(action: A, properties: P = {} as P) {
  return {
    type: 'object' as const,
    additionalProperties: false,
    properties: {
      action: { type: 'string' as const, const: action, required: true as const },
      ...properties,
    },
  }
}

function writeActionInput<const A extends string, const P extends Record<string, ParameterPropertySpec>>(action: A, properties: P = {} as P) {
  return actionInput(action, { operationId: requiredOperationId, ...properties })
}

export const RAGFLOW_TOOL_INPUT_SCHEMAS = {
  ragflow_discover: { ...actionInput('context'), required: true },
  ragflow_retrieval: {
    type: 'object',
    required: true,
    additionalProperties: false,
    properties: {
      question: requiredString,
      datasetIds: resourceIdArray,
      documentIds: resourceIdArray,
      cursor: optionalString,
      limit: pageProperties.limit,
      similarityThreshold: optionalNumber,
      vectorSimilarityWeight: optionalNumber,
      topK: { type: 'integer', description: 'Candidate count from 1 to 10000.' },
      rerankId: optionalResourceId,
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
  },
  ragflow_manage_datasets: { oneOf: [
    actionInput('list', { ...pageProperties, id: optionalResourceId, ids: resourceIdArray, name: optionalString }),
    actionInput('get', { datasetId: requiredResourceId }),
    writeActionInput('create', { name: requiredString }),
    writeActionInput('update', { datasetId: requiredResourceId, version: requiredVersion, patch: { ...datasetPatch, required: true } }),
    writeActionInput('delete', { datasetId: requiredResourceId, version: requiredVersion }),
  ], required: true },
  ragflow_manage_documents: { oneOf: [
    actionInput('list', {
      datasetId: requiredResourceId,
      ...pageProperties,
      id: optionalResourceId,
      ids: resourceIdArray,
      name: optionalString,
      keywords: optionalString,
      createTimeFrom: { type: 'integer', description: 'Inclusive Unix timestamp boundary.' },
      createTimeTo: { type: 'integer', description: 'Inclusive Unix timestamp boundary.' },
    }),
    writeActionInput('update', { datasetId: requiredResourceId, documentId: requiredResourceId, version: requiredVersion, patch: { ...documentPatch, required: true } }),
    writeActionInput('delete', { datasetId: requiredResourceId, documentId: requiredResourceId, version: requiredVersion }),
    actionInput('get_auto_metadata', { datasetId: requiredResourceId }),
    writeActionInput('update_auto_metadata', { datasetId: requiredResourceId, version: requiredVersion, config: { ...metadataConfig, required: true } }),
  ], required: true },
  ragflow_transfer_documents: { oneOf: [
    writeActionInput('upload', { datasetId: requiredResourceId, sourcePath: requiredString, displayName: optionalString }),
    actionInput('download', { datasetId: requiredResourceId, documentId: requiredResourceId, fileName: optionalString }),
    writeActionInput('start_parse', { datasetId: requiredResourceId, documentIds: requiredResourceIdArray }),
    writeActionInput('cancel_parse', { datasetId: requiredResourceId, documentIds: requiredResourceIdArray }),
  ], required: true },
  ragflow_manage_chunks: { oneOf: [
    actionInput('list', { datasetId: requiredResourceId, documentId: requiredResourceId, ...pageProperties, keywords: optionalString, id: optionalResourceId }),
    writeActionInput('add', { datasetId: requiredResourceId, documentId: requiredResourceId, content: requiredString }),
    writeActionInput('update', { datasetId: requiredResourceId, documentId: requiredResourceId, chunkId: requiredResourceId, version: requiredVersion, patch: { ...chunkPatch, required: true } }),
    writeActionInput('delete', { datasetId: requiredResourceId, documentId: requiredResourceId, chunkId: requiredResourceId, version: requiredVersion }),
  ], required: true },
  ragflow_manage_chats: { oneOf: [
    actionInput('list', { ...pageProperties, id: optionalResourceId, name: optionalString, keywords: optionalString }),
    actionInput('get', { chatId: requiredResourceId }),
    writeActionInput('create', { name: requiredString }),
    writeActionInput('update', { chatId: requiredResourceId, version: requiredVersion, patch: { ...chatPatch, required: true } }),
    writeActionInput('delete', { chatId: requiredResourceId, version: requiredVersion }),
  ], required: true },
  ragflow_manage_sessions: { oneOf: [
    writeActionInput('create', { kind: { type: 'string', enum: ['chat', 'agent'], required: true }, ownerId: requiredResourceId, request: { ...sessionCreate, required: true } }),
    actionInput('list', { kind: { type: 'string', enum: ['chat', 'agent'], required: true }, ownerId: requiredResourceId, ...pageProperties, id: optionalResourceId, name: optionalString }),
    writeActionInput('update', { kind: { type: 'string', const: 'chat', required: true }, ownerId: requiredResourceId, sessionId: requiredResourceId, version: requiredVersion, patch: { ...sessionPatch, required: true } }),
    writeActionInput('delete', { kind: { type: 'string', enum: ['chat', 'agent'], required: true }, ownerId: requiredResourceId, sessionId: requiredResourceId, version: requiredVersion }),
    writeActionInput('ask', { kind: { type: 'string', enum: ['chat', 'agent'], required: true }, ownerId: requiredResourceId, sessionId: requiredResourceId, question: requiredString, inputs: { type: 'json' }, release: booleanInput, returnTrace: booleanInput }),
  ], required: true },
  ragflow_manage_agents: { oneOf: [
    actionInput('list', { ...pageProperties }),
    actionInput('get', { agentId: requiredResourceId }),
    writeActionInput('create', { title: requiredString, dsl: requiredJson }),
    writeActionInput('update', { agentId: requiredResourceId, version: requiredVersion, patch: { ...agentPatch, required: true } }),
    writeActionInput('delete', { agentId: requiredResourceId, version: requiredVersion }),
  ], required: true },
  ragflow_manage_memories: { oneOf: [
    writeActionInput('create', { name: requiredString, memoryType: requiredStringArray, embdId: requiredResourceId, llmId: requiredResourceId }),
    actionInput('list', { ...pageProperties, memoryType: stringArray, storageType: optionalString, keywords: optionalString }),
    writeActionInput('update', { memoryId: requiredResourceId, version: requiredVersion, patch: { ...memoryPatch, required: true } }),
    writeActionInput('delete', { memoryId: requiredResourceId, version: requiredVersion }),
    actionInput('get_config', { memoryId: requiredResourceId }),
    actionInput('list_messages', { memoryId: requiredResourceId, ...pageProperties }),
    writeActionInput('forget_message', { memoryId: requiredResourceId, messageId: requiredInteger, version: requiredVersion }),
    writeActionInput('update_message_status', { memoryId: requiredResourceId, messageId: requiredInteger, version: requiredVersion, status: { type: 'boolean', required: true } }),
    actionInput('get_message_content', { memoryId: requiredResourceId, messageId: requiredInteger }),
    writeActionInput('add_message', { memoryIds: requiredResourceIdArray, agentId: requiredResourceId, sessionId: requiredResourceId, userInput: requiredString, agentResponse: requiredString }),
    actionInput('search_messages', { query: requiredString, memoryIds: requiredResourceIdArray, agentId: optionalResourceId, sessionId: optionalResourceId, similarityThreshold: optionalNumber, keywordsSimilarityWeight: optionalNumber, topN: optionalInteger }),
    actionInput('recent_messages', { memoryIds: requiredResourceIdArray, agentId: optionalResourceId, sessionId: optionalResourceId, limit: pageProperties.limit }),
  ], required: true },
} as const satisfies Record<RagFlowAgentToolName, ParameterPropertySpec>

export const RAGFLOW_TOOL_OUTPUT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    status: { type: 'string', enum: ['success', 'warning'], required: true },
    summary: requiredString,
    data: { oneOf: [
      { type: 'object', additionalProperties: false, properties: {
        kind: { type: 'string', enum: ['authorization', 'retrieval', 'resource', 'resource-list', 'mutation', 'invocation'], required: true },
        format: { type: 'string', const: 'json-entries', required: true },
        entries: { type: 'array', required: true, items: { oneOf: [
          { type: 'object', additionalProperties: false, properties: { path: requiredString, kind: { type: 'string', const: 'object', required: true } } },
          { type: 'object', additionalProperties: false, properties: { path: requiredString, kind: { type: 'string', const: 'array', required: true } } },
          { type: 'object', additionalProperties: false, properties: { path: requiredString, kind: { type: 'string', const: 'null', required: true } } },
          { type: 'object', additionalProperties: false, properties: { path: requiredString, kind: { type: 'string', const: 'string', required: true }, stringValue: requiredString } },
          { type: 'object', additionalProperties: false, properties: { path: requiredString, kind: { type: 'string', const: 'number', required: true }, numberValue: requiredNumber } },
          { type: 'object', additionalProperties: false, properties: { path: requiredString, kind: { type: 'string', const: 'boolean', required: true }, booleanValue: { type: 'boolean', required: true } } },
        ] } },
        bytes: requiredInteger,
        truncated: { type: 'boolean', const: false, required: true },
      } },
      { type: 'object', additionalProperties: false, properties: {
        kind: { type: 'string', const: 'artifact-reference', required: true },
        format: { type: 'string', const: 'artifact-reference', required: true },
        artifactName: requiredString,
        bytes: requiredInteger,
        truncated: { type: 'boolean', const: true, required: true },
      } },
    ], required: true },
    nextActions: { type: 'array', items: { type: 'string' }, required: true },
    artifacts: { type: 'array', required: true, items: { type: 'object', additionalProperties: false, properties: {
      kind: { type: 'string', const: 'spill', required: true },
      name: requiredString,
      locator: requiredString,
      mimeType: requiredString,
      encoding: { type: 'string', enum: ['utf8', 'base64'], required: true },
      originalName: optionalString,
      originalMimeType: optionalString,
      bytes: requiredInteger,
      storedBytes: requiredInteger,
      sha256: optionalString,
      retrievalHint: requiredString,
    } } },
  },
} as const
