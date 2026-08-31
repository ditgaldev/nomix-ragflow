import type { OperationData } from '../src/types.js'

const dataset = {
  id: 'dataset-a',
  version: 1,
  name: 'Authorized',
} satisfies OperationData<'datasets.get'>

// @ts-expect-error Dataset responses require the server-generated optimistic version.
const missingVersion: OperationData<'datasets.get'> = { id: 'dataset-a', name: 'Authorized' }

// @ts-expect-error List response data is the array itself, never a guessed resource wrapper.
const guessedList: OperationData<'datasets.list'> = { datasets: [] }

// @ts-expect-error Session invocation has one canonical content/role/sessionId shape.
const guessedInvocation: OperationData<'chatSessions.invoke'> = { answer: 'legacy answer' }

const graphRetrieval = {
  chunks: [{ content: 'synthetic knowledge-graph result' }],
  total: 1,
  docAggs: {},
} satisfies OperationData<'retrieval.search'>

void [dataset, missingVersion, guessedList, guessedInvocation, graphRetrieval]
