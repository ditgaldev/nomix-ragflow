import assert from 'node:assert/strict'
import { realpath } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Context, symbols } from '@nomix-ai/nomix-harness/plugin'
import { AgentRegistry } from '@nomix-ai/nomix-harness/plugin/agent'
import { AgentLoop } from '@nomix-ai/nomix-harness/plugin/agent-loop'
import { SessionId } from '@nomix-ai/nomix-harness/plugin/session'
import { ToolCallId } from '@nomix-ai/nomix-harness/plugin/llm'
import { renderPrompt } from '@nomix-ai/nomix-harness/plugin/system-prompt'

export const name = 'ragflow-profile-smoke-driver'
export const inject = ['agents', 'agentLoop', 'tools', 'knowledge', 'businessIdentity', 'credentials', 'spillStore', 'systemPrompt', 'loader', 'appReady', 'appExit']
const readTools = ['knowledge_space_list', 'knowledge_space_get', 'knowledge_document_list', 'knowledge_document_get', 'knowledge_search', 'knowledge_source_read', 'knowledge_document_download', 'knowledge_operation_get'].sort()
export const smokeSession = 'ragflow-profile-smoke'
// FiberState is a const enum; Harness's Loader fixtures use its ACTIVE wire value.
const FIBER_ACTIVE = 2
const original = value => value?.[symbols.original] ?? value

async function installedArtifacts() {
  const require = createRequire(import.meta.url)
  const profileRequire = createRequire(join(process.env.PROFILE_SMOKE_DIRECTORY, 'package.json'))
  assert.equal(await realpath(require.resolve('@nomix-ai/nomix-ragflow/package.json')), await realpath(profileRequire.resolve('@nomix-ai/nomix-ragflow/package.json')), 'driver must import the profile tarball')
  assert.equal(await realpath(fileURLToPath(import.meta.resolve('@nomix-ai/nomix-ragflow/service'))), await realpath(profileRequire.resolve('@nomix-ai/nomix-ragflow/service')), 'service import must resolve to the profile tarball')
  const [identity, service, plugin] = await Promise.all([
    import('@nomix-ai/nomix-ragflow/business-identity'),
    import('@nomix-ai/nomix-ragflow/service'),
    import('@nomix-ai/nomix-ragflow/plugin'),
  ])
  return { identity, service, plugin }
}

