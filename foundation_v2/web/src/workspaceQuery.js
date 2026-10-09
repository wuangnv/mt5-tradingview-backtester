import { QueryCache, QueryClient, QueryObserver } from '@tanstack/react-query'
import { scopedRead } from './scopedRead.js'
import { readJson } from './researchDataApi.js'

const resources = { 'market-assets': '/api/v2/data/market-assets', datasets: '/api/v2/data/datasets', providers: '/api/v2/data/providers' }
const liveScopes = new Set()
const MAX_QUERIES = 16

export const metadataKey = (workspace, authority, resource, revision = 'current') =>
  ['workspace-metadata', workspace, authority, resource, revision]

export function retryMetadataRead(attempt, error) {
  if (error?.name === 'AbortError' || [401, 403].includes(error?.status)) return false
  return attempt < 2 && (error instanceof TypeError || [408, 429, 502, 503, 504].includes(error?.status))
}

/** Short-lived read-only cache. Authority changes discard the complete scope. */
export function createWorkspaceQueryScope(workspace, authority = 'local-workspace-v1') {
  let denied = false
  const listeners = new Set()
  const scope = {
    workspace, authority,
    isDenied: () => denied,
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener) },
    deny() {
      if (denied) return
      denied = true
      void scope.client.cancelQueries()
      // Query completion schedules GC after callbacks. Purge after settlement to avoid orphan timers.
      queueMicrotask(() => scope.client.clear())
      for (const listener of listeners) listener()
    },
    dispose() { liveScopes.delete(scope); scope.client.clear(); listeners.clear() },
  }
  scope.client = new QueryClient({
    queryCache: new QueryCache({
      onError(error) { if ([401, 403].includes(error?.status)) scope.deny() },
      onSuccess() { queueMicrotask(() => {
        const inactive = scope.client.getQueryCache().getAll().filter(query => !query.isActive())
          .sort((a, b) => a.state.dataUpdatedAt - b.state.dataUpdatedAt)
        while (scope.client.getQueryCache().getAll().length > MAX_QUERIES && inactive.length) {
          scope.client.getQueryCache().remove(inactive.shift())
        }
      }) },
    }),
    defaultOptions: { queries: {
      staleTime: 15000, gcTime: 120000, retry: retryMetadataRead,
      retryDelay: attempt => Math.min(1000 * 2 ** attempt, 10000),
      refetchOnWindowFocus: false, refetchOnReconnect: false,
    } },
  })
  return scope
}

export function registerWorkspaceQueryScope(scope) {
  liveScopes.add(scope)
  return () => scope.dispose()
}

/** Imperative consumers retain their own cancellation while sharing the observed query. */
export function readWorkspaceMetadata(resource, workspace, signal) {
  if (!resources[resource]) return Promise.reject(new Error('Metadata resource is outside the cache pilot'))
  if (signal?.aborted) return Promise.reject(signal.reason || new DOMException('Aborted', 'AbortError'))
  const scope = [...liveScopes].find(candidate => candidate.workspace === workspace)
  if (!scope) return scopedRead(resources[resource], workspace, signal).then(readJson)
  if (scope.isDenied()) { const error = new Error('Workspace access denied'); error.status = 403; return Promise.reject(error) }
  const options = metadataOptions(scope, resource)
  const cached = scope.client.getQueryCache().find({ queryKey: options.queryKey })
  if (cached && !cached.isStaleByTime(15000)) return Promise.resolve(cached.state.data)
  return new Promise((resolve, reject) => {
    const observer = new QueryObserver(scope.client, options)
    let unsubscribe = () => {}, settled = false
    const finish = (error, data) => {
      if (settled) return
      settled = true
      signal?.removeEventListener('abort', aborted)
      unsubscribe()
      error ? reject(error) : resolve(data)
    }
    const aborted = () => finish(signal.reason || new DOMException('Aborted', 'AbortError'))
    unsubscribe = observer.subscribe(result => {
      if (result.isError) finish(result.error)
      else if (result.isSuccess && !result.isFetching) finish(null, result.data)
    })
    signal?.addEventListener('abort', aborted, { once: true })
  })
}

export function metadataOptions(scope, resource, revision = 'current') {
  if (!resources[resource]) throw new Error('Metadata resource is outside the cache pilot')
  return {
    queryKey: metadataKey(scope.workspace, scope.authority, resource, revision),
    queryFn: async ({ signal }) => {
      if (scope.isDenied()) { const error = new Error('Workspace access denied'); error.status = 403; throw error }
      const payload = await readJson(await scopedRead(resources[resource], scope.workspace, signal))
      // This pilot stores bounded catalogs, never candles, ledgers or job results.
      if (!Array.isArray(payload.items) || payload.items.length > 5000 || JSON.stringify(payload).length > 5 * 1024 * 1024) {
        throw new Error('Metadata catalog exceeds the cache contract')
      }
      return payload
    },
  }
}

export function invalidateScopeMetadata(scope, resourcesToInvalidate) {
  if (scope.isDenied()) return Promise.resolve()
  return scope.client.invalidateQueries({ predicate: query => query.queryKey[0] === 'workspace-metadata'
    && query.queryKey[1] === scope.workspace && query.queryKey[2] === scope.authority
    && (!resourcesToInvalidate || resourcesToInvalidate.includes(query.queryKey[3])) }, { cancelRefetch: false })
}

/** Call only for a known successful mutation, never an unknown command outcome. */
export function invalidateWorkspaceMetadata(workspace, resourcesToInvalidate) {
  return Promise.all([...liveScopes].filter(scope => scope.workspace === workspace)
    .map(scope => invalidateScopeMetadata(scope, resourcesToInvalidate)))
}

export function catalogEventRevision(snapshot) {
  // Command counts include read commands; using them would create a refresh feedback loop.
  return JSON.stringify(['qdm', 'dukascopy'].map(provider => (snapshot?.downloads?.[provider]?.jobs || [])
    .map(job => [job.job_id, job.status])))
}
