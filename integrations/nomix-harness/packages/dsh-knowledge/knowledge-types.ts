export interface KnowledgeRequestContext {
  serviceToken: string
  userAssertion: string
  sessionId: string
  toolCallId: string
  requestId: string
}

export interface KnowledgeRequestOptions {
  signal?: AbortSignal
  idempotencyKey?: string
}

export interface KnowledgeToolArtifact {
  kind: 'spill'
  name: string
  locator: string
  mimeType: 'application/json'
  encoding: 'utf8'
  bytes: number
  storedBytes: number
  retrievalHint: string
}

export type KnowledgeObservationData<T> =
  | { kind: 'inline'; format: 'structured'; resultKind: string; result: T; bytes: number; truncated: false }
  | { kind: 'artifact-reference'; format: 'json'; resultKind: string; artifactName: string; bytes: number; truncated: true }

export interface KnowledgeToolOutput<T = unknown> {
  status: 'success' | 'warning'
  summary: string
  data: KnowledgeObservationData<T>
  nextActions: string[]
  artifacts: KnowledgeToolArtifact[]
}
