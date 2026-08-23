import { describe, expect, it, vi } from 'vitest'

const { applyMcp } = vi.hoisted(() => ({ applyMcp: vi.fn(async () => undefined) }))
vi.mock('@nomix-ai/nomix-mcp-client', () => ({ apply: applyMcp }))

import { apply } from '../src/index.js'

describe('plugin lifecycle and MCP bridge', () => {
  it('discovers MCP through the configured bridge and scopes every tool disposer', async () => {
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
      effect(callback: () => (() => void)) { effects.push(callback()) },
      on(name: string) { hooks.push(name) },
    } as never

    await apply(ctx, {
      baseURL: 'https://ragflow.example.com/',
      apiKey: 'secret',
      serverName: 'knowledge',
      requestTimeoutMs: 1_000,
    })

    expect(registered).toHaveLength(8)
    expect(registered).toContain('ragflow_manage_memories')
    expect(hooks).toEqual(['tools/pre-execute'])
    expect(applyMcp).toHaveBeenCalledWith(ctx, expect.objectContaining({
      transport: 'streamable-http',
      serverName: 'knowledge',
      url: 'https://ragflow.example.com/api/v1/mcp',
      headers: { Authorization: 'Bearer secret' },
    }))

    for (const dispose of effects.reverse()) dispose()
    expect(disposed.sort()).toEqual(registered.sort())
  })

  it('accepts the standalone Python MCP endpoint', async () => {
    const ctx = { tools: { register: () => () => undefined }, effect: (callback: () => (() => void)) => callback(), on: () => undefined } as never
    await apply(ctx, { baseURL: 'http://ragflow:9380', mcpURL: 'http://ragflow:9382/mcp', apiKey: 'secret' })
    expect(applyMcp).toHaveBeenLastCalledWith(ctx, expect.objectContaining({ url: 'http://ragflow:9382/mcp' }))
  })
})
