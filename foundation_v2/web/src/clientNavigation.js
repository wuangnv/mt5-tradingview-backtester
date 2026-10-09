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
  window.history[replace ? 'replaceState' : 'pushState']({}, '', next)
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
