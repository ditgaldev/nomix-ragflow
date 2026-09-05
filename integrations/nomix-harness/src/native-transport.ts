import { RagFlowApiError } from './errors.js'
import type { NativeQuery, RagFlowResult, RequestOptions } from './types.js'

export interface RagFlowBusinessClientOptions {
  /** Native RAGFlow service root; a reverse-proxy path prefix is permitted. */
  baseURL: string
  /** Native RAGFlow API key, resolved for every HTTP request. Never a business user assertion. */
  accessToken: string | (() => string | Promise<string>)
  timeoutMs?: number
  /** Bounded JSON buffering; binary downloads remain streamed. */
  maxResponseBytes?: number
}

export function resourceId(value: string): string {
  if (typeof value !== 'string' || !value.trim() || value !== value.trim() || value === '.' || value === '..' || /[\p{Cc}/\\:]/u.test(value)) throw new TypeError('A nonempty resource ID without path separators or colons is required')
  return encodeURIComponent(value)
}

export function resourceIds(values: readonly string[]): string[] {
  if (!Array.isArray(values) || values.length === 0) throw new TypeError('At least one explicit resource ID is required')
  values.forEach(resourceId)
  if (new Set(values).size !== values.length) throw new TypeError('Resource IDs must be unique')
  return [...values]
}

async function abortable<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  signal.throwIfAborted()
  let cancel: () => void = () => undefined
  const aborted = new Promise<never>((_, reject) => { cancel = () => reject(signal.reason); signal.addEventListener('abort', cancel, { once: true }) })
  try { return await Promise.race([work, aborted]) } finally { signal.removeEventListener('abort', cancel) }
}

export class NativeTransport {
  private readonly root: URL
  private readonly timeoutMs: number
  private readonly maxBytes: number
  constructor(private readonly config: RagFlowBusinessClientOptions) {
    const root = new URL(config.baseURL)
    if (!['http:', 'https:'].includes(root.protocol) || root.username || root.password || root.search || root.hash) throw new TypeError('baseURL must be an HTTP(S) service root without credentials, query or fragment')
    if (/\/api\/v\d+\/?$/u.test(root.pathname)) throw new TypeError('baseURL must not include /api/v1')
    root.pathname = `${root.pathname.replace(/\/+$/u, '')}/api/v1/`
    this.root = root
    this.timeoutMs = config.timeoutMs ?? 60_000
    this.maxBytes = config.maxResponseBytes ?? 16 * 1024 * 1024
    if (!Number.isSafeInteger(this.timeoutMs) || this.timeoutMs < 1 || this.timeoutMs > 300_000) throw new TypeError('timeoutMs must be 1–300000')
    if (!Number.isSafeInteger(this.maxBytes) || this.maxBytes < 1 || this.maxBytes > 64 * 1024 * 1024) throw new TypeError('maxResponseBytes must be 1–67108864')
    if (typeof config.accessToken !== 'function' && (typeof config.accessToken !== 'string' || !config.accessToken.trim())) throw new TypeError('accessToken is required')
  }

  async json<T>(method: string, path: string, body?: unknown, query?: NativeQuery, options?: RequestOptions): Promise<RagFlowResult<T>> {
    const response = await this.raw(method, path, body, query, options)
    return this.envelope<T>(response)
  }

  async download(path: string, options?: RequestOptions): Promise<Response> {
    const response = await this.raw('GET', path, undefined, undefined, options)
    // Native error envelopes can have HTTP 200. JSON documents are legitimate
    // attachments, so Content-Type alone must not classify a file as an error.
    if (/\battachment\b/iu.test(response.headers.get('content-disposition') ?? '')) return response
    if ((response.headers.get('content-type') ?? '').includes('json')) {
      await this.envelope(response)
      throw new RagFlowApiError('INVALID_DOWNLOAD_RESPONSE', response.status)
    }
    await response.body?.cancel()
    throw new RagFlowApiError('INVALID_DOWNLOAD_RESPONSE', response.status)
  }

