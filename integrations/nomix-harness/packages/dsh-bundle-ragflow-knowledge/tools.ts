import { KNOWLEDGE_AGENT_TOOL_NAMES, type KnowledgeAgentToolName } from '../dsh-knowledge/harness-contract.js'
import { registerKnowledgeTool, type ToolContext, type KnowledgeToolServices } from '../dsh-knowledge/tool.js'
import { readToolDefinitions } from '../dsh-tool-knowledge-read/tools.js'
import { writeToolDefinitions } from '../dsh-tool-knowledge-write/tools.js'
import { adminToolDefinitions } from '../dsh-tool-knowledge-admin/tools.js'

export function registerKnowledgeTools(ctx: ToolContext, services: KnowledgeToolServices, names: readonly KnowledgeAgentToolName[] = KNOWLEDGE_AGENT_TOOL_NAMES, timeoutMs = 90_000): () => void {
  const definitions = { ...readToolDefinitions(services, timeoutMs), ...writeToolDefinitions(services, timeoutMs), ...adminToolDefinitions(services, timeoutMs) }
  const disposers: Array<() => void> = []
  try {
    for (const name of names) disposers.push(registerKnowledgeTool(ctx, definitions[name], timeoutMs))
  } catch (error) {
    for (const dispose of disposers.reverse()) dispose()
    throw error
  }
  return () => { for (const dispose of disposers.splice(0).reverse()) dispose() }
}
