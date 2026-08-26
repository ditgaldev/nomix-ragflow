import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { RagFlowApiError, RagFlowClient } from '../src/client.js'

interface Seen {
  method: string
  url: string
  authorization?: string
  body: unknown
}

describe('RagFlowClient contracts', () => {
  let baseURL = ''
  let close: (() => Promise<void>) | undefined
  const seen: Seen[] = []
  let responder: (request: IncomingMessage, response: ServerResponse) => void

  beforeEach(async () => {
    seen.length = 0
    responder = async (request, response) => {
      const chunks: Buffer[] = []
      for await (const chunk of request) chunks.push(chunk)
      const text = Buffer.concat(chunks).toString()
      seen.push({
        method: request.method ?? '', url: request.url ?? '',
        ...(request.headers.authorization === undefined ? {} : { authorization: request.headers.authorization }),
        body: text === '' ? undefined : JSON.parse(text),
      })
      response.setHeader('content-type', 'application/json')
      response.end(JSON.stringify({ code: 0, data: [] }))
    }
    const server = createServer((request, response) => responder(request, response))
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    const address = server.address()
    if (address === null || typeof address === 'string') throw new Error('fixture did not bind TCP')
    baseURL = `http://127.0.0.1:${address.port}`
    close = () => new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
  })

  afterEach(async () => close?.())

  it.each([
    ['datasets list', async (client: RagFlowClient) => client.datasets.list({ page: 2, pageSize: 7, ids: ['a', 'b'] }), 'GET', '/api/v1/datasets?page=2&page_size=7&ids=a&ids=b', undefined],
    ['dataset create', async (client: RagFlowClient) => client.datasets.create({ name: 'docs', embeddingModel: 'BAAI/bge' }), 'POST', '/api/v1/datasets', { name: 'docs', embedding_model: 'BAAI/bge', permission: 'me', chunk_method: 'naive' }],
    ['document parse', async (client: RagFlowClient) => client.documents.startParse('d s', ['one']), 'POST', '/api/v1/datasets/d%20s/documents/parse', { document_ids: ['one'] }],
    ['document stop', async (client: RagFlowClient) => client.documents.cancelParse('d s', ['one']), 'POST', '/api/v1/datasets/d%20s/documents/stop', { document_ids: ['one'] }],
    ['chunk delete all', async (client: RagFlowClient) => client.chunks.delete('d', 'doc', undefined, true), 'DELETE', '/api/v1/datasets/d/documents/doc/chunks', { chunk_ids: null, delete_all: true }],
    ['chat sessions', async (client: RagFlowClient) => client.sessions.list({ kind: 'chat', ownerId: 'c', page: 3 }), 'GET', '/api/v1/chats/c/sessions?page=3', undefined],
    ['agent delete', async (client: RagFlowClient) => client.agents.delete('agent'), 'DELETE', '/api/v1/agents/agent', {}],
    ['memory status', async (client: RagFlowClient) => client.memories.updateMessageStatus('mem', 8, true), 'PUT', '/api/v1/messages/mem:8', { status: true }],
    ['retrieval', async (client: RagFlowClient) => client.retrieval.search({ datasetIds: ['d'], question: 'q' }), 'POST', '/api/v1/retrieval', { dataset_ids: ['d'], document_ids: [], question: 'q', page: 1, page_size: 30, similarity_threshold: 0.2, vector_similarity_weight: 0.3, top_k: 1024, keyword: false, use_kg: false, toc_enhance: false }],
  ])('%s maps the public SDK call', async (_label, invoke, method, url, body) => {
    const client = new RagFlowClient({ baseURL, apiKey: 'super-secret' })
    await invoke(client)
    expect(seen).toEqual([{ method, url, authorization: 'Bearer super-secret', body }])
  })

  it('validates envelopes and never exposes the API key', async () => {
    responder = (_request, response) => {
      response.setHeader('content-type', 'application/json')
      response.end(JSON.stringify({ code: 102, message: 'denied never-print-this', data: null }))
    }
    const client = new RagFlowClient({ baseURL, apiKey: 'never-print-this' })
    const error = await client.datasets.list().catch(value => value)
    expect(error).toBeInstanceOf(RagFlowApiError)
    expect(String(error)).toContain('denied')
    expect(String(error)).not.toContain('never-print-this')
  })

  it('resolves the API key for every request', async () => {
    let apiKey = 'first-key'
    const client = new RagFlowClient({ baseURL, apiKey: async () => apiKey })
    await client.datasets.list()
    apiKey = 'second-key'
    await client.datasets.list()
    expect(seen.map(call => call.authorization)).toEqual(['Bearer first-key', 'Bearer second-key'])
  })

  it('supports caller cancellation', async () => {
    responder = () => undefined
    const client = new RagFlowClient({ baseURL, apiKey: 'key', timeoutMs: 5_000 })
    const controller = new AbortController()
    const pending = client.datasets.list({}, { signal: controller.signal })
    controller.abort(new Error('stop'))
    await expect(pending).rejects.toBeInstanceOf(RagFlowApiError)
  })

  it('enforces the configured timeout', async () => {
    responder = () => undefined
    const client = new RagFlowClient({ baseURL, apiKey: 'key', timeoutMs: 10 })
    await expect(client.datasets.list()).rejects.toBeInstanceOf(RagFlowApiError)
  })

  it('maps chat SSE messages and stops at DONE', async () => {
    responder = async (request, response) => {
      const chunks: Buffer[] = []
      for await (const chunk of request) chunks.push(chunk)
      seen.push({ method: request.method ?? '', url: request.url ?? '', body: JSON.parse(Buffer.concat(chunks).toString()) })
      response.writeHead(200, { 'content-type': 'text/event-stream' })
      response.write('data: {"code":0,"data":{"answer":"hello","reference":[]}}\n\n')
      response.end('data: [DONE]\n\n')
    }
    const client = new RagFlowClient({ baseURL, apiKey: 'key' })
    const messages = []
    for await (const message of client.sessions.askStream({ kind: 'chat', ownerId: 'chat', sessionId: 'session', question: 'hi' })) messages.push(message)
    expect(messages).toEqual([{ role: 'assistant', content: 'hello', reference: [] }])
    expect(seen[0]?.body).toEqual({ question: 'hi', stream: true, session_id: 'session' })
  })
})
