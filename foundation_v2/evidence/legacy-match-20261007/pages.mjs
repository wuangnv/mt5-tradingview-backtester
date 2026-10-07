import assert from 'node:assert/strict'
import { writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { chromium } from '../../web/node_modules/playwright/index.mjs'
const out = new URL('./', import.meta.url), report = { cases: [], errors: [], deniedWrites: [] }
const browser = await chromium.launch({ headless: true })
const pages = [
  ['dashboard', 'view=overview&area=testing&section=dashboard'],
  ['sessions', 'view=replay&area=testing&section=sessions&select=1'],
  ['trades', 'view=trade&area=testing&section=trades&select=1&sessions=all'],
  ['analytics', 'view=analytics&area=testing&section=analytics&select=1'],
  ['market-data', 'view=market-data&area=testing&section=market-data'],
  ['live', 'view=live&area=live&section=calendar'],
  ['settings', 'view=settings&area=settings'],
]
try {
  for (const theme of ['dark', 'light']) {
    const context = await browser.newContext({ viewport: { width: 1710, height: 987 } })
    await context.addInitScript(theme => { localStorage.setItem('tw-theme', theme); localStorage.setItem('tw-language', 'vi') }, theme)
    await context.routeWebSocket('**/*', socket => socket.close())
    await context.route('**/*', route => {
      const request = route.request(), target = new URL(request.url())
      if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method())) { report.deniedWrites.push(request.url()); return route.abort() }
      if (!['http://127.0.0.1:5180', 'http://127.0.0.1:8010'].includes(target.origin)) return route.abort()
      return route.continue()
    })
    const page = await context.newPage()
    page.on('pageerror', error => report.errors.push(String(error)))
    for (const [name, query] of pages) {
      await page.goto(`http://127.0.0.1:5180/?workspace=tenant-a&demo=1&${query}`)
      await page.locator('.fx-content > *').first().waitFor({ timeout: 20000 })
      await page.waitForTimeout(500)
      const result = await page.locator('.fx-app').evaluate(el => {
        const css = getComputedStyle(el)
        return { theme: el.dataset.theme, canvas: css.getPropertyValue('--project-canvas').trim(), text: css.getPropertyValue('--project-text').trim(), action: css.getPropertyValue('--project-action').trim(), overflow: document.documentElement.scrollWidth - innerWidth }
      })
      assert.equal(result.canvas, theme === 'dark' ? '#080808' : '#FFFFFF')
      assert.equal(result.text, theme === 'dark' ? '#FFFFFF' : '#111111')
      assert.equal(result.overflow, 0)
      await page.screenshot({ path: fileURLToPath(new URL(`page-${name}-${theme}.png`, out)) })
      report.cases.push({ name, width: 1710, ...result })
      if (['dashboard', 'market-data', 'live'].includes(name)) {
        await page.setViewportSize({ width: 390, height: 987 })
        await page.waitForTimeout(200)
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth), 0)
        await page.screenshot({ path: fileURLToPath(new URL(`page-${name}-${theme}-390.png`, out)) })
        report.cases.push({ name, width: 390, ...result })
        await page.setViewportSize({ width: 1710, height: 987 })
      }
    }
    await context.close()
  }
  assert.deepEqual(report.errors, [])
  assert.deepEqual(report.deniedWrites, [])
  report.pass = true
} catch (error) { report.pass = false; report.failure = String(error); throw error }
finally { await writeFile(new URL('pages-report.json', out), JSON.stringify(report, null, 2)); await browser.close(); console.log(JSON.stringify(report)) }
