import { createRequire } from 'node:module'
import { mkdir, writeFile } from 'node:fs/promises'
import assert from 'node:assert/strict'
const require = createRequire('D:/ANNAM/TradingWorkspace/projects/mt5-tradingview-backtester/foundation_v2/web/package.json')
const { chromium } = require('playwright')
const out = 'D:/ANNAM/TradingWorkspace/projects/mt5-tradingview-backtester/.artifacts/fx-neutral-controls-20261005/primary'
await mkdir(out, { recursive: true })
const browser = await chromium.launch({ headless: true }), page = await browser.newPage({ viewport: { width: 1440, height: 987 } })
const errors = [], writes = [], apiReads = [], cases = []
page.on('pageerror', error => errors.push(error.message))
await page.route('**/api/**', route => {
  if (route.request().method() !== 'GET') { writes.push(route.request().url()); return route.abort() }
  apiReads.push(route.request().url()); return route.continue()
})
const url = view => `http://127.0.0.1:5180/?workspace=tenant-a&demo=1&view=${view}&area=testing&section=${{ overview: 'dashboard', replay: 'sessions', trade: 'trades', analytics: 'analytics', 'market-data': 'market-data' }[view]}&select=1`
const neutral = color => { const channels = color.match(/[\d.]+/g).slice(0, 3).map(Number); assert.ok(Math.max(...channels) - Math.min(...channels) <= 1, color) }
const style = locator => locator.evaluate(el => { const css = getComputedStyle(el); return { color: css.color, border: css.borderColor, background: css.backgroundColor, radius: css.borderRadius, height: el.getBoundingClientRect().height, outline: css.outlineStyle, focus: el.matches(':focus-visible') } })
try {
  for (const theme of ['dark', 'light']) {
    await page.goto(url('overview')); await page.evaluate(theme => localStorage.setItem('tw-theme', theme), theme)
    await page.reload(); await page.waitForLoadState('networkidle')
    const scope = page.getByRole('button', { name: 'Phạm vi Performance', exact: true })
    const idle = await style(scope)
    assert.equal(idle.radius, '8px'); assert.equal(idle.height, 40)
    await scope.hover(); await page.waitForTimeout(180)
    const hover = await style(scope); neutral(hover.background); neutral(hover.color); neutral(hover.border)
    await scope.click()
    const opened = await style(scope); assert.equal(opened.outline, 'none')
    neutral(opened.background)
    const option = page.getByRole('option', { name: 'Backtesting · All sessions', exact: true })
    await option.hover(); await page.waitForTimeout(180); neutral((await style(option)).background)
    await page.screenshot({ path: out + '/dashboard-' + theme + '.png' })
    await page.keyboard.press('Escape')
    await page.keyboard.press('Tab'); await page.keyboard.press('Shift+Tab')
    assert.equal((await style(scope)).focus, true)
    neutral(await scope.evaluate(el => getComputedStyle(el).outlineColor))
    cases.push({ theme, view: 'dashboard', idle, hover, opened })
    await page.goto(url('trade') + '&sessions=all'); await page.waitForLoadState('networkidle')
    const sessions = page.getByRole('button', { name: 'Session: Tất cả phiên', exact: true })
    const sessionStyle = await style(sessions); assert.equal(sessionStyle.radius, '8px'); assert.equal(sessionStyle.height, 40)
    await sessions.click(); await page.getByRole('searchbox', { name: 'Tìm phiên', exact: true }).fill('Gold')
    assert.equal(await page.locator('.fxa-session-options > label').count(), 1)
    const sessionRow = page.locator('.fxa-session-options > label').first(); await sessionRow.hover(); await page.waitForTimeout(180)
    neutral((await style(sessionRow)).background)
    await page.screenshot({ path: out + '/trades-' + theme + '.png' })
    await page.keyboard.press('Escape')
    await page.getByRole('button', { name: 'Basic', exact: true }).click()
    const side = page.getByLabel('Side', { exact: true })
    assert.equal((await style(side)).radius, '8px'); assert.equal((await style(side)).height, 40)
    await side.selectOption('buy'); assert.equal(await page.locator('tbody tr .fxa-badge.is-sell').count(), 0)
    await side.click(); await page.waitForTimeout(180)
    assert.equal((await style(side)).focus, false); assert.equal((await style(side)).outline, 'none')
    await page.keyboard.press('Escape')
    cases.push({ theme, view: 'trades', sessionStyle, native: await style(side) })
    await page.goto(url('analytics')); await page.waitForLoadState('networkidle')
    const assets = page.getByRole('button', { name: 'Assets', exact: true })
    assert.equal((await style(assets)).radius, '8px'); assert.equal((await style(assets)).height, 40)
    await assets.click(); await page.getByRole('option', { name: 'EURUSD', exact: true }).hover(); await page.waitForTimeout(180)
    neutral((await style(page.getByRole('option', { name: 'EURUSD', exact: true }))).background)
    await page.screenshot({ path: out + '/analytics-' + theme + '.png' }); await page.keyboard.press('Escape')
    const apply = page.getByRole('button', { name: 'Apply', exact: true }); await apply.hover(); await page.waitForTimeout(180)
    neutral((await style(apply)).background); neutral((await style(apply)).color)
    const loss = page.locator('.fxa-bar-fill.is-negative').first(); assert.ok(await loss.count(), 'fixture has negative bars'); const c = (await style(loss)).background.match(/\d+/g).map(Number); assert.ok(c[0] > c[1], 'loss bar remains red')
    cases.push({ theme, view: 'analytics', apply: await style(apply) })
    await page.goto(url('market-data')); await page.waitForLoadState('networkidle')
    const group = page.getByLabel('Nhóm asset', { exact: true }); assert.equal((await style(group)).height, 40); assert.equal((await style(group)).radius, '8px')
    await group.click(); await page.waitForTimeout(180); assert.equal((await style(group)).outline, 'none')
    await page.screenshot({ path: out + '/market-' + theme + '.png' }); await page.keyboard.press('Escape')
    cases.push({ theme, view: 'market-data', native: await style(group) })
  }
  assert.deepEqual(errors, []); assert.deepEqual(writes, []); assert.deepEqual(apiReads, [])
  await writeFile(out + '/report.json', JSON.stringify({ pass: true, cases, errors, writes, apiReads }, null, 2))
  console.log(JSON.stringify({ pass: true, cases: cases.length, errors, writes }))
} catch (error) {
  await page.screenshot({ path: out + '/failure.png' })
  await writeFile(out + '/failure.json', JSON.stringify({ error: error.stack, cases, errors, writes, apiReads }, null, 2)); throw error
} finally { await browser.close() }
