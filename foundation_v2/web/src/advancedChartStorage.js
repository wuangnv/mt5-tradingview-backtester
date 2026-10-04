export function readChartSnapshot(storage, key, cutoff) {
  const snapshots = JSON.parse(storage.getItem(key) || '[]')
  if (!Array.isArray(snapshots)) return undefined
  return snapshots.filter(item => item.version === 1 && Number.isFinite(item.cutoff) && item.cutoff <= cutoff && item.layout).sort((a, b) => b.cutoff - a.cutoff)[0]?.layout
}

export function writeChartSnapshot(storage, key, cutoff, layout) {
  if (!Number.isFinite(cutoff)) throw new Error('Chart cutoff chưa hợp lệ.')
  const current = JSON.parse(storage.getItem(key) || '[]')
  const snapshots = (Array.isArray(current) ? current : []).filter(item => item.version === 1 && item.cutoff !== cutoff)
  snapshots.push({ version: 1, cutoff, layout })
  storage.setItem(key, JSON.stringify(snapshots.sort((a, b) => a.cutoff - b.cutoff).slice(-24)))
}
