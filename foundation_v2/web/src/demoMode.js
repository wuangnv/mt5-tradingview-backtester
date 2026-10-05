export const DEMO_VIEWS = ['overview', 'replay', 'trade', 'analytics', 'market-data', 'live', 'testing', 'prop', 'playbook', 'journal']

export function canPreviewDemo(view, query) {
  if (!DEMO_VIEWS.includes(view)) return false
  if (view === 'replay') return query.get('surface') !== 'workspace' && (query.get('select') === '1' || query.get('mode') === 'Practice')
  return view !== 'trade' || query.get('intent') !== 'order'
}

export function demoToggleHref(href, enabled) {
  const url = new URL(href)
  if (enabled) url.searchParams.set('demo', '1')
  else url.searchParams.delete('demo')
  return url
}
