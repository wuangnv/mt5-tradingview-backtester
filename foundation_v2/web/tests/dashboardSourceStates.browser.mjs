import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { chromium } from 'playwright'

const origin = process.env.TESTING_UI_ORIGIN || 'http://127.0.0.1:5180'
const out = process.env.TW_UI_EVIDENCE_DIR || '../evidence/menu-audit-20261009/source-states'
await mkdir(out, { recursive: true })
const browser = await chromium.launch({ headless: true })
const checks = [], errors = [], writes = []
const item = { record_id: 'fixture-session', revision: 1, name: 'Source state fixture', dataset_id: 'fixture-dataset', dataset_available: true, instrument_id: 'EURUSD', timeframe: '60s', cursor_index: 0, status: 'paused', created_at_utc: '2026-10-01T00:00:00Z', updated_at_utc: '2026-10-01T00:00:00Z' }
const report = { schema_version: 'prop-attempt-report-v1', session: { session_id: 'fixture-prop' }, attempt: { attempt_id: 'fixture-attempt', revision: 1 }, profile: { profile_id: 'Fixture profile', terms_version: 'fixture-v1' }, phase: { phase_index: 1, balance: 10000, equity: 10000, currency: 'USD', qualifying_days: 0, virtual_time_utc: '2026-10-09T12:34:56Z' }, outcome: { status: 'active' }, mode: 'simulation', broker_execution_capability: false }
const overview = { performance: { schema_version: 'dashboard-replay-performance-v1', status: 'ready', scope: { session_count: 0, readable_session_count: 0 }, metrics: { closed_trade_count: 0, win_rate_pct: null }, months: [], symbols: [], sessions: [], sources: [], excluded: [] } }

