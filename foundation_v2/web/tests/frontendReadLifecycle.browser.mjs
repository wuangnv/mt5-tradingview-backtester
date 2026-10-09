import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { chromium } from 'playwright'

const origin = process.env.TW_UI_ORIGIN || 'http://127.0.0.1:5184'
assert.equal(new URL(origin).hostname, '127.0.0.1')
const output = process.env.TW_LIFECYCLE_OUTPUT ? new URL(`file:///${process.env.TW_LIFECYCLE_OUTPUT.replaceAll('\\', '/').replace(/\/$/, '')}/`) : new URL('../../evidence/frontend-implementation-20261009/lifecycle/', import.meta.url)
await mkdir(output, { recursive: true })
const browser = await chromium.launch({ headless: true })
const report = { scope: 'Production React build, explicit synthetic intercepted APIs; no database/provider/broker calls', cases: [], errors: [], requests: [] }
const workspace = 'lifecycle-fixture', session = 'lifecycle-session', dataset = 'lifecycle-dataset'
const rows = [
  { trade_id: 'fixture-buy', session_id: session, side: 'BUY', net_pnl: 1111, open_time_utc: 1700000000, close_time_utc: 1700000060 },
  { trade_id: 'fixture-sell', session_id: session, side: 'SELL', net_pnl: -2222, open_time_utc: 1700000120, close_time_utc: 1700000180 },
]
const analytics = url => {
  const ledger = rows.filter(row => !url.searchParams.get('side') || row.side.toLowerCase() === url.searchParams.get('side'))
  const net = ledger.reduce((value, row) => value + row.net_pnl, 0)
  return { schema_version: 'analytics-read-model-v1', analytics_available: true, ledger,
    metrics: { closed_trade_count: ledger.length, starting_balance: 10000, net_pnl: net, ending_closed_trade_balance: 10000 + net },
    scope: { selected_trade_count: ledger.length, total_trade_count: rows.length, balance_curve_scope: 'synthetic lifecycle fixture' },
    provenance: { workspace_id: workspace, session_id: session, dataset_id: dataset, dataset_sha256: 'fixture-only', revision: 1, account_currency: 'USD', cursor_index: 4, execution_event_sequence: 0 }, filters: {} }
}
let canonical = 4, revision = 1
const bars = Array.from({ length: 40 }, (_, index) => ({ timestamp: 1700000000 + index * 60, open: 1.1, high: 1.102, low: 1.099, close: 1.101 + index * .00001, volume: 10 }))
const replay = cursor => ({ record_id: session, revision, view_cursor_index: cursor, canonical_cursor_index: canonical,
  cutoff_timestamp: bars[cursor].timestamp, historical_view: cursor < canonical, dataset_sha256: 'fixture-only',
  visible_rows: bars.slice(0, cursor + 1), visible_row_start: 0, visible_row_count: cursor + 1,
  payload: { dataset_id: dataset, cursor_index: cursor, status: 'paused', execution: null, chart_engine: 'lightweight' } })
