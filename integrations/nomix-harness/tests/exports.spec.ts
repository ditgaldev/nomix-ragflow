import { describe, expect, it } from 'vitest'
import * as client from '../src/index.js'
import * as plugin from '../src/plugin.js'

describe('Cordis loader exports', () => {
  it('keeps the generic root free of Harness runtime imports', () => {
    expect(client.RagFlowClient).toBeTypeOf('function')
    expect('apply' in client).toBe(false)
    expect('default' in client).toBe(false)
  })

  it('keeps named plugin metadata on the plugin subpath', () => {
    expect(plugin.name).toBe('nomix-ragflow')
    expect(plugin.inject).toEqual(['tools', 'fs'])
    expect(plugin.Config).toBeDefined()
    expect(plugin.apply).toBeTypeOf('function')
    expect('default' in plugin).toBe(false)
    expect(plugin.RagFlowClient).toBeTypeOf('function')
  })
})
