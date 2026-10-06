import assert from 'node:assert/strict'
import { chromium } from '../../../web/node_modules/playwright/index.mjs'
import { readFile, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'

const output = 'foundation_v2/evidence/testing-tabs-20261006/transparent-hover'
const source = 'foundation_v2/web/src/component-interactions.css'
const pin = async () => createHash('sha256').update(await readFile(source)).digest('hex')
const report = { before: await pin(), cases: [], errors: [], denied: [] }
const browser = await chromium.launch({ ignoreDefaultArgs: ['--hide-scrollbars'] })
try {
  for (const theme of ['dark', 'light']) for (const width of [1377, 360]) {
    const context = await browser.newContext({ viewport: { width, height: 987 } })
    await context.addInitScript(theme => {
      localStorage.setItem('tw-theme', theme)
      localStorage.setItem('tw-language', 'vi')
    }, theme)
    await context.route('**/*', route => {
      const request = route.request()
      if (new URL(request.url()).origin !== 'http://127.0.0.1:5180'
        || !['GET', 'HEAD', 'OPTIONS'].includes(request.method())) {
        report.denied.push(request.url())
        return route.abort()
      }
      return route.continue()
    })
    const page = await context.newPage()
    page.on('pageerror', error => report.errors.push(error.message))
    await page.goto('http://127.0.0.1:5180/?workspace=tenant-a&view=analytics&area=testing&section=analytics&select=1&analytics_source=sessions&demo=1')
    await page.waitForLoadState('networkidle')
    const menu = page.locator('.fx-menu-button')
    await menu.hover()
    await page.waitForTimeout(180)
    const hover = await menu.evaluate(element => {
      const style = getComputedStyle(element)
      return { background: style.backgroundColor, border: style.borderColor, outline: style.outlineStyle, color: style.color }
    })
    assert.equal(hover.background, 'rgba(0, 0, 0, 0)')
    assert.equal(hover.border, 'rgba(0, 0, 0, 0)')
    assert.equal(hover.outline, 'none')
    await page.screenshot({ path: `${output}/final-menu-${theme}-${width}.png` })
    await menu.press('Tab')
    await menu.focus()
    const focus = await menu.evaluate(element => ({ visible: element.matches(':focus-visible'), outline: getComputedStyle(element).outlineStyle }))
    assert.equal(focus.visible, true)
    assert.equal(focus.outline, 'solid')
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false)
    report.cases.push({ theme, width, hover, focus, pass: true })
    await context.close()
  }
  report.after = await pin()
  assert.equal(report.before, report.after)
  assert.deepEqual(report.errors, [])
  assert.deepEqual(report.denied, [])
  report.pass = true
} catch (error) {
  report.failure = String(error)
  process.exitCode = 1
} finally {
  await browser.close()
  await writeFile(`${output}/menu-final-report.json`, JSON.stringify(report, null, 2))
  console.log(JSON.stringify({ pass: report.pass, cases: report.cases.length, failure: report.failure }))
}
