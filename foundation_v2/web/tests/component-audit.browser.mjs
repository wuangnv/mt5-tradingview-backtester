import assert from 'node:assert/strict'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { chromium } from 'playwright'

const origin = process.env.TW_UI_ORIGIN || 'http://127.0.0.1:5180'
assert.equal(new URL(origin).hostname, '127.0.0.1')
const out = path.resolve(process.env.TW_UI_EVIDENCE || '../evidence/ui-component-audit-20261003/interactions')
const session = '39b1d068edd64e75864f692f27237852'
const report = { scope: 'isolated GET-only local QA data plus labeled annotation/catalog/loading fixtures; local appearance/drawing preferences only', cases: [], errors: [], blocked: [] }
const get = async route => {
  const response = await fetch(origin + route, { headers: { 'X-Workspace-Id': 'tenant-a' } })
  assert.ok(response.ok)
  return response.json()
}
const [replay, datasets] = await Promise.all([get(`/api/v2/replay/sessions/${session}`), get('/api/v2/data/datasets')])
assert.equal(replay.payload.cursor_index, 60)
const dataset = datasets.items.find(item => item.dataset_id === replay.payload.dataset_id)
assert.ok(dataset)
const row = replay.visible_rows[10]
const annotation = { record_id: 'component-audit-annotation', revision: 1, payload: { annotation_type: 'horizontal-line', instrument_id: dataset.instrument_id, timeframe: dataset.timeframe, run_id: session, cutoff_timestamp: replay.cutoff_timestamp, anchors: [{ timestamp: row.timestamp, price: row.close }], label: 'Fixture kiểm tra hiển thị / khóa' } }
const books = ['audit-a', 'audit-b'].map((id, index) => ({ record_id: id, revision: 1, payload: { name: `Setup kiểm tra ${index + 1}`, status: 'draft', rules: {}, execution_capability: 'read_only' } }))
const axe = await readFile('../../../../.artifacts/wm-integration-quality-tools/node_modules/axe-core/axe.min.js', 'utf8')
await mkdir(out, { recursive: true })
const browser = await chromium.launch({ headless: true })
try {
  for (const theme of ['dark', 'light']) for (const width of [1440, 390, 320]) {
    const context = await browser.newContext({ viewport: { width, height: 987 }, reducedMotion: 'reduce' })
    await context.addInitScript(value => {
      if (localStorage.getItem('tw-theme') === null) localStorage.setItem('tw-theme', value)
      if (localStorage.getItem('tw-language') === null) localStorage.setItem('tw-language', 'vi')
    }, theme)
    let catalogMode = 'hold', releaseCatalog, releaseSession, holdSession = false
    let catalogGate = new Promise(resolve => { releaseCatalog = resolve })
    let sessionGate = new Promise(resolve => { releaseSession = resolve })
    await context.route('**/*', async route => {
      const request = route.request(), url = new URL(request.url())
      if (url.origin !== origin || !['GET', 'HEAD', 'OPTIONS'].includes(request.method())) {
        report.blocked.push({ method: request.method(), path: url.pathname })
        return route.abort()
      }
      if (url.pathname === '/api/v2/chart/annotations') return route.fulfill({ json: { items: [annotation] } })
      if (url.pathname === '/api/v2/playbooks') {
        if (catalogMode === 'hold') await catalogGate
        return route.fulfill({ status: catalogMode === 'error' ? 503 : 200, json: catalogMode === 'error' ? { detail: 'Labeled catalog unavailable fixture' } : { items: catalogMode === 'empty' ? [] : books } })
      }
      if (/^\/api\/v2\/playbooks\/audit-/.test(url.pathname)) return route.fulfill({ json: { items: [books.find(item => url.pathname.includes(item.record_id))] } })
      if (holdSession && url.pathname === '/api/v2/session/status') await sessionGate
      return route.continue()
    })
    const page = await context.newPage()
    page.setDefaultTimeout(15000)
    page.on('pageerror', error => report.errors.push(String(error)))
    const capture = async name => {
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth) <= 1, 'No page overflow')
      await page.screenshot({ path: path.join(out, `${name}-${theme}-${width}.png`), animations: 'disabled' })
    }
    await page.goto(`${origin}/?view=playbook&workspace=tenant-a`, { waitUntil: 'domcontentloaded' })
    await page.getByText('Đang đọc playbook catalog…').waitFor()
    assert.equal(await page.getByTestId('playbook-empty').count(), 0, 'Loading is not empty')
    assert.equal(await page.locator('.pb-count').count(), 0, 'Loading is not a zero record count')
    catalogMode = 'ready'; releaseCatalog()
    const second = page.getByTestId('playbook-row-audit-b')
    await second.click()
    assert.equal(await second.getAttribute('aria-pressed'), 'true')
    assert.equal(await second.getAttribute('aria-current'), null, 'Detail selection is not page navigation')
    await page.getByTestId('playbook-summary').getByRole('heading', { name: 'Setup kiểm tra 2', exact: true }).waitFor()
    await capture('playbook-selected')
    catalogMode = 'error'
    await page.reload({ waitUntil: 'networkidle' })
    await page.getByTestId('playbook-catalog-retry').waitFor()
    assert.equal(await page.getByTestId('playbook-empty').count(), 0, 'Error is not empty')
    catalogMode = 'empty'
    await page.getByTestId('playbook-catalog-retry').click()
    await page.getByTestId('playbook-empty').waitFor()
    assert.equal(await page.getByText('Chọn một playbook', { exact: true }).count(), 0, 'Empty catalog does not ask to select a nonexistent record')

    holdSession = true
    await page.goto(`${origin}/?view=settings&workspace=tenant-a&from=learn`, { waitUntil: 'domcontentloaded' })
    await page.getByTestId('settings-session-facts-loading').waitFor()
    assert.equal(await page.getByTestId('settings-session-loading').count(), 0)
    assert.equal(await page.locator('.settings-topbar-actions a').count(), 1, 'Only one return-to-Learn link')
    assert.equal(await page.locator('.settings-footnote').count(), 0)
    holdSession = false; releaseSession()
    await page.waitForLoadState('networkidle')
    const language = page.getByRole('combobox', { name: 'Ngôn ngữ điều hướng', exact: true })
    await language.selectOption('en')
    await page.getByTestId('settings-appearance-status').getByText('Có thay đổi chưa lưu.').waitFor()
    await page.getByRole('button', { name: 'Hủy thay đổi', exact: true }).click()
    assert.equal(await language.inputValue(), 'vi')
    await language.selectOption('en')
    await page.getByRole('button', { name: 'Lưu giao diện', exact: true }).click()
    await page.reload({ waitUntil: 'networkidle' })
    assert.equal(await language.inputValue(), 'en', 'Saved appearance survives reload')
    assert.equal(await page.locator('.fx-app').getAttribute('data-theme'), theme)
    await capture('settings')

    await page.goto(`${origin}/?view=replay&workspace=tenant-a&session=${session}&cursor=60`, { waitUntil: 'networkidle' })
    const chart = page.getByTestId('replay-chart')
    await chart.waitFor()
    assert.equal(await chart.getAttribute('data-visible-row-count'), '61')
    const volume = page.getByRole('checkbox', { name: 'Volume', exact: true })
    await volume.uncheck()
    const label = volume.locator('..')
    const plainBackground = await label.evaluate(element => getComputedStyle(element).backgroundColor)
    await volume.check()
    assert.notEqual(await label.evaluate(element => getComputedStyle(element).backgroundColor), plainBackground)
    await page.keyboard.press('Tab')
    await volume.focus()
    assert.equal(await label.evaluate(element => getComputedStyle(element).outlineStyle), 'solid')
    assert.equal(await page.getByTestId('play-toggle').getAttribute('aria-pressed'), null)
    const range = page.getByRole('button', { name: '1D', exact: true })
    await range.click()
    await page.getByRole('button', { name: 'Tới cutoff', exact: true }).click()
    assert.equal(await range.getAttribute('aria-pressed'), null, 'Range command does not promise retained viewport selection')
    const openObjects = page.getByRole('button', { name: 'Mở chi tiết và đối tượng chart', exact: true })
    await openObjects.click()
    assert.equal(await openObjects.getAttribute('aria-expanded'), 'true')
    assert.equal(await page.getByTestId('annotation-draft').count(), 0, 'Crosshair mode has no empty annotation surface')
    await page.getByRole('button', { name: 'Chọn đường giá local', exact: true }).click()
    await page.getByTestId('annotation-draft').getByText('Đặt mốc trên chart để tạo nháp local.').waitFor()
    await page.getByRole('button', { name: 'Chỉ xem crosshair', exact: true }).click()
    assert.equal(await page.getByTestId('annotation-draft').count(), 0)
    const links = await page.locator('.decision-panel .next-action-link').evaluateAll(elements => elements.map(element => ({ top: element.getBoundingClientRect().top, bottom: element.getBoundingClientRect().bottom })))
    assert.ok(links.every((link, index) => link.bottom - link.top >= 44 && (!index || link.top >= links[index - 1].bottom)), 'Panel actions have distinct rows and touch targets')
    const object = page.locator('[data-testid="replay-object"][data-record-id="component-audit-annotation"]')
    await object.waitFor()
    const visibility = object.getByRole('button', { name: 'Hiển thị', exact: true })
    const lock = object.getByRole('button', { name: 'Khóa', exact: true })
    await visibility.click()
    assert.equal(await visibility.getAttribute('aria-pressed'), 'false')
    await lock.click()
    assert.equal(await lock.getAttribute('aria-pressed'), 'true')
    const input = object.getByRole('textbox')
    assert.equal(await input.isDisabled(), true)
    assert.equal(await input.evaluate(element => getComputedStyle(element).cursor), 'not-allowed')
    assert.equal(await object.getByRole('button', { name: 'Xóa đối tượng', exact: true }).isDisabled(), true)
    await object.scrollIntoViewIfNeeded()
    await capture('objects-locked')
    await page.reload({ waitUntil: 'networkidle' })
    await openObjects.click()
    assert.equal(await visibility.getAttribute('aria-pressed'), 'false', 'Hidden preference survives reload')
    assert.equal(await lock.getAttribute('aria-pressed'), 'true', 'Locked preference survives reload')
    await lock.click()
    assert.equal(await input.isDisabled(), false)
    await visibility.click()
    assert.equal(await visibility.getAttribute('aria-pressed'), 'true')
    await capture('objects-visible')
    await page.addScriptTag({ content: axe })
    const audit = await page.evaluate(() => axe.run(document.querySelector('.fx-app'), { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21aa'] } }))
    assert.deepEqual(audit.violations, [])
    await page.goto(`${origin}/?view=analytics&workspace=tenant-a&session=${session}&cursor=60`, { waitUntil: 'networkidle' })
    const netMetric = page.locator('.as-story-metric').filter({ has: page.getByText('Net P/L', { exact: true }) })
    await netMetric.getByText('75', { exact: true }).waitFor()
    await netMetric.getByText('USD · net', { exact: true }).waitFor()
    const ledger = page.getByRole('region', { name: 'Trade ledger, cuộn ngang để xem các cột', exact: true })
    await page.keyboard.press('Tab')
    await ledger.focus()
    assert.equal(await ledger.evaluate(element => getComputedStyle(element).outlineStyle), 'solid', 'Keyboard focus on scrollable ledger remains visible')
    await capture('ledger-focus')
    report.cases.push({ theme, width, playbook: 'loading/error/empty/selection', settings: 'single loading/return/save/cancel/reload', chart: 'overlays/range commands/object show/lock/reload', axeViolations: audit.violations.length })
    await context.close()
  }
  assert.deepEqual(report.errors, [])
  assert.deepEqual(report.blocked, [])
  report.status = 'PASS'
} catch (error) { report.status = 'FAIL'; report.failure = String(error); report.stack = error.stack; process.exitCode = 1 }
finally {
  await browser.close()
  await writeFile(path.join(out, 'report.json'), JSON.stringify(report, null, 2))
  console.log(JSON.stringify({ status: report.status, cases: report.cases.length, failure: report.failure }))
}
