import { createHash } from 'node:crypto'
import { readFile, writeFile, rename, mkdir, open } from 'node:fs/promises'
import { resolve, dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import dukascopy from 'dukascopy-node'

const { instrumentMetaData, generateUrls, BufferFetcher, processData } = dukascopy
export const metadata = Object.entries(instrumentMetaData).map(([id, item]) => ({ id, ...item }))
const MAX_BYTES = 2 * 1024 * 1024
const DAY = 86400000
const hash = data => createHash('sha256').update(data).digest('hex')
const emit = value => process.stdout.write(JSON.stringify(value) + '\n')
export async function atomicJson(path, value) {
  await writeFile(path + '.tmp', JSON.stringify(value))
  await rename(path + '.tmp', path)
}

export async function fetchRaw(url, fetchFn = fetch, onBytes = () => {}) {
  if (!/^https:\/\/jetta\.dukascopy\.com\/v1\/candles\/minute\/[^/?]+\/BID\/\d{4}\/\d{1,2}\/\d{1,2}$/.test(url)) throw Error('invalid_source_url')
  let response
  try { response = await fetchFn(url, { signal:AbortSignal.timeout(15000), redirect:'error' }) }
  catch { throw Error('source_unavailable') }
  if (response.status !== 200) {
    await response.body?.cancel()
    const error = Error(response.status === 429 ? 'source_rate_limited' : 'source_unavailable')
    const retry = response.headers.get('retry-after')
    const seconds = /^\d+$/.test(retry || '') ? Number(retry) : Math.ceil((Date.parse(retry) - Date.now()) / 1000)
    error.retryAfter = response.status === 429 ? Math.min(86400, Math.max(300, seconds || 0)) : 60
    throw error
  }
  const reader = response.body.getReader(), chunks = []
  let bytes = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      bytes += value.byteLength
      onBytes(value.byteLength)
      if (bytes > MAX_BYTES) throw Error('invalid_source_data')
      chunks.push(Buffer.from(value))
    }
  } catch (error) { await reader.cancel(); throw Error(error.message === 'invalid_source_data' ? error.message : 'source_unavailable') }
  return Buffer.concat(chunks)
}

export function originalCandles(url, buffer, start, end) {
  // The upstream normalizer inserts flat bars. Retain only timestamps present in the original feed.
  const raw = JSON.parse(buffer.toString('utf8'))
  if (!Array.isArray(raw.times) || raw.times.length > 1440 || raw.shift !== 60000 || !Number.isSafeInteger(raw.timestamp)
      || raw.timestamp % DAY !== 0 || raw.timestamp !== start || !Number.isFinite(raw.multiplier) || raw.multiplier <= 0) throw Error('invalid_source_data')
  for (const key of ['opens','highs','lows','closes','volumes']) {
    if (!Array.isArray(raw[key]) || raw[key].length !== raw.times.length || raw[key].some(v => !Number.isFinite(v))) throw Error('invalid_source_data')
  }
  const originalTimes = new Set()
  let timestamp = raw.timestamp
  for (const [i, delta] of raw.times.entries()) {
    if (!Number.isSafeInteger(delta) || delta < 0 || delta > 1440 || (i > 0 && delta === 0)) throw Error('invalid_source_data')
    timestamp += delta * raw.shift
    if (timestamp < start || timestamp >= end) throw Error('invalid_source_data')
    originalTimes.add(timestamp)
  }
  const processed = processData({ requestedTimeframe:'m1', bufferObjects:[{url,buffer}], priceType:'bid', volumes:true, volumeUnits:'units', ignoreFlats:false })
  const rows = processed.filter(row => originalTimes.has(row[0]))
  if (rows.length !== raw.times.length) throw Error('invalid_source_data')
  for (const [ts,o,h,l,c,v] of rows) {
    if (![ts,o,h,l,c,v].every(Number.isFinite) || ts % 60000 || o <= 0 || l <= 0 || c <= 0 || h < Math.max(o,c) || l > Math.min(o,c) || v < 0) throw Error('invalid_source_data')
  }
  return rows
}

