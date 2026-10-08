import { categoryOf, categoryLabel, downloadEngineOf, sourceOf } from './dataLibraryModel.js'
import { displayTimeframe } from './dataDisplay.js'

export function datasetAssetOptions(datasets, instruments = [], sessions = []) {
  const recentIds = [...new Set([...sessions].filter(item => !item.archived)
    .sort((a, b) => (Date.parse(b.updated_at_utc || b.created_at_utc) || 0) - (Date.parse(a.updated_at_utc || a.created_at_utc) || 0))
    .map(item => item.dataset_id))].slice(0, 5)
  const options = datasets.map(item => {
    const catalog = instruments.find(entry => entry.instrument_id === item.instrument_id
      && downloadEngineOf(entry) === downloadEngineOf(item) && sourceOf(entry) === sourceOf(item))
    const category = categoryOf(item) || categoryOf(catalog || {})
    const label = item.instrument_id || item.dataset_id
    const name = item.name || catalog?.name || ''
    const duplicate = datasets.filter(entry => entry.instrument_id === item.instrument_id).length > 1
    const version = duplicate ? ` · #${item.dataset_id.replace(/^dataset-/, '').slice(0, 12)}` : ''
    const summary = `${displayTimeframe(item)} · ${sourceOf(item)}${version}`
    const recent = recentIds.indexOf(item.dataset_id)
    return { value: item.dataset_id, label, name: name.replaceAll('/', '') === label.replaceAll('/', '') ? '' : name,
      category, summary, detail: summary, searchText: `${name} ${category} ${categoryLabel(category)}`, localize: false, recent }
  }).sort((a, b) => (a.recent < 0 ? 5 : a.recent) - (b.recent < 0 ? 5 : b.recent)
    || a.label.localeCompare(b.label, 'en', { numeric: true }) || a.value.localeCompare(b.value))
  const hasRecent = options.some(option => option.recent >= 0)
  return options.map(option => ({ ...option, group: hasRecent ? option.recent >= 0 ? 'Dùng gần đây' : 'Dữ liệu đã tải' : '' }))
}
