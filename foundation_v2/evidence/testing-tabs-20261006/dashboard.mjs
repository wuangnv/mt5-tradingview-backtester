import assert from 'node:assert/strict'
import { chromium } from '../../web/node_modules/playwright/index.mjs'
import { writeFile } from 'node:fs/promises'

const output = 'foundation_v2/evidence/testing-tabs-20261006'
const origin = 'http://127.0.0.1:5180'
const browser = await chromium.launch({ ignoreDefaultArgs: ['--hide-scrollbars'] })
const report = { cases: [], errors: [], deniedRequests: [], responses: [] }
try {
  for (const theme of ['dark', 'light']) for (const width of [1320, 360]) {
    const context = await browser.newContext({ viewport: { width, height: 987 } })
    await context.addInitScript(theme => {
      localStorage.setItem('tw-theme', theme)
      localStorage.setItem('tw-language', 'vi')
    }, theme)
    await context.route('**/*', route => {
      const request = route.request()
      if (![origin, 'http://127.0.0.1:8010'].includes(new URL(request.url()).origin)
        || !['GET', 'HEAD', 'OPTIONS'].includes(request.method())) {
        report.deniedRequests.push({ method: request.method(), url: request.url() })
        return route.abort()
      }
      return route.continue()
    })
    const page = await context.newPage()
    page.on('pageerror', error => report.errors.push(error.message))
    page.on('response', response => {
      if (new URL(response.url()).pathname.startsWith('/api/')) {
        report.responses.push({ status: response.status(), path: new URL(response.url()).pathname })
      }
    })
    await page.goto(`${origin}/?workspace=tenant-a&view=overview&area=testing&section=dashboard`)
    await page.waitForLoadState('networkidle')
    assert.equal(await page.locator('.fx-dashboard').count(), 1)
    assert.equal(await page.locator('.wm-skeleton, .fx-content [role=alert]').count(), 0)
    assert.equal(await page.locator('.fx-dashboard-session-card').count() > 0, true)
    const tab = page.locator('.fx-subnav-primary>a[aria-current=page]')
    const selected = await tab.evaluate(element => {
      const style = getComputedStyle(element)
      const line = getComputedStyle(element, '::after')
      return { text: style.color, line: line.backgroundColor, lineHeight: line.height, background: style.backgroundColor }
    })
    assert.equal(selected.text, selected.line)
    assert.equal(selected.lineHeight, '2px')
    assert.equal(selected.background, 'rgba(0, 0, 0, 0)')
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false)
    await page.screenshot({ path: `${output}/actual-dashboard-${theme}-${width}.png` })
    report.cases.push({ theme, width, selected, pass: true })
    await context.close()
  }
  assert.deepEqual(report.errors, [])
  assert.deepEqual(report.deniedRequests, [])
  assert.ok(report.responses.length > 0 && report.responses.every(response => response.status === 200))
  report.pass = true
} catch (error) {
  report.failure = String(error)
  process.exitCode = 1
} finally {
  await browser.close()
  await writeFile(`${output}/dashboard-report.json`, JSON.stringify(report, null, 2))
  console.log(JSON.stringify({ pass: report.pass, cases: report.cases.length, failure: report.failure, errors: report.errors, deniedRequests: report.deniedRequests }))
}
