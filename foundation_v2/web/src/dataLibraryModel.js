export const CATEGORIES = [
  ['stock', 'Cổ phiếu'], ['futures', 'Hợp đồng tương lai'], ['fx', 'Forex'],
  ['crypto', 'Crypto'], ['index', 'Chỉ số'], ['metal', 'Kim loại'],
  ['energy', 'Năng lượng'], ['agriculture', 'Nông sản'], ['etf', 'ETF'], ['bond', 'Trái phiếu'],
]

const aliases = { stocks:'stock', equities:'stock', forex:'fx', indices:'index', metals:'metal', energies:'energy', etfs:'etf', bonds:'bond' }
export function categoryOf(item) {
  const value = item.asset_class || item.instrument_spec?.asset_class || ''
  return aliases[value] || value
}
export const categoryLabel = value => CATEGORIES.find(([key]) => key === value)?.[1] || 'Chưa phân loại'
function exportSettingsOf(item) {
  try { return JSON.parse(item?.source?.export_settings || '{}') || {} }
  catch { return {} }
}
// Keep transport identity for job/update matching, including immutable older QDM imports.
export const downloadEngineOf = item => item?.download_engine || exportSettingsOf(item).download_engine || item?.source?.provider || item?.provider || item?.provider_id || '—'
export const sourceOf = item => item?.data_source || exportSettingsOf(item).upstream_provider
  || (downloadEngineOf(item) === 'QuantDataManager' ? 'Dukascopy' : item?.source?.provider || item?.provider || item?.provider_id || '—')

export function libraryDataType(item, availableStart) {
  if (!item.downloaded) return availableStart ? { timeframe: 'M1', ...(downloadEngineOf(item) === 'QuantDataManager' ? {} : { price: 'Bid' }) } : { timeframe: '—' }
  const settings = exportSettingsOf(item)
  const price = { bid: 'Bid', ask: 'Ask', mid: 'Mid' }[settings?.price]
  return { timeframe: item.timeframe || '—', price }
}

export function canDownloadAsset(asset, download, preview = false) {
  return !preview && Boolean(download?.available) && Array.isArray(download.supported_instruments)
    && download.supported_instruments.includes(asset.instrument_id)
    && downloadEngineOf(asset).toLowerCase() === (download.download_engine || download.provider || 'Dukascopy').toLowerCase()
}

export function defaultDownloadDates(now = new Date()) {
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) - 86400000)
  return { to_date:end.toISOString().slice(0,10), from_date:new Date(end.getTime() - 29 * 86400000).toISOString().slice(0,10) }
}

export function downloadRangeError(from, to, now = new Date()) {
  const date = value => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return NaN
    const parsed = new Date(`${value}T00:00:00Z`)
    return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0,10) === value ? parsed.getTime() : NaN
  }
  const start = date(from), end = date(to)
  if (!Number.isFinite(start) || !Number.isFinite(end) || start > end) return 'Chọn khoảng ngày hợp lệ.'
  if (to > defaultDownloadDates(now).to_date) return 'Chỉ tải ngày đã kết thúc theo UTC.'
  if ((end - start) / 86400000 + 1 > 366) return 'Mỗi lần tải tối đa 366 ngày.'
  return ''
}

export function libraryRows(datasets, instruments = [], jobs = []) {
  // Keep dataset versions separate: a saved session pins one immutable version.
  const rows = datasets.map(item => ({ ...item, key:item.dataset_id, downloaded:true }))
  for (const item of instruments) {
    if (!datasets.some(dataset => dataset.instrument_id === item.instrument_id && downloadEngineOf(dataset) === downloadEngineOf(item))) {
      rows.push({ ...item, key:`${item.provider_id}:${item.instrument_id}`, downloaded:false })
    }
  }
  return rows.map(item => ({ ...item, downloadJob: jobs.find(job => (job.download_engine || job.provider || 'Dukascopy') === downloadEngineOf(item)
    && job.instrument_id === item.instrument_id && ['queued','running','pausing','paused','failed'].includes(job.status)) }))
}

export function filterLibrary(rows, { category = 'all', provider = 'all', downloadStatus = 'all', search = '', sort = 'asset-asc' } = {}) {
  const term = search.trim().toLocaleLowerCase('vi')
  const filtered = rows.filter(item => (category === 'all' || categoryOf(item) === category)
    && (provider === 'all' || sourceOf(item) === provider)
    && (downloadStatus === 'all'
      || (downloadStatus === 'downloading' && Boolean(item.downloadJob))
      || (downloadStatus === 'downloaded' && item.downloaded)
      || (downloadStatus === 'not-downloaded' && !item.downloaded && !item.downloadJob))
    && `${item.instrument_id} ${item.name || ''} ${item.timeframe || ''} ${sourceOf(item)} ${categoryLabel(categoryOf(item))}`.toLocaleLowerCase('vi').includes(term))
  const assetCompare = (a, b) => `${a.instrument_id || ''} ${a.timeframe || ''}`.localeCompare(`${b.instrument_id || ''} ${b.timeframe || ''}`, 'en', { numeric:true }) || a.key.localeCompare(b.key)
  return filtered.sort((a, b) => sort === 'asset-desc' ? assetCompare(b,a)
    : sort === 'downloaded' ? Number(b.downloaded) - Number(a.downloaded) || assetCompare(a,b)
    : sort === 'not-downloaded' ? Number(a.downloaded) - Number(b.downloaded) || assetCompare(a,b)
    : sort === 'newest' ? (Date.parse(b.created_at_utc) || 0) - (Date.parse(a.created_at_utc) || 0) || assetCompare(a,b)
    : assetCompare(a,b))
}
