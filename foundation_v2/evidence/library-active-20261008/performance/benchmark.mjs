// Isolated comparison of pinned source commits. No real requests or service changes.
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve, join, relative } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = fileURLToPath(new URL('../../../../', import.meta.url))
const workerPath = 'foundation_v2/data_worker/index.mjs'
const packageUrl = pathToFileURL(join(root, 'foundation_v2/data_worker/node_modules/dukascopy-node/dist/index.js')).href
const commits = [
  ['baseline', 'fa52a806bce492f1cb46626cb6a6a894f94d5971'],
  ['optimized', 'efe87fe']
]
const load = async revision => {
  const source = execFileSync('git', ['show', `${revision}:${workerPath}`], { cwd:root, encoding:'utf8' })
    .replace("import dukascopy from 'dukascopy-node'", `import dukascopy from '${packageUrl}'`)
  return import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'))
}
const folder = await mkdtemp(join(tmpdir(), 'tw-perf-fixture-'))
const digest = text => createHash('sha256').update(text).digest('hex')
try {
  const results = []
  for (const [name, revision] of commits) {
    const { download } = await load(revision)
    const dir = join(folder, name)
    await mkdir(dir)
    const request = join(dir, 'request.json')
    await writeFile(request, JSON.stringify({ instrument_id:'EUR/USD', from_date:'2026-01-05', to_date:'2026-02-03' }))
    let calls = 0, active = 0, maxActive = 0, events = 0, bytes = 0
    const fetchFn = async url => {
      calls++; active++; maxActive = Math.max(maxActive, active)
      await new Promise(done => setTimeout(done, 15))
      active--
      const [year, month, day] = url.split('/').slice(-3).map(Number)
      const zeros = Array(1440).fill(0), ones = Array(1440).fill(1)
      const body = JSON.stringify({ timestamp:Date.UTC(year, month-1, day), multiplier:0.00001, shift:60000,
        open:1.1, high:1.1, low:1.1, close:1.1, times:[0,...Array(1439).fill(1)],
        opens:zeros, highs:zeros, lows:zeros, closes:zeros, volumes:ones })
      bytes += Buffer.byteLength(body)
      return new Response(body)
    }
    let at = performance.now()
    await download(request, { fetchFn, notify:()=>events++, pauseMs:25 })
    const coldMs = performance.now() - at
    at = performance.now()
    await download(request, { fetchFn:async()=>{ throw Error('network on resume') }, notify:()=>{}, pauseMs:25 })
    const cachedMs = performance.now() - at
    results.push({ name, commit:execFileSync('git',['rev-parse',revision],{cwd:root,encoding:'utf8'}).trim(),
      cold_ms:Math.round(coldMs), cached_ms:Math.round(cachedMs), calls, max_active:maxActive, events, bytes,
      csv_sha256:digest(await readFile(join(dir,'candles.csv'))) })
  }
  assert.equal(results[0].csv_sha256, results[1].csv_sha256)
  assert.equal(results[0].bytes, results[1].bytes)
  for (const result of results) assert.equal(result.calls,30)
  assert.equal(results[0].max_active,1)
  assert.equal(results[1].max_active,3)
  console.log(JSON.stringify({fixture:'30 days, 1440 source rows/day, 15ms simulated response,25ms batch pause; local IO, not live-network benchmark',
    recorded_at_utc:new Date().toISOString(), node:process.version, results},null,2))
} finally {
  const withinTemp = relative(resolve(tmpdir()),resolve(folder))
  if (!withinTemp.startsWith('tw-perf-fixture-') || withinTemp.includes('..')) throw Error('unsafe temp cleanup')
  await rm(folder,{recursive:true,force:true})
}
