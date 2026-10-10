import { DATA_STATES } from './dataStates.js'

export const DEMO_VIEWS = ['overview', 'replay', 'trade', 'analytics', 'market-data', 'live', 'testing', 'prop', 'playbook', 'journal']

export function previewOptions(view) {
  return [
    { value: 'real', label: 'Dữ liệu thật', detail: 'Đọc dữ liệu hiện tại của workspace.' },
    { value: 'demo', label: 'Dữ liệu mẫu', detail: 'Có dữ liệu mẫu để xem bố cục và tương tác.' },
    { value: 'many', label: 'Nhiều phiên mẫu', detail: '12 phiên để thử tìm kiếm và phân trang; mỗi trang tối đa 3 phiên.', disabled: view !== 'overview' },
    ...DATA_STATES.filter(([state]) => state !== 'ready').map(([value, label, detail]) => ({ value, label, detail,
      disabled: ['partial', 'unknown'].includes(value) && view !== 'overview' })),
  ]
}

export function previewMode(query, view) {
  if (query.get('demo') !== '1' || !canPreviewDemo(view, query)) return 'real'
  const state = query.get('ui_state') || 'demo'
  return previewOptions(view).some(option => option.value === state && !option.disabled) ? state : 'demo'
}

export function previewStateHref(href, state) {
  const url = demoToggleHref(href, state !== 'real')
  if (state === 'many' || DATA_STATES.some(([value]) => value === state && value !== 'ready')) url.searchParams.set('ui_state', state)
  else url.searchParams.delete('ui_state')
  return url
}

export function canPreviewDemo(view, query) {
  if (!DEMO_VIEWS.includes(view)) return false
  if (view === 'replay') return query.get('surface') !== 'workspace' && (query.get('select') === '1' || query.get('mode') === 'Practice')
  return view !== 'trade' || query.get('intent') !== 'order'
}

export function demoToggleHref(href, enabled) {
  const url = new URL(href)
  if (enabled) url.searchParams.set('demo', '1')
  else { url.searchParams.delete('demo'); url.searchParams.delete('demo_session'); url.searchParams.delete('ui_state') }
  return url
}
