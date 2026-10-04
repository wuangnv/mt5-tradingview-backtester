import assert from 'node:assert/strict'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { chromium } from 'playwright'
const origin = 'http://127.0.0.1:5180'
const session = '39b1d068edd64e75864f692f27237852'
const out = path.resolve(process.env.SESSION_FX_EVIDENCE || '../evidence/ui-sessions-fx-20261004/journeys')
await mkdir(out, { recursive: true })
const report = { scope: 'Actual local GET-only QA replay services; fixture state overrides separately labeled; no database writes', cases: [], errors: [], blocked: [] }
const browser = await chromium.launch({ headless: true })
const axe = await readFile('../../../../.artifacts/wm-integration-quality-tools/node_modules/axe-core/axe.min.js', 'utf8')
try {
  for (const theme of ['dark', 'light']) for (const width of [1440, 768, 390, 320]) {
    const context = await browser.newContext({ viewport: { width, height: 987 }, reducedMotion: 'reduce' })
    await context.addInitScript(theme => localStorage.setItem('tw-theme', theme), theme)
    await context.route('**/*', route => {
      const request = route.request()
      if (new URL(request.url()).origin !== origin || !['GET', 'HEAD', 'OPTIONS'].includes(request.method())) { report.blocked.push(request.url()); return route.abort() }
      return route.continue()
    })
    await context.routeWebSocket('**/*', socket => socket.close())
    const page = await context.newPage()
    page.setDefaultTimeout(30000)
    page.on('pageerror', error => report.errors.push(String(error)))
    await page.goto(`${origin}/?workspace=tenant-a&view=replay&select=1&session=${session}`, { waitUntil: 'domcontentloaded', timeout: 30000 })
    await page.getByTestId('session-performance').waitFor()
    const data = await page.evaluate(async session => (await fetch(`/api/v2/replay/sessions/${session}/analytics`, { headers: { 'X-Workspace-Id': 'tenant-a' } })).json(), session)
    assert.equal(data.metrics.closed_trade_count, 60)
    assert.equal(data.metrics.net_pnl, 75)
    await page.getByRole('img', { name: /^Số dư từ lệnh đóng:/ }).waitFor()
    assert.match(await page.locator('.fxs-metric').first().innerText(), /75 USD/)
    assert.match(await page.locator('.fxs-metric').nth(3).innerText(), /2024-01/)
    assert.match(await page.locator('.fxs-balance').innerText(), /100\.075 USD/)
    const picker = page.getByLabel('Chọn phiên replay', { exact: true })
    const settled = locator => locator.evaluate(async element => {
      getComputedStyle(element).backgroundColor
      await Promise.all(element.getAnimations().map(animation => animation.finished))
      const style = getComputedStyle(element)
      return { background: style.backgroundColor, outline: style.outlineStyle, shadow: style.boxShadow }
    })
    await page.locator('.fxr-session-catalog-status').click()
    const resting = await settled(picker)
    await picker.hover()
    assert.notEqual((await settled(picker)).background, resting.background)
    await picker.click()
    await page.waitForFunction(() => document.querySelector('select[aria-label="Chọn phiên replay"]').matches(':open'))
    assert.equal((await settled(picker)).outline, 'none')
    assert.equal((await settled(picker)).shadow, 'none')
    const option = picker.locator('option:not(:checked)').first()
    const optionRest = await settled(option)
    await option.hover()
    assert.notEqual((await settled(option)).background, optionRest.background)
    assert.equal(await picker.inputValue(), session)
    await page.keyboard.press('Escape')
    await page.keyboard.press('Tab')
    await picker.focus()
    assert.equal((await settled(picker)).outline, 'solid')
    assert.equal(await page.locator('.fxs-table-scroll tbody tr').count(), 5)
    const first = await page.locator('.fxs-table-scroll tbody tr').first().innerText()
    await page.getByRole('button', { name: 'Trang giao dịch sau', exact: true }).click()
    assert.notEqual(await page.locator('.fxs-table-scroll tbody tr').first().innerText(), first)
    await page.getByRole('combobox', { name: 'Số dòng Recent Trades' }).selectOption('20')
    assert.equal(await page.locator('.fxs-table-scroll tbody tr').count(), 20)
    await page.getByRole('combobox', { name: 'Trang Recent Trades' }).selectOption('3')
    assert.equal(await page.getByRole('button', { name: 'Trang giao dịch sau', exact: true }).isDisabled(), true)
    const link = new URL(await page.locator('.fxs-table-scroll tbody a').first().getAttribute('href'), origin)
    assert.equal(link.searchParams.get('session'), session)
    assert.ok(link.searchParams.get('trade'))
    await page.getByRole('button', { name: 'Cài đặt phiên' }).click()
    await page.getByLabel('Tên phiên', { exact: true }).fill('Unsaved UI review draft')
    await page.getByRole('button', { name: 'Hủy sửa' }).click()
    assert.equal(await page.getByText('Unsaved UI review draft', { exact: true }).count(), 0)
    await page.getByRole('combobox', { name: 'Số dòng Recent Trades' }).selectOption('5')
    await page.addScriptTag({ content: axe })
    const audit = await page.evaluate(() => axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] } }))
    assert.deepEqual(audit.violations.map(v => v.id), [])
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth) <= 1)
    await page.screenshot({ path: path.join(out, `sessions-${theme}-${width}.png`), fullPage: true, animations: 'disabled' })
    await page.locator('.fxs-charts').scrollIntoViewIfNeeded()
    await page.screenshot({ path: path.join(out, `charts-${theme}-${width}.png`), animations: 'disabled' })
    await page.locator('.fxs-pagination').scrollIntoViewIfNeeded()
    await page.screenshot({ path: path.join(out, `trades-${theme}-${width}.png`), animations: 'disabled' })
    await page.reload({ waitUntil: 'domcontentloaded', timeout: 30000 })
    await page.getByTestId('session-performance').waitFor()
    assert.equal(await page.getByLabel('Chọn phiên replay', { exact: true }).inputValue(), session)
    report.cases.push({ theme, width, source: 'actual QA API', closedTrades: 60, netPnl: 75, rowsAndPagination: true, editCancel: true, axeViolations: 0, incompleteRules: audit.incomplete.map(rule => rule.id) })
    if (theme === 'light' && width === 320) {
      for (const state of ['empty', 'blocked', 'partial', 'stale', 'error', 'malformed', 'missing-date', 'many-months']) {
        await page.route(`**/api/v2/replay/sessions/${session}/analytics`, route => {
          if (state === 'error') return route.fulfill({ status: 503, json: { detail: 'fixture_unavailable' } })
          if (state === 'malformed') return route.fulfill({ json: { schema_version: 'wrong' } })
          const payload = structuredClone(data)
          if (state === 'blocked') { payload.analytics_available = false; payload.blocked_by_data = ['fixture_execution_unavailable'] }
          if (state === 'empty') { payload.ledger = []; payload.scope.selected_trade_count = 0; payload.metrics.closed_trade_count = 0; payload.metrics.net_pnl = 0; payload.metrics.closed_trade_balance_curve = [{ sequence: 0, trade_id: null, closed_trade_balance: payload.metrics.starting_balance }]; payload.metrics.ending_closed_trade_balance = payload.metrics.starting_balance }
          if (state === 'partial') payload.partial = true
          if (state === 'stale') payload.stale = true
          if (state === 'missing-date') payload.ledger[0].close_time_utc = null
          if (state === 'many-months') {
            payload.ledger = Array.from({ length: 14 }, (_, index) => ({ ...data.ledger[0], trade_id: `fixture-month-${index}`, close_time_utc: Date.UTC(2024, index, 15) / 1000, net_pnl: index % 2 ? -5 : 10 }))
            payload.scope.selected_trade_count = payload.scope.total_trade_count = 14
            payload.metrics.closed_trade_count = 14
            payload.metrics.wins = payload.metrics.losses = 7
            payload.metrics.win_rate_pct = 50
            payload.metrics.net_pnl = 35
            let balance = payload.metrics.starting_balance
            payload.metrics.closed_trade_balance_curve = [{ sequence: 0, trade_id: null, closed_trade_balance: balance }, ...payload.ledger.map((trade, index) => ({ sequence: index + 1, trade_id: trade.trade_id, closed_trade_balance: balance += trade.net_pnl }))]
            payload.metrics.ending_closed_trade_balance = balance
          }
          return route.fulfill({ json: payload })
        })
        await page.reload({ waitUntil: 'domcontentloaded', timeout: 30000 })
        if (state === 'blocked') { await page.getByTestId('session-performance-blocked').waitFor(); assert.equal(await page.getByTestId('session-performance').count(), 0) }
        else if (['error', 'malformed'].includes(state)) { await page.getByRole('alert').filter({ hasText: 'Không tải được kết quả' }).waitFor(); assert.equal(await page.getByTestId('session-performance').count(), 0) }
        else { await page.getByTestId('session-performance').waitFor(); if (state === 'empty') assert.equal(await page.locator('.fxs-table-scroll tbody tr').count(), 0); if (state === 'partial') await page.getByText('Dữ liệu một phần.', { exact: false }).waitFor(); if (state === 'stale') await page.getByText('Dữ liệu chưa cập nhật.', { exact: false }).waitFor(); if (state === 'missing-date') assert.equal(await page.locator('.fxs-metric').nth(3).locator('strong').innerText(), '—') }
        if (state === 'many-months') {
          const bars = page.locator('.fxs-bars.is-horizontal')
          await bars.scrollIntoViewIfNeeded()
          assert.equal(await bars.locator('.fxs-bar-item').count(), 12)
          const geometry = await bars.evaluate(element => ({ top: element.getBoundingClientRect().top, firstTop: element.firstElementChild.getBoundingClientRect().top, scrollHeight: element.scrollHeight, height: element.clientHeight }))
          assert.ok(geometry.firstTop >= geometry.top - 1, 'First month is reachable at scroll origin')
          assert.ok(geometry.scrollHeight > geometry.height)
          assert.ok(await bars.locator('.fxs-bar.is-negative').count() > 0)
        }
        await page.screenshot({ path: path.join(out, `fixture-${state}-light-320.png`), fullPage: true })
        report.cases.push({ source: 'labeled state fixture', state, pass: true })
        await page.unroute(`**/api/v2/replay/sessions/${session}/analytics`)
      }
    }
    if (theme === 'dark' && width === 1440) {
      await page.locator('.fxs-table-scroll tbody a').first().click()
      await page.getByTestId('analytics-workspace').waitFor()
      assert.equal(new URL(page.url()).searchParams.get('session'), session)
      assert.ok(new URL(page.url()).searchParams.get('trade'))
      await page.goto(`${origin}/?workspace=tenant-a&view=replay&select=1&session=${session}`, { waitUntil: 'domcontentloaded' })
      await page.getByTestId('session-performance').waitFor()
      await page.getByRole('link', { name: 'Tiếp tục trên chart' }).click()
      await page.getByTestId('replay-chart').waitFor()
      assert.equal(new URL(page.url()).searchParams.get('session'), session)
      report.cases.push({ source: 'actual QA API', tradeDrilldown: true, chartResume: true })
    }
    await context.close()
  }
  assert.deepEqual(report.errors, [])
  assert.deepEqual(report.blocked, [])
  report.status = 'PASS'
} catch (error) { report.status = 'FAIL'; report.failure = String(error); process.exitCode = 1 }
finally { await browser.close(); await writeFile(path.join(out, 'report.json'), JSON.stringify(report, null, 2)); console.log(JSON.stringify({ status: report.status, cases: report.cases.length, failure: report.failure })) }
