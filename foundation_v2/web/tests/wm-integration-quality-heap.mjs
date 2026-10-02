import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { readdirSync, readFileSync, createWriteStream } from 'node:fs'
import { createHash } from 'node:crypto'
import { performance as hostClock } from 'node:perf_hooks'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'

const webRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const args = Object.fromEntries(process.argv.slice(2).map((arg) => { const i = arg.indexOf('='); return [arg.slice(2, i), arg.slice(i + 1)] }))
const origin = args.origin || 'http://127.0.0.1:5180'
assert.equal(new URL(origin).hostname, '127.0.0.1')
const iterations = Number(args.iterations || 120)
const dwellMs = Number(args.dwell || 250)
const durationMs = Number(args.seconds || 0) * 1000
const checkpointMs = Number(args['checkpoint-seconds'] || 60) * 1000
assert.ok(Number.isInteger(iterations) && iterations > 0 && iterations <= 20000)
assert.ok(dwellMs >= 0 && dwellMs <= 10000)
assert.ok(Number.isFinite(durationMs) && durationMs >= 0 && durationMs <= 7200000)
assert.ok(Number.isFinite(checkpointMs) && checkpointMs >= 1000 && checkpointMs <= 60000)
const arms = (args.arms || 'dwell,filters,pagination,full').split(',')
for (const arm of arms) assert.ok(['dwell', 'filters', 'pagination', 'full'].includes(arm))
const out = path.resolve(args.out || path.join(webRoot, '../../../../.artifacts', `wm-integration-quality-heap-${Date.now()}`))
await mkdir(out, { recursive: true })
function fingerprint() {
  const hash = createHash('sha256')
  const root = path.join(webRoot, 'src')
  for (const name of readdirSync(root, { recursive: true }).filter((name) => /\.(jsx?|css)$/.test(name)).sort()) hash.update(name).update(readFileSync(path.join(root, name)))
  return hash.digest('hex')
}
const ledger = Array.from({ length: 5000 }, (_, index) => ({ trade_id: `quality-${index}`, open_time_utc: new Date(Date.UTC(2024, 0, 1) + index * 86400000).toISOString(), close_time_utc: new Date(Date.UTC(2024, 0, 1) + index * 86400000).toISOString(), net_pnl: [12, -7, 0][index % 3], realized_r: [1.2, -.7, 0][index % 3], side: index % 2 ? 'sell' : 'buy', source: { session_id: 'quality-fixture' } }))
let balance = 1000
const fixture = {
  schema_version: 'analytics-read-model-v1', analytics_available: true, stale: false,
  provenance: { dataset_id: 'quality-fixture', dataset_sha256: 'quality-fixture-sha', protocol_sha256: 'quality-protocol-sha', metrics_schema_version: 'metrics-v2', split: 'research', playbook_id: 'quality-fixture', status: 'fresh' },
  scope: { selected_trade_count: ledger.length, total_trade_count: ledger.length, observed_range: { first_close_utc: ledger[0].close_time_utc, last_close_utc: ledger.at(-1).close_time_utc }, balance_curve_scope: 'closed trades' },
  metrics: { closed_trade_count: ledger.length, net_pnl: ledger.reduce((sum, row) => sum + row.net_pnl, 0), closed_trade_balance_curve: ledger.map((row) => ({ trade_id: row.trade_id, closed_trade_balance: (balance += row.net_pnl) })), closed_trade_balance_max_drawdown: 7, definitions: {} }, ledger,
}
const report = { scope: '5000-row intercepted analytics fixture; precise CDP heap measurement; not integrated product acceptance', sourceBefore: fingerprint(), iterations, durationMs, checkpointMs, dwellMs, pid: process.pid, arms: [], failures: [], startedAt: new Date().toISOString() }
await writeFile(path.join(out, 'process.json'), JSON.stringify({ pid: process.pid, startedAt: report.startedAt, origin, sourceBefore: report.sourceBefore, fixtureRows: ledger.length, iterations, durationMs, checkpointMs, dwellMs, arms, argv: process.argv.slice(2) }, null, 2))
const browser = await chromium.launch({ headless: true })
try {
  for (const arm of arms) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
    const page = await context.newPage()
    const cdp = await context.newCDPSession(page)
    const hostStart = hostClock.now()
    const result = { arm, samples: [], pageErrors: [], interactionErrors: [], documentEvents: [], sameDocumentEvents: 0, unexpectedRequests: [] }
    report.arms.push(result)
    page.on('pageerror', (error) => result.pageErrors.push(String(error)))
    await cdp.send('Page.enable')
    await cdp.send('HeapProfiler.enable')
    cdp.on('Page.frameNavigated', ({ frame }) => { if (!frame.parentId) result.documentEvents.push({ hostElapsedMs: hostClock.now() - hostStart, loaderId: frame.loaderId, url: frame.url }) })
    cdp.on('Page.navigatedWithinDocument', () => { result.sameDocumentEvents += 1 })
    await page.route('**/*', async (route) => {
      const request = route.request()
      const url = new URL(request.url())
      if (url.origin !== origin || request.method() !== 'GET') { result.unexpectedRequests.push({ method: request.method(), url: request.url() }); return route.abort() }
      if (!url.pathname.startsWith('/api/')) return route.continue()
      let payload = { items: [] }
      if (url.pathname.endsWith('/analytics')) payload = fixture
      else if (url.pathname.endsWith('/overview')) payload = { counts: { datasets: 1, research_jobs: { completed: 1 }, records: { sessions: 1 } } }
      return route.fulfill({ contentType: 'application/json', body: JSON.stringify(payload) })
    })
    await page.addInitScript(() => {
      window.__wmQuality = { frameIntervals: [], frameCount: 0, longTasks: [], longTaskCount: 0, priorFrame: null }
      const state = window.__wmQuality
      new PerformanceObserver((list) => { for (const entry of list.getEntries()) state.longTasks[(state.longTaskCount++) % 1000] = { duration: entry.duration, startTime: entry.startTime } }).observe({ type: 'longtask', buffered: true })
      function tick(now) { if (state.priorFrame !== null) state.frameIntervals[(state.frameCount++) % 12000] = now - state.priorFrame; state.priorFrame = now; requestAnimationFrame(tick) }
      requestAnimationFrame(tick)
    })
    const frame = () => page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))))
    async function interact(index) {
      if (arm === 'filters' || arm === 'full') {
        await page.getByLabel('Analytics outcome', { exact: true }).selectOption(['all', 'win', 'loss'][index % 3])
        await page.getByLabel('Analytics side', { exact: true }).selectOption(['all', 'buy', 'sell'][index % 3])
      }
      if (arm === 'pagination' || arm === 'full') {
        const button = page.getByRole('button', { name: index % 2 ? 'Trang trước' : 'Trang sau', exact: true })
        if (await button.isEnabled()) await button.click()
        await page.evaluate((offset) => { const node = document.querySelector('.fx-content'); if (node) node.scrollTop = offset }, index % 2 ? 0 : 1500)
      }
      await frame()
    }
    async function sample(iteration) {
      const gcStarted = hostClock.now()
      const afterGc = []
      for (let count = 0; count < 2; count++) {
        await cdp.send('HeapProfiler.collectGarbage')
        await frame()
        afterGc.push(await cdp.send('Runtime.getHeapUsage'))
      }
      const document = await page.evaluate(() => ({ timeOrigin: performance.timeOrigin, documentElapsedMs: performance.now(), navigationEntries: performance.getEntriesByType('navigation').map(({ type, startTime, duration }) => ({ type, startTime, duration })), nodes: document.querySelectorAll('*').length, rows: document.querySelectorAll('tbody tr').length, overflowX: document.documentElement.scrollWidth - innerWidth, url: location.href }))
      result.samples.push({ iteration, hostElapsedMs: hostClock.now() - hostStart, collectionMs: hostClock.now() - gcStarted, afterGc, document })
      await writeFile(path.join(out, 'progress.json'), JSON.stringify(report, null, 2))
    }
    try {
      await page.goto(`${origin}/?view=analytics&workspace=quality-fixture&job=quality-large`, { waitUntil: 'networkidle' })
      await page.getByLabel('Analytics outcome', { exact: true }).waitFor({ timeout: 10000 })
      for (let i = 0; i < 20; i++) await interact(i)
      await sample(-1)
      const measuredStart = hostClock.now()
      let lastCheckpoint = hostClock.now()
      let completedIterations = 0
      for (let i = 0; durationMs ? hostClock.now() - measuredStart < durationMs : i < iterations; i++) {
        try { await interact(i) } catch (error) { result.interactionErrors.push({ iteration: i, error: String(error) }); break }
        if (dwellMs) await new Promise((resolve) => setTimeout(resolve, dwellMs))
        completedIterations = i + 1
        if (hostClock.now() - lastCheckpoint >= checkpointMs) {
          await sample(i)
          lastCheckpoint = hostClock.now()
        }
      }
      await sample(completedIterations - 1)
      const first = result.samples[0]
      const last = result.samples.at(-1)
      const heapValues = result.samples.map((item) => item.afterGc.at(-1).usedSize)
      result.summary = { durationMs: hostClock.now() - hostStart, measuredDurationMs: hostClock.now() - measuredStart, completedIterations, baselineUsedBytes: heapValues[0], finalUsedBytes: heapValues.at(-1), peakUsedBytes: Math.max(...heapValues), deltaUsedBytes: heapValues.at(-1) - heapValues[0], documentTimeOrigins: [...new Set(result.samples.map((item) => item.document.timeOrigin))], domDelta: last.document.nodes - first.document.nodes }
      result.frameObservation = await page.evaluate(() => window.__wmQuality)
      const frames = [...result.frameObservation.frameIntervals].sort((a, b) => a - b)
      result.summary.frameP95Ms = frames[Math.floor(frames.length * .95)] ?? null
      result.summary.maxLongTaskMs = Math.max(0, ...result.frameObservation.longTasks.map((entry) => entry.duration))
      result.verdicts = { requestedDuration: !durationMs || result.summary.measuredDurationMs >= durationMs, preciseBytesPresent: result.samples.every((item) => item.afterGc.every(({ usedSize }) => Number.isFinite(usedSize) && usedSize > 0)), sameDocument: result.summary.documentTimeOrigins.length === 1 && result.documentEvents.length === 1, hostTimeMonotonic: result.samples.every((item, index, all) => index === 0 || item.hostElapsedMs > all[index - 1].hostElapsedMs), heapDeltaWithinHistorical12MiB: result.summary.deltaUsedBytes <= 12 * 1024 * 1024, interactions: result.interactionErrors.length === 0, pageErrors: result.pageErrors.length === 0, overflow: result.samples.every((item) => item.document.overflowX <= 2), localReadOnly: result.unexpectedRequests.length === 0 }
      if (args.snapshot === 'true') {
        const stream = createWriteStream(path.join(out, `${arm}-final.heapsnapshot`))
        const onChunk = ({ chunk }) => stream.write(chunk)
        cdp.on('HeapProfiler.addHeapSnapshotChunk', onChunk)
        await cdp.send('HeapProfiler.takeHeapSnapshot', { reportProgress: false })
        cdp.off('HeapProfiler.addHeapSnapshotChunk', onChunk)
        await new Promise((resolve, reject) => { stream.on('error', reject); stream.end(resolve) })
      }
      if (Object.values(result.verdicts).some((value) => !value)) report.failures.push({ arm, verdicts: result.verdicts })
    } catch (error) { report.failures.push({ arm, error: String(error) }) }
    finally { await context.close() }
  }
} finally {
  await browser.close()
  report.sourceAfter = fingerprint()
  if (report.sourceBefore !== report.sourceAfter) report.failures.push({ reason: 'Source changed during diagnostic; discard acceptance interpretation' })
  report.status = report.failures.length ? 'FAIL_OR_INVALID' : durationMs >= 3600000 ? 'LONG_DURATION_FIXTURE_PASS' : 'BOUNDED_DIAGNOSTIC_PASS'
  await writeFile(path.join(out, 'report.json'), JSON.stringify(report, null, 2))
  console.log(JSON.stringify({ status: report.status, summaries: report.arms.map(({ arm, summary, verdicts }) => ({ arm, summary, verdicts })), failures: report.failures, out }, null, 2))
  if (report.failures.length) process.exitCode = 1
}
