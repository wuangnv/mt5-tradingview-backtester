const formatters = new Map()

export function dateFieldDisplay(value, type = 'date') {
  if (!value) return ''
  if (type === 'time') return value
  // datetime-local represents wall time, not a timestamp to convert through a zone.
  const [date, time] = value.replace(/Z$/, '').split('T')
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date)
  if (!match) return ''
  return `${match[3]}/${match[2]}/${match[1]}${type === 'date' ? '' : ` ${(time || '00:00').replace(/\.\d+$/, '')}`}`
}

export function parseDateField(value, type = 'date') {
  if (!value) return ''
  if (type === 'time') {
    const match = /^(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(value)
    return match && Number(match[1]) < 24 && Number(match[2]) < 60 && Number(match[3] || 0) < 60 ? value : null
  }
  const match = (type === 'date' ? /^(\d{2})\/(\d{2})\/(\d{4})$/ : /^(\d{2})\/(\d{2})\/(\d{4}) (\d{2}):(\d{2})(?::(\d{2}))?$/).exec(value)
  if (!match) return null
  const [, day, month, year, hour, minute, second] = match
  const isoDate = `${year}-${month}-${day}`
  const parsed = new Date(`${isoDate}T00:00:00Z`)
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== isoDate || Number(year) === 0) return null
  if (type === 'date') return isoDate
  if (Number(hour) > 23 || Number(minute) > 59 || Number(second || 0) > 59) return null
  return `${isoDate}T${hour}:${minute}${second === undefined ? '' : `:${second}`}`
}

export function displayTime(value, { seconds = false, timeZone = 'UTC' } = {}) {
  const dateTime = displayDate(value, { timeStyle: seconds ? 'medium' : 'short', timeZone })
  return dateTime === '—' ? dateTime : dateTime.split(' ')[1]
}

export function displayDate(value, { timeStyle, timeZone = 'UTC', fallback = '—' } = {}) {
  if (value == null || value === '' || typeof value === 'boolean') return fallback
  const numeric = typeof value === 'number' || (typeof value === 'string' && /^[+-]?\d+(?:\.\d+)?$/.test(value.trim()))
  const date = value instanceof Date ? value : numeric
    ? new Date(Math.abs(Number(value)) >= 100_000_000_000 ? Number(value) : Number(value) * 1000)
    : new Date(value)
  if (!Number.isFinite(date.getTime())) return fallback
  const key = `${timeZone}/${timeStyle || 'date'}`
  if (!formatters.has(key)) formatters.set(key, new Intl.DateTimeFormat('en-GB', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    ...(timeZone ? { timeZone } : {}),
    ...(timeStyle ? { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', ...(timeStyle === 'medium' ? { second: '2-digit' } : {}) } : {}),
  }))
  const parts = Object.fromEntries(formatters.get(key).formatToParts(date).map(({ type, value }) => [type, value]))
  const day = `${parts.day}/${parts.month}/${parts.year.padStart(4, '0')}`
  return timeStyle ? `${day} ${parts.hour}:${parts.minute}${parts.second ? `:${parts.second}` : ''}` : day
}
