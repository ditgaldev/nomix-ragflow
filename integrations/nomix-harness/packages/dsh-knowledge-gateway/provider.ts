import { Schema as z, type Context } from '@nomix-ai/nomix-harness/plugin'
import { credentialRef } from '@nomix-ai/nomix-harness/plugin/credentials'
import { DEFAULT_KNOWLEDGE_ARTIFACT_MAX_BYTES, DEFAULT_KNOWLEDGE_REQUEST_TIMEOUT_MS, KNOWLEDGE_GATEWAY_PROVIDER_ID, MAX_KNOWLEDGE_ARTIFACT_MAX_BYTES, MAX_KNOWLEDGE_REQUEST_TIMEOUT_MS } from '../dsh-knowledge/harness-contract.js'
import { KnowledgeGatewayClient } from './knowledge-client.js'
import { KnowledgeGatewayError } from '../dsh-knowledge/knowledge-errors.js'
import type { KnowledgeOperationContext, KnowledgeProvider, KnowledgeRuntime } from '../dsh-knowledge/service.js'

export const name = 'nomix-knowledge-gateway-provider'
export const inject = ['knowledge', 'businessIdentity', 'credentials']

export interface Config {
  gatewayBaseURL: string
  serviceTokenRef: string
  requestTimeoutMs?: number
  artifactMaxBytes?: number
}

export const Config = z.object({
  gatewayBaseURL: z.string().required(),
  serviceTokenRef: z.string().required(),
  requestTimeoutMs: z.number().step(1).min(1).max(MAX_KNOWLEDGE_REQUEST_TIMEOUT_MS).default(DEFAULT_KNOWLEDGE_REQUEST_TIMEOUT_MS),
  artifactMaxBytes: z.number().step(1).min(1).max(MAX_KNOWLEDGE_ARTIFACT_MAX_BYTES).default(DEFAULT_KNOWLEDGE_ARTIFACT_MAX_BYTES),
}) as unknown as z<Config>

type ProviderContext = Context & { knowledge: KnowledgeRuntime }

export class KnowledgeGatewayProvider implements KnowledgeProvider {
  readonly id = KNOWLEDGE_GATEWAY_PROVIDER_ID
  private readonly serviceRef

  constructor(
    private readonly gatewayBaseURL: string,
    serviceTokenRef: string,
    private readonly timeoutMs: number,
    private readonly maxResponseBytes: number,
  ) {
    this.serviceRef = credentialRef(serviceTokenRef)
    new KnowledgeGatewayClient(gatewayBaseURL, {
      serviceToken: 'validation',
      userAssertion: 'validation',
      sessionId: 'validation',
      toolCallId: 'validation',
      requestId: 'validation',
    }, timeoutMs, maxResponseBytes)
  }

  available() { return true }

  async createService(operation: KnowledgeOperationContext): Promise<KnowledgeGatewayClient> {
    const identity = operation.businessIdentity.resolveUserAssertion(operation.sessionId)
    let serviceToken
    try {
      serviceToken = await operation.credentials.resolve(this.serviceRef)
    } catch (cause) {
      throw new KnowledgeGatewayError('The Harness service credential could not be resolved for this operation.', { code: 'KNOWLEDGE_PROVIDER_UNAVAILABLE', status: 503, retryable: true, cause })
    }
    const token = serviceToken?.value.trim()
    if (!token) throw new KnowledgeGatewayError('The Harness service token is required.', { code: 'KNOWLEDGE_UNAUTHENTICATED', status: 401 })
    const logger = operation.context.logger('nomix-ragflow.gateway')
    return new KnowledgeGatewayClient(this.gatewayBaseURL, {
      serviceToken: token,
      userAssertion: identity.userAssertion,
      sessionId: operation.sessionId,
      toolCallId: operation.toolCallId,
      requestId: operation.requestId,
    }, this.timeoutMs, this.maxResponseBytes, meta => logger.debug('knowledge gateway response', {
      harnessSessionId: operation.sessionId,
      toolCallId: operation.toolCallId,
      businessRequestId: meta.requestId,
      gatewayTraceId: meta.traceId,
    }))
  }
}

export function applyKnowledgeProvider(ctx: Context, config: Config): () => void {
  return (ctx as ProviderContext).knowledge.registerProvider(new KnowledgeGatewayProvider(
    config.gatewayBaseURL,
    config.serviceTokenRef,
    config.requestTimeoutMs ?? DEFAULT_KNOWLEDGE_REQUEST_TIMEOUT_MS,
    config.artifactMaxBytes ?? DEFAULT_KNOWLEDGE_ARTIFACT_MAX_BYTES,
  ))
}

export function apply(ctx: Context, config: Config): void { applyKnowledgeProvider(ctx, config) }
