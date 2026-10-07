export const CATEGORIES = [
  ['stock', 'Cổ phiếu'], ['futures', 'Hợp đồng tương lai'], ['fx', 'Forex'],
  ['crypto', 'Crypto'], ['index', 'Chỉ số'], ['metal', 'Kim loại'],
  ['energy', 'Năng lượng'], ['agriculture', 'Nông sản'],
]

const aliases = { stocks:'stock', equities:'stock', forex:'fx', indices:'index', metals:'metal', energies:'energy' }
export function categoryOf(item) {
  const value = item.asset_class || item.instrument_spec?.asset_class || ''
  return aliases[value] || value
}
export const categoryLabel = value => CATEGORIES.find(([key]) => key === value)?.[1] || 'Chưa phân loại'
export const sourceOf = item => item.source?.provider || item.provider || item.provider_id || '—'

export function libraryRows(datasets, instruments = []) {
  // Keep dataset versions separate: a saved session pins one immutable version.
  const rows = datasets.map(item => ({ ...item, key:item.dataset_id, downloaded:true }))
  for (const item of instruments) {
    if (!datasets.some(dataset => dataset.instrument_id === item.instrument_id && sourceOf(dataset) === sourceOf(item))) {
      rows.push({ ...item, key:`${item.provider_id}:${item.instrument_id}`, downloaded:false })
    }
  }
  return rows
}

export function filterLibrary(rows, { category = 'all', provider = 'all', search = '', sort = 'asset-asc' } = {}) {
  const term = search.trim().toLocaleLowerCase('vi')
  const filtered = rows.filter(item => (category === 'all' || categoryOf(item) === category)
    && (provider === 'all' || sourceOf(item) === provider)
    && `${item.instrument_id} ${item.name || ''} ${item.timeframe || ''} ${sourceOf(item)} ${categoryLabel(categoryOf(item))}`.toLocaleLowerCase('vi').includes(term))
  const assetCompare = (a, b) => `${a.instrument_id || ''} ${a.timeframe || ''}`.localeCompare(`${b.instrument_id || ''} ${b.timeframe || ''}`, 'en', { numeric:true }) || a.key.localeCompare(b.key)
  return filtered.sort((a, b) => sort === 'asset-desc' ? assetCompare(b,a)
    : sort === 'downloaded' ? Number(b.downloaded) - Number(a.downloaded) || assetCompare(a,b)
    : sort === 'newest' ? (Date.parse(b.created_at_utc) || 0) - (Date.parse(a.created_at_utc) || 0) || assetCompare(a,b)
    : assetCompare(a,b))
}
