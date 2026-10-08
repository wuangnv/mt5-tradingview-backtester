// Calendar-day throughput is only an estimate: artifact sizes vary and saving is separate.
export function sampleDownloadMetrics(previous, job, time) {
  const sample = { time, bytes: job.transferred_bytes || 0, days: job.completed_days || 0 }
  const signature = JSON.stringify([job.status, job.stage, job.total_days, job.from_date, job.to_date])
  const last = previous?.samples.at(-1)
  const reset = !last || previous.signature !== signature || sample.bytes < last.bytes || sample.days < last.days || time <= last.time || time - last.time > 10000
  const samples = reset ? [sample] : [...previous.samples.filter(item => time - item.time <= 30000), sample]
  const first = samples[0], elapsed = (time - first.time) / 1000
  const running = job.status === 'running' && job.stage !== 'processing'
  const bytes_per_second = running && elapsed > 0 ? (sample.bytes - first.bytes) / elapsed : null
  const lastAdvance = reset ? time : sample.days > last.days ? time : previous.lastAdvance
  const gained = sample.days - first.days, remaining = Math.max(0, (job.total_days || 0) - sample.days)
  const estimated_seconds_remaining = running && elapsed >= 10 && gained >= 3 && remaining > 0 && time - lastAdvance <= 15000 ? remaining * elapsed / gained : null
  return { state: { signature, samples, lastAdvance }, metrics: { bytes_per_second, estimated_seconds_remaining } }
}

export function downloadEtaDuration(seconds) {
  if (!Number.isFinite(seconds) || seconds <= 0) return null
  if (seconds < 60) return { count: Math.ceil(seconds), unit: 'duration.second' }
  if (seconds < 3600) return { count: Math.ceil(seconds / 60), unit: 'duration.minute' }
  if (seconds < 86400) return { count: Math.ceil(seconds / 3600), unit: 'duration.hour' }
  return { count: Math.ceil(seconds / 86400), unit: 'duration.day' }
}
