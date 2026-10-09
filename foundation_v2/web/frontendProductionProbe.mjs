import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { readFile, stat, mkdir, writeFile, readdir } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { gzipSync } from 'node:zlib'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import os from 'node:os'
import { chromium } from 'playwright'

const here = path.dirname(fileURLToPath(import.meta.url))
const summary = values => {
  const sorted = [...values].sort((a, b) => a - b)
  return { count: sorted.length, median: (sorted[Math.floor((sorted.length - 1) / 2)] + sorted[Math.floor(sorted.length / 2)]) / 2, sampleP95: sorted[Math.ceil(sorted.length * .95) - 1] }
}

// Static imports belong to startup. Dynamic imports are inspected separately;
// mentioning a Replay filename in Vite's preload map does not eagerly load it.
export function staticImports(code) {
  return [...code.matchAll(/(?:^|[;\n}])\s*(?:import\s*(?:[^;\n]*?\bfrom\s*)?|export\s*[^;\n]*?\bfrom\s*)["']([^"']+)["']/g)].map(match => match[1])
}

export async function bundleAudit(dist) {
  const html = await readFile(path.join(dist, 'index.html'), 'utf8')
  const initial = [...html.matchAll(/(?:src|href)=["'](\/assets\/[^"']+)["']/g)].map(match => match[1].slice(1))
  const graph = new Map(), visited = new Set(), queue = [...initial]
  while (queue.length) {
    const name = queue.shift()
    if (visited.has(name)) continue
    visited.add(name)
    const content = await readFile(path.join(dist, name))
    const deps = name.endsWith('.js') ? staticImports(content.toString()).filter(value => value.startsWith('.')).map(value => path.posix.normalize(path.posix.join(path.posix.dirname(name), value))) : []
    graph.set(name, { bytes: content.length, gzipBytes: gzipSync(content).length, sha256: createHash('sha256').update(content).digest('hex'), staticImports: deps })
    queue.push(...deps)
  }
  const assets = await readdir(path.join(dist, 'assets'))
  return {
    schema: 'production-critical-bundle-v1', initialAssets: initial, staticCriticalGraph: Object.fromEntries(graph),
    criticalRawBytes: [...graph.values()].reduce((sum, entry) => sum + entry.bytes, 0),
    criticalGzipBytes: [...graph.values()].reduce((sum, entry) => sum + entry.gzipBytes, 0),
    replayInCriticalGraph: [...graph.keys()].some(name => /ReplayWorkspace|advancedReplay|charting_library/i.test(name)),
    replayLazyAssets: assets.filter(name => /ReplayWorkspace/.test(name)),
    limits: ['Static graph covers emitted local module imports; actual dashboard requests are checked separately.', 'Gzip values are estimates, not transferred bytes unless the server negotiates gzip. Vendor chart assets live outside this Vite build.'],
  }
}

