import { chromium } from '../../../web/node_modules/playwright/index.mjs'
import assert from 'node:assert/strict'
import { writeFile } from 'node:fs/promises'

const browser = await chromium.launch({ ignoreDefaultArgs: ['--hide-scrollbars'] })
const results = [], errors = [], blocked = []
try {
  for (const width of [1440, 360]) for (const theme of ['dark', 'light']) {
    const context = await browser.newContext({ viewport: { width, height: 1000 } })
    await context.addInitScript(theme => { localStorage.setItem('tw-theme', theme); localStorage.setItem('tw-language', 'vi') }, theme)
    await context.route('**/*', route => {
      const request = route.request(), url = new URL(request.url())
      if (!['localhost', '127.0.0.1'].includes(url.hostname) || !['GET', 'HEAD', 'OPTIONS'].includes(request.method())) { blocked.push(url.href); return route.abort() }
      return route.continue()
    })
    const page = await context.newPage()
    page.on('pageerror', error => errors.push(error.message))
    for (const section of ['calendar', 'trades', 'notes', 'tag-analytics', 'analytics', 'trading-accounts', 'market-data', 'dashboard']) {
      const view = section === 'market-data' ? section : section === 'dashboard' ? 'overview' : 'live'
      const area = view === 'live' ? 'live' : 'testing'
      await page.goto(`http://127.0.0.1:5180/?workspace=tenant-a&view=${view}&area=${area}&section=${section}&demo=1`)
      const target = page.locator(view === 'live' ? '.live-topbar' : view === 'overview' ? '.fx-dashboard-session-card' : '.market-sync-filters').first()
      await target.waitFor()
      const geometry = await page.evaluate(() => {
        const content = document.querySelector('.fx-content'), box = content.getBoundingClientRect()
        const selector = document.querySelector('.live-workspace') ? '.live-topbar' : '.market-sync-filters'
        const divider = document.querySelector(selector)?.getBoundingClientRect()
        return { overflow: document.documentElement.scrollWidth > innerWidth, content: { left: box.left, right: box.right }, divider: divider && { left: divider.left, right: divider.right } }
      })
      assert.equal(geometry.overflow, false, `${section}/${width}/${theme}`)
      if (view !== 'overview') {
        assert.ok(Math.abs(geometry.content.left - geometry.divider.left) < 1)
        assert.ok(Math.abs(geometry.content.right - geometry.divider.right) < 18)
      }
      if (view === 'live') {
        assert.equal(await page.locator('.live-status').count(), 0)
        assert.equal(await page.locator('.live-topbar .live-read-only').count(), 0)
      }
      if (view === 'overview') {
        await page.getByRole('button', { name: 'Hiện bộ lọc phiên', exact: true }).click()
        assert.equal(await page.getByRole('button', { name: 'Trạng thái phiên', exact: true }).count(), 0)
        const head = page.locator('.fx-dashboard-session-card-head').first()
        await head.hover()
        await page.waitForTimeout(180)
        assert.equal(await head.evaluate(el => getComputedStyle(el).backgroundColor), await head.evaluate(el => getComputedStyle(document.querySelector('.fx-app')).getPropertyValue('--project-canvas').trim()).then(async value => page.evaluate(value => { const el = document.createElement('div'); el.style.color = value; document.body.append(el); const color = getComputedStyle(el).color; el.remove(); return color }, value)))
        await head.click({ position: { x: 60, y: 20 } })
        assert.equal(await page.locator('.fx-dashboard-session-card.is-expanded').count(), 1)
      }
      results.push({ section, width, theme, geometry, pass: true })
      if (width === 1440 && theme === 'dark' && ['calendar', 'trades', 'trading-accounts', 'market-data'].includes(section)) await page.screenshot({ path: new URL(`./${section}.png`, import.meta.url).pathname.replace(/^\/(\w:)/, '$1'), fullPage: true })
    }
    await context.close()
  }
  assert.deepEqual(errors, []); assert.deepEqual(blocked, [])
  await writeFile(new URL('./report.json', import.meta.url), JSON.stringify({ results, errors, blocked }, null, 2))
  console.log(`${results.length} layout cases PASS`)
} finally { await browser.close() }
