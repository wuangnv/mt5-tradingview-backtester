// Keep ordinary links usable without JavaScript, including new-tab and download
// gestures. Only the application's root document is handled by this router.
const listeners = new Set()
let revision = 0
let lastSearch = null

export function isApplicationUrl(href, currentHref) {
  const current = new URL(currentHref)
  const next = new URL(href, current)
  return ['http:', 'https:'].includes(next.protocol) && next.origin === current.origin && next.pathname === '/'
}

export function shouldHandleLink(event, anchor, currentHref) {
  if (!anchor || event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return false
  if (anchor.hasAttribute('download') || anchor.hasAttribute('data-native-navigation') || (anchor.target && anchor.target !== '_self')) return false
  if (!isApplicationUrl(anchor.href, currentHref)) return false
  const current = new URL(currentHref), next = new URL(anchor.href, current)
  // In-page anchors keep native scrolling, focus and history behavior.
  return next.search !== current.search || (!next.hash && current.hash !== next.hash)
}

function notifyNavigation() {
  lastSearch = window.location.search
  revision += 1
  for (const listener of listeners) listener()
}

function onPopState() {
  // Native hash history belongs to the current page, not a new data scope.
  if (lastSearch !== window.location.search) notifyNavigation()
}

export function navigate(href, { replace = false } = {}) {
  if (!isApplicationUrl(href, window.location.href)) {
    window.location[replace ? 'replace' : 'assign'](href)
    return
  }
  const next = new URL(href, window.location.href)
  if (next.href === window.location.href) return
  // Hash-only navigation belongs to the browser so anchors still scroll.
  if (next.search === window.location.search) {
    window.location[replace ? 'replace' : 'assign'](next.href)
    return
  }
  window.history[replace ? 'replaceState' : 'pushState'](replace ? window.history.state : {}, '', next)
  notifyNavigation()
}

export function navigationSnapshot() {
  if (lastSearch === null) lastSearch = window.location.search
  return `${revision}:${lastSearch}`
}

export function navigationSearch() {
  return lastSearch ?? window.location.search
}

export function subscribeNavigation(listener) {
  if (!listeners.size) {
    lastSearch = window.location.search
    window.addEventListener('popstate', onPopState)
    document.addEventListener('click', onDocumentClick)
  }
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
    if (!listeners.size) {
      window.removeEventListener('popstate', onPopState)
      document.removeEventListener('click', onDocumentClick)
      lastSearch = null
    }
  }
}

function onDocumentClick(event) {
  const anchor = event.target?.closest?.('a[href]')
  if (!shouldHandleLink(event, anchor, window.location.href)) return
  event.preventDefault()
  navigate(anchor.href)
}

// Reader lifetimes follow data identity, not every query edit. Filters, chart
// cursor and report tabs update the existing page; a new resource resets it.
export function navigationScope(query, activeView) {
  const workspace = query.get('workspace') || 'tenant-a'
  const picker = query.get('surface') !== 'workspace' && (query.get('select') === '1' || query.get('mode') === 'Practice')
  const analytics = query.get('analytics_source') === 'prop' ? 'prop'
    : query.get('surface') !== 'workspace' && !query.get('job') && !query.get('job_id') ? 'reports' : 'result'
  const surface = query.get('ui_reference') === '1' ? 'reference'
    : activeView === 'replay' ? picker ? 'picker' : 'chart'
      : activeView === 'analytics' ? analytics
        : activeView === 'trade' ? query.get('intent') === 'order' ? 'order' : 'ledger' : 'page'
  const resources = ['dataset', 'prop_session', 'attempt', 'playbook', 'playbook_revision'].map(key => query.get(key) || '')
  return JSON.stringify([
    workspace, activeView, query.get('area') || '', query.get('section') || '', surface,
    query.get('demo') === '1', query.get('ui_state') || '', query.get('session') || query.get('replay_session') || '',
    [...query.getAll('sessions')].sort(), query.get('job') || query.get('job_id') || '', ...resources,
  ])
}
