import { describe, expect, it } from 'vitest'
import * as plugin from '../src/index.js'

describe('Cordis loader exports', () => {
  it('keeps named metadata and has no default export', () => {
    expect(plugin.name).toBe('nomix-ragflow')
    expect(plugin.inject).toEqual(['tools', 'fs'])
    expect(plugin.Config).toBeDefined()
    expect(plugin.apply).toBeTypeOf('function')
    expect('default' in plugin).toBe(false)
    expect(plugin.RagFlowClient).toBeTypeOf('function')
  })
})
