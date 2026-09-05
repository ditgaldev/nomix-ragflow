import { Context } from '@nomix-ai/nomix-harness/plugin'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { BusinessIdentityRuntime } from '../packages/dsh-business-identity/business-identity.js'

describe('BusinessIdentityRuntime', () => {
  afterEach(() => vi.useRealTimers())

  it('cleans expired bindings without waiting for another lookup', () => {
    vi.useFakeTimers()
    vi.setSystemTime(1_800_000_000_000)
    const runtime = new BusinessIdentityRuntime(new Context())
    runtime.bindSession({ sessionId: 'session', userAssertion: 'secret', expiresAtEpochSeconds: 1_800_000_001 })
    expect(vi.getTimerCount()).toBe(1)
    vi.advanceTimersByTime(1000)
    expect(vi.getTimerCount()).toBe(0)
    expect(() => runtime.resolveUserAssertion('session')).toThrow('No business identity is bound')
  })

  it('clears credentials and expiry timers when its Cordis scope stops', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(1_800_000_000_000)
    const ctx = new Context()
    const runtime = new BusinessIdentityRuntime(ctx)
    runtime.bindSession({ sessionId: 'session', userAssertion: 'secret', expiresAtEpochSeconds: 1_800_000_300 })
    await ctx.fiber.dispose()
    expect(vi.getTimerCount()).toBe(0)
    expect(() => runtime.resolveUserAssertion('session')).toThrow('No business identity is bound')
  })

  it('binds a short-lived assertion to exactly one Harness session', () => {
    vi.useFakeTimers()
    vi.setSystemTime(1_800_000_000_000)
    const runtime = new BusinessIdentityRuntime(new Context())
    runtime.bindSession({ sessionId: 'session-1', userAssertion: 'signed-assertion-v1', expiresAtEpochSeconds: 1_800_000_500 })
    expect(runtime.resolveUserAssertion('session-1')).toEqual({ sessionId: 'session-1', userAssertion: 'signed-assertion-v1', expiresAtEpochSeconds: 1_800_000_500 })
    vi.setSystemTime(1_800_000_501_000)
    expect(() => runtime.resolveUserAssertion('session-1')).toThrow(expect.objectContaining({ code: 'KNOWLEDGE_UNAUTHENTICATED' }))
  })

  it('keeps a refreshed binding when the previous disposer runs', () => {
    vi.useFakeTimers()
    vi.setSystemTime(1_800_000_000_000)
    const runtime = new BusinessIdentityRuntime(new Context())
    const disposeOld = runtime.bindSession({ sessionId: 'session-1', userAssertion: 'old', expiresAtEpochSeconds: 1_800_000_300 })
    runtime.bindSession({ sessionId: 'session-1', userAssertion: 'new', expiresAtEpochSeconds: 1_800_000_500 })
    disposeOld()
    expect(runtime.resolveUserAssertion('session-1').userAssertion).toBe('new')
  })

  it('rejects malformed, expired, or over-ten-minute bindings', () => {
    vi.useFakeTimers()
    vi.setSystemTime(1_800_000_000_000)
    const runtime = new BusinessIdentityRuntime(new Context())
    expect(() => runtime.bindSession({ sessionId: ' session ', userAssertion: 'token', expiresAtEpochSeconds: 1_800_000_300 })).toThrow(expect.objectContaining({ code: 'KNOWLEDGE_INVALID_INPUT' }))
    expect(() => runtime.bindSession({ sessionId: 'session', userAssertion: 'token', expiresAtEpochSeconds: 1_799_999_999 })).toThrow(expect.objectContaining({ code: 'KNOWLEDGE_INVALID_INPUT' }))
    expect(() => runtime.bindSession({ sessionId: 'session', userAssertion: 'token', expiresAtEpochSeconds: 1_800_000_601 })).toThrow(expect.objectContaining({ code: 'KNOWLEDGE_INVALID_INPUT' }))
  })
})
