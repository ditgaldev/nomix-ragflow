import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { BusinessGatewayError, RagFlowBusinessClient } from '../src/client.js'

interface Seen {
  method: string
  url: string
  authorization?: string
  callSource?: string
  idempotencyKey?: string
  ifMatch?: string
  body: unknown
}

describe('RagFlowBusinessClient contracts', () => {
  let baseURL = ''
  let close: (() => Promise<void>) | undefined
  const seen: Seen[] = []
  let responder: (request: IncomingMessage, response: ServerResponse) => void | Promise<void>

  beforeEach(async () => {
    seen.length = 0
    responder = async (request, response) => {
      const chunks: Buffer[] = []
      for await (const chunk of request) chunks.push(chunk)
      const text = Buffer.concat(chunks).toString()
      seen.push({
        method: request.method ?? '',
        url: request.url ?? '',
        ...(request.headers.authorization === undefined ? {} : { authorization: request.headers.authorization }),
        ...(request.headers['x-nomix-call-source'] === undefined ? {} : { callSource: String(request.headers['x-nomix-call-source']) }),
        ...(request.headers['idempotency-key'] === undefined ? {} : { idempotencyKey: String(request.headers['idempotency-key']) }),
        ...(request.headers['if-match'] === undefined ? {} : { ifMatch: String(request.headers['if-match']) }),
        body: text === '' ? undefined : JSON.parse(text),
      })
      response.setHeader('content-type', 'application/json')
      const url = request.url ?? ''
      let data: unknown = []
      if (request.method === 'POST' && url === '/api/v1/datasets') {
        data = { id: 'dataset-1', version: 1, name: 'docs' }
      } else if (request.method === 'PATCH' && url.startsWith('/api/v1/datasets/')) {
        data = { id: 'dataset-1', version: 8, name: 'new' }
      } else if (url.endsWith(':parse') || url.endsWith(':cancel-parse') || url.endsWith(':batch-delete') || request.method === 'DELETE' || url.includes('/messages/')) {
        data = { successCount: 1 }
      } else if (url.endsWith(':invoke')) {
        data = { content: 'answer', role: 'assistant', sessionId: 's' }
      } else if (url === '/api/v1/retrieval') {
        data = { chunks: [], total: 0, docAggs: {} }
      }
      response.end(JSON.stringify({ data, meta: { requestId: 'request-1' } }))
    }
    const server = createServer((request, response) => { void responder(request, response) })
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    const address = server.address()
    if (address === null || typeof address === 'string') throw new Error('fixture did not bind TCP')
    baseURL = `http://127.0.0.1:${address.port}`
    close = () => new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
  })

  afterEach(async () => close?.())

  it.each([
    ['datasets list', async (client: RagFlowBusinessClient) => client.datasets.list({ cursor: 'next', limit: 7, ids: ['a', 'b'] }), 'GET', '/api/v1/datasets?cursor=next&limit=7&ids=a&ids=b', undefined, undefined, undefined],
    ['dataset create', async (client: RagFlowBusinessClient) => client.datasets.create({ name: 'docs', embeddingModel: 'BAAI/bge' }, { idempotencyKey: 'create-1' }), 'POST', '/api/v1/datasets', { name: 'docs', embeddingModel: 'BAAI/bge' }, 'create-1', undefined],
    ['dataset update', async (client: RagFlowBusinessClient) => client.datasets.update('dataset', { name: 'new' }, { version: 7 }), 'PATCH', '/api/v1/datasets/dataset', { name: 'new' }, undefined, '7'],
    ['document parse', async (client: RagFlowBusinessClient) => client.documents.startParse('d s', ['one'], { idempotencyKey: 'parse-1' }), 'POST', '/api/v1/datasets/d%20s/documents:parse', { documentIds: ['one'] }, 'parse-1', undefined],
    ['document stop', async (client: RagFlowBusinessClient) => client.documents.cancelParse('d s', ['one'], { idempotencyKey: 'stop-1' }), 'POST', '/api/v1/datasets/d%20s/documents:cancel-parse', { documentIds: ['one'] }, 'stop-1', undefined],
    ['chunk batch delete', async (client: RagFlowBusinessClient) => client.chunks.batchDelete('d', 'doc', ['chunk'], { idempotencyKey: 'chunks-1' }), 'POST', '/api/v1/datasets/d/documents/doc/chunks:batch-delete', { ids: ['chunk'] }, 'chunks-1', undefined],
    ['chat sessions', async (client: RagFlowBusinessClient) => client.sessions.list({ kind: 'chat', ownerId: 'c', cursor: 'cursor-3' }), 'GET', '/api/v1/chats/c/sessions?cursor=cursor-3', undefined, undefined, undefined],
    ['chat session invoke', async (client: RagFlowBusinessClient) => client.sessions.invoke({ kind: 'chat', ownerId: 'c', sessionId: 's', question: 'hello', inputs: { locale: 'zh-CN' } }, { idempotencyKey: 'invoke-1' }), 'POST', '/api/v1/chats/c/sessions/s:invoke', { question: 'hello', inputs: { locale: 'zh-CN' }, stream: false }, 'invoke-1', undefined],
    ['agent delete', async (client: RagFlowBusinessClient) => client.agents.delete('agent', { version: 8 }), 'DELETE', '/api/v1/agents/agent', {}, undefined, '8'],
    ['memory status', async (client: RagFlowBusinessClient) => client.memoryMessages.update('mem', 8, { status: true }, { version: 9 }), 'PATCH', '/api/v1/memories/mem/messages/8', { status: true }, undefined, '9'],
    ['retrieval', async (client: RagFlowBusinessClient) => client.retrieval.search({ datasetIds: ['d'], question: 'q' }), 'POST', '/api/v1/retrieval', { question: 'q', datasetIds: ['d'] }, undefined, undefined],
  ])('%s maps to the Business Gateway contract', async (_label, invoke, method, url, body, idempotencyKey, ifMatch) => {
    const client = new RagFlowBusinessClient({ baseURL, accessToken: 'business-token' })
    await invoke(client)
    expect(seen).toEqual([{
      method,
      url,
      authorization: 'Bearer business-token',
      callSource: 'rest',
      ...(idempotencyKey === undefined ? {} : { idempotencyKey }),
      ...(ifMatch === undefined ? {} : { ifMatch }),
      body,
    }])
  })

  it('parses the stable error envelope and redacts the current token', async () => {
    responder = (_request, response) => {
      response.statusCode = 403
      response.setHeader('content-type', 'application/json')
      response.end(JSON.stringify({
        error: {
          code: 'ACTION_NOT_ALLOWED',
          message: 'denied never-print-this',
          requestId: 'request-denied',
          details: { upstream: 'never-print-this' },
          retryable: false,
        },
      }))
    }
    const client = new RagFlowBusinessClient({ baseURL, accessToken: 'never-print-this' })
    const error: unknown = await client.datasets.list().catch((value: unknown) => value)
    expect(error).toBeInstanceOf(BusinessGatewayError)
    expect(error).toMatchObject({ code: 'ACTION_NOT_ALLOWED', status: 403, requestId: 'request-denied', retryable: false })
    expect(JSON.stringify(error)).not.toContain('never-print-this')
    expect(String(error)).not.toContain('never-print-this')
  })

  it('rejects declared and streamed responses above the bounded client limit before schema validation', async () => {
    responder = (_request, response) => {
      response.setHeader('content-type', 'application/json')
      response.setHeader('content-length', '2048')
      response.end('{}')
    }
    const declared = new RagFlowBusinessClient({ baseURL, accessToken: 'token', maxResponseBytes: 1024 })
    await expect(declared.datasets.list()).rejects.toMatchObject({ code: 'RESPONSE_TOO_LARGE', status: 502, retryable: false })

    responder = (_request, response) => {
      response.setHeader('content-type', 'application/json')
      response.write('{"data":[],"meta":{"requestId":"large"},"padding":"')
      response.end(`${'x'.repeat(2048)}"}`)
    }
    const streamed = new RagFlowBusinessClient({ baseURL, accessToken: 'token', maxResponseBytes: 4096 })
    await expect(streamed.datasets.list({}, { maxResponseBytes: 512 })).rejects.toMatchObject({ code: 'RESPONSE_TOO_LARGE', status: 502 })
  })

  it('bounds error bodies independently and falls back to a generic redacted error', async () => {
    responder = (_request, response) => {
      response.statusCode = 503
      response.setHeader('content-type', 'application/json')
      response.end(JSON.stringify({
        error: {
          code: 'UPSTREAM_DETAIL',
          message: 'x'.repeat(70 * 1024),
          requestId: 'oversized-error',
          retryable: true,
        },
      }))
    }
    const client = new RagFlowBusinessClient({ baseURL, accessToken: 'token' })
    await expect(client.datasets.list()).rejects.toMatchObject({ code: 'AUTH_SERVICE_UNAVAILABLE', status: 503, retryable: true })
  })

  it('resolves the business token for every request so rotation needs no reload', async () => {
    let accessToken = 'first-token'
    const client = new RagFlowBusinessClient({ baseURL, accessToken: async () => accessToken })
    await client.datasets.list()
    accessToken = 'second-token'
    await client.datasets.list()
    expect(seen.map(call => call.authorization)).toEqual(['Bearer first-token', 'Bearer second-token'])
  })

  it('does not retain credential-provider error text that may contain a token', async () => {
    const client = new RagFlowBusinessClient({
      baseURL,
      accessToken: async () => { throw new Error('credential provider echoed super-secret-token') },
    })
    const error = await client.datasets.list().catch(value => value) as Error & { cause?: unknown }
    expect(error).toMatchObject({ code: 'ACCESS_TOKEN_UNAVAILABLE' })
    expect(`${error.message} ${String(error.cause)} ${JSON.stringify(error)}`).not.toContain('super-secret-token')
  })

  it('exposes the verified Gateway context through the same REST client', async () => {
    let contextRequest: Pick<Seen, 'method' | 'url' | 'callSource'> | undefined
    responder = (request, response) => {
      contextRequest = {
        method: request.method ?? '',
        url: request.url ?? '',
        callSource: String(request.headers['x-nomix-call-source']),
      }
      response.setHeader('content-type', 'application/json')
      response.end(JSON.stringify({
        data: {
          subject: 'subject-a', actorSubject: 'actor-a', onBehalfOfSubject: null,
          workspaceId: 'workspace-a', actions: ['authorization:read'],
          datasetScope: { mode: 'ids', ids: ['dataset-a'] }, documentScope: { mode: 'inherit' },
          chatScope: { mode: 'ids', ids: ['chat-a'] }, agentScope: { mode: 'ids', ids: ['agent-a'] },
          memoryScope: { mode: 'ids', ids: ['memory-a'] },
          permissionRef: 'permission-a', authenticationType: 'token-introspection', requestId: 'request-context',
          tokenUse: 'data', audience: ['nomix-ragflow-data'], expiresAt: '2026-08-29T00:00:00Z', clientId: 'crm',
        },
        meta: { requestId: 'request-context' },
      }))
    }
    const client = new RagFlowBusinessClient({ baseURL, accessToken: 'token' })
    await expect(client.authorization.getContext()).resolves.toMatchObject({
      subject: 'subject-a', workspaceId: 'workspace-a', datasetScope: { ids: ['dataset-a'] },
    })
    expect(contextRequest).toMatchObject({ method: 'GET', url: '/api/v1/gateway-context', callSource: 'rest' })
  })

  it('marks Agent calls for audit without opening a trusted-header surface', async () => {
    const client = new RagFlowBusinessClient({ baseURL, accessToken: 'token', source: 'agent' })
    await client.datasets.list()
    expect(seen[0]).toMatchObject({ authorization: 'Bearer token', callSource: 'agent' })
  })

  it('retains pagination metadata for lists and retrieval', async () => {
    responder = (_request, response) => {
      response.setHeader('content-type', 'application/json')
      response.end(JSON.stringify({
        data: [{ id: 'dataset-a', version: 3, name: 'A' }],
        meta: { requestId: 'request-page', limit: 1, hasNext: true, nextCursor: 'opaque-next' },
      }))
    }
    const client = new RagFlowBusinessClient({ baseURL, accessToken: 'token' })
    await expect(client.datasets.list({ limit: 1 })).resolves.toEqual({
      data: [{ id: 'dataset-a', version: 3, name: 'A' }],
      meta: { requestId: 'request-page', limit: 1, hasNext: true, nextCursor: 'opaque-next' },
    })
  })

  it('rejects operation-specific response drift instead of guessing wrappers or invoke fields', async () => {
    responder = (request, response) => {
      response.setHeader('content-type', 'application/json')
      const data = request.url?.endsWith(':invoke')
        ? { answer: 'legacy nested answer' }
        : { datasets: [{ id: 'dataset-a', name: 'missing-version' }] }
      response.end(JSON.stringify({ data, meta: { requestId: 'response-drift' } }))
    }
    const client = new RagFlowBusinessClient({ baseURL, accessToken: 'token' })
    await expect(client.datasets.list()).rejects.toMatchObject({ code: 'INVALID_GATEWAY_RESPONSE' })
    await expect(client.sessions.invoke({
      kind: 'chat', ownerId: 'chat-a', sessionId: 'session-a', question: 'hello',
    }, { idempotencyKey: 'invoke-drift' })).rejects.toMatchObject({ code: 'INVALID_GATEWAY_RESPONSE' })
  })

  it('does not share credentials between concurrent clients', async () => {
    const left = new RagFlowBusinessClient({ baseURL, accessToken: async () => 'left-token' })
    const right = new RagFlowBusinessClient({ baseURL, accessToken: async () => 'right-token' })
    await Promise.all([left.datasets.list(), right.datasets.list()])
    expect(seen.map(call => call.authorization).sort()).toEqual(['Bearer left-token', 'Bearer right-token'])
  })

  it('requires explicit idempotency keys for required writes', async () => {
    const client = new RagFlowBusinessClient({ baseURL, accessToken: 'token' })
    await expect(client.datasets.create({ name: 'docs' }, {})).rejects.toMatchObject({ code: 'IDEMPOTENCY_KEY_REQUIRED' })
    expect(seen).toHaveLength(0)
  })

  it('supports caller cancellation', async () => {
    responder = () => undefined
    const client = new RagFlowBusinessClient({ baseURL, accessToken: 'token', timeoutMs: 5_000 })
    const controller = new AbortController()
    const pending = client.datasets.list({}, { signal: controller.signal })
    controller.abort(new Error('stop'))
    await expect(pending).rejects.toBeInstanceOf(BusinessGatewayError)
  })

  it('enforces the configured timeout', async () => {
    responder = () => undefined
    const client = new RagFlowBusinessClient({ baseURL, accessToken: 'token', timeoutMs: 10 })
    await expect(client.datasets.list()).rejects.toMatchObject({ code: 'REQUEST_TIMEOUT' })
  })

  it('keeps the timeout active while consuming a response body', async () => {
    responder = (_request, response) => {
      response.setHeader('content-type', 'application/json')
      response.write('{"data":')
    }
    const client = new RagFlowBusinessClient({ baseURL, accessToken: 'token', timeoutMs: 20 })
    await expect(client.datasets.list()).rejects.toMatchObject({ code: 'REQUEST_TIMEOUT', retryable: true })
  })

  it('normalizes caller cancellation while consuming a response body', async () => {
    let bodyStarted!: () => void
    const started = new Promise<void>(resolve => { bodyStarted = resolve })
    responder = (_request, response) => {
      response.setHeader('content-type', 'application/json')
      response.write('{"data":')
      bodyStarted()
    }
    const controller = new AbortController()
    const client = new RagFlowBusinessClient({ baseURL, accessToken: 'token', timeoutMs: 5_000 })
    const pending = client.datasets.list({}, { signal: controller.signal })
    await started
    controller.abort(new Error('stop body consumption'))
    await expect(pending).rejects.toMatchObject({ code: 'REQUEST_CANCELLED', retryable: false })
  })

  it('keeps timeout and cancellation active for raw download streams', async () => {
    responder = (_request, response) => {
      response.setHeader('content-type', 'application/octet-stream')
      response.write(new Uint8Array([1]))
    }
    const timed = new RagFlowBusinessClient({ baseURL, accessToken: 'token', timeoutMs: 20 })
    const timedResponse = await timed.documents.download('dataset-1', 'document-1')
    await expect(timedResponse.arrayBuffer()).rejects.toMatchObject({ code: 'REQUEST_TIMEOUT', retryable: true })

    let bodyStarted!: () => void
    const started = new Promise<void>(resolve => { bodyStarted = resolve })
    responder = (_request, response) => {
      response.setHeader('content-type', 'application/octet-stream')
      response.write(new Uint8Array([1]))
      bodyStarted()
    }
    const controller = new AbortController()
    const cancelled = new RagFlowBusinessClient({ baseURL, accessToken: 'token', timeoutMs: 5_000 })
    const cancelledResponse = await cancelled.documents.download('dataset-1', 'document-1', { signal: controller.signal })
    const body = cancelledResponse.arrayBuffer()
    await started
    controller.abort(new Error('stop download'))
    await expect(body).rejects.toMatchObject({ code: 'REQUEST_CANCELLED', retryable: false })
  })

  it('classifies fallback HTTP errors and exposes Retry-After without guessing retryability', async () => {
    responder = (_request, response) => {
      response.statusCode = 429
      response.setHeader('content-type', 'text/plain')
      response.setHeader('retry-after', '2')
      response.end('busy')
    }
    const client = new RagFlowBusinessClient({ baseURL, accessToken: 'token' })
    await expect(client.datasets.list()).rejects.toMatchObject({
      code: 'RATE_LIMITED',
      status: 429,
      retryable: true,
      retryAfterMs: 2_000,
    })
  })

  it('respects an explicit non-retryable Gateway classification', async () => {
    responder = (_request, response) => {
      response.statusCode = 503
      response.setHeader('content-type', 'application/json')
      response.end(JSON.stringify({
        error: {
          code: 'WORKSPACE_MAPPING_DISABLED',
          message: 'mapping disabled',
          requestId: 'request-disabled',
          retryable: false,
        },
      }))
    }
    const client = new RagFlowBusinessClient({ baseURL, accessToken: 'token' })
    await expect(client.datasets.list()).rejects.toMatchObject({
      code: 'WORKSPACE_MAPPING_DISABLED',
      status: 503,
      retryable: false,
    })
  })

  it('applies timeout and cancellation while resolving a rotating token', async () => {
    const never = () => new Promise<string>(() => undefined)
    const timed = new RagFlowBusinessClient({ baseURL, accessToken: never, timeoutMs: 10 })
    await expect(timed.datasets.list()).rejects.toMatchObject({ code: 'REQUEST_TIMEOUT' })

    const controller = new AbortController()
    const cancelled = new RagFlowBusinessClient({ baseURL, accessToken: never, timeoutMs: 5_000 })
    const pending = cancelled.datasets.list({}, { signal: controller.signal })
    controller.abort(new Error('stop token resolution'))
    await expect(pending).rejects.toMatchObject({ code: 'REQUEST_CANCELLED' })
    expect(seen).toHaveLength(0)
  })

  it('accepts only a dedicated service root', () => {
    expect(() => new RagFlowBusinessClient({ baseURL: 'https://gateway.example.com/api/v1', accessToken: 'token' })).toThrow(/service root/)
    expect(() => new RagFlowBusinessClient({ baseURL: 'https://user:pass@gateway.example.com', accessToken: 'token' })).toThrow(/credentials/)
    expect(() => new RagFlowBusinessClient({ baseURL: 'http://gateway.example.com', accessToken: 'token' })).toThrow(/HTTPS/)
    expect(() => new RagFlowBusinessClient({ baseURL: 'https://gateway.example.com', accessToken: 'token', timeoutMs: 300_001 })).toThrow(/300000/)
    expect(() => new RagFlowBusinessClient({ baseURL: 'https://gateway.example.com', accessToken: 'token', maxResponseBytes: 64 * 1024 * 1024 + 1 })).toThrow(/must not exceed/)
    expect(() => new RagFlowBusinessClient({ baseURL: 'https://gateway.example.com', accessToken: 'token', source: 'browser' as never })).toThrow(/source/)
  })

  it('rejects malformed business tokens before the network boundary', async () => {
    const client = new RagFlowBusinessClient({ baseURL, accessToken: 'not a token' })
    await expect(client.datasets.list()).rejects.toMatchObject({ code: 'ACCESS_TOKEN_UNAVAILABLE', status: 401 })
    expect(seen).toHaveLength(0)
  })

  it('keeps the public request options and trusted-header surface closed', async () => {
    const client = new RagFlowBusinessClient({ baseURL, accessToken: 'token' })
    await client.datasets.list({}, { idempotencyKey: 'caller-key' })
    expect(seen[0]).toMatchObject({ idempotencyKey: 'caller-key' })
    expect(seen[0]).toMatchObject({ callSource: 'rest' })
    expect(Object.keys({ signal: undefined, idempotencyKey: undefined, version: undefined, maxResponseBytes: undefined })).not.toContain('headers')
  })
})
