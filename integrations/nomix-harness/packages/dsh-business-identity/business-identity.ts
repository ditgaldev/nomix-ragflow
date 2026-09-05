import { Service, type Context } from '@nomix-ai/nomix-harness/plugin'
import { KnowledgeGatewayError } from '../dsh-knowledge/knowledge-errors.js'

const MAX_ASSERTION_LIFETIME_SECONDS = 10 * 60

declare module '@nomix-ai/nomix-harness/plugin' {
  interface Context { businessIdentity: BusinessIdentityRuntime }
}

export interface SessionBusinessIdentityBinding {
  sessionId: string
  userAssertion: string
  expiresAtEpochSeconds: number
}

export interface ResolvedBusinessIdentity {
  readonly sessionId: string
  readonly userAssertion: string
  readonly expiresAtEpochSeconds: number
}

interface StoredBinding extends ResolvedBusinessIdentity { readonly generation: symbol; readonly timer: ReturnType<typeof setTimeout> }

/**
 * Session-scoped identity port populated by the business system when it creates
 * or refreshes a Harness session. It deliberately stores no roles or ACL data.
 */
export class BusinessIdentityRuntime extends Service {
  private readonly bindings = new Map<string, StoredBinding>()

  constructor(ctx: Context) {
    super(ctx, 'businessIdentity')
    ctx.effect(() => () => {
      for (const binding of this.bindings.values()) clearTimeout(binding.timer)
      this.bindings.clear()
    })
  }

  bindSession(input: SessionBusinessIdentityBinding): () => void {
    const sessionId = input.sessionId.trim()
    const userAssertion = input.userAssertion.trim()
    const nowSeconds = Math.floor(Date.now() / 1000)
    if (!sessionId || sessionId !== input.sessionId || !userAssertion) {
      throw new KnowledgeGatewayError('A trimmed session ID and signed user assertion are required.', { code: 'KNOWLEDGE_INVALID_INPUT', status: 422 })
    }
    if (!Number.isSafeInteger(input.expiresAtEpochSeconds) || input.expiresAtEpochSeconds <= nowSeconds || input.expiresAtEpochSeconds > nowSeconds + MAX_ASSERTION_LIFETIME_SECONDS) {
      throw new KnowledgeGatewayError('The user assertion expiry must be within the next ten minutes.', { code: 'KNOWLEDGE_INVALID_INPUT', status: 422 })
    }
    const previous = this.bindings.get(sessionId)
    if (previous) clearTimeout(previous.timer)
    const timer = setTimeout(() => {
      if (this.bindings.get(sessionId)?.generation === binding.generation) this.bindings.delete(sessionId)
    }, input.expiresAtEpochSeconds * 1000 - Date.now())
    timer.unref()
    const binding: StoredBinding = { sessionId, userAssertion, expiresAtEpochSeconds: input.expiresAtEpochSeconds, generation: Symbol(sessionId), timer }
    this.bindings.set(sessionId, binding)
    return () => {
      clearTimeout(timer)
      if (this.bindings.get(sessionId)?.generation === binding.generation) this.bindings.delete(sessionId)
    }
  }

  resolveUserAssertion(sessionId: string): ResolvedBusinessIdentity {
    const binding = this.bindings.get(sessionId)
    if (!binding) throw new KnowledgeGatewayError('No business identity is bound to this Harness session.', { code: 'KNOWLEDGE_UNAUTHENTICATED', status: 401 })
    if (binding.expiresAtEpochSeconds <= Math.floor(Date.now() / 1000)) {
      clearTimeout(binding.timer)
      this.bindings.delete(sessionId)
      throw new KnowledgeGatewayError('The business identity bound to this Harness session has expired.', { code: 'KNOWLEDGE_UNAUTHENTICATED', status: 401 })
    }
    return { sessionId: binding.sessionId, userAssertion: binding.userAssertion, expiresAtEpochSeconds: binding.expiresAtEpochSeconds }
  }
}

export default BusinessIdentityRuntime
