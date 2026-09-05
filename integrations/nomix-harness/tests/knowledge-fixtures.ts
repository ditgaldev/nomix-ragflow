import type { KnowledgeDocumentDetail, DocumentVersionDetail } from '../packages/dsh-knowledge/knowledge-openapi.generated.js'

export const metadata = { category: null, tags: [], versionLabel: null, productCode: null }
export const pagination = { page: 1, pageSize: 20, totalItems: 0, totalPages: 0, hasNext: false }
export const meta = { success: true, requestId: 'business-request-1', traceId: 'gateway-trace-1', timestamp: '2026-09-05T00:00:00Z', apiVersion: 'v1', pagination: null, error: null }
export function success(data: unknown, page?: typeof pagination) { return { data, meta: { ...meta, pagination: page ?? null } } }
export function failure(code: string, retryable = false) {
  return { data: null, meta: { ...meta, success: false, error: { code, retryable, message: 'Safe business failure', fieldErrors: [] } } }
}
export function versionDetail(overrides: Partial<DocumentVersionDetail> = {}): DocumentVersionDetail {
  return { versionId: 'v-1', versionNo: 1, changeType: 'INITIAL_UPLOAD', status: 'READY', fileName: '制度.pdf', mimeType: 'application/pdf', fileSize: 1024,
    operationId: 'op-1', operationStatus: 'SUCCEEDED', progressPercent: 100, progressSource: 'TERMINAL_STATE', progressUpdatedAt: meta.timestamp,
    retryable: false, error: null, createdAt: meta.timestamp, processingStartedAt: meta.timestamp, readyAt: meta.timestamp, activatedAt: meta.timestamp, failedAt: null, cancelledAt: null, ...overrides }
}
export function documentDetail(overrides: Partial<KnowledgeDocumentDetail> = {}): KnowledgeDocumentDetail {
  return { documentId: 'doc-1', spaceId: 'space-1', name: '制度', status: 'ACTIVE', searchable: true, metadata, lockVersion: 1,
    activeVersion: versionDetail(), candidateVersion: null, createdAt: meta.timestamp, updatedAt: meta.timestamp, ...overrides }
}
