import { Service, type Context } from '@nomix-ai/nomix-harness/plugin'
import type { CredentialProvider } from '@nomix-ai/nomix-harness/plugin/credentials'
import { KnowledgeGatewayError } from './knowledge-errors.js'
import type {
  CitationContextRequest,
  CitationSource,
  DeleteResourceRequest,
  DocumentOperationAccepted,
  DocumentDeleteRequest,
  DownloadLink,
  EmptyRequest,
  KnowledgeDocument,
  KnowledgeDocumentDetail,
  KnowledgeDocumentPage,
  KnowledgeDocumentReplaceRequest,
  KnowledgeDocumentUpdateRequest,
  KnowledgeDocumentUploadRequest,
  KnowledgeOperation,
  KnowledgeSpace,
  KnowledgeSpaceCreated,
  KnowledgeSpaceUpdated,
  ManualRetryOperation,
  KnowledgeSpaceCreateRequest,
  KnowledgeSpacePage,
  KnowledgeSpaceUpdateRequest,
  ListDocumentsRequest,
  ListSpacesRequest,
  OperationReasonRequest,
  RetrievalRequest,
  RetrievalResult,
  SpaceOperationAccepted,
  VersionedResourceRequest,
} from './knowledge-openapi.generated.js'
import type { KnowledgeRequestOptions } from './knowledge-types.js'

declare module '@nomix-ai/nomix-harness/plugin' { interface Context { knowledge: KnowledgeRuntime } }

export interface KnowledgeOperationContext {
  readonly context: Context
  readonly credentials: CredentialProvider
  readonly businessIdentity: { resolveUserAssertion(sessionId: string): { readonly sessionId: string; readonly userAssertion: string; readonly expiresAtEpochSeconds: number } }
  readonly signal?: AbortSignal
  readonly sessionId: string
  readonly toolCallId: string
  readonly requestId: string
}

/** Provider-neutral business API consumed by Agent tools. */
export interface KnowledgeService {
  search(input: RetrievalRequest, options?: KnowledgeRequestOptions): Promise<RetrievalResult>
  listSpaces(input: ListSpacesRequest, options?: KnowledgeRequestOptions): Promise<KnowledgeSpacePage>
  getSpace(knowledgeSpaceId: string, options?: KnowledgeRequestOptions): Promise<KnowledgeSpace>
  createSpace(input: KnowledgeSpaceCreateRequest, options: KnowledgeRequestOptions): Promise<KnowledgeSpaceCreated>
  updateSpace(knowledgeSpaceId: string, input: KnowledgeSpaceUpdateRequest, options: KnowledgeRequestOptions): Promise<KnowledgeSpaceUpdated>
  deleteSpace(knowledgeSpaceId: string, input: DeleteResourceRequest, options: KnowledgeRequestOptions): Promise<SpaceOperationAccepted>
  listDocuments(knowledgeSpaceId: string, input: ListDocumentsRequest, options?: KnowledgeRequestOptions): Promise<KnowledgeDocumentPage>
  getDocument(documentId: string, options?: KnowledgeRequestOptions): Promise<KnowledgeDocumentDetail>
  uploadDocument(knowledgeSpaceId: string, input: KnowledgeDocumentUploadRequest, options: KnowledgeRequestOptions): Promise<DocumentOperationAccepted>
  updateDocument(documentId: string, input: KnowledgeDocumentUpdateRequest, options: KnowledgeRequestOptions): Promise<KnowledgeDocument>
  replaceDocument(documentId: string, input: KnowledgeDocumentReplaceRequest, options: KnowledgeRequestOptions): Promise<DocumentOperationAccepted>
  enableDocument(documentId: string, input: VersionedResourceRequest, options: KnowledgeRequestOptions): Promise<KnowledgeDocument>
  disableDocument(documentId: string, input: VersionedResourceRequest, options: KnowledgeRequestOptions): Promise<KnowledgeDocument>
  reindexDocument(documentId: string, input: VersionedResourceRequest, options: KnowledgeRequestOptions): Promise<DocumentOperationAccepted>
  deleteDocument(documentId: string, input: DocumentDeleteRequest, options: KnowledgeRequestOptions): Promise<DocumentOperationAccepted>
  createDownloadLink(documentId: string, input?: EmptyRequest, options?: KnowledgeRequestOptions): Promise<DownloadLink>
  getCitation(citationId: string, input: CitationContextRequest, options?: KnowledgeRequestOptions): Promise<CitationSource>
  getOperation(operationId: string, options?: KnowledgeRequestOptions): Promise<KnowledgeOperation>
  cancelOperation(operationId: string, input: OperationReasonRequest, options: KnowledgeRequestOptions): Promise<KnowledgeOperation>
  retryOperation(operationId: string, input: OperationReasonRequest, options: KnowledgeRequestOptions): Promise<ManualRetryOperation>
}

export interface KnowledgeProvider {
  readonly id: string
  available(): boolean
  createService(operation: KnowledgeOperationContext): Promise<KnowledgeService>
}

export class KnowledgeRuntime extends Service {
  private readonly providers = new Map<string, KnowledgeProvider>()

  constructor(ctx: Context) { super(ctx, 'knowledge') }

  registerProvider(provider: KnowledgeProvider): () => void {
    if (this.providers.has(provider.id)) throw new KnowledgeGatewayError('A Knowledge Gateway provider with this ID is already registered.', { code: 'KNOWLEDGE_INVALID_INPUT', status: 422 })
    const providers = this.providers
    const dispose = this.ctx.effect(function* () {
      providers.set(provider.id, provider)
      yield () => providers.delete(provider.id)
    }, `knowledge.registerProvider(${provider.id})`)
    return () => void dispose()
  }

  async forOperation(operation: KnowledgeOperationContext): Promise<KnowledgeService> {
    const available = [...this.providers.values()].filter(provider => provider.available())
    if (available.length !== 1) throw new KnowledgeGatewayError('Exactly one Knowledge Gateway provider must be available.', { code: 'KNOWLEDGE_PROVIDER_UNAVAILABLE', status: 503 })
    return available[0]!.createService(operation)
  }
}

export default KnowledgeRuntime
