const byteUnits = { B:1, KB:1000, MB:1000 ** 2, GB:1000 ** 3, TB:1000 ** 4 }

export function formatDataSize(bytes, fmt, unit) {
  if (!Number.isFinite(bytes) || bytes < 0) return '—'
  const selected = unit || Object.keys(byteUnits).findLast(key => bytes >= byteUnits[key]) || 'B'
  return `${fmt(bytes / byteUnits[selected], '', selected === 'B' ? 0 : 1)} ${selected}`
}

export function displayTimeframe(item, fallback = '—') {
  const value = item?.timeframe
  const duration = /^(\d+)([smhdw])$/i.exec(value || '')
  const seconds = duration ? Number(duration[1]) * {s:1,m:60,h:3600,d:86400,w:604800}[duration[2].toLowerCase()] : !value ? item?.timeframe_seconds : null
  if (Number.isFinite(seconds) && seconds > 0) {
    for (const [size, prefix] of [[604800,'W'],[86400,'D'],[3600,'H'],[60,'M'],[1,'S']]) {
      if (seconds % size === 0) return `${prefix}${seconds / size}`
    }
  }
  return value ? /^(?:[SMHDW]\d+|MN\d+|TICK)$/i.test(value) ? value.toUpperCase() : value : fallback
}