let denyAnalytics = false, journalFailed = true, tag = 'first-label', holdAnalytics = false, heldSide = 'buy'
let releaseAnalytics, releaseStep, pendingStep = false
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' })
await context.addInitScript(() => { localStorage.setItem('tw-lang', 'en'); localStorage.setItem('tw-theme', 'dark') })
await context.routeWebSocket('**/*', socket => socket.close())
const page = await context.newPage()
page.setDefaultTimeout(12000)
page.on('pageerror', error => report.errors.push(error.message))
await context.route('**/*', async route => {
  const request = route.request(), url = new URL(request.url())
  if (url.origin !== origin) return route.abort()
  if (!url.pathname.startsWith('/api/')) return route.continue()
  report.requests.push({ method: request.method(), path: url.pathname, query: url.search })
  assert.equal(request.headers()['x-workspace-id'], workspace)
  const json = (body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) }).catch(() => {})
  if (url.pathname === `/api/v2/replay/sessions/${session}/step` && request.method() === 'POST') {
    if (pendingStep) await new Promise(resolve => { releaseStep = resolve })
    canonical += Number(request.postDataJSON().steps || 1); revision++
    return json(replay(canonical))
  }
  // Replay activity is local observation telemetry, intercepted and never persisted.
  if (url.pathname.endsWith('/activity') && request.method() === 'POST') return json({ recorded: true })
  assert.equal(request.method(), 'GET', `Unexpected mutation ${url.pathname}`)
  if (url.pathname === `/api/v2/replay/sessions/${session}/analytics`) {
    if (holdAnalytics && url.searchParams.get('side') === heldSide) await new Promise(resolve => { releaseAnalytics = resolve })
    return denyAnalytics ? json({ detail: 'fixture_read_access_revoked' }, 401) : json(analytics(url))
  }
  if (url.pathname === '/api/v2/journal/context') return journalFailed
    ? json({ detail: 'fixture_journal_temporarily_unavailable' }, 503)
    : json({ schema_version: 'replay-journal-context-v1', workspace_id: workspace, session_id: session, record_count: 1, trades: [{ trade_id: 'fixture-buy', record_count: 1, tags: [tag] }] })
  if (url.pathname === `/api/v2/replay/sessions/${session}`) return json(replay(Number(url.searchParams.get('cursor_index') ?? canonical)))
  if (url.pathname === '/api/v2/data/datasets') return json({ items: [{ dataset_id: dataset, instrument_id: 'EURUSD', timeframe_seconds: 60, timeframe: '1m', source: { provider: 'CSV' } }] })
  if (url.pathname === '/api/v2/chart/annotations' || url.pathname === '/api/v2/replay/sessions') return json({ items: [] })
  return json({ detail: 'explicit_lifecycle_fixture_unavailable' }, 503)
})
const href = (view, params = '') => `${origin}/?workspace=${workspace}&view=${view}&surface=workspace&session=${session}${params}`
const navigate = href => page.evaluate(href => {
  const anchor = document.createElement('a'); anchor.href = href; document.body.append(anchor); anchor.click(); anchor.remove()
}, href)
const waitRequest = predicate => page.waitForResponse(response => predicate(new URL(response.url()), response.request().method()))
const metric = () => page.getByTestId('analytics-performance').locator('.fxa-metrics').first().locator('strong').first()
const cursor = value => page.waitForFunction(value => document.querySelector('.chart-bottom-cursor')?.textContent.includes(`#${value} /`), value)
const replayReads = () => report.requests.filter(request => request.method === 'GET' && request.path === `/api/v2/replay/sessions/${session}`).length
const rendered = () => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
try {
  await page.goto(href('analytics'))
  await page.getByTestId('analytics-performance').waitFor()
  assert.match(await metric().textContent(), /1[.,]111/)
  await page.getByText('Chưa đọc được ghi chú và nhãn giao dịch. Số ghi chú hiện chưa xác minh.').waitFor()
  journalFailed = false
  const journalRetry = waitRequest(url => url.pathname === '/api/v2/journal/context')
  await page.getByRole('button', { name: /Thử lại|Retry/ }).click()
  await journalRetry
  await page.getByTestId('analytics-workspace').getByRole('button', { name: /Xuất CSV|Export CSV/ }).waitFor()
  report.cases.push('Journal independent error and explicit retry recover without replacing analytics')

  await page.evaluate(() => { window.__lifecyclePage = document.querySelector('[data-testid="analytics-workspace"]') })
  holdAnalytics = true
  await navigate(href('analytics', '&side=buy'))
  await page.waitForFunction(() => !document.querySelector('[data-testid="analytics-performance"]'))
  await page.waitForFunction(() => document.querySelector('[data-testid="analytics-workspace"]') === window.__lifecyclePage)
  assert.equal(await page.getByTestId('analytics-performance').count(), 0, 'Previous financial scope hidden until replacement result')
  holdAnalytics = false; releaseAnalytics()
  await page.getByTestId('analytics-performance').waitFor()
  assert.match(await metric().textContent(), /1[.,]111/)
  const back = waitRequest(url => url.pathname.endsWith('/analytics') && !url.searchParams.has('side'))
  await page.goBack(); await back
  await page.getByTestId('analytics-performance').waitFor()
  assert.match(await metric().textContent(), /-1[.,]111/)
  const forward = waitRequest(url => url.pathname.endsWith('/analytics') && url.searchParams.get('side') === 'buy')
  await page.goForward(); await forward
  await page.getByTestId('analytics-performance').waitFor()
  assert.match(await metric().textContent(), /1[.,]111/)
  assert.equal(await page.evaluate(() => window.__lifecyclePage === document.querySelector('[data-testid="analytics-workspace"]')), true)
  report.cases.push('Filter changes hide wrong-scope result; Back/Forward restores correct metrics with mounted page retained')

  holdAnalytics = true; heldSide = 'sell'; releaseAnalytics = null
  const heldRead = page.waitForRequest(request => new URL(request.url()).pathname.endsWith('/analytics') && new URL(request.url()).searchParams.get('side') === 'sell')
  const cancelled = page.waitForEvent('requestfailed', { predicate: request => new URL(request.url()).pathname.endsWith('/analytics') && new URL(request.url()).searchParams.get('side') === 'sell' })
  await navigate(href('analytics', '&side=sell')); await heldRead
  const replacement = waitRequest(url => url.pathname.endsWith('/analytics') && !url.searchParams.has('side'))
  await navigate(href('analytics')); await replacement; await cancelled
  holdAnalytics = false; releaseAnalytics?.(); await rendered()
  assert.match(await metric().textContent(), /-1[.,]111/, 'Cancelled prior generation cannot replace current financial result')
  report.cases.push('Superseded analytics transport cancels and cannot overwrite replacement scope')

  tag = 'updated-label'
  const focusJournal = waitRequest(url => url.pathname === '/api/v2/journal/context')
  await page.evaluate(() => window.dispatchEvent(new Event('focus')))
  await focusJournal; await rendered()
  await navigate(href('analytics', '&side=buy&analytics_tag=updated-label'))
  await page.getByTestId('analytics-performance').waitFor(); await rendered()
  assert.match(await metric().textContent(), /1[.,]111/)
  report.cases.push('Focus reconciliation reloads journal annotations; new tag filters retain the matching trade')
  await page.screenshot({ path: new URL('analytics-journal-ready.png', output).pathname.replace(/^\/(\w:)/, '$1') })

  denyAnalytics = true
  const denied = waitRequest(url => url.pathname.endsWith('/analytics'))
  // The refresh handler throttles burst events; test its next eligible focus.
  await page.waitForTimeout(2100)
  await page.evaluate(() => window.dispatchEvent(new Event('focus')))
  await denied
  await page.waitForFunction(() => !document.querySelector('[data-testid="analytics-performance"]'))
  await page.getByText(/fixture_read_access_revoked/).waitFor()
  report.cases.push('Background analytics 401 removes retained financial result instead of rendering stale data')

  await page.goto(href('replay', `&dataset=${dataset}&chart_engine=lightweight&cursor=4`))
  await page.getByTestId('replay-chart').waitFor()
  await cursor(4)
  const initialReads = replayReads()
  const firstStep = waitRequest((url, method) => url.pathname.endsWith('/step') && method === 'POST')
  await page.getByTestId('step-1').click(); await firstStep
  await cursor(5); await rendered()
  assert.equal(replayReads(), initialReads, 'Self mutation URL persistence must not cause redundant GET')
  report.cases.push('Successful replay step persists cursor without reloading the session')
  const external = waitRequest(url => url.pathname === `/api/v2/replay/sessions/${session}` && url.searchParams.get('cursor_index') === '2')
  await navigate(href('replay', `&dataset=${dataset}&chart_engine=lightweight&cursor=2`)); await external; await cursor(2)
  const returnCanonical = waitRequest(url => url.pathname === `/api/v2/replay/sessions/${session}` && url.searchParams.get('cursor_index') === '5')
  await page.goBack(); await returnCanonical; await cursor(5)
  report.cases.push('External same-session cursor navigation and Back resolve historical/canonical window')

  pendingStep = true
  const posted = page.waitForRequest(request => request.method() === 'POST' && request.url().endsWith('/step'))
  await page.getByTestId('step-1').click(); await posted
  await navigate(href('replay', `&dataset=${dataset}&chart_engine=lightweight&cursor=1`))
  await page.waitForURL(url => url.searchParams.get('cursor') === '1')
  await rendered()
  assert.equal(replayReads(), initialReads + 2, 'Pending mutation defers navigation read')
  const deferred = waitRequest(url => url.pathname === `/api/v2/replay/sessions/${session}` && url.searchParams.get('cursor_index') === '1')
  pendingStep = false; releaseStep(); await deferred; await cursor(1)
  assert.equal(new URL(page.url()).searchParams.get('cursor'), '1', 'Command response cannot overwrite newer navigation')
  assert.equal(report.requests.filter(request => request.method === 'POST' && request.path.endsWith('/step')).length, 2)
  report.cases.push('Cursor change while command pending is deferred then reconciled; command result preserves newer URL')
  await page.screenshot({ path: new URL('replay-pending-navigation-resolved.png', output).pathname.replace(/^\/(\w:)/, '$1') })
  const realProgress = waitRequest(url => url.pathname === '/api/v2/events')
  await page.goto(href('replay', `&dataset=${dataset}&chart_engine=lightweight&cursor=1&demo=1`))
  await realProgress; await cursor(1)
  report.cases.push('Unsupported demo flag keeps real replay readers and progress stream enabled')
  assert.deepEqual(report.errors, [])
  report.status = 'pass'
} catch (error) {
  report.status = 'fail'; report.error = error.stack
  await page.screenshot({ path: new URL('failure.png', output).pathname.replace(/^\/(\w:)/, '$1') }).catch(() => {})
  throw error
} finally {
  releaseAnalytics?.(); releaseStep?.()
  await context.unrouteAll({ behavior: 'ignoreErrors' })
  await browser.close()
  await writeFile(new URL('receipt.json', output), JSON.stringify(report, null, 2))
  console.log(JSON.stringify({ status: report.status, cases: report.cases.length, errors: report.errors, evidence: output.href }))
}
