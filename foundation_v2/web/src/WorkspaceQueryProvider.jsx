import { createContext, useContext, useEffect, useLayoutEffect, useMemo, useState, useSyncExternalStore } from 'react'
import { QueryClientProvider, useQuery } from '@tanstack/react-query'
import { createWorkspaceQueryScope, metadataOptions, registerWorkspaceQueryScope, catalogEventRevision, invalidateScopeMetadata } from './workspaceQuery.js'
import { subscribeWorkspaceEvents } from './workspaceEvents.js'
import TestingReadState from './TestingReadState.jsx'

const ScopeContext = createContext(null)

function QueryScope({ workspace, authorityKey, eventsEnabled, children }) {
  const [scope] = useState(() => createWorkspaceQueryScope(workspace, authorityKey))
  const denied = useSyncExternalStore(scope.subscribe, scope.isDenied, scope.isDenied)
  useLayoutEffect(() => registerWorkspaceQueryScope(scope), [scope])
  useEffect(() => {
    if (denied || !eventsEnabled) return
    let revision = null
    const off = subscribeWorkspaceEvents(workspace, ({ event, data }) => {
      if (event === 'snapshot') {
        const next = catalogEventRevision(data)
        if (next !== revision) void invalidateScopeMetadata(scope, ['datasets', 'providers'])
        revision = next
      } else if ((event === 'error' && [401, 403].includes(data.status)) || (event === 'connection' && data.state === 'denied')) scope.deny()
    })
    const refocus = () => {
      if (document.visibilityState !== 'hidden') void invalidateScopeMetadata(scope)
    }
    document.addEventListener('visibilitychange', refocus)
    return () => { off(); document.removeEventListener('visibilitychange', refocus) }
  }, [scope, workspace, denied, eventsEnabled])
  return <ScopeContext.Provider value={scope}><QueryClientProvider client={scope.client}>{denied
    ? <TestingReadState error message="Không có quyền đọc dữ liệu trong workspace này." /> : children}</QueryClientProvider></ScopeContext.Provider>
}

export default function WorkspaceQueryProvider({ workspace, authorityKey = 'local-workspace-v1', eventsEnabled = true, children }) {
  return <QueryScope key={JSON.stringify([workspace, authorityKey, eventsEnabled])} workspace={workspace} authorityKey={authorityKey} eventsEnabled={eventsEnabled}>{children}</QueryScope>
}

export function useWorkspaceQueryScope() { return useContext(ScopeContext) }

export function useWorkspaceMetadataQuery(resource, { workspace, revision = 'current', enabled = true } = {}) {
  const provided = useWorkspaceQueryScope()
  // Standalone reference previews do not require the app shell/provider.
  const fallback = useMemo(() => createWorkspaceQueryScope(workspace), [workspace])
  const scope = provided?.workspace === workspace ? provided : fallback
  useEffect(() => () => fallback.dispose(), [fallback])
  const denied = useSyncExternalStore(scope.subscribe, scope.isDenied, scope.isDenied)
  const query = useQuery({ ...metadataOptions(scope, resource, revision), enabled: enabled && !denied }, scope.client)
  return { ...query, scope, denied }
}
