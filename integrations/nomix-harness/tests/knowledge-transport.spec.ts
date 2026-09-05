import { createServer, type Server } from 'node:http'
import { once } from 'node:events'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { KnowledgeGatewayClient } from '../packages/dsh-knowledge-gateway/knowledge-client.js'

import { failure, success, pagination } from './knowledge-fixtures.js'

const identity = { serviceToken: 'synthetic-service-secret', userAssertion: 'synthetic-user-secret', sessionId: 'session-1', toolCallId: 'call-1', requestId: 'request-1' }
const servers: Server[] = []
async function listen(server: Server): Promise<string> {
  servers.push(server)
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Expected TCP server')
  return `http://127.0.0.1:${address.port}`
}
afterEach(async () => {
  vi.unstubAllGlobals()
  await Promise.all(servers.splice(0).map(server => new Promise<void>((resolve, reject) => {
    server.close(error => error ? reject(error) : resolve())
    server.closeAllConnections()
  })))
})

describe('trusted Gateway transport boundary', () => {
  it.each([200, 503])('retries a disconnected HTTP %i body once and returns the recovered read', async status => {
    let attempts = 0
    const origin = await listen(createServer((_request, response) => {
      if (++attempts === 2) { response.end(JSON.stringify(success({ items: [] }, pagination))); return }
      response.writeHead(status, { 'content-type': 'application/json' })
      response.write('{"data":')
      setTimeout(() => response.destroy(), 20)
    }))
    const client = new KnowledgeGatewayClient(origin, identity, 1000, 10000)
    await expect(client.listSpaces({})).resolves.toEqual({ items: [], pagination })
    expect(attempts).toBe(2)
  })

  it.each(['read', 'write', 'download'] as const)('bounds retries after body disconnection for %s', async kind => {
    let attempts = 0
    const origin = await listen(createServer((_request, response) => {
      attempts++
      response.writeHead(200, { 'content-type': 'application/json' })
      response.write('{"data":')
      setTimeout(() => response.destroy(), 20)
    }))
    const client = new KnowledgeGatewayClient(origin, identity, 1000, 10000)
    const result = kind === 'read' ? client.listSpaces({}) : kind === 'download' ? client.createDownloadLink('doc-1')
      : client.reindexDocument('doc-1', { expectedVersion: 0 }, { idempotencyKey: 'stable-test-key' })
    await expect(result).rejects.toMatchObject({ code: 'KNOWLEDGE_PROVIDER_UNAVAILABLE', retryable: kind === 'read' })
    expect(attempts).toBe(kind === 'read' ? 2 : 1)
  })

  it.each([200, 503])('reports HTTP %i body timeout as unavailable without resetting the budget', async status => {
    let attempts = 0
    let receivedHeaders = false
    const origin = await listen(createServer((_request, response) => {
      attempts++
      response.writeHead(status, { 'content-type': 'application/json' })
      response.write('{"data":')
    }))
    const fetch = globalThis.fetch
    vi.stubGlobal('fetch', async (...args: Parameters<typeof fetch>) => { const response = await fetch(...args); receivedHeaders = true; return response })
    const client = new KnowledgeGatewayClient(origin, identity, 250, 10000)
    await expect(client.listSpaces({})).rejects.toMatchObject({ code: 'KNOWLEDGE_PROVIDER_UNAVAILABLE', retryable: true })
    expect(receivedHeaders).toBe(true)
    expect(attempts).toBe(1)
  })

  it.each([200, 503])('does not retry a fully received malformed HTTP %i JSON body', async status => {
    let attempts = 0
    const origin = await listen(createServer((_request, response) => { attempts++; response.writeHead(status).end('{invalid') }))
    const client = new KnowledgeGatewayClient(origin, identity, 1000, 10000)
    await expect(client.listSpaces({})).rejects.toMatchObject({ code: 'KNOWLEDGE_GATEWAY_PROTOCOL_ERROR', retryable: false })
    expect(attempts).toBe(1)
  })

  it.each([200, 503])('preserves caller cancellation while reading an HTTP %i body', async status => {
    let attempts = 0
    const origin = await listen(createServer((_request, response) => {
      attempts++
      response.writeHead(status, { 'content-type': 'application/json' })
      response.write('{"data":')
    }))
    const controller = new AbortController()
    const fetch = globalThis.fetch
    vi.stubGlobal('fetch', async (...args: Parameters<typeof fetch>) => {
      const response = await fetch(...args)
      setImmediate(() => controller.abort())
      return response
    })
    const client = new KnowledgeGatewayClient(origin, identity, 1000, 10000)
    await expect(client.listSpaces({}, { signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' })
    expect(attempts).toBe(1)
  })

  it.each([null, { error: { code: '__proto__', retryable: false } }, { error: { code: 'constructor', retryable: false } }])('normalizes malformed and prototype-named remote errors', async body => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(body), { status: 403 })))
    const client = new KnowledgeGatewayClient('https://gateway.example', identity, 1000, 10000)
    await expect(client.listSpaces({})).rejects.toMatchObject({ code: 'KNOWLEDGE_GATEWAY_PROTOCOL_ERROR' })
  })

  it('does not discard prototype-named properties before closed-schema validation', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(success({ items: [] }, pagination)).replace('"items":[]', '"items":[],"__proto__":{"extra":true}'))))
    const client = new KnowledgeGatewayClient('https://gateway.example', identity, 1000, 10000)
    await expect(client.listSpaces({})).rejects.toMatchObject({ code: 'KNOWLEDGE_GATEWAY_PROTOCOL_ERROR' })
  })

  it('cancels an oversized declared response without consuming its body', async () => {
    const cancel = vi.fn()
    const body = new ReadableStream({ cancel })
    vi.stubGlobal('fetch', vi.fn(async () => new Response(body, { headers: { 'content-length': '10001' } })))
    const client = new KnowledgeGatewayClient('https://gateway.example', identity, 1000, 10000)
    await expect(client.listSpaces({})).rejects.toMatchObject({ code: 'KNOWLEDGE_PROVIDER_UNAVAILABLE' })
    expect(cancel).toHaveBeenCalledOnce()
  })

  it('never forwards either credential to a redirect target over real HTTP', async () => {
    const destination = vi.fn()
    const target = await listen(createServer((request, response) => { destination(request.headers); response.end('{}') }))
    const received = vi.fn()
    const origin = await listen(createServer((request, response) => {
      received(request.headers)
      response.writeHead(307, { location: `${target}/capture` }).end()
    }))
    const client = new KnowledgeGatewayClient(origin, identity, 1000, 10000)
    await expect(client.listSpaces({})).rejects.toMatchObject({ code: 'KNOWLEDGE_GATEWAY_PROTOCOL_ERROR', retryable: false })
    expect(received).toHaveBeenCalledOnce()
    expect(received.mock.calls[0]?.[0]).toMatchObject({ authorization: `Bearer ${identity.serviceToken}`, 'x-user-assertion': identity.userAssertion, 'x-harness-session-id': 'session-1', 'x-tool-call-id': 'call-1', 'x-request-id': 'request-1' })
    expect(destination).not.toHaveBeenCalled()
  })

  it.each(['serviceToken', 'userAssertion', 'sessionId', 'toolCallId', 'requestId'] as const)('rejects invalid %s before Headers can expose its value', async key => {
    const fetch = vi.fn()
    vi.stubGlobal('fetch', fetch)
    const client = new KnowledgeGatewayClient('https://gateway.example', { ...identity, [key]: 'synthetic-secret\n注入' }, 1000, 10000)
    const error = await client.listSpaces({}).catch(error => error)
    expect(error).toMatchObject({ code: 'KNOWLEDGE_UNAUTHENTICATED' })
    expect(String(error)).not.toContain('synthetic-secret')
    expect(fetch).not.toHaveBeenCalled()
  })

  it('does not retry link issuance even though download is read-visible and concurrent', async () => {
    const fetch = vi.fn(async () => new Response(JSON.stringify(failure('PROVIDER_TIMEOUT', true)), { status: 503 }))
    vi.stubGlobal('fetch', fetch)
    const client = new KnowledgeGatewayClient('https://gateway.example', identity, 1000, 10000)
    await expect(client.createDownloadLink('doc-1')).rejects.toMatchObject({ code: 'KNOWLEDGE_PROVIDER_UNAVAILABLE' })
    expect(fetch).toHaveBeenCalledOnce()
  })

  it('honors an explicit non-retryable Gateway failure', async () => {
    const fetch = vi.fn(async () => new Response(JSON.stringify(failure('SPACE_NOT_EMPTY')), { status: 503 }))
    vi.stubGlobal('fetch', fetch)
    const client = new KnowledgeGatewayClient('https://gateway.example', identity, 1000, 10000)
    await expect(client.listSpaces({})).rejects.toMatchObject({ code: 'KNOWLEDGE_CONFLICT', retryable: false })
    expect(fetch).toHaveBeenCalledOnce()
  })

  it('uses one cancellation budget across read attempts', async () => {
    const signals: AbortSignal[] = []
    vi.stubGlobal('fetch', vi.fn(async (_url, init) => {
      signals.push(init.signal)
      return new Response(JSON.stringify(failure('PROVIDER_TIMEOUT', true)), { status: 503 })
    }))
    const controller = new AbortController()
    const client = new KnowledgeGatewayClient('https://gateway.example', identity, 1000, 10000)
    await expect(client.listSpaces({}, { signal: controller.signal })).rejects.toMatchObject({ code: 'KNOWLEDGE_PROVIDER_UNAVAILABLE' })
    expect(signals).toHaveLength(2)
    expect(signals[0]).toBe(signals[1])
    controller.abort()
    expect(signals[0]?.aborted).toBe(true)
  })
})
