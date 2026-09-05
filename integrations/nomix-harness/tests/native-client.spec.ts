import { readFileSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import { once } from 'node:events'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { RagFlowBusinessClient } from '../src/client.js'

const servers: Server[] = []
async function listen(server: Server) {
  servers.push(server)
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Expected TCP address')
  return `http://127.0.0.1:${address.port}`
}
afterEach(async () => {
  vi.unstubAllGlobals()
  await Promise.all(servers.splice(0).map(server => new Promise<void>((resolve, reject) => {
    server.close(error => error ? reject(error) : resolve())
    server.closeAllConnections()
  })))
})
const client = () => new RagFlowBusinessClient({ baseURL: 'https://native.example/proxy', accessToken: 'synthetic-key' })

describe('native server SDK, separate from Knowledge Gateway', () => {
  it('maps every exposed method to an existing native Python route and never to the removed Gateway', async () => {
    const sources = ['dataset', 'document', 'chunk', 'chat', 'agent', 'memory', 'compilation_template_group'].map(name => readFileSync(new URL(`../../../api/apps/restful_apis/${name}_api.py`, import.meta.url), 'utf8')).join('\n')
    const routes = [...sources.matchAll(/@manager\.route\("([^"]+)", methods=\[([^\]]+)\]/gu)].flatMap(match => [...match[2]!.matchAll(/"([A-Z]+)"/gu)].map(method => ({ method: method[1], path: new RegExp(`^${match[1]!.replace(/<[^>]+>/gu, '[^/]+')}$`, 'u') })))
    const fetcher = vi.fn(async (url: URL, init: RequestInit) => {
      expect(url.origin).toBe('https://native.example')
      expect(url.pathname.startsWith('/proxy/api/v1/')).toBe(true)
      const path = url.pathname.slice('/proxy/api/v1'.length)
      expect(routes.some(route => route.method === init.method && route.path.test(path)), `${init.method} ${path}`).toBe(true)
      return path === '/datasets/d/documents/x' && init.method === 'GET'
        ? new Response('file', { headers: { 'content-disposition': 'attachment; filename="x"' } })
        : Response.json({ code: 0, data: {}, total: 9 })
    })
    vi.stubGlobal('fetch', fetcher)
    const c = client()
    await c.datasets.list(); await c.datasets.get('d'); await c.datasets.create({ name: 'name' }); await c.datasets.update('d', {}); await c.datasets.delete(['d'])
    await c.datasets.getMetadataConfig('d'); await c.datasets.updateMetadataConfig('d', {})
    await c.documents.list('d'); await c.documents.get('d', 'x'); await c.documents.upload('d', [{ body: new Blob(['file']), displayName: 'x' }]); await (await c.documents.download('d', 'x')).body?.cancel()
    await c.documents.update('d', 'x', {}); await c.documents.delete('d', ['x']); await c.documents.startParse('d', ['x']); await c.documents.stopParse('d', ['x'])
    await c.chunks.list('d', 'x'); await c.chunks.get('d', 'x', 'k'); await c.chunks.create('d', 'x', {}); await c.chunks.update('d', 'x', 'k', {}); await c.chunks.delete('d', 'x', ['k'])
    await c.retrieval.search({ dataset_ids: ['d'], question: 'question', toc_enhance: true }); await c.pageIndex.getStructure('d', 'x')
    for (const group of [c.chats, c.agents, c.templateGroups]) {
      await group.list(); await group.get('x'); await group.create({}); await group.update('x', {}); await group.delete('x')
    }
    for (const kind of ['chat', 'agent'] as const) {
      const target = { kind, ownerId: 'o' }
      await c.sessions.list(target); await c.sessions.get(target, 's'); await c.sessions.create(target, {}); await c.sessions.delete(target, ['s']); await c.sessions.invoke(target, { question: 'hello', stream: true })
      expect(JSON.parse(fetcher.mock.lastCall![1].body as string).stream).toBe(false)
    }
    await c.chats.batchDelete(['x']); await c.sessions.updateChat('o', 's', { name: 'updated' })
    await c.memories.list(); await c.memories.getConfig('m'); await c.memories.create({}); await c.memories.update('m', {}); await c.memories.delete('m')
    await c.memoryMessages.list('m'); await c.memoryMessages.create({ memory_id: ['m'], agent_id: 'a', session_id: 's', user_input: 'u', agent_response: 'r' })
    await c.memoryMessages.get('m', 'n'); await c.memoryMessages.setStatus('m', 'n', false); await c.memoryMessages.delete('m', 'n'); await c.memoryMessages.search({ query: 'q' }); await c.memoryMessages.recent({ limit: 1 })
    expect(fetcher).toHaveBeenCalledTimes(61)
  })

  it('preserves native envelopes, pagination, snake_case body and explicit deletion keys', async () => {
    const fetcher = vi.fn(async () => Response.json({ code: 0, data: [], total: 12 }))
    vi.stubGlobal('fetch', fetcher)
    const c = client()
    expect(await c.datasets.list({ page: 2, page_size: 5 })).toEqual({ code: 0, data: [], total: 12 })
    await c.documents.get('d', 'x')
    expect(String((fetcher.mock.calls as unknown as [URL, RequestInit][]).at(-1)![0])).toBe('https://native.example/proxy/api/v1/datasets/d/documents?id=x')
    await c.documents.startParse('d', ['x'])
    expect(JSON.parse((fetcher.mock.calls as unknown as [URL, RequestInit][]).at(-1)![1].body as string)).toEqual({ document_ids: ['x'] })
    await c.chunks.delete('d', 'x', ['k'])
    expect(JSON.parse((fetcher.mock.calls as unknown as [URL, RequestInit][]).at(-1)![1].body as string)).toEqual({ chunk_ids: ['k'], delete_all: false })
    expect(() => c.documents.delete('d', [])).toThrow()
    expect(() => c.datasets.delete(['d', 'd'])).toThrow()
    expect(() => c.documents.download('..', 'x')).toThrow()
  })

  it('sends real multipart files with refreshed native credentials, not business headers', async () => {
    const seen: string[] = []
    const origin = await listen(createServer(async (request, response) => {
      const data: Buffer[] = []
      for await (const part of request) data.push(Buffer.from(part))
      seen.push(request.headers.authorization!, Buffer.concat(data).toString())
      expect(request.headers['content-type']).toMatch(/^multipart\/form-data; boundary=/u)
      expect(request.headers['x-user-assertion']).toBeUndefined()
      expect(request.headers['idempotency-key']).toBeUndefined()
      response.end('{"code":0,"data":[]}')
    }))
    let token = 0
    const c = new RagFlowBusinessClient({ baseURL: origin, accessToken: async () => `synthetic-${++token}` })
    for (let i = 0; i < 2; i++) await c.documents.upload('d', [{ body: new Blob(['binary-content']), displayName: 'x.pdf' }])
    expect(seen[0]).toBe('Bearer synthetic-1'); expect(seen[2]).toBe('Bearer synthetic-2')
    expect(seen[1]).toContain('name="file"; filename="x.pdf"'); expect(seen[1]).toContain('binary-content')
  })

  it('streams binary and JSON attachments, but rejects HTTP-200 native download errors', async () => {
    const origin = await listen(createServer((request, response) => {
      if (request.url?.endsWith('/bad')) { response.setHeader('content-type', 'application/json'); response.end('{"code":102,"message":"private native URL"}'); return }
      response.setHeader('content-disposition', 'attachment; filename="file.json"')
      response.setHeader('content-type', 'application/json')
      response.end('{"binary":"file"}')
    }))
    const c = new RagFlowBusinessClient({ baseURL: origin, accessToken: 'synthetic', maxResponseBytes: 100 })
    expect(await (await c.documents.download('d', 'x')).text()).toBe('{"binary":"file"}')
    await expect(c.documents.download('d', 'bad')).rejects.toMatchObject({ code: 102, message: 'RAGFlow request failed (102).' })
  })

  it.each([
    ['{"code":102,"message":"secret"}', 200, 100, 102],
    ['not json', 200, 100, 'INVALID_JSON_RESPONSE'],
    ['{}', 200, 100, 'INVALID_API_RESPONSE'],
    ['{"code":0,"data":"large"}', 200, 10, 'RESPONSE_TOO_LARGE'],
    ['secret', 503, 100, 'HTTP_503'],
    ['secret', 302, 100, 'REDIRECT_REJECTED'],
  ])('fails safely without retries: %s', async (body, status, maxResponseBytes, code) => {
    const fetcher = vi.fn(async () => new Response(body as string, { status: status as number }))
    vi.stubGlobal('fetch', fetcher)
    const c = new RagFlowBusinessClient({ baseURL: 'https://native.example', accessToken: 'synthetic', maxResponseBytes: maxResponseBytes as number })
    await expect(c.datasets.create({ name: 'x' })).rejects.toMatchObject({ code })
    expect(fetcher).toHaveBeenCalledTimes(1)
  })

  it.each(['cancel', 'timeout'] as const)('keeps %s active while consuming a response body', async mode => {
    const controller = new AbortController()
    const origin = await listen(createServer((_request, response) => {
      response.writeHead(200, { 'content-type': 'application/json' })
      response.write('{"code":0,')
      if (mode === 'cancel') controller.abort()
    }))
    const c = new RagFlowBusinessClient({ baseURL: origin, accessToken: 'synthetic', timeoutMs: 100 })
    await expect(c.datasets.list({}, { signal: controller.signal })).rejects.toMatchObject({ code: mode === 'cancel' ? 'REQUEST_CANCELLED' : 'REQUEST_TIMEOUT' })
  })

  it('bounds credential resolution and does not send pre-cancelled requests', async () => {
    const fetcher = vi.fn()
    vi.stubGlobal('fetch', fetcher)
    const c = new RagFlowBusinessClient({ baseURL: 'https://native.example', accessToken: () => new Promise<string>(() => undefined), timeoutMs: 10 })
    await expect(c.datasets.list()).rejects.toMatchObject({ code: 'REQUEST_TIMEOUT' })
    await expect(c.datasets.list({}, { signal: AbortSignal.abort() })).rejects.toMatchObject({ code: 'REQUEST_CANCELLED' })
    expect(fetcher).not.toHaveBeenCalled()
  })
})
