/** Harness Provider that binds the RAGFlow seam to one Business Gateway. */
import { Schema as z, type Context } from '@nomix-ai/nomix-harness/plugin'
import { credentialRef } from '@nomix-ai/nomix-harness/plugin/credentials'
import { RagFlowBusinessClient } from './client.js'
import { BusinessGatewayError } from './errors.js'
import {
  DEFAULT_RAGFLOW_REQUEST_TIMEOUT_MS,
  MAX_RAGFLOW_REQUEST_TIMEOUT_MS,
  RAGFLOW_BUSINESS_GATEWAY_PROVIDER_ID,
} from './harness-contract.js'
import type { RagFlowOperationContext, RagFlowProvider, RagFlowRuntime } from './service.js'

export const name = 'nomix-ragflow-business-gateway-provider'
export const inject = ['ragflow', 'credentials']

export interface Config {
  providerId?: string
  /** Dedicated Business Gateway service root without `/api/v1`. */
  baseURL: string
  /** Agent/session-scoped business access-token credential reference. */
  accessTokenRef: string
  requestTimeoutMs?: number
}

export const Config = z.object({
  providerId: z.string().default(RAGFLOW_BUSINESS_GATEWAY_PROVIDER_ID),
  baseURL: z.string().required(),
  accessTokenRef: z.string().required(),
  requestTimeoutMs: z.number().step(1).min(1).max(MAX_RAGFLOW_REQUEST_TIMEOUT_MS).default(DEFAULT_RAGFLOW_REQUEST_TIMEOUT_MS),
}) as unknown as z<Config>

type ProviderContext = Context & { ragflow: RagFlowRuntime }

export class BusinessGatewayRagFlowProvider implements RagFlowProvider {
  private readonly ref

  constructor(
    private readonly baseURL: string,
    accessTokenRef: string,
    private readonly timeoutMs: number,
    readonly id = RAGFLOW_BUSINESS_GATEWAY_PROVIDER_ID,
  ) {
    if (!id.trim() || id !== id.trim()) {
      throw new BusinessGatewayError('RAGFlow providerId must be a non-empty string without surrounding whitespace', {
        code: 'RAGFLOW_PROVIDER_CONFIG_INVALID',
        status: 422,
      })
    }
    if (!accessTokenRef.trim() || accessTokenRef !== accessTokenRef.trim()) {
      throw new BusinessGatewayError('RAGFlow accessTokenRef must be a non-empty credential reference without surrounding whitespace', {
        code: 'RAGFLOW_PROVIDER_CONFIG_INVALID',
        status: 422,
      })
    }
    // Validate endpoint and timeout during plugin load. No request is made.
    new RagFlowBusinessClient({
      baseURL,
      accessToken: 'configuration-validation-only',
      timeoutMs,
      source: 'agent',
    })
    this.ref = credentialRef(accessTokenRef)
  }

  available(): boolean {
    return true
  }

  async createClient(operation: RagFlowOperationContext): Promise<RagFlowBusinessClient> {
    let credential
    try {
      // Resolve exactly once per tool operation from the owning Agent context.
      // The next operation observes a rotated credential without plugin reload.
      credential = await operation.credentials.resolve(this.ref)
    } catch {
      throw new BusinessGatewayError('The RAGFlow business access-token reference could not be resolved', {
        code: 'TOKEN_PROVIDER_FAILED',
        status: 503,
        retryable: true,
      })
    }
    if (!credential) {
      throw new BusinessGatewayError(`Credential reference ${this.ref} is not configured for this Agent/session`, {
        code: 'AUTHENTICATION_REQUIRED',
        status: 401,
      })
    }
    return new RagFlowBusinessClient({
      baseURL: this.baseURL,
      accessToken: credential.value,
      timeoutMs: this.timeoutMs,
      source: 'agent',
    })
  }
}

export function applyRagFlowProvider(ctx: Context, config: Config): () => void {
  return (ctx as ProviderContext).ragflow.registerProvider(new BusinessGatewayRagFlowProvider(
    config.baseURL,
    config.accessTokenRef,
    config.requestTimeoutMs ?? DEFAULT_RAGFLOW_REQUEST_TIMEOUT_MS,
    config.providerId,
  ))
}

export function apply(ctx: Context, config: Config): void {
  applyRagFlowProvider(ctx, config)
}
