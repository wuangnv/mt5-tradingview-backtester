import assert from 'node:assert/strict'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { chromium } from 'playwright'
const origin = 'http://127.0.0.1:5180', id = '39b1d068edd64e75864f692f27237852'
const out = path.resolve('../evidence/ui-fx-analytics-20261004/states')
await mkdir(out, { recursive: true })
const headers = { 'X-Workspace-Id': 'tenant-a' }
const real = await (await fetch(`http://127.0.0.1:8020/api/v2/replay/sessions/${id}/analytics`, { headers })).json()
const historical = await (await fetch(`http://127.0.0.1:8020/api/v2/replay/sessions/${id}/analytics?cursor_index=20`, { headers })).json()
const p = historical.provenance
const prop = { schema_version: 'prop-attempt-report-v1', mode: 'simulation', broker_execution_capability: false, session: { session_id: 'fixture-prop', revision: 1 }, profile: { profile_id: 'Fixture challenge — browser QA', terms_version: 'fixture-v1' }, attempt: { attempt_id: 'fixture-bound', revision: 1, virtual_start_utc: '2024-01-01T00:00:00Z' }, phase: { phase_index: 1, currency: 'USD', initial_balance: '100000', balance: '100025', equity: '100025', floating_pl: '0', qualifying_days: 1, virtual_time_utc: '2024-01-01T00:21:00Z', last_event_sequence: 5, evaluation_quality: 'fixture' }, outcome: { status: 'running' }, objectives: { money: { profit_target: { current: 25, target: 5000, hit: false }, daily_loss: { current: 100025, floor: 95000, breached: false }, overall_drawdown: { current: 100025, floor: 90000, breached: false } }, calendar: { qualifying_days: 1, min_qualifying_days_satisfied: false, expired: false } }, provenance: { replay_binding: { replay_session_id: id, branch_id: p.branch_id, dataset_id: p.dataset_id, dataset_sha256: p.dataset_sha256, last_replay_event_sequence: p.execution_event_sequence }, replay_cursor: { bar_index: 20 } } }
const unbound = { ...structuredClone(prop), attempt: { ...prop.attempt, attempt_id: 'fixture-unbound' }, provenance: {} }
const wrong = { ...structuredClone(prop), attempt: { ...prop.attempt, attempt_id: 'fixture-wrong-phase' }, phase: { ...prop.phase, phase_index: 2 } }
const cases = [], requests = [], errors = []
const browser = await chromium.launch({ headless: true, executablePath: 'C:/Users/MIIKEY/AppData/Local/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-win64/chrome-headless-shell.exe' })
const context = await browser.newContext({ viewport: { width: 390, height: 987 }, reducedMotion: 'reduce', acceptDownloads: true })
await context.routeWebSocket('**/*', socket => socket.close())
const page = await context.newPage()
page.setDefaultTimeout(20000)
page.on('pageerror', error => errors.push(error.message))
let state = 'real'
await context.route('**/*', async route => {
  const request = route.request(), url = new URL(request.url())
  if (url.origin !== origin || !['GET', 'HEAD', 'OPTIONS'].includes(request.method())) return route.abort()
  if (!url.pathname.startsWith('/api/')) return route.continue()
  requests.push({ method: request.method(), path: url.pathname, query: url.search })
  if (url.pathname === '/api/v2/prop/reports') return route.fulfill({ json: { schema_version: 'prop-report-list-v1', broker_execution_capability: false, items: [prop, unbound, wrong] } })
  if (url.pathname === '/api/v2/journal') return route.fulfill({ json: { items: [{ payload: { source: { session_id: id, trade_id: real.ledger[0].trade_id }, tags: ['fixture-tag'] } }] } })
  if (url.pathname.endsWith('/analytics') && state !== 'real') {
    if (state === 'denied') return route.fulfill({ status: 403, json: { detail: 'fixture_access_denied' } })
    if (state === 'malformed') return route.fulfill({ json: { schema_version: 'invalid' } })
    const payload = structuredClone(real)
    if (state === 'partial') payload.partial = true
    if (state === 'stale') payload.stale = true
    if (state === 'blocked') { payload.analytics_available = false; payload.blocked_by_data = ['fixture_execution_missing'] }
    if (state === 'empty') { payload.ledger = []; payload.scope.selected_trade_count = 0; payload.metrics.closed_trade_count = 0; payload.metrics.net_pnl = 0; payload.metrics.closed_trade_balance_curve = [{ closed_trade_balance: 100000 }]; payload.metrics.ending_closed_trade_balance = 100000; payload.metrics.closed_trade_balance_drawdown_curve = [] }
    if (state === 'unknown') payload.ledger[0].net_pnl = null
    return route.fulfill({ json: payload })
  }
  return route.continue()
})
try {
  await page.goto(`${origin}/?workspace=tenant-a&view=analytics&analytics_source=prop&session=${id}`)
  await page.getByTestId('analytics-performance').waitFor()
  assert.match(await page.locator('.fxa-report-scope').innerText(), /^20 \/ 20/)
  assert.match(await page.getByTestId('analytics-performance').innerText(), /25 USD/)
  assert.ok(requests.some(request => request.path.endsWith('/analytics') && request.query.includes(`event_sequence=${p.execution_event_sequence}`) && request.query.includes('cursor_index=20')))
  await page.screenshot({ path: path.join(out, 'prop-bound-historical-real-replay.png'), fullPage: true })
  const axe = await readFile('../../../../.artifacts/wm-integration-quality-tools/node_modules/axe-core/axe.min.js', 'utf8')
  await page.addScriptTag({ content: axe })
  const audit = await page.evaluate(() => axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] } }))
  assert.deepEqual(audit.violations.map(item => item.id), [])
  cases.push('fixture Prop report reads real historical ledger at exact report event; no later trades; axe390')
  await page.getByLabel('Prop firm attempt', { exact: true }).selectOption('fixture-prop:fixture-unbound')
  await page.getByText('Attempt chưa có replay binding', { exact: false }).waitFor()
  assert.equal(await page.getByTestId('analytics-performance').count(), 0)
  cases.push('unbound Prop keeps objectives with unavailable analytics')
  await page.getByLabel('Prop firm attempt', { exact: true }).selectOption('fixture-prop:fixture-wrong-phase')
  await page.getByRole('alert').filter({ hasText: 'prop_replay_scope_mismatch' }).waitFor()
  assert.equal(await page.getByTestId('analytics-performance').count(), 0)
  cases.push('wrong phase rejected even with same valid dataset/cursor')
  await page.getByLabel('Prop firm attempt', { exact: true }).selectOption('')
  await page.getByText('Không tìm thấy attempt này.', { exact: false }).waitFor()
  assert.equal(new URL(page.url()).searchParams.has('attempt'), false)
  cases.push('Prop clear placeholder safe and URL cleared')
  for (state of ['partial', 'stale', 'blocked', 'empty', 'unknown', 'denied', 'malformed']) {
    await page.goto(`${origin}/?workspace=tenant-a&view=analytics&session=${id}`)
    if (state === 'blocked') await page.getByTestId('analytics-blocked').waitFor()
    else if (['denied', 'malformed'].includes(state)) { await page.getByRole('alert').filter({ hasText: 'Không đọc được kết quả' }).waitFor(); assert.equal(await page.getByTestId('analytics-performance').count(), 0) }
    else { await page.getByTestId('analytics-performance').waitFor(); if (state === 'unknown') assert.match(await page.locator('.fxa-metrics').first().innerText(), /Total P\/L\n—/); if (state === 'empty') assert.match(await page.locator('.fxa-metrics').first().innerText(), /Total trades\n0/); if (state === 'partial') await page.getByRole('status').filter({ hasText: 'Dữ liệu một phần.' }).waitFor(); if (state === 'stale') await page.getByRole('status').filter({ hasText: 'Dữ liệu có thể đã cũ.' }).waitFor() }
    assert.equal(await page.getByRole('button', { name: /^(Tải lại|Làm mới)/ }).count(), 0)
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false)
    await page.screenshot({ path: path.join(out, `fixture-${state}.png`), fullPage: true })
    cases.push(`labeled fixture ${state}`)
  }
  state = 'real'
  await page.evaluate(() => window.dispatchEvent(new Event('online')))
  await page.getByTestId('analytics-performance').waitFor()
  cases.push('GET error recovery on network return')
  await page.getByLabel('Tags', { exact: true }).selectOption('fixture-tag')
  assert.match(await page.locator('.fxa-report-scope').innerText(), /^1 \/ 60/)
  const event = page.waitForEvent('download'); await page.getByRole('button', { name: 'Xuất CSV' }).click(); const download = await event
  await download.saveAs(path.join(out, 'filtered-tag.csv'))
  const csv = await readFile(path.join(out, 'filtered-tag.csv'), 'utf8')
  assert.equal(csv.split('\r\n').length, 2); assert.ok(csv.includes('fixture-tag')); assert.ok(csv.includes('report_execution_event_sequence')); assert.ok(csv.includes(real.provenance.dataset_sha256))
  cases.push('Journal tag annotations filter all metrics and exact CSV with provenance')
  assert.deepEqual(errors, [])
  await writeFile(path.join(out, 'report.json'), JSON.stringify({ scope: 'Explicit report/state/journal fixtures; actual replay GET data and experiments remain service-backed; no writes', cases, requests, errors }, null, 2))
  console.log(`PASS ${cases.length} fixture/historical journeys; no pageerrors/writes`)
} catch (error) { await writeFile(path.join(out, 'failure.json'), JSON.stringify({ cases, error: String(error.stack || error), requests, errors }, null, 2)); throw error }
finally { await browser.close() }
