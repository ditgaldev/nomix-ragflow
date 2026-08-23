import { describe, expect, it, vi } from 'vitest'
import { destructiveDecision } from '../src/tools.js'

describe('destructive tool approval classification', () => {
  it.each([
    ['ragflow_manage_datasets', 'delete'],
    ['ragflow_manage_documents', 'delete'],
    ['ragflow_manage_documents', 'cancel_parse'],
    ['ragflow_manage_chunks', 'delete'],
    ['ragflow_manage_chats', 'delete'],
    ['ragflow_manage_sessions', 'delete'],
    ['ragflow_manage_agents', 'delete'],
    ['ragflow_manage_memories', 'delete'],
    ['ragflow_manage_memories', 'forget_message'],
  ])('asks once for %s.%s', async (name, action) => {
    const next = vi.fn(async () => ({ kind: 'allow' as const }))
    await expect(destructiveDecision(name, { action, input: {} }, next)).resolves.toMatchObject({ kind: 'ask' })
    expect(next).not.toHaveBeenCalled()
  })

  it('delegates non-destructive and foreign calls', async () => {
    const next = vi.fn(async () => ({ kind: 'allow' as const }))
    await expect(destructiveDecision('ragflow_manage_datasets', { action: 'list', input: {} }, next)).resolves.toEqual({ kind: 'allow' })
    await expect(destructiveDecision('another_plugin', { action: 'delete' }, next)).resolves.toEqual({ kind: 'allow' })
    expect(next).toHaveBeenCalledTimes(2)
  })
})
