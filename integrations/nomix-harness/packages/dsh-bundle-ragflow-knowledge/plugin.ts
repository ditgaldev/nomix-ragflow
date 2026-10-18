import type { Context } from '@nomix-ai/nomix-harness/plugin'
import { applyKnowledgeConsumer, Config } from './consumer.js'

export { Config }
export { inject } from './consumer.js'
export { KNOWLEDGE_EVIDENCE_INSTRUCTIONS } from '../dsh-knowledge-policy/policy.js'
export const name = 'nomix-ragflow'

/** Consumer entry. The bundle mounts its replaceable provider as a separate row. */
export function apply(ctx: Context, config: Config): void {
  applyKnowledgeConsumer(ctx, config)
}