export async function download(requestPath, { fetchFn = fetch, notify = emit, pauseMs, concurrency, progressIntervalMs = 250, sleepFn = ms => new Promise(resolve => setTimeout(resolve,ms)) } = {}) {
  const folder = dirname(resolve(requestPath)), request = JSON.parse(await readFile(requestPath, 'utf8'))
  concurrency ??= request.pacing?.concurrency ?? 3
  pauseMs ??= request.pacing?.pause_ms ?? 1000
  if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 4) throw Error('invalid_concurrency')
  if (!Number.isInteger(pauseMs) || pauseMs < 0 || pauseMs > 30000) throw Error('invalid_pause')
  const meta = metadata.find(item => item.name === request.instrument_id)
  if (!meta) throw Error('instrument_not_supported')
  const start = Date.parse(request.from_date + 'T00:00:00Z'), end = Date.parse(request.to_date + 'T00:00:00Z') + DAY
  const total = (end-start)/DAY
  if (!/^\d{4}-\d{2}-\d{2}$/.test(request.from_date) || !/^\d{4}-\d{2}-\d{2}$/.test(request.to_date)
      || !Number.isInteger(total) || total < 1 || end > Math.floor(Date.now()/DAY)*DAY
      || new Date(start).toISOString().slice(0,10) !== request.from_date || new Date(end-DAY).toISOString().slice(0,10) !== request.to_date
      || start < Date.parse(meta.startDayForMinuteCandles.slice(0,10) + 'T00:00:00Z')) throw Error('invalid_date_range')
  await mkdir(join(folder,'raw'), {recursive:true})
  const receiptPath = join(folder,'buckets.json')
  let receipt = { version:1, library:'dukascopy-node@1.50.0', instrument_id:request.instrument_id, buckets:{} }
  try { receipt = JSON.parse(await readFile(receiptPath,'utf8')) } catch (error) { if (error.code !== 'ENOENT') throw Error('invalid_source_data') }
  if (receipt.instrument_id !== request.instrument_id || receipt.version !== 1) throw Error('invalid_source_data')
  const output = await open(join(folder,'candles.csv.tmp'),'w')
  let rowCount = 0, transferredBytes = Number(request.transferred_bytes) || 0, cachedBytes = 0, completedDays = 0, lastProgressAt = -Infinity
  const progress = (force = false) => {
    const now = performance.now()
    if (!force && now - lastProgressAt < progressIntervalMs) return
    lastProgressAt = now
    notify({event:'progress',completed_days:completedDays,total_days:total,
      transferred_bytes:transferredBytes,cached_bytes:cachedBytes,stage:'downloading'})
  }
  try {
    await output.writeFile('time,open,high,low,close,volume\n')
    const urls = generateUrls({instrument:meta.id,timeframe:'m1',priceType:'bid',startDate:new Date(start),endDate:new Date(end)})
    if (urls.length !== total || urls.some(url => url.includes('?'))) throw Error('invalid_date_range')
    const readBucket = async (url, i) => {
      const fileName = hash(url) + '.json', rawPath = join(folder,'raw',fileName)
      let buffer, cached = false
      let bucket = receipt.buckets[url]
      try { bucket = JSON.parse(await readFile(rawPath+'.receipt.json','utf8')) }
      catch (error) { if (error.code !== 'ENOENT') throw Error('invalid_source_data') }
      if (bucket) {
        buffer = await readFile(rawPath)
        if (buffer.length > MAX_BYTES || hash(buffer) !== bucket.sha256) throw Error('invalid_source_data')
        cached = true
        cachedBytes += buffer.length
      } else {
        const fetcher = new BufferFetcher({batchSize:1,retryCount:0,fetcherFn:value => fetchRaw(value,fetchFn,bytes => { transferredBytes += bytes; progress() })})
        const objects = await fetcher.fetch([url])
        if (objects.length !== 1) throw Error('invalid_source_data')
        buffer = objects[0].buffer
      }
      const rows = originalCandles(url,buffer,start+i*DAY,start+(i+1)*DAY)
      if (!cached) {
        await writeFile(rawPath+'.tmp',buffer)
        await rename(rawPath+'.tmp',rawPath)
        bucket = {sha256:hash(buffer),file:'raw/'+fileName,row_count:rows.length}
        // Persist one bounded bucket receipt; rewriting the full index daily is quadratic for decades of M1.
        await atomicJson(rawPath+'.receipt.json',bucket)
      }
      receipt.buckets[url] = bucket
      return { rows, cached }
    }
    for (let offset = 0; offset < urls.length; offset += concurrency) {
      let firstFailure
      // Drain the bounded batch even on failure. Successful buckets remain durable for resume,
      // and no work from a later batch can escape the rate-limit/cancellation boundary.
      const batch = await Promise.allSettled(urls.slice(offset, offset + concurrency).map((url, index) =>
        readBucket(url, offset + index).catch(error => {
          if (!firstFailure || (error.message === 'source_rate_limited' &&
              (firstFailure.message !== 'source_rate_limited' || error.retryAfter > firstFailure.retryAfter))) firstFailure = error
          throw error
        })))
      if (firstFailure) throw firstFailure
      let fetched = false
      for (const result of batch) {
        const { rows, cached } = result.value
        if (rows.length) await output.writeFile(rows.map(row => [row[0]/1000,...row.slice(1)].join(',')).join('\n')+'\n')
        rowCount += rows.length
        completedDays++
        fetched ||= !cached
        progress(true)
      }
      if (fetched && offset + concurrency < urls.length && pauseMs > 0) await sleepFn(pauseMs)
    }
  } finally { await output.close() }
  if (rowCount < 2 && !/^dataset-[a-f0-9]{64}$/.test(request.parent_dataset_id || '')) throw Error('empty_range')
  await atomicJson(receiptPath,receipt)
  await rename(join(folder,'candles.csv.tmp'),join(folder,'candles.csv'))
  notify({event:'complete',row_count:rowCount,buckets_sha256:hash(await readFile(receiptPath)),transferred_bytes:transferredBytes,cached_bytes:cachedBytes,stage:'processing'})
  return rowCount
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  if (process.argv[2] === '--metadata') emit({version:'1.50.0',items:metadata})
  else download(process.argv[2]).catch(error => { emit({event:'error',error:['source_rate_limited','source_unavailable','invalid_date_range','instrument_not_supported','empty_range'].includes(error.message) ? error.message : 'invalid_source_data',retry_after_seconds:error.retryAfter || 60}); process.exitCode = 1 })
}