async function fixtureServer(dist) {
  const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2' }
  const server = createServer(async (request, response) => {
    try {
      const pathname = decodeURIComponent(new URL(request.url, 'http://127.0.0.1').pathname)
      if (request.method !== 'GET' || pathname.startsWith('/api/')) { response.writeHead(403); response.end(); return }
      const file = path.resolve(dist, pathname === '/' ? 'index.html' : `.${pathname}`)
      const relative = path.relative(dist, file)
      if (relative.startsWith('..') || path.isAbsolute(relative) || !(await stat(file)).isFile()) { response.writeHead(404); response.end(); return }
      const content = await readFile(file)
      const compress = /gzip/.test(request.headers['accept-encoding'] || '') && ['.js', '.css', '.html'].includes(path.extname(file))
      const body = compress ? gzipSync(content) : content
      response.writeHead(200, { 'Content-Type': mime[path.extname(file)] || 'application/octet-stream', 'Content-Length': body.length, 'Cache-Control': pathname.startsWith('/assets/') ? 'public, max-age=31536000, immutable' : 'no-store', ...(compress ? { 'Content-Encoding': 'gzip', Vary: 'Accept-Encoding' } : {}) })
      response.end(body)
    } catch { response.writeHead(404); response.end() }
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  return { server, origin: `http://127.0.0.1:${server.address().port}` }
}

async function sample(page, origin, index, cacheState) {
  const errors = [], resources = new Set()
  const consoleListener = message => { if (message.type() === 'error') errors.push('console-error') }
  const errorListener = () => errors.push('page-error')
  const resourceListener = request => resources.add(new URL(request.url()).pathname)
  page.on('console', consoleListener); page.on('pageerror', errorListener); page.on('request', resourceListener)
  try {
    await page.goto(`${origin}/?workspace=benchmark-fixture&view=overview&area=testing&section=dashboard&demo=1`, { waitUntil: 'domcontentloaded' })
    await page.locator('.fx-dashboard-session-list').waitFor({ state: 'visible', timeout: 15000 })
    const result = await page.evaluate(async () => {
      const contentReadyMs = await window.__probeContentReady
      const entries = performance.getEntriesByType('resource')
      const n = performance.getEntriesByType('navigation')[0]
      return { contentReadyMs, domContentLoadedMs: n.domContentLoadedEventEnd, ttfbMs: n.responseStart, resourceCount: entries.length, transferBytes: entries.reduce((sum, entry) => sum + entry.transferSize, 0), encodedBodyBytes: entries.reduce((sum, entry) => sum + entry.encodedBodySize, 0), decodedBodyBytes: entries.reduce((sum, entry) => sum + entry.decodedBodySize, 0), resourceTypes: entries.reduce((acc, entry) => { const type = ['script', 'css', 'fetch', 'xmlhttprequest', 'img', 'link'].includes(entry.initiatorType) ? entry.initiatorType : 'other'; acc[type] = (acc[type] || 0) + 1; return acc }, {}), longTasks: window.__probeLongTasks.count, longTaskMs: window.__probeLongTasks.ms, sessionCards: document.querySelectorAll('.fx-dashboard-session-card').length }
    })
    assert.equal(errors.length, 0, `browser errors in ${cacheState} sample ${index}`)
    assert.ok(result.sessionCards > 0, 'populated dashboard fixture did not render')
    assert.ok(![...resources].some(name => /charting_library|ReplayWorkspace|advancedReplay/.test(name)), 'dashboard requested a replay/vendor chunk')
    assert.ok(![...resources].some(name => name.startsWith('/api/')), 'demo fixture unexpectedly requested backend data')
    return { sample: index, cacheState, ...result, replayOrVendorRequested: false, backendRequested: false }
  } finally { page.off('console', consoleListener); page.off('pageerror', errorListener); page.off('request', resourceListener) }
}

export async function runProbe({ dist, output, samples = 30 }) {
  assert.ok(Number.isInteger(samples) && samples >= 30 && samples <= 100, 'samples must be 30–100 per cache state')
  const absolute = path.resolve(dist)
  const audit = await bundleAudit(absolute)
  const { server, origin } = await fixtureServer(absolute)
  let browser
  try {
    browser = await chromium.launch({ headless: true })
    const rows = []
    const configure = async context => {
      await context.addInitScript(() => {
        window.__probeLongTasks = { count: 0, ms: 0 }
        if (PerformanceObserver.supportedEntryTypes.includes('longtask')) new PerformanceObserver(list => { for (const entry of list.getEntries()) { window.__probeLongTasks.count += 1; window.__probeLongTasks.ms += entry.duration } }).observe({ type: 'longtask', buffered: true })
        // Record inside the browser so Playwright polling/IPC is not counted as
        // application content-ready time. The fixture asserts populated cards.
        window.__probeContentReady = new Promise(resolve => {
          const check = () => {
            const content = document.querySelector('.fx-dashboard-session-list')
            if (!content || !content.querySelector('.fx-dashboard-session-card') || !content.getBoundingClientRect().height) return
            observer.disconnect()
            requestAnimationFrame(() => requestAnimationFrame(() => resolve(performance.now())))
          }
          const observer = new MutationObserver(check)
          observer.observe(document, { childList: true, subtree: true })
          check()
        })
      })
    }
    // Alternate cold and warm to reduce systematic drift. Warm has a priming
    // navigation in its retained context; cold uses a fresh browser context.
    const warmContext = await browser.newContext({ viewport: { width: 1440, height: 900 }, serviceWorkers: 'block' })
    await configure(warmContext)
    const warm = await warmContext.newPage()
    await sample(warm, origin, 0, 'warmup')
    for (let i = 1; i <= samples; i += 1) {
      const coldContext = await browser.newContext({ viewport: { width: 1440, height: 900 }, serviceWorkers: 'block' })
      try { await configure(coldContext); rows.push(await sample(await coldContext.newPage(), origin, i, 'cold')) } finally { await coldContext.close() }
      rows.push(await sample(warm, origin, i, 'warm'))
    }
    await warmContext.close()
    const metrics = ['contentReadyMs', 'domContentLoadedMs', 'ttfbMs', 'resourceCount', 'transferBytes', 'encodedBodyBytes', 'decodedBodyBytes', 'longTasks', 'longTaskMs']
    const summaries = Object.fromEntries(['cold', 'warm'].map(state => [state, Object.fromEntries(metrics.map(metric => [metric, summary(rows.filter(row => row.cacheState === state).map(row => row[metric]))]))]))
    const result = { schema: 'production-frontend-fixture-probe-v1', generatedUtc: new Date().toISOString(), scope: 'populated built-in demo dashboard, production bundle, loopback gzip HTTP, no backend/provider reads', machine: { platform: os.platform(), arch: os.arch(), cpu: os.cpus()[0]?.model, logicalCpus: os.cpus().length, totalMemoryBytes: os.totalmem() }, browser: await browser.version(), viewport: { width: 1440, height: 900 }, cacheMethod: 'fresh context cold; retained context after priming warm; alternating samples; one browser process', samplesPerCacheState: samples, summaries, samples: rows, bundleAudit: audit, limitations: ['No financial/API/worker correctness or capacity measured.', 'This is controlled UI fixture latency, not whole-app speedup; no baseline/candidate A/B claim.', 'Long tasks ending after the content-ready checkpoint are outside this sample.', 'No CPU/network throttling. Headless loopback timings do not establish user field Core Web Vitals.'] }
    await mkdir(path.dirname(output), { recursive: true })
    await writeFile(output, `${JSON.stringify(result, null, 2)}\n`)
    return result
  } finally {
    if (browser) await browser.close()
    await new Promise(resolve => { server.close(resolve); server.closeAllConnections() })
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2), option = (name, fallback) => { const i = args.indexOf(name); return i < 0 ? fallback : args[i + 1] }
  const result = await runProbe({ dist: option('--dist', path.join(here, '../.runtime/frontend-research-20261009/dist')), output: path.resolve(option('--output', path.join(here, '../evidence/frontend-implementation-20261009/metrics/production-fixture.json'))), samples: Number(option('--samples', '30')) })
  console.log(JSON.stringify({ status: 'PASS', samplesPerCacheState: result.samplesPerCacheState, summaries: result.summaries, criticalGzipBytes: result.bundleAudit.criticalGzipBytes, replayInCriticalGraph: result.bundleAudit.replayInCriticalGraph }, null, 2))
}
