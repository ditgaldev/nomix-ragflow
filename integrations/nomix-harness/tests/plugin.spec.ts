import { describe, expect, it } from 'vitest'

import { apply } from '../src/plugin.js'

describe('plugin lifecycle', () => {
  it('registers the REST tool surface and scopes every tool disposer', async () => {
    const registered: string[] = []
    const disposed: string[] = []
    const effects: Array<() => void> = []
    const hooks: string[] = []
    const ctx = {
      tools: {
        register(tool: { name: string }) {
          registered.push(tool.name)
          return () => disposed.push(tool.name)
        },
      },
      credentials: { resolve: async () => ({ value: 'secret', source: 'test' }) },
      effect(callback: () => (() => void)) { effects.push(callback()) },
      on(name: string) { hooks.push(name) },
    } as never

    await apply(ctx, {
      baseURL: 'https://ragflow.example.com/',
      apiKeyRef: 'RAGFLOW_API_KEY',
      requestTimeoutMs: 1_000,
    })

    expect(registered).toHaveLength(9)
    expect(registered).toContain('ragflow_retrieval')
    expect(registered).toContain('ragflow_manage_memories')
    expect(hooks).toEqual(['tools/pre-execute'])

    for (const dispose of effects.reverse()) dispose()
    expect(disposed.sort()).toEqual(registered.sort())
  })

  it('loads the complete REST tool surface with only the service URL', async () => {
    const registered: string[] = []
    const ctx = {
      tools: { register: (tool: { name: string }) => { registered.push(tool.name); return () => undefined } },
      credentials: { resolve: async () => ({ value: 'secret', source: 'test' }) },
      effect: (callback: () => (() => void)) => callback(),
      on: () => undefined,
    } as never

    await apply(ctx, { baseURL: 'http://ragflow:9380' })

    expect(registered).toHaveLength(9)
    expect(registered).toContain('ragflow_retrieval')
  })
})
