import { HarnessError } from '@nomix-ai/nomix-harness/plugin/llm'
import { defineTool, type ToolDefinition, type ToolRunContext, type ToolRuntime, type ValueSchemaSpec } from '@nomix-ai/nomix-harness/plugin/tools'
import { isKnowledgeToolConcurrencySafe, type KnowledgeAgentToolName } from './harness-contract.js'
import { KnowledgeGatewayError } from './knowledge-errors.js'
import { knowledgeOutput, observeKnowledge, type KnowledgeObservationServices } from './knowledge-observation.js'
import type { DocumentMetadata, DocumentMetadataPatch, KnowledgeGatewayData, VersionedResourceRequest } from './knowledge-openapi.generated.js'
import { parseKnowledgeToolInput, parseKnowledgeToolResult } from './knowledge-schema.js'
import { knowledgeToolDataSchemas, knowledgeToolInputSchemas } from './knowledge-tool-schemas.generated.js'
import type { KnowledgeService } from './service.js'

export type ToolContext = { agent?: unknown; get(name: 'tools', required: true): ToolRuntime | undefined }
type Input = Record<string, unknown>
type OutputDefinition = ReturnType<typeof knowledgeOutput<ValueSchemaSpec>>

export interface KnowledgeToolServices extends KnowledgeObservationServices {
  knowledge(exec: ToolRunContext): Promise<KnowledgeService>
  idempotencyKey(exec: ToolRunContext): string
}

export function string(input: Input, key: string): string { return input[key] as string }
export function number(input: Input, key: string, fallback?: number): number { return (input[key] ?? fallback) as number }
export function optionalString(input: Input, key: string): string | undefined { return input[key] as string | undefined }
export function optionalIds(input: Input, key: string): string[] | undefined { return input[key] as string[] | undefined }
export function optionalMetadata(input: Input): DocumentMetadata | undefined { return input.metadata as DocumentMetadata | undefined }
export function optionalMetadataPatch(input: Input): DocumentMetadataPatch | undefined { return input.metadata as DocumentMetadataPatch | undefined }

export function versioned(input: Input): VersionedResourceRequest {
  const reason = optionalString(input, 'reason')
  return { expectedVersion: number(input, 'expectedVersion'), ...(reason === undefined ? {} : { reason }) }
}

export function mutationOptions(services: KnowledgeToolServices, exec: ToolRunContext) {
  return { signal: exec.signal, idempotencyKey: services.idempotencyKey(exec) }
}

function toHarnessError(error: unknown): never {
  if (error instanceof HarnessError) {
    if (error.code === 'INVALID_ARGS') throw new HarnessError('The knowledge tool input does not match the business contract.', 'KNOWLEDGE_INVALID_INPUT', { cause: error })
    throw new HarnessError('The knowledge operation failed without exposing provider details.', 'KNOWLEDGE_PROVIDER_UNAVAILABLE', { cause: error })
  }
  if (error instanceof KnowledgeGatewayError) throw new HarnessError(error.message, error.code, { cause: error })
  if (error instanceof TypeError) throw new HarnessError('The knowledge operation could not be prepared safely.', 'KNOWLEDGE_INVALID_INPUT', { cause: error })
  throw new HarnessError('The knowledge operation failed without exposing provider details.', 'KNOWLEDGE_PROVIDER_UNAVAILABLE', { cause: error })
}

export const outputs = {
  retrieval: knowledgeOutput(['retrieval'], knowledgeToolDataSchemas.RetrievalResult),
  spaceList: knowledgeOutput(['space-list'], knowledgeToolDataSchemas.KnowledgeSpacePage),
  space: knowledgeOutput(['space'], knowledgeToolDataSchemas.KnowledgeSpace),
  spaceCreated: knowledgeOutput(['space-created'], knowledgeToolDataSchemas.KnowledgeSpaceCreated),
  spaceUpdated: knowledgeOutput(['space'], knowledgeToolDataSchemas.KnowledgeSpaceUpdated),
  spaceOperation: knowledgeOutput(['space-operation'], knowledgeToolDataSchemas.SpaceOperationAccepted),
  documentList: knowledgeOutput(['document-list'], knowledgeToolDataSchemas.KnowledgeDocumentPage),
  document: knowledgeOutput(['document'], knowledgeToolDataSchemas.KnowledgeDocument),
  documentDetail: knowledgeOutput(['document-detail'], knowledgeToolDataSchemas.KnowledgeDocumentDetail),
  documentOperation: knowledgeOutput(['document-operation'], knowledgeToolDataSchemas.DocumentOperationAccepted),
  citation: knowledgeOutput(['citation-source'], knowledgeToolDataSchemas.CitationSource),
  download: knowledgeOutput(['download-link'], knowledgeToolDataSchemas.DownloadLink),
  operation: knowledgeOutput(['operation'], knowledgeToolDataSchemas.KnowledgeOperation),
  retry: knowledgeOutput(['operation'], knowledgeToolDataSchemas.ManualRetryOperation),
}

export function makeTool(
  services: KnowledgeToolServices,
  timeoutMs: number,
  name: KnowledgeAgentToolName,
  description: string,
  resultKind: string,
  output: OutputDefinition,
  run: (input: Input, exec: ToolRunContext, knowledge: KnowledgeService) => Promise<KnowledgeGatewayData>,
): ToolDefinition {
  const schema = knowledgeToolInputSchemas[name]
  const definition = defineTool({
    name,
    description,
    parameters: { input: schema },
    output,
    timeoutMs,
    isConcurrencySafe: () => isKnowledgeToolConcurrencySafe(name),
    async execute(args, exec) {
      const value = parseKnowledgeToolResult<KnowledgeGatewayData>(name, await run(args.input as Input, exec, await services.knowledge(exec)))
      return observeKnowledge(services, exec, name, resultKind, value)
    },
  })
  return {
    ...definition,
    async execute(args, exec) {
      const input = parseKnowledgeToolInput<Input>(name, args && typeof args === 'object' ? (args as Input).input : undefined)
      // Normalize and classify business input before defineTool's structural
      // validation. The closed outer/inner schemas remain enforced unchanged.
      return definition.execute({ ...(args as Input), input }, exec)
    },
  }
}

export function registerKnowledgeTool(ctx: ToolContext, definition: ToolDefinition, timeoutMs: number): () => void {
  const tools = ctx.get('tools', true)
  if (!tools) throw new KnowledgeGatewayError('Harness tool runtime is unavailable.', { code: 'KNOWLEDGE_PROVIDER_UNAVAILABLE', status: 503 })
  const execute = definition.execute
  return tools.register({
    ...definition,
    timeoutMs,
    async execute(args, exec) {
      try { return await execute(args, exec) } catch (error) {
        if (exec.signal.aborted) throw error
        return toHarnessError(error)
      }
    },
  })
}
