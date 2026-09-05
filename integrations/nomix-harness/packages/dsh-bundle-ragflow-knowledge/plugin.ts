import type { Context } from '@nomix-ai/nomix-harness/plugin'
import { applyKnowledgeConsumer, Config } from './consumer.js'

export { Config }
export { KNOWLEDGE_EVIDENCE_INSTRUCTIONS } from '../dsh-knowledge-policy/policy.js'
export const name = 'nomix-ragflow'
export const inject = ['knowledge', 'businessIdentity', 'agents', 'tools', 'credentials', 'spillStore', 'systemPrompt']

/** Consumer entry. The bundle mounts its replaceable provider as a separate row. */
export function apply(ctx: Context, config: Config): void {
  applyKnowledgeConsumer(ctx, config)
}
