import { resolutionSeconds } from './advancedReplayDatafeed.js'

export const REPLAY_INTERVALS = ['5S', '10S', '15S', '30S', '1', '3', '5', '10', '15', '30', '60', '240']

export function replayIntervalSteps(interval, datasetSeconds) {
  const seconds = resolutionSeconds(interval), base = Number(datasetSeconds)
  if (!Number.isSafeInteger(seconds) || !Number.isSafeInteger(base) || base <= 0 || seconds < base || seconds % base) return null
  const steps = seconds / base
  return steps <= 1000 ? steps : null
}

// The server resolves interval boundaries from authoritative timestamps;
// historical navigation remains bounded by the already opened canonical cursor.
export function replayAdvance({ cursor, canonicalCursor, historical, completed, steps, intervalSeconds }) {
  if (!Number.isSafeInteger(steps) || steps < 1 || steps > 1000) return null
  if (intervalSeconds !== undefined && (!Number.isSafeInteger(intervalSeconds) || intervalSeconds < 1 || intervalSeconds > 86400)) return null
  if (!Number.isSafeInteger(cursor) || cursor < 0 || !Number.isSafeInteger(canonicalCursor) || canonicalCursor < cursor) return null
  if (historical) {
    if (cursor >= canonicalCursor) return null
    if (intervalSeconds != null) return { kind: 'read', cursor, advanceIntervalSeconds: intervalSeconds }
    const next = Math.min(cursor + steps, canonicalCursor)
    return { kind: 'read', cursor: next === canonicalCursor ? null : next }
  }
  return completed ? null : intervalSeconds != null ? { kind: 'step', steps: 1, replayIntervalSeconds: intervalSeconds } : { kind: 'step', steps }
}

export function replayRewind(cursor, steps) {
  return Number.isSafeInteger(cursor) && cursor > 0 && Number.isSafeInteger(steps) && steps > 0 ? Math.max(0, cursor - steps) : null
}

export function replayRewindBucket(rows, cursor, intervalSeconds) {
  if (!Number.isSafeInteger(intervalSeconds) || intervalSeconds < 1 || !Number.isSafeInteger(cursor) || cursor <= 0 || !rows.length) return null
  const bucket = timestamp => Math.floor(Number(timestamp) / intervalSeconds)
  const currentBucket = bucket(rows.at(-1).timestamp), offset = cursor - rows.length + 1
  let index = rows.length - 2
  while (index >= 0 && bucket(rows[index].timestamp) >= currentBucket) index--
  if (index < 0) return Math.max(0, offset)
  const previousBucket = bucket(rows[index].timestamp)
  while (index > 0 && bucket(rows[index - 1].timestamp) === previousBucket) index--
  return offset + index
}

export function replaySelectionCursor(rows, timestamp, cursor) {
  if (!Number.isFinite(timestamp) || !Number.isSafeInteger(cursor)) return null
  const index = rows.findIndex(row => Number(row.timestamp) === timestamp)
  // The API returns a contiguous prefix ending at cursor, not future rows.
  const target = cursor - rows.length + 1 + index
  return index >= 0 && target >= 0 && target < cursor ? target : null
}

export function replayDelay(speed, lastDispatch, now) {
  const rate = Math.max(1, Math.min(16, Number(speed) || 1))
  return Math.max(0, 1000 / rate - Math.max(0, now - lastDispatch))
}
