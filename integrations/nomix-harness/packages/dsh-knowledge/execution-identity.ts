import { createHash } from 'node:crypto'

/** Replay identity belongs to the tool contract, not an HTTP provider. */
export function stableIdempotencyKey(identity: { sessionId: string; rootCallId: string; toolCallId: string; toolName: string }): string {
  return `knowledge:${createHash('sha256').update(JSON.stringify([identity.sessionId, identity.rootCallId, identity.toolCallId, identity.toolName])).digest('hex')}`
}
