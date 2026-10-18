import { createRequire } from 'node:module'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { EventEmitter } from 'node:events'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@nomix-ai/nomix-harness/plugin'
import { loadOverlayPatches } from '@nomix-ai/nomix-harness/plugin/app-boot'
import { AgentRegistry } from '@nomix-ai/nomix-harness/plugin/agent'
import { AgentLoop } from '@nomix-ai/nomix-harness/plugin/agent-loop'
import { LlmRuntime } from '@nomix-ai/nomix-harness/plugin/llm'
import { SessionStore } from '@nomix-ai/nomix-harness/plugin/session'
import { SessionProjectionRegistry } from '@nomix-ai/nomix-harness/plugin/session-projection'
import { SystemPrompt } from '@nomix-ai/nomix-harness/plugin/system-prompt'
import { ToolRuntime } from '@nomix-ai/nomix-harness/plugin/tools'
import { LocalCredentialProvider as Credentials } from '@nomix-ai/nomix-harness/plugin/credentials-local'
import { LocalSpillStore as Spill } from '@nomix-ai/nomix-harness/plugin/spill-local'
import { afterEach, describe, expect, it, vi } from 'vitest'
import * as consumer from '../packages/dsh-bundle-ragflow-knowledge/plugin.js'
import * as provider from '../packages/dsh-knowledge-gateway/provider.js'
import * as identity from '../packages/dsh-business-identity/business-identity.js'
import * as service from '../packages/dsh-knowledge/service.js'
import { auditProfile } from '../scripts/profile-smoke-driver.mjs'
import { profileSmokePatches, startGateway, waitForAudit, stopProfile } from '../scripts/profile-smoke.mjs'

const require = createRequire(import.meta.url)
const hostRequire = createRequire(require.resolve('@nomix-ai/nomix-harness/package.json'))
const { default: Loader } = await import(pathToFileURL(hostRequire.resolve('@nomix-ai/cordis-plugin-loader')).href)
const { applyEntryPatches } = await import(pathToFileURL(hostRequire.resolve('@nomix-ai/cordis-plugin-include')).href)
const cleanup = []
afterEach(async () => {
  vi.restoreAllMocks()
  const failures = []
  for (const release of cleanup.splice(0).reverse()) {
    try { await release() } catch (error) { failures.push(error) }
  }
  if (failures.length) throw new AggregateError(failures, 'source fixture cleanup failed')
})

async function setup() {
  const directory = await mkdtemp(join(tmpdir(), 'ragflow-smoke-unit-'))
  cleanup.push(() => rm(directory, { recursive: true, force: true }))
  const ctx = new Context()
  cleanup.push(() => ctx.fiber.dispose())
  for (const plugin of [LlmRuntime, SessionStore, SessionProjectionRegistry, SystemPrompt, ToolRuntime, AgentRegistry]) await ctx.plugin(plugin)
  await ctx.plugin(AgentLoop, { agents: [] })
  const path = join(directory, 'credentials.yaml')
  await writeFile(path, JSON.stringify({ version: 1, refs: { PROFILE_SMOKE_SERVICE_TOKEN: 'profile-smoke-service' } }), { mode: 0o600 })
  await ctx.plugin(Credentials, { path, watch: false })
  await ctx.plugin(Spill, { root: join(directory, 'spill'), cleanupPeriodDays: 0 })
  // Only the module-import plane is adapted: real Loader Entries own every source plugin fiber.
  const modules = { identity, service, consumer, provider }
  class SourceLoader extends Loader {
    import(specifier) { return modules[specifier] }
  }
  await ctx.plugin(SourceLoader)
  const gateway = await startGateway()
  cleanup.push(() => gateway.close())
  for (const row of [
    { id: 'business-identity', name: 'identity' },
    { id: 'knowledge-service', name: 'service' },
    { id: 'knowledge-gateway', name: 'provider', config: { gatewayBaseURL: gateway.url, serviceTokenRef: 'PROFILE_SMOKE_SERVICE_TOKEN', requestTimeoutMs: 1000 } },
    { id: 'knowledge', name: 'consumer', config: { agentToolsets: [{ agentPreset: 'smoke', toolset: 'read' }] } },
  ]) await ctx.loader.create(row)
  await ctx.loader.await()
  for (const entry of ctx.loader.entries()) await entry.fiber.await()
  return { ctx, gateway, artifacts: async () => ({ identity, service, plugin: consumer }) }
}

