import assert from 'node:assert/strict'
import { chromium } from '../../web/node_modules/playwright/index.mjs'
import { writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

const origin = 'http://127.0.0.1:5180'
const report = { cases: [], errors: [], blocked: [] }
const browser = await chromium.launch()
const styleKeys = ['borderRadius', 'border', 'backgroundColor', 'height', 'padding', 'fontSize', 'lineHeight', 'color', 'outlineStyle', 'boxShadow']
const styles = locator => locator.evaluate((e, keys) => {
  const s = getComputedStyle(e), placeholder = getComputedStyle(e, '::placeholder')
  return { ...Object.fromEntries(keys.map(k => [k, s[k]])), placeholderColor: placeholder.color, placeholderOpacity: placeholder.opacity }
}, styleKeys)
try {
  for (const width of [1710, 768, 360]) for (const theme of ['dark', 'light']) {
    const context = await browser.newContext({ viewport: { width, height: 987 } })
    await context.addInitScript(theme => { localStorage.setItem('tw-theme', theme); localStorage.setItem('tw-language', 'vi') }, theme)
    await context.routeWebSocket('**/*', s => s.close())
    await context.route('**/*', route => {
      const r = route.request(), u = new URL(r.url())
      if (u.origin !== origin || /^\/api\/v2\/live\//.test(u.pathname) || !['GET', 'HEAD', 'OPTIONS'].includes(r.method())) {
        report.blocked.push(r.method() + ' ' + r.url()); return route.abort()
      }
      return route.continue()
    })
    const page = await context.newPage()
    page.on('pageerror', e => report.errors.push(String(e)))
    const item = { name: `search-parity-${width}-${theme}`, states: {} }
    report.cases.push(item)
    try {
      const reference = {}
      for (const [view, selector] of [['overview', '.fx-dashboard-search input'], ['market-data', '.data-library-search input']]) {
        await page.goto(`${origin}/?workspace=tenant-a&view=${view}&area=testing&section=${view === 'overview' ? 'dashboard' : 'market-data'}`)
        const input = page.locator(selector)
        await input.waitFor()
        await page.mouse.move(0, 0)
        await input.evaluate(e => e.blur())
        await page.waitForTimeout(170)
        const states = { rest: await styles(input) }
        await input.hover()
        await page.waitForTimeout(170)
        states.hover = await styles(input)
        await page.mouse.move(0, 0)
        await page.keyboard.press('Tab')
        await input.focus()
        assert(await input.evaluate(e => e.matches(':focus-visible')))
        await page.waitForTimeout(170)
        states.focus = await styles(input)
        assert.equal(await page.locator('.fx-content').evaluate(e => e.scrollWidth - e.clientWidth), 0)
        if (view === 'overview') Object.assign(reference, states)
        else {
          assert.deepEqual(states, reference)
          assert.equal(states.rest.borderRadius, '999px')
          await input.fill('EURUSD')
          assert.equal(await input.inputValue(), 'EURUSD')
          await input.fill('')
          await page.screenshot({ path: fileURLToPath(new URL(`${item.name}.png`, import.meta.url)), fullPage: true })
          item.states = states
        }
      }
      item.pass = true
    } catch (e) { item.pass = false; item.failure = String(e) }
    finally { await context.close() }
  }
} finally { await browser.close() }
await writeFile(new URL('verification.json', import.meta.url), JSON.stringify(report, null, 2))
console.log(JSON.stringify({ passed: report.cases.filter(x => x.pass).length, total: report.cases.length, failures: report.cases.filter(x => !x.pass), errors: report.errors, blocked: report.blocked }))
if (report.errors.length || report.cases.some(x => !x.pass)) process.exitCode = 1
