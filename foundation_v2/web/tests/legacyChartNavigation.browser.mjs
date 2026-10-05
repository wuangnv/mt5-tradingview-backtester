import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { chromium } from 'playwright'

const args = Object.fromEntries(process.argv.slice(2).map(arg => arg.slice(2).split('=')))
const ui = 'http://127.0.0.1:5180', api = 'http://127.0.0.1:8020'
const out = args.out
assert.ok(out)
await mkdir(out, { recursive: true })
const browser = await chromium.launch({ headless: true })
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
const errors = [], writes = [], checks = []
await context.route('**/api/**', async route => {
  if (route.request().method() !== 'GET') { writes.push(route.request().url()); return route.abort() }
  const url = new URL(route.request().url())
  const response = await route.fetch({ url: api + url.pathname + url.search })
  await route.fulfill({ response })
})
const page = await context.newPage()
page.on('pageerror', error => errors.push(String(error)))
try {
  await page.goto(`${ui}/?workspace=tenant-a&view=replay&session=a70ee596383445d29e650175d505639a&surface=workspace&cursor=60`)
  await page.locator('[data-chart-status="ready"]').waitFor({ timeout: 25000 })
  const chart = page.frameLocator('.advanced-chart-host iframe')
  await chart.getByRole('link', { name: 'Trở về Sessions', exact: true }).click()
  await page.waitForURL(url => url.searchParams.get('select') === '1', { timeout: 8000 })
  assert.equal(await page.locator('.advanced-chart-host iframe').count(), 0)
  assert.equal(await page.getByRole('navigation', { name: 'Tiện ích replay', exact: true }).count(), 0)
  checks.push('native iframe back link navigates top-level Sessions and unmounts chart')
  await page.locator('.fx-subnav').getByRole('link', { name: 'Dashboard', exact: true }).click()
  await page.locator('.fx-dashboard').waitFor()
  for (const selector of ['.chart-utility-rail', '.legacy-quick-actions', '.chart-floating-toolbar', '.chart-trading-bar', '.advanced-chart-host']) assert.equal(await page.locator(selector).count(), 0, `Dashboard has no stale ${selector}`)
  await page.screenshot({ path: out + '/dashboard-after-chart.png' })
  checks.push('actual chart → Sessions → Dashboard journey removes all chart chrome')
  assert.deepEqual(errors, []); assert.deepEqual(writes, [])
  await writeFile(out + '/report.json', JSON.stringify({ result: 'PASS', checks, errors, writes }, null, 2))
  console.log(JSON.stringify({ result: 'PASS', checks: checks.length, out }))
} catch (error) {
  await page.screenshot({ path: out + '/failure.png' }).catch(() => {})
  await writeFile(out + '/report.json', JSON.stringify({ result: 'FAIL', error: String(error), url: page.url(), frames: page.frames().map(frame => frame.url()), checks, errors, writes }, null, 2))
  throw error
} finally { await context.unrouteAll({ behavior: 'ignoreErrors' }); await browser.close() }
