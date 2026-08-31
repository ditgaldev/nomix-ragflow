/**
 * Provider-neutral Harness capability seam for RAGFlow Business Gateway
 * access. This service owns provider registration and selection only.
 */
import { Service, type Context } from '@nomix-ai/cordis'
import type { CredentialProvider } from '@nomix-ai/nomix-credentials'
import type { RagFlowBusinessClient } from './client.js'
import { BusinessGatewayError } from './errors.js'

declare module '@nomix-ai/cordis' {
  interface Context {
    ragflow: RagFlowRuntime
  }
}

export interface RagFlowOperationContext {
  /** Exact Agent-scoped Context that owns this operation. */
  readonly context: Context
  /** Credential seam captured from that exact Agent isolation layer. */
  readonly credentials: CredentialProvider
  readonly signal?: AbortSignal
  /** Explicit provider binding selected by the Consumer. */
  readonly providerId?: string
}

export interface RagFlowProvider {
  readonly id: string
  available(): boolean
  createClient(operation: RagFlowOperationContext): Promise<RagFlowBusinessClient>
}

export class RagFlowRuntime extends Service {
  private readonly providers = new Map<string, RagFlowProvider>()

  constructor(ctx: Context) {
    super(ctx, 'ragflow')
  }

  registerProvider(provider: RagFlowProvider): () => void {
    if (this.providers.has(provider.id)) {
      throw new BusinessGatewayError(`RAGFlow provider ${provider.id} is already registered`, {
        code: 'RAGFLOW_DUPLICATE_PROVIDER',
        status: 422,
      })
    }
    const providers = this.providers
    const dispose = this.ctx.effect(function* () {
      providers.set(provider.id, provider)
      yield () => providers.delete(provider.id)
    }, `ragflow.registerProvider(${provider.id})`)
    return () => void dispose()
  }

  async clientFor(operation: RagFlowOperationContext): Promise<RagFlowBusinessClient> {
    if (operation.providerId) {
      const provider = this.providers.get(operation.providerId)
      if (!provider || !provider.available()) {
        throw new BusinessGatewayError(`RAGFlow provider ${operation.providerId} is unavailable`, {
          code: 'RAGFLOW_PROVIDER_UNAVAILABLE',
          status: 503,
        })
      }
      return provider.createClient(operation)
    }

    const usable = [...this.providers.values()].filter(provider => provider.available())
    if (usable.length === 0) {
      throw new BusinessGatewayError('No RAGFlow Business Gateway provider is available', {
        code: 'RAGFLOW_PROVIDER_UNAVAILABLE',
        status: 503,
      })
    }
    if (usable.length > 1) {
      throw new BusinessGatewayError('Multiple RAGFlow Business Gateway providers are available; select providerId explicitly', {
        code: 'RAGFLOW_PROVIDER_AMBIGUOUS',
        status: 503,
      })
    }
    return usable[0]!.createClient(operation)
  }
}

export default RagFlowRuntime