  private async envelope<T>(response: Response): Promise<RagFlowResult<T>> {
    const reader = response.body?.getReader()
    let value: unknown
    let size = 0
    const decoder = new TextDecoder('utf-8', { fatal: true })
    let text = ''
    try {
      if (reader) while (true) {
        const part = await reader.read()
        if (part.done) break
        size += part.value.byteLength
        if (size > this.maxBytes) throw new RagFlowApiError('RESPONSE_TOO_LARGE', response.status)
        text += decoder.decode(part.value, { stream: true })
      }
      value = JSON.parse(text + decoder.decode())
    } catch (error) {
      await reader?.cancel().catch(() => undefined)
      if (error instanceof RagFlowApiError) throw error
      throw new RagFlowApiError('INVALID_JSON_RESPONSE', response.status)
    } finally { reader?.releaseLock() }
    if (!value || typeof value !== 'object' || Array.isArray(value) || !Number.isSafeInteger((value as { code?: unknown }).code)) throw new RagFlowApiError('INVALID_API_RESPONSE', response.status)
    const code = (value as { code: number }).code
    if (code !== 0) throw new RagFlowApiError(code, response.status)
    return value as RagFlowResult<T>
  }

  private async raw(method: string, path: string, body?: unknown, query?: NativeQuery, options: RequestOptions = {}): Promise<Response> {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), this.timeoutMs)
    const signal = AbortSignal.any([controller.signal, ...(options.signal ? [options.signal] : [])])
    const failure = () => new RagFlowApiError(options.signal?.aborted ? 'REQUEST_CANCELLED' : controller.signal.aborted ? 'REQUEST_TIMEOUT' : 'REQUEST_FAILED')
    let response: Response
    try {
      signal.throwIfAborted()
      const key = await abortable(Promise.resolve(typeof this.config.accessToken === 'function' ? this.config.accessToken() : this.config.accessToken), signal)
      if (typeof key !== 'string' || !/^[\x21-\x7e]+$/u.test(key.trim())) throw new RagFlowApiError('ACCESS_TOKEN_UNAVAILABLE')
      const url = new URL(path, this.root)
      if (query) for (const [name, value] of Object.entries(query)) {
        if (value === undefined) continue
        if (Array.isArray(value)) for (const item of value) url.searchParams.append(name, item)
        else url.searchParams.set(name, String(value))
      }
      const headers = new Headers({ authorization: `Bearer ${key.trim()}`, accept: 'application/json' })
      const multipart = body instanceof FormData
      if (body !== undefined && !multipart) headers.set('content-type', 'application/json')
      response = await fetch(url, { method, headers, signal, redirect: 'manual', ...(body === undefined ? {} : { body: multipart ? body : JSON.stringify(body) }) })
      if (!response.ok) {
        await response.body?.cancel()
        throw new RagFlowApiError(response.status >= 300 && response.status < 400 ? 'REDIRECT_REJECTED' : `HTTP_${response.status}`, response.status)
      }
    } catch (error) {
      clearTimeout(timer)
      if (error instanceof RagFlowApiError) throw error
      throw failure()
    }
    if (!response.body) { clearTimeout(timer); return response }
    const reader = response.body.getReader()
    let finished = false
    const finish = () => { if (!finished) { finished = true; clearTimeout(timer); reader.releaseLock() } }
    // Keep the same deadline/cancellation active until the body is consumed or
    // cancelled, including streamed file downloads. Never retry side effects.
    const stream = new ReadableStream<Uint8Array>({
      async pull(out) {
        try {
          const part = await reader.read()
          if (part.done) { finish(); out.close() } else out.enqueue(part.value)
        } catch { finish(); out.error(failure()) }
      },
      async cancel(reason) { try { await reader.cancel(reason) } finally { finish() } },
    })
    return new Response(stream, { status: response.status, statusText: response.statusText, headers: response.headers })
  }
}
