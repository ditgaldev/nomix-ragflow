import { Context } from '@nomix-ai/nomix-harness/plugin'
import { credentialRef } from '@nomix-ai/nomix-harness/plugin/credentials'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { applyKnowledgeProvider, KnowledgeGatewayProvider } from '../packages/dsh-knowledge-gateway/provider.js'
import { BusinessIdentityRuntime } from '../packages/dsh-business-identity/business-identity.js'
import { KnowledgeRuntime } from '../packages/dsh-knowledge/service.js'
import { pagination, success } from './knowledge-fixtures.js'

const roots: Context[] = []
afterEach(async () => { await Promise.all(roots.splice(0).map(ctx => ctx.fiber.dispose())); vi.unstubAllGlobals(); vi.restoreAllMocks() })

describe('KnowledgeGatewayProvider', () => {
  it.each(['AbortError', 'TimeoutError'])('does not resolve credentials for a pre-aborted %s signal', async name => {
    const controller = new AbortController()
    const reason = new DOMException('Operation stopped', name)
    controller.abort(reason)
    const resolve = vi.fn()
    const resolveUserAssertion = vi.fn()
    const provider = new KnowledgeGatewayProvider('https://knowledge-gateway.example.com', 'KNOWLEDGE_SERVICE_TOKEN', 1_000, 128 * 1024)
    await expect(provider.createService({
      credentials: { resolve } as never, businessIdentity: { resolveUserAssertion }, context: {} as never,
      signal: controller.signal, sessionId: 'session', toolCallId: 'call', requestId: 'request',
    })).rejects.toBe(reason)
    expect(resolve).not.toHaveBeenCalled()
    expect(resolveUserAssertion).not.toHaveBeenCalled()
  })

  it.each([
    ['AbortError', 'resolve'], ['AbortError', 'reject'],
    ['TimeoutError', 'resolve'], ['TimeoutError', 'reject'],
  ])('preserves %s after pending credentials %s, waiting for settlement', async (name, outcome) => {
    const controller = new AbortController()
    const reason = new DOMException('Operation stopped', name)
    let settle!: () => void
    const resolve = vi.fn(() => new Promise<{ value: string; source: string }>((resolve, reject) => {
      settle = () => outcome === 'resolve' ? resolve({ value: 'service', source: 'test' }) : reject(new Error('Credential failure'))
    }))
    const resolveUserAssertion = vi.fn()
    const provider = new KnowledgeGatewayProvider('https://knowledge-gateway.example.com', 'KNOWLEDGE_SERVICE_TOKEN', 1_000, 128 * 1024)
    const pending = provider.createService({
      credentials: { resolve } as never, businessIdentity: { resolveUserAssertion }, context: {} as never,
      signal: controller.signal, sessionId: 'session', toolCallId: 'call', requestId: 'request',
    })
    let settled = false
    const observed = pending.then(() => { settled = true }, error => { settled = true; throw error })
    const rejection = expect(observed).rejects.toBe(reason)
    expect(resolve).toHaveBeenCalledOnce()
    controller.abort(reason)
    await Promise.resolve()
    expect(settled).toBe(false)
    settle()
    await rejection
    expect(resolveUserAssertion).not.toHaveBeenCalled()
  })

  it('uses an assertion refreshed while credentials are pending', async () => {
    const ctx = new Context(); roots.push(ctx)
    const businessIdentity = new BusinessIdentityRuntime(ctx)
    const expiresAtEpochSeconds = Math.floor(Date.now() / 1000) + 60
    businessIdentity.bindSession({ sessionId: 'session', userAssertion: 'old-assertion', expiresAtEpochSeconds })
    let settle!: () => void
    const resolve = vi.fn(() => new Promise<{ value: string; source: string }>(resolve => {
      settle = () => resolve({ value: 'service', source: 'test' })
    }))
    const fetch = vi.fn(async (_url: URL, _init: RequestInit) => Response.json(success({ items: [] }, pagination)))
    vi.stubGlobal('fetch', fetch)
    const provider = new KnowledgeGatewayProvider('https://knowledge-gateway.example.com', 'KNOWLEDGE_SERVICE_TOKEN', 1_000, 128 * 1024)
    const pending = provider.createService({ context: ctx, businessIdentity, credentials: { resolve } as never, sessionId: 'session', toolCallId: 'call', requestId: 'request' })
    businessIdentity.bindSession({ sessionId: 'session', userAssertion: 'new-assertion', expiresAtEpochSeconds })
    settle()
    await (await pending).listSpaces({})
    expect(fetch).toHaveBeenCalledOnce()
    expect(new Headers(fetch.mock.calls[0]![1].headers).get('x-user-assertion')).toBe('new-assertion')
  })

  it.each(['expiry', 'unbind'])('rejects identity %s while credentials are pending', async change => {
    const ctx = new Context(); roots.push(ctx)
    const businessIdentity = new BusinessIdentityRuntime(ctx)
    const expiresAtEpochSeconds = Math.floor(Date.now() / 1000) + 60
    const unbind = businessIdentity.bindSession({ sessionId: 'session', userAssertion: 'assertion', expiresAtEpochSeconds })
    let settle!: () => void
    const resolve = vi.fn(() => new Promise<{ value: string; source: string }>(resolve => {
      settle = () => resolve({ value: 'service', source: 'test' })
    }))
    const provider = new KnowledgeGatewayProvider('https://knowledge-gateway.example.com', 'KNOWLEDGE_SERVICE_TOKEN', 1_000, 128 * 1024)
    const pending = provider.createService({ context: ctx, businessIdentity, credentials: { resolve } as never, sessionId: 'session', toolCallId: 'call', requestId: 'request' })
    if (change === 'expiry') vi.spyOn(Date, 'now').mockReturnValue(expiresAtEpochSeconds * 1000)
    else unbind()
    settle()
    await expect(pending).rejects.toMatchObject({ code: 'KNOWLEDGE_UNAUTHENTICATED', status: 401 })
  })

  it('resolves the service token and current session assertion for every operation', async () => {
    const resolve = vi.fn(async () => ({ value: 'service', source: 'test' }))
    const resolveUserAssertion = vi.fn((sessionId: string) => ({ sessionId, userAssertion: `assertion-${resolveUserAssertion.mock.calls.length}`, expiresAtEpochSeconds: 2_000_000_000 }))
    const logger = vi.fn(() => ({ debug: vi.fn() }))
    const provider = new KnowledgeGatewayProvider('https://knowledge-gateway.example.com', 'KNOWLEDGE_SERVICE_TOKEN', 1_000, 128 * 1024)
    const base = { credentials: { resolve } as never, businessIdentity: { resolveUserAssertion } as never, context: { logger } as never, sessionId: 'session', toolCallId: 'call', requestId: 'request' }
    await provider.createService(base)
    await provider.createService({ ...base, toolCallId: 'call-2', requestId: 'request-2' })
    expect(resolve).toHaveBeenCalledTimes(2)
    expect(resolveUserAssertion).toHaveBeenCalledTimes(2)
    expect(resolveUserAssertion).toHaveBeenNthCalledWith(1, 'session')
    expect(logger).toHaveBeenCalledTimes(2)
  })

  it('uses each business deployment configuration without sharing its Gateway or session identity', async () => {
    const calls: Array<{ url: string; headers: Headers }> = []
    vi.stubGlobal('fetch', vi.fn(async (url: URL, init: RequestInit) => {
      calls.push({ url: String(url), headers: new Headers(init.headers) })
      return Response.json(success({ items: [] }, pagination))
    }))
    const deployments = [
      { baseURL: 'https://business-a.example.com', tokenRef: 'BUSINESS_A_TOKEN', token: 'test-service-a', assertion: 'test-user-a' },
      { baseURL: 'https://business-b.example.org/backend', tokenRef: 'BUSINESS_B_TOKEN', token: 'test-service-b', assertion: 'test-user-b' },
    ]
    const services = await Promise.all(deployments.map(async deployment => {
      const ctx = new Context(); roots.push(ctx)
      const knowledge = new KnowledgeRuntime(ctx)
      const businessIdentity = new BusinessIdentityRuntime(ctx)
      const credentials = { resolve: vi.fn(async () => ({ value: deployment.token, source: 'test' })) }
      ctx.provide('credentials', credentials as never)
      // Identical session IDs in isolated deployments must not share assertions.
      businessIdentity.bindSession({ sessionId: 'session-1', userAssertion: deployment.assertion, expiresAtEpochSeconds: Math.floor(Date.now() / 1000) + 60 })
      applyKnowledgeProvider(ctx, { gatewayBaseURL: deployment.baseURL, serviceTokenRef: deployment.tokenRef })
      const service = await knowledge.forOperation({ context: ctx, businessIdentity, credentials: credentials as never, sessionId: 'session-1', toolCallId: 'call-1', requestId: 'request-1' })
      expect(credentials.resolve).toHaveBeenCalledWith(credentialRef(deployment.tokenRef))
      return service
    }))
    await Promise.all(services.map(service => service.listSpaces({})))
    expect(calls).toHaveLength(2)
    for (const deployment of deployments) {
      const call = calls.find(call => call.url.startsWith(deployment.baseURL))!
      expect(new URL(call.url).pathname).toBe(`${new URL(deployment.baseURL).pathname.replace(/\/$/u, '')}/internal/v1/knowledge/spaces`)
      expect(call.headers.get('authorization')).toBe(`Bearer ${deployment.token}`)
      expect(call.headers.get('x-user-assertion')).toBe(deployment.assertion)
      expect(call.headers.get('x-harness-session-id')).toBe('session-1')
    }
  })
})