try {
  for (const theme of ['dark', 'light']) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 987 } })
    await context.addInitScript(theme => { localStorage.setItem('tw-language', 'vi'); localStorage.setItem('tw-theme', theme) }, theme)
    await context.route('**/*', route => {
      const request = route.request()
      if (new URL(request.url()).origin !== origin) return route.abort()
      if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method())) { writes.push(request.url()); return route.abort() }
      return route.continue()
    })
    let catalogMode = 'ready', propMode = 'ready', datasetMode = 'empty', detailMode = 'error', detailCounts = {}, datasetCount = 0, holdCatalog, holdProp, seenCatalog, seenProp
    await context.route('**/api/**', async route => {
      const request = route.request(), path = new URL(request.url()).pathname
      assert.equal(request.method(), 'GET')
      if (path === '/api/v2/replay/sessions') {
        seenCatalog?.()
        if (holdCatalog) await holdCatalog
        if (['error', 'denied'].includes(catalogMode)) return route.fulfill({ status: catalogMode === 'denied' ? 403 : 503, json: { detail: 'labeled_catalog_failure' } }).catch(() => {})
        return route.fulfill({ json: { items: catalogMode === 'empty' ? [] : catalogMode === 'details' ? [item, { ...item, record_id: 'ready-session', name: 'Ready cached session' }] : [item] } }).catch(() => {})
      }
      if (path === '/api/v2/prop/reports') {
        seenProp?.()
        if (holdProp) await holdProp
        if (['error', 'denied'].includes(propMode)) return route.fulfill({ status: propMode === 'denied' ? 403 : 503, json: { detail: 'labeled_prop_failure' } }).catch(() => {})
        const malformedChildren = { 'bad-phase-index': { ...report, phase: { ...report.phase, phase_index: {} } }, 'bad-time': { ...report, phase: { ...report.phase, virtual_time_utc: {} } }, 'bad-quality': { ...report, phase: { ...report.phase, evaluation_quality: {} } }, 'bad-terms': { ...report, profile: { ...report.profile, terms_version: {} } }, 'bad-outcome': { ...report, outcome: { status: {} } } }
        return route.fulfill({ json: { schema_version: 'prop-report-list-v1', broker_execution_capability: false, items: propMode === 'empty' ? [] : propMode === 'malformed' ? [{ ...report, phase: null }] : propMode === 'malformed-id' ? [{ ...report, attempt: { attempt_id: 123 } }] : malformedChildren[propMode] ? [malformedChildren[propMode]] : [report] } }).catch(() => {})
      }
      if (path === '/api/v2/overview') return route.fulfill({ json: overview })
      if (path === '/api/v2/data/datasets') {
        datasetCount += 1
        if (['error', 'denied'].includes(datasetMode)) return route.fulfill({ status: datasetMode === 'denied' ? 403 : 503, json: { detail: 'labeled_dataset_failure' } })
        return route.fulfill({ json: { items: datasetMode === 'empty' ? [] : datasetMode === 'malformed' ? [null] : [{ dataset_id: 'fixture-dataset', first_timestamp: '2020-01-02T00:00:00Z', last_timestamp: '2026-10-09T00:00:00Z' }] } })
      }
      if (path.endsWith('/analytics')) {
        const id = path.split('/').at(-2); detailCounts[id] = (detailCounts[id] || 0) + 1
        if (id === 'fixture-session' && detailMode === 'error') return route.fulfill({ status: 503, json: { detail: 'labeled_detail_failure' } })
        return route.fulfill({ json: { schema_version: 'analytics-read-model-v1', analytics_available: false, scope: {} } })
      }
      return route.fulfill({ status: 404, json: { detail: 'fixture_not_implemented' } })
    })
    const page = await context.newPage()
    page.setDefaultTimeout(10000)
    page.on('pageerror', error => errors.push(error.message))
    const recent = page.getByTestId('dashboard-recent'), prop = page.getByTestId('prop-analytics')
    const waitState = (testid, state) => page.waitForFunction(({ testid, state }) => document.querySelector(`[data-testid="${testid}"]`)?.dataset.state === state, { testid, state })
    const go = async () => { await page.goto(`${origin}/?workspace=tenant-a&area=testing&view=overview&dashboard_source=all`); await recent.waitFor(); await prop.waitFor() }
    await go(); await waitState('dashboard-recent', 'ready'); await waitState('prop-analytics', 'ready')
    assert.match(await prop.getByTestId('prop-analytics-objectives').innerText(), /09\/10\/2026 12:34:56/)
    await recent.getByRole('button', { name: 'Sửa phiên Source state fixture', exact: true }).click()
    const dialog = page.locator('dialog.fxs-settings-drawer')
    await dialog.waitFor()
    let releaseCatalog, releaseProp
    holdCatalog = new Promise(resolve => { releaseCatalog = resolve }); holdProp = new Promise(resolve => { releaseProp = resolve })
    const requests = Promise.all([new Promise(resolve => { seenCatalog = resolve }), new Promise(resolve => { seenProp = resolve })])
    await page.evaluate(() => window.dispatchEvent(new Event('focus'))); await requests
    await page.waitForFunction(() => document.querySelector('[data-testid="dashboard-recent"]').getAttribute('aria-busy') === 'true')
    assert.equal(await recent.locator('.fx-dashboard-session-card').count(), 1)
    assert.equal(await prop.getByTestId('prop-analytics-objectives').count(), 1)
    assert.equal(await dialog.locator('button[type=submit]').isDisabled(), true)
    catalogMode = 'error'; propMode = 'error'; releaseCatalog(); releaseProp(); holdCatalog = null; holdProp = null
    await waitState('dashboard-recent', 'stale'); await waitState('prop-analytics', 'stale')
    assert.equal(await recent.locator('.fx-dashboard-session-card').count(), 1)
    assert.equal(await recent.getByRole('button', { name: 'Xóa phiên Source state fixture', exact: true }).isDisabled(), true)
    assert.equal(await dialog.locator('button[type=submit]').isDisabled(), true)
    assert.equal(await prop.getByTestId('prop-analytics-objectives').count(), 1)
    assert.equal(await prop.locator('.fxa-prop-selector').count(), 1)
    await page.keyboard.press('Escape')
    await recent.screenshot({ path: `${out}/catalog-stale-${theme}.png` })
    await prop.screenshot({ path: `${out}/prop-stale-${theme}.png` })
    checks.push({ case: 'same-scope refresh retains values and blocks catalog dialog/card mutations', theme, pass: true })
    holdCatalog = new Promise(resolve => { releaseCatalog = resolve })
    await recent.getByRole('button', { name: 'Thử lại', exact: true }).click()
    await page.waitForFunction(() => document.querySelector('[data-testid="dashboard-recent"]').getAttribute('aria-busy') === 'true')
    assert.equal(await recent.locator('.fx-dashboard-session-card').count(), 1)
    catalogMode = 'ready'; releaseCatalog(); holdCatalog = null
    await waitState('dashboard-recent', 'ready')
    assert.equal(await recent.getByRole('button', { name: 'Xóa phiên Source state fixture', exact: true }).isDisabled(), false)
    holdProp = new Promise(resolve => { releaseProp = resolve })
    await prop.getByRole('button', { name: 'Thử lại', exact: true }).click()
    await page.waitForFunction(() => document.querySelector('[data-testid="prop-analytics"]').getAttribute('aria-busy') === 'true')
    assert.equal(await prop.getByTestId('prop-analytics-objectives').count(), 1)
    assert.equal(await prop.locator('.fxa-prop-selector').count(), 1)
    propMode = 'ready'; releaseProp(); holdProp = null
    await waitState('prop-analytics', 'ready')
    checks.push({ case: 'retry preserves catalog and Prop values until success', theme, pass: true })
    // A fresh mount resets the focus-refresh debounce. Revocation must clear open dialogs and cached values.
    await go(); await waitState('dashboard-recent', 'ready'); await waitState('prop-analytics', 'ready')
    await recent.getByRole('button', { name: 'Sửa phiên Source state fixture', exact: true }).click(); await dialog.waitFor()
    catalogMode = 'denied'; propMode = 'denied'
    await page.evaluate(() => window.dispatchEvent(new Event('focus')))
    await waitState('dashboard-recent', 'error'); await waitState('prop-analytics', 'error')
    assert.equal(await dialog.count(), 0)
    assert.equal(await recent.locator('.fx-dashboard-session-card').count(), 0)
    assert.equal(await recent.getByRole('alert').count(), 1)
    assert.equal(await prop.getByTestId('prop-analytics-objectives').count(), 0)
    assert.equal(await prop.locator('.fxa-prop-selector').count(), 0)
    checks.push({ case: '403 clears catalog dialogs/cards and Prop cached report', theme, pass: true })
    catalogMode = 'error'; propMode = 'malformed'; await go()
    await waitState('dashboard-recent', 'error'); await waitState('prop-analytics', 'error')
    assert.equal(await recent.getByRole('alert').count(), 1)
    assert.equal(await prop.getByRole('alert').count(), 1)
    assert.match(await prop.innerText(), /prop_report_invalid/)
    assert.equal(await page.getByTestId('dashboard-result-group').count(), 1)
    checks.push({ case: 'initial catalog error and malformed Prop have source-local single alerts', theme, pass: true })
    propMode = 'malformed-id'; await go(); await waitState('prop-analytics', 'error')
    assert.equal(await prop.getByRole('alert').count(), 1); assert.match(await prop.innerText(), /prop_report_invalid/)
    checks.push({ case: 'invalid scalar report identifiers stay source-local', theme, pass: true })
    for (const value of ['bad-phase-index', 'bad-time', 'bad-quality', 'bad-terms', 'bad-outcome']) {
      propMode = value; await go(); await waitState('prop-analytics', 'error')
      assert.equal(await prop.getByRole('alert').count(), 1); assert.match(await prop.innerText(), /prop_report_invalid/)
    }
    checks.push({ case: 'nonprimitive rendered report fields stay source-local', theme, pass: true })
    catalogMode = 'empty'; propMode = 'empty'; await go()
    await waitState('dashboard-recent', 'ready'); await waitState('prop-analytics', 'ready')
    catalogMode = 'error'; propMode = 'error'; await page.evaluate(() => window.dispatchEvent(new Event('focus')))
    await waitState('dashboard-recent', 'stale'); await waitState('prop-analytics', 'stale')
    assert.equal(await recent.getByRole('alert').count(), 0)
    assert.equal(await prop.getByRole('alert').count(), 0)
    assert.equal(await recent.locator('.fx-dashboard-session-card').count(), 0)
    assert.equal(await prop.locator('.fxa-empty').count(), 1)
    assert.equal(await prop.locator('.fxa-prop-selector').count(), 1)
    checks.push({ case: 'successful empty catalog/report remain known empty on refresh failure', theme, pass: true })
    await page.setViewportSize({ width: 360, height: 987 })
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false)
    await page.screenshot({ path: `${out}/stale-empty-${theme}-360.png`, fullPage: true })
    checks.push({ case: 'stale empty sources fit mobile viewport', theme, pass: true })
    await page.setViewportSize({ width: 1440, height: 987 })
    catalogMode = 'details'; propMode = 'empty'; datasetMode = 'ready'; detailMode = 'error'; detailCounts = {}
    await go(); await waitState('dashboard-recent', 'ready')
    const card = recent.locator('[data-session-id="fixture-session"]')
    await card.getByRole('button', { name: 'Mở rộng phiên Source state fixture', exact: true }).click()
    await card.getByRole('alert').waitFor()
    await card.screenshot({ path: `${out}/detail-error-${theme}.png` })
    await page.waitForFunction(() => document.querySelector('[data-session-id="ready-session"]'))
    assert.equal(detailCounts['fixture-session'], 1); assert.equal(detailCounts['ready-session'], 1)
    detailMode = 'ready'
    await card.getByRole('button', { name: 'Thử lại', exact: true }).click()
    await card.getByTestId('session-performance').waitFor()
    assert.equal(detailCounts['fixture-session'], 2); assert.equal(detailCounts['ready-session'], 1)
    checks.push({ case: 'failed detail retry recovers only failed entry and preserves ready cache', theme, pass: true })
    const metadata = recent.getByTestId('dashboard-dataset-state')
    await waitState('dashboard-dataset-state', 'ready')
    assert.match(await card.locator('.fx-dashboard-card-facts').innerText(), /02\/01\/2020/)
    datasetMode = 'error'; await page.evaluate(() => window.dispatchEvent(new Event('focus')))
    await waitState('dashboard-dataset-state', 'stale')
    assert.match(await card.locator('.fx-dashboard-card-facts').innerText(), /02\/01\/2020/)
    assert.equal(await recent.locator('.fx-dashboard-session-card').count(), 2)
    assert.match(await metadata.innerText(), /Thông tin dữ liệu chưa cập nhật/)
    await recent.screenshot({ path: `${out}/metadata-stale-${theme}.png` })
    const beforeRetry = datasetCount
    datasetMode = 'ready'; await metadata.getByRole('button', { name: 'Thử lại', exact: true }).click(); await waitState('dashboard-dataset-state', 'ready')
    assert.equal(datasetCount, beforeRetry + 1)
    assert.equal(detailCounts['fixture-session'], 2); assert.equal(detailCounts['ready-session'], 1)
    checks.push({ case: 'dataset refresh failure preserves metadata and local retry avoids other reads', theme, pass: true })
    datasetMode = 'error'; await go(); await waitState('dashboard-dataset-state', 'error'); await waitState('dashboard-recent', 'ready')
    assert.equal(await recent.locator('.fx-dashboard-session-card').count(), 2)
    assert.equal(await metadata.getByRole('alert').count(), 1)
    datasetMode = 'ready'; await metadata.getByRole('button', { name: 'Thử lại', exact: true }).click(); await waitState('dashboard-dataset-state', 'ready')
    datasetMode = 'denied'; await page.evaluate(() => window.dispatchEvent(new Event('focus'))); await waitState('dashboard-dataset-state', 'error')
    assert.doesNotMatch(await recent.locator('.fx-dashboard-card-facts').first().innerText(), /02\/01\/2020/)
    assert.equal(await recent.locator('.fx-dashboard-session-card').count(), 2)
    checks.push({ case: 'dataset initial errors and permission revocation never hide sessions', theme, pass: true })
    datasetMode = 'malformed'; await go(); await waitState('dashboard-dataset-state', 'error'); await waitState('dashboard-recent', 'ready')
    assert.equal(await metadata.getByRole('alert').count(), 1)
    assert.equal(await recent.locator('.fx-dashboard-session-card').count(), 2)
    checks.push({ case: 'malformed dataset entries stay source-local without crashing catalog', theme, pass: true })
    datasetMode = 'empty'; catalogMode = 'details'; detailMode = 'error'; detailCounts = {}
    await go(); await waitState('dashboard-recent', 'ready')
    await card.getByRole('button', { name: 'Mở rộng phiên Source state fixture', exact: true }).click(); await card.getByRole('alert').waitFor()
    await recent.getByRole('button', { name: 'Hiện bộ lọc phiên', exact: true }).click()
    const aggregate = recent.locator('.wm-read-state').filter({ hasText: 'Chưa đọc được kết quả của một số phiên.' })
    await aggregate.waitFor(); assert.equal(await aggregate.getByRole('button').count(), 1)
    catalogMode = 'error'; await page.evaluate(() => window.dispatchEvent(new Event('focus'))); await waitState('dashboard-recent', 'stale')
    assert.equal(await aggregate.getByRole('button').count(), 0)
    assert.equal(await card.getByRole('button', { name: 'Thử lại', exact: true }).count(), 0)
    assert.equal(detailCounts['fixture-session'], 1); assert.equal(detailCounts['ready-session'], 1)
    assert.equal(await card.getByRole('alert').count(), 1, 'failed detail remains cached until catalog is verified')
    catalogMode = 'details'; await recent.locator('.wm-read-state').filter({ hasText: 'Dữ liệu chưa cập nhật.' }).getByRole('button', { name: 'Thử lại', exact: true }).click(); await waitState('dashboard-recent', 'ready')
    detailMode = 'ready'; await aggregate.getByRole('button', { name: 'Thử lại', exact: true }).click(); await card.getByTestId('session-performance').waitFor()
    assert.equal(detailCounts['fixture-session'], 2); assert.equal(detailCounts['ready-session'], 1)
    checks.push({ case: 'aggregate detail retry stays blocked on stale catalog and recovers after verification', theme, pass: true })
    await context.close()
  }
  assert.deepEqual(errors, []); assert.deepEqual(writes, [])
  await writeFile(`${out}/report.json`, JSON.stringify({ pass: true, fixtureOnly: true, checks, errors, writes }, null, 2))
  console.log(JSON.stringify({ pass: true, checks: checks.length, out }))
} catch (error) {
  await writeFile(`${out}/failure.json`, JSON.stringify({ error: error.message, checks, errors, writes }, null, 2))
  throw error
} finally { await browser.close() }