// The source test replaces only artifact imports; release execution resolves from the installed driver.
export async function auditProfile(ctx, loadArtifacts = installedArtifacts) {
  const { identity, service, plugin } = await loadArtifacts()
  assert.ok(ctx instanceof Context, 'driver must share the host Context constructor')
  assert.ok(ctx.agents instanceof AgentRegistry, 'driver must share the host AgentRegistry')
  assert.ok(ctx.agentLoop instanceof AgentLoop, 'real loop factory must be installed')
  assert.ok(ctx.knowledge instanceof service.KnowledgeRuntime, 'installed service must share host identity')
  assert.ok(ctx.businessIdentity instanceof identity.BusinessIdentityRuntime, 'installed identity must share host identity')
  const entryFor = id => {
    const rows = [...ctx.loader.entries()].filter(entry => entry.options.id === id)
    assert.equal(rows.length, 1, `expected one Loader entry: ${id}`)
    assert.equal(rows[0].fiber?.state, FIBER_ACTIVE, `inactive Loader entry: ${id}`)
    return rows[0]
  }
  const consumer = entryFor('knowledge')
  const provider = entryFor('knowledge-gateway')
  for (const entry of [consumer, provider]) {
    assert.ok(entry.fiber.ctx instanceof Context)
    for (const key of ['knowledge', 'businessIdentity', 'credentials']) {
      assert.ok(original(entry.fiber.ctx.get(key, true)) === original(ctx.get(key, true)), `${entry.options.id}: separate ${key} instance`)
    }
  }
  const knowledgeTools = async agent => (await ctx.systemPrompt.assemble({ scope: agent })).tools.map(tool => tool.name).filter(tool => tool.startsWith('knowledge_')).sort()
  const assertNoTools = async agent => {
    assert.deepEqual(await knowledgeTools(agent), [])
    for (const tool of readTools) assert.ok(ctx.tools.get(tool, agent) === undefined, `leaked tool: ${tool}`)
  }
  const handles = []
  const unbind = []
  const failures = []
  try {
    const outside = await ctx.agents.create({ sessionId: SessionId(`${smokeSession}-outside`), meta: { agentPreset: 'outside' } })
    handles.push(outside)
    await assertNoTools(outside.agent)
    for (let round = 0; round < 2; round++) {
      const handle = await ctx.agents.create({ sessionId: SessionId(`${smokeSession}-${round}`), meta: { agentPreset: 'smoke' } })
      handles.push(handle)
      const { agent } = handle
      assert.ok(original(ctx.agents.get(agent.id)) === original(agent), 'registry must return the created Agent')
      assert.ok(agent.ctx instanceof Context)
      for (const key of ['agents', 'tools', 'knowledge', 'businessIdentity', 'credentials', 'systemPrompt', 'agentLoop']) {
        assert.ok(original(agent.ctx.get(key, true)) === original(ctx.get(key, true)), `Agent has separate ${key} instance`)
      }
      assert.deepEqual(await knowledgeTools(agent), readTools, 'smoke preset must expose exactly the read toolset')
      const prompt = await ctx.systemPrompt.assemble({ scope: agent })
      assert.ok(renderPrompt(prompt).includes(plugin.KNOWLEDGE_EVIDENCE_INSTRUCTIONS), 'missing evidence policy')
      unbind.push(ctx.businessIdentity.bindSession({ sessionId: agent.id, userAssertion: 'profile-smoke-user', expiresAtEpochSeconds: Math.floor(Date.now() / 1000) + 60 }))
      const result = await ctx.tools.execute({ agent, name: 'knowledge_search', callId: ToolCallId(`profile-smoke-call-${round}`), arguments: { input: { query: 'profile smoke' } }, signal: AbortSignal.timeout(5_000) })
      assert.equal(result.isError, false, `knowledge_search failed: ${JSON.stringify(result)}`)
      assert.ok(JSON.stringify(result).includes('NO_AUTHORIZED_RELEVANT_EVIDENCE'), 'missing successful empty-search result')
      if (round === 1) {
        const consumerFiber = consumer.fiber
        await ctx.loader.update(consumer.id, { disabled: true })
        assert.equal(consumer.options.disabled, true)
        assert.notEqual(consumerFiber.state, FIBER_ACTIVE, 'Loader must initiate consumer disposal')
        // Entry.update starts disposal without awaiting it; join the same memoized teardown.
        await consumerFiber.dispose()
        await assertNoTools(agent)
        assert.ok(!renderPrompt(await ctx.systemPrompt.assemble({ scope: agent })).includes(plugin.KNOWLEDGE_EVIDENCE_INSTRUCTIONS), 'consumer prompt leaked after unload')
        const providerFiber = provider.fiber
        await ctx.loader.update(provider.id, { disabled: true })
        assert.equal(provider.options.disabled, true)
        assert.notEqual(providerFiber.state, FIBER_ACTIVE, 'Loader must initiate provider disposal')
        await providerFiber.dispose()
        await assert.rejects(ctx.knowledge.forOperation({ context: agent.ctx, credentials: ctx.credentials, businessIdentity: ctx.businessIdentity, sessionId: agent.id, toolCallId: 'after-unload', requestId: 'after-unload' }), error => error.code === 'KNOWLEDGE_PROVIDER_UNAVAILABLE')
      }
      unbind.pop()()
      await handle.dispose()
      handles.pop()
      assert.ok(ctx.agents.get(agent.id) === undefined, 'Agent leaked after disposal')
      await assertNoTools(agent)
    }
    const after = await ctx.agents.create({ sessionId: SessionId(`${smokeSession}-after`), meta: { agentPreset: 'smoke' } })
    handles.push(after)
    await assertNoTools(after.agent)
  } catch (error) { failures.push(error) }
  for (const release of unbind.reverse()) {
    try { release() } catch (error) { failures.push(error) }
  }
  const disposed = await Promise.allSettled(handles.reverse().map(handle => handle.dispose()))
  failures.push(...disposed.filter(result => result.status === 'rejected').map(result => result.reason))
  if (failures.length === 1) throw failures[0]
  if (failures.length) throw new AggregateError(failures, 'smoke audit/Agent cleanup failed')
  return { rounds: 2, consumerRemoved: true, providerRemoved: true, recreatedWithoutTools: true }
}

export function apply(ctx) {
  assert.equal(typeof process.send, 'function', 'profile smoke requires parent IPC')
  let triggered = false
  let ready = false
  ctx.effect(() => {
    const onMessage = message => {
      if (message?.type === 'profile-smoke:stop') { ctx.appExit(0); return }
      if (message?.type !== 'profile-smoke:trigger') return
      if (!ready || triggered) { ctx.appExit(1); return }
      triggered = true
      void auditProfile(ctx).then(
        checks => process.send({ type: 'profile-smoke:result', ok: true, checks }),
        error => { process.send({ type: 'profile-smoke:result', ok: false, error: error.stack ?? String(error) }); ctx.appExit(1) },
      )
    }
    const onDisconnect = () => ctx.appExit(1)
    process.on('message', onMessage)
    process.on('disconnect', onDisconnect)
    return () => { process.off('message', onMessage); process.off('disconnect', onDisconnect) }
  })
  ctx.effect(() => ctx.appReady.onReady(() => {
    ready = true
    process.send({ type: 'profile-smoke:ready' })
  }))
}