describe('profile smoke audit with real Harness and source plugins', () => {
  it('overrides actual base rows without inserting duplicate core services', () => {
    const base = loadOverlayPatches('smoke-test', hostRequire.resolve('@nomix-ai/nomix-base/cordis.patch.yml'))
    const bundle = loadOverlayPatches('smoke-test', fileURLToPath(new URL('../packages/dsh-bundle-ragflow-knowledge/cordis.patch.yml', import.meta.url)))
    const overlay = profileSmokePatches('smoke-home', 'http://127.0.0.1:1')
    expect(overlay.every(row => !row.insert && !row.name)).toBe(true)
    const warn = vi.fn()
    const original = applyEntryPatches([], [...base, ...bundle], warn)
    const rows = applyEntryPatches([], [...base, ...bundle, ...overlay], warn)
    expect(warn).not.toHaveBeenCalled()
    expect(rows).toHaveLength(original.length)
    for (const patch of overlay) {
      const matching = rows.filter(row => row.id === patch.id)
      expect(matching).toHaveLength(1)
      expect(matching[0].config).toEqual(patch.config)
      if (patch.disabled !== undefined) expect(matching[0].disabled).toBe(false)
    }
    for (const id of ['llm', 'session', 'session-projection', 'agent', 'tools', 'system-prompt', 'agent-loop', 'credentials', 'spill-local']) {
      expect(rows.filter(row => row.id === id)).toHaveLength(1)
      expect(rows.find(row => row.id === id).name).toBe(original.find(row => row.id === id).name)
    }
  })

  it('calls the HTTP Gateway twice, recreates Agents, and removes entries/tools/providers', async () => {
    const { ctx, gateway, artifacts } = await setup()
    await expect(auditProfile(ctx, artifacts)).resolves.toEqual({ rounds: 2, consumerRemoved: true, providerRemoved: true, recreatedWithoutTools: true })
    gateway.assertComplete()
    expect(ctx.agents.list()).toEqual([])
    expect(ctx.loader.resolve('knowledge').options.disabled).toBe(true)
    expect(ctx.loader.resolve('knowledge-gateway').options.disabled).toBe(true)
  })

  it('fails on a broken tool call and still removes owned Agents', async () => {
    const { ctx, artifacts } = await setup()
    vi.spyOn(ctx.tools, 'execute').mockResolvedValue({ isError: true, content: [] })
    await expect(auditProfile(ctx, artifacts)).rejects.toThrow('knowledge_search failed')
    expect(ctx.agents.list()).toEqual([])
  })

  it('detects failed consumer cleanup', async () => {
    const { ctx, artifacts } = await setup()
    const fiber = ctx.loader.resolve('knowledge').fiber
    vi.spyOn(ctx.loader, 'update').mockResolvedValue(undefined)
    vi.spyOn(fiber, 'dispose').mockResolvedValue(undefined)
    await expect(auditProfile(ctx, artifacts)).rejects.toThrow()
    expect(ctx.agents.list()).toEqual([])
  })

  it('preserves the invocation failure when Agent cleanup also fails', async () => {
    const { ctx, artifacts } = await setup()
    vi.spyOn(ctx.tools, 'execute').mockResolvedValue({ isError: true, content: [] })
    const create = ctx.agents.create.bind(ctx.agents)
    vi.spyOn(ctx.agents, 'create').mockImplementation(async options => {
      const handle = await create(options)
      const dispose = handle.dispose.bind(handle)
      handle.dispose = async () => { await dispose(); throw new Error('cleanup failed') }
      return handle
    })
    await expect(auditProfile(ctx, artifacts)).rejects.toMatchObject({ errors: [expect.objectContaining({ message: expect.stringContaining('knowledge_search failed') }), expect.objectContaining({ message: 'cleanup failed' }), expect.objectContaining({ message: 'cleanup failed' })] })
    expect(ctx.agents.list()).toEqual([])
  })
})

function childProcess() {
  const child = new EventEmitter()
  Object.assign(child, { connected: true, exitCode: null, signalCode: null, send: vi.fn((_message, callback) => callback?.()), kill: vi.fn() })
  return child
}
const ready = { type: 'profile-smoke:ready' }
const result = { type: 'profile-smoke:result', ok: true, checks: { rounds: 2, consumerRemoved: true, providerRemoved: true, recreatedWithoutTools: true } }

describe('parent IPC and finite shutdown', () => {
  it('triggers only after ready and validates the completed audit', async () => {
    const child = childProcess()
    const pending = waitForAudit(child, 100)
    expect(child.send).not.toHaveBeenCalled()
    child.emit('message', ready)
    expect(child.send).toHaveBeenCalledWith({ type: 'profile-smoke:trigger' }, expect.any(Function))
    child.emit('message', result)
    await expect(pending).resolves.toEqual(result.checks)
    expect(child.listenerCount('message')).toBe(0)
  })

  it.each([
    [result, /before ready/],
    [ready, /duplicate ready/, ready],
    [{ ...result, ok: false, error: 'broken invocation' }, /broken invocation/, ready],
    [{ ...result, checks: {} }, /Expected values/, ready],
  ])('rejects malformed/out-of-order/failing handshake %#', async (message, error, first) => {
    const child = childProcess()
    const pending = waitForAudit(child, 100)
    if (first) child.emit('message', first)
    child.emit('message', message)
    await expect(pending).rejects.toThrow(error)
  })

  it('fails on missing result or early CLI exit', async () => {
    const child = childProcess()
    await expect(waitForAudit(child, 10)).rejects.toThrow('timed out')
    const pending = waitForAudit(child, 100)
    child.emit('exit', 1, null)
    await expect(pending).rejects.toThrow('exited before smoke result')
  })

  it('requests graceful shutdown and bounds unresponsive children with force kill', async () => {
    const child = childProcess()
    child.send.mockImplementation(() => { child.exitCode = 0; child.emit('exit', 0, null) })
    await stopProfile(child, 10, 10)
    expect(child.kill).not.toHaveBeenCalled()
    const stuck = childProcess()
    stuck.kill.mockImplementation(signal => { stuck.signalCode = signal; stuck.emit('exit', null, signal) })
    await expect(stopProfile(stuck, 10, 10)).rejects.toThrow('required forced shutdown')
    expect(stuck.kill).toHaveBeenCalledWith('SIGKILL')
    const unkillable = childProcess()
    await expect(stopProfile(unkillable, 10, 10)).rejects.toThrow('did not exit')
  })
})
