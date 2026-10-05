import assert from 'node:assert/strict'
import { chromium } from '../../../web/node_modules/playwright/index.mjs'
import { mkdir, writeFile } from 'node:fs/promises'

const out = '.artifacts/fx-dashboard-parity-20261005/root'
await mkdir(out, { recursive: true })
const report = { checks: [], errors: [], writes: [], scope: 'Demo lifecycle local state; real services GET-only. No broker/session API writes.' }
const browser = await chromium.launch({ headless: true })
const context = await browser.newContext({ viewport: { width: 1671, height: 987 }, reducedMotion: 'reduce' })
await context.route('**/*', route => {
  const request = route.request()
  if (new URL(request.url()).origin !== 'http://127.0.0.1:5180' || !['GET', 'HEAD', 'OPTIONS'].includes(request.method())) {
    report.writes.push({ method: request.method(), url: request.url() }); return route.abort()
  }
  return route.continue()
})
await context.routeWebSocket('**/*', socket => socket.close())
const page = await context.newPage()
page.setDefaultTimeout(12000)
page.on('pageerror', error => report.errors.push(error.message))
const go = async query => { await page.goto('http://127.0.0.1:5180/?workspace=tenant-a&view=overview&area=testing&section=dashboard' + query); await page.waitForLoadState('networkidle') }
const card = id => page.locator(`[data-session-id="${id}"]`)
const select = async (label, option) => { await page.getByRole('button', { name: label, exact: true }).click(); await page.getByRole('option', { name: option, exact: true }).click() }
try {
  await go('&demo=1')
  await page.getByRole('button', { name: 'Mở rộng Gold Swing', exact: true }).click()
  assert.equal(await card('demo-gold').locator('.fxs-chart-panel').count(), 3)
  assert.equal(await card('demo-gold').locator('svg.fxs-balance-curve').count(), 1)
  await page.screenshot({ path: out + '/demo-expanded-dark.png', fullPage: true })
  await page.getByRole('button', { name: 'Mở rộng London Breakout', exact: true }).click()
  const gradients = await page.locator('.fxs-balance-curve linearGradient').evaluateAll(nodes => nodes.map(node => node.id))
  assert.equal(new Set(gradients).size, 2)
  const href = new URL(await card('demo-gold').getByRole('link', { name: 'Analytics Gold Swing' }).getAttribute('href'), page.url())
  assert.equal(href.searchParams.get('demo_session'), 'demo-gold')
  await page.goto(href.href); await page.waitForLoadState('networkidle')
  assert.equal(await page.getByRole('button', { name: 'Session: Gold Swing', exact: true }).count(), 1)
  await go('&demo=1')
  await card('demo-gold').getByRole('button', { name: 'Summary Gold Swing', exact: true }).click()
  const summary = page.getByRole('dialog')
  assert.equal(await summary.locator('.fxs-chart-panel').count(), 3)
  assert.equal(await summary.locator('.fxs-metric').count(), 6)
  await page.keyboard.press('Escape')
  await card('demo-gold').getByRole('button', { name: 'Sửa Gold Swing', exact: true }).click()
  await page.getByRole('dialog').getByLabel('Tên phiên', { exact: true }).fill('Gold Swing edited')
  await page.getByRole('dialog').getByLabel('Mô tả', { exact: true }).fill('Demo local edit')
  await page.getByRole('button', { name: 'Lưu thay đổi', exact: true }).click()
  await card('demo-gold').getByRole('heading', { name: /Gold Swing edited/ }).waitFor()
  await card('demo-gold').getByRole('button', { name: 'Tạo bản sao Gold Swing edited', exact: true }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Tạo bản sao', exact: true }).click()
  const copy = page.locator('[data-session-id^="demo-copy-"]')
  await copy.waitFor()
  assert.match(await copy.innerText(), /Gold Swing edited \(copy\)/)
  await copy.getByRole('button', { name: /^Mở rộng/ }).click()
  await copy.locator('.fxs-balance-curve').waitFor()
  assert.equal(await copy.locator('.fxs-chart-panel').count(), 3)
  await card('demo-gold').getByRole('button', { name: 'Lưu trữ Gold Swing edited', exact: true }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Lưu trữ', exact: true }).click()
  await card('demo-gold').waitFor({ state: 'detached' })
  await page.getByRole('button', { name: 'Hiện bộ lọc phiên', exact: true }).click()
  await select('Trạng thái phiên', 'Đã lưu trữ')
  await card('demo-gold').waitFor()
  assert.equal(await card('demo-gold').getByRole('button', { name: /^Tạo bản sao/ }).isDisabled(), true)
  await card('demo-gold').getByRole('button', { name: 'Khôi phục Gold Swing edited', exact: true }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Khôi phục', exact: true }).click()
  await select('Trạng thái phiên', 'Đang hoạt động')
  await card('demo-gold').waitFor()
  report.checks.push('Demo rename, copy with analytics, archive/restore, Summary, 3-chart expansion, unique SVG gradients, session-specific demo Analytics link')
  await go('&demo=1')
  assert.match(await card('demo-gold').innerText(), /Gold Swing/)
  assert.doesNotMatch(await card('demo-gold').innerText(), /edited/)
  assert.equal(await page.locator('[data-session-id^="demo-copy-"]').count(), 0)
  report.checks.push('Demo mutations reset on navigation/reload; original fixtures remain unchanged')
  for (const width of [1671, 768, 360]) {
    await page.setViewportSize({ width, height: width === 360 ? 600 : 987 })
    await card('demo-gold').getByRole('button', { name: 'Mở rộng Gold Swing', exact: true }).click()
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth), 0)
    await card('demo-gold').getByRole('button', { name: 'Sửa Gold Swing', exact: true }).click()
    const box = await page.getByRole('dialog').boundingBox()
    assert.ok(box.x >= 0 && box.x + box.width <= width)
    await page.screenshot({ path: out + `/demo-dialog-${width}.png` })
    await page.keyboard.press('Escape')
    await card('demo-gold').getByRole('button', { name: 'Thu gọn Gold Swing', exact: true }).click()
  }
  await page.setViewportSize({ width: 1671, height: 987 })
  await go('')
  await page.locator('.fx-dashboard-session-card').first().waitFor()
  await page.screenshot({ path: out + '/real-dashboard.png', fullPage: true })
  await page.locator('.fx-dashboard-card-summary').first().click()
  await page.getByRole('dialog').locator('.fxs-metric').first().waitFor()
  await page.screenshot({ path: out + '/real-summary.png', fullPage: true })
  await page.keyboard.press('Escape')
  report.checks.push('Real Dashboard catalog/read analytics and Summary; responsive demo dialog and cards 1671/768/360x600')
  assert.deepEqual(report.errors, [])
  assert.deepEqual(report.writes, [])
  report.pass = true
} catch (error) {
  report.failure = error.stack
  await page.screenshot({ path: out + '/failure.png', fullPage: true }).catch(() => {})
  process.exitCode = 1
} finally {
  await browser.close()
  await writeFile(out + '/lifecycle.json', JSON.stringify(report, null, 2))
  console.log(JSON.stringify(report))
}
