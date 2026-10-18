import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { fork } from 'node:child_process'
import { createServer } from 'node:http'
import { once } from 'node:events'
import { copyFile, mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

const session = 'ragflow-profile-smoke'
const token = 'profile-smoke-service'

export function profileSmokePatches(home, gatewayURL) {
  return [
    { id: 'agent-loop', config: { agents: [] } },
    { id: 'credentials', config: { nomixHome: home, watch: false } },
    { id: 'spill-local', config: { root: join(home, 'spill'), cleanupPeriodDays: 0 } },
    { id: 'knowledge-gateway', disabled: false, config: { gatewayBaseURL: gatewayURL, serviceTokenRef: 'PROFILE_SMOKE_SERVICE_TOKEN', requestTimeoutMs: 5_000 } },
    { id: 'knowledge', disabled: false, config: { agentToolsets: [{ agentPreset: 'smoke', toolset: 'read' }], requestTimeoutMs: 5_000 } },
  ]
}

export async function startGateway() {
  const requests = []
  const failures = []
  const server = createServer(async (req, res) => {
    try {
      let body = ''
      for await (const chunk of req) {
        body += chunk
        assert.ok(body.length < 16_384, 'unexpected Gateway request size')
      }
      const call = `profile-smoke-call-${requests.length}`
      const sessionId = `${session}-${requests.length}`
      assert.equal(req.method, 'POST')
      assert.equal(req.url, '/internal/v1/knowledge/search')
      assert.deepEqual(JSON.parse(body), { query: 'profile smoke', limit: 8 })
      assert.equal(req.headers.authorization, `Bearer ${token}`)
      assert.equal(req.headers['x-user-assertion'], 'profile-smoke-user')
      assert.equal(req.headers['x-harness-session-id'], sessionId)
      assert.equal(req.headers['x-tool-call-id'], call)
      const requestId = `knowledge-${createHash('sha256').update(sessionId).update('\0').update(call).digest('hex').slice(0, 32)}`
      assert.equal(req.headers['x-request-id'], requestId)
      assert.equal(req.headers['idempotency-key'], undefined, 'read must not claim mutation idempotency')
      requests.push({ call, requestId })
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ data: { query: 'profile smoke', hits: [], reason: 'NO_AUTHORIZED_RELEVANT_EVIDENCE' }, meta: { success: true, requestId, traceId: `gateway-${call}`, timestamp: new Date().toISOString(), apiVersion: 'v1', pagination: null, error: null } }))
    } catch (error) {
      failures.push(error)
      res.writeHead(500, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ error: 'smoke Gateway assertion failed' }))
    }
  })
  server.requestTimeout = 5_000
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  return {
    url: `http://127.0.0.1:${server.address().port}`,
    assertComplete() { assert.deepEqual(failures, [], 'Gateway auth/contract failed'); assert.equal(requests.length, 2, 'expected two actual Gateway calls') },
    async close() { const closed = new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve())); server.closeAllConnections(); await closed },
  }
}

export function waitForAudit(child, timeoutMs = 30_000) {
  return new Promise((resolve, reject) => {
    let ready = false
    const finish = (error, value) => {
      clearTimeout(timer)
      child.off('message', onMessage)
      child.off('exit', onExit)
      child.off('error', onError)
      if (error) reject(error)
      else resolve(value)
    }
    const onError = error => finish(error)
    const onExit = (code, signal) => finish(new Error(`profile exited before smoke result (${code ?? signal})`))
    const onMessage = message => {
      try {
        if (message?.type === 'profile-smoke:ready') {
          assert.equal(ready, false, 'duplicate ready')
          ready = true
          child.send({ type: 'profile-smoke:trigger' }, error => { if (error) finish(error) })
        } else if (message?.type === 'profile-smoke:result') {
          assert.equal(ready, true, 'result before ready')
          assert.equal(message.ok, true, message.error ?? 'driver reported failure')
          assert.deepEqual(message.checks, { rounds: 2, consumerRemoved: true, providerRemoved: true, recreatedWithoutTools: true })
          finish(undefined, message.checks)
        }
      } catch (error) { finish(error) }
    }
    const timer = setTimeout(() => finish(new Error('profile smoke timed out waiting for ready/result')), timeoutMs)
    child.on('message', onMessage)
    child.on('exit', onExit)
    child.on('error', onError)
  })
}

export async function stopProfile(child, graceMs = 7_000, killMs = 2_000) {
  if (child.exitCode !== null || child.signalCode !== null) return
  const wait = ms => new Promise(resolve => {
    const done = () => { clearTimeout(timer); child.off('exit', done); resolve(true) }
    const timer = setTimeout(() => { child.off('exit', done); resolve(false) }, ms)
    child.once('exit', done)
  })
  const graceful = wait(graceMs)
  if (child.connected) child.send({ type: 'profile-smoke:stop' }, () => {})
  else child.kill('SIGTERM')
  if (await graceful) return
  const forced = wait(killMs)
  child.kill('SIGKILL')
  assert.ok(await forced, 'profile child did not exit after forced shutdown')
  throw new Error('profile child required forced shutdown')
}

export async function smokeInstalledProfile({ home, profileDir, cli, env, runCli, harnessVersion }) {
  const gateway = await startGateway()
  let child
  const failures = []
  try {
    const driver = join(profileDir, 'audit-driver')
    await mkdir(driver)
    await copyFile(new URL('./profile-smoke-driver.mjs', import.meta.url), join(driver, 'index.mjs'))
    await writeFile(join(driver, 'package.json'), JSON.stringify({ name: '@local/ragflow-profile-smoke', version: '1.0.0', private: true, type: 'module', exports: './index.mjs', peerDependencies: { '@nomix-ai/nomix-harness': harnessVersion }, devDependencies: { '@nomix-ai/nomix-harness': harnessVersion }, nomix: { bundle: { patch: './cordis.patch.yml' } } }))
    await writeFile(join(driver, 'cordis.patch.yml'), JSON.stringify([{ insert: [{ id: 'profile-smoke-driver', name: '@local/ragflow-profile-smoke' }] }]))
    runCli(['plugin', '--profile', 'ragflow-audit', 'add', driver])
    const patch = join(home, 'profile-smoke.patch.yml')
    await writeFile(patch, JSON.stringify(profileSmokePatches(home, gateway.url)))
    child = fork(cli, ['--profile', 'ragflow-audit', '--patch', patch], { cwd: profileDir, env: { ...env, PROFILE_SMOKE_DIRECTORY: profileDir, PROFILE_SMOKE_SERVICE_TOKEN: token, NOMIX_TELEMETRY_DISABLED: '1' }, stdio: ['ignore', 'inherit', 'inherit', 'ipc'] })
    await waitForAudit(child)
    gateway.assertComplete()
  } catch (error) { failures.push(error) }
  try { if (child) await stopProfile(child) } catch (error) { failures.push(error) }
  try { await gateway.close() } catch (error) { failures.push(error) }
  if (failures.length === 1) throw failures[0]
  if (failures.length) throw new AggregateError(failures, 'profile smoke/shutdown failed')
  assert.equal(child.exitCode, 0, 'profile CLI must exit successfully after smoke')
  assert.equal(child.signalCode, null, 'profile CLI must shut down without a forced signal')
}
