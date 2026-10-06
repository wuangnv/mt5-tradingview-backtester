import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import { chromium } from 'playwright'

const origin = process.env.TESTING_UI_ORIGIN || 'http://127.0.0.1:5180'
const output = process.env.TESTING_QA_OUTPUT || '../evidence/testing-standard-20261006/chrome-root'
const browser = await chromium.launch({ ignoreDefaultArgs: ['--hide-scrollbars'] })
const results = [], errors = [], writes = []
await fs.mkdir(output, { recursive: true })
const style = locator => locator.evaluate(e => {
  const c = getComputedStyle(e), r = e.getBoundingClientRect()
  return { width: r.width, height: r.height, border: c.border, radius: c.borderRadius, color: c.color, background: c.backgroundColor }
})
const neutral = color => {
  const channels = color.match(/[\d.]+/g)?.slice(0, 3).map(Number)
  return channels?.every(value => value === channels[0])
}
try {
  for (const width of [1320, 768, 390]) for (const theme of ['dark', 'light']) for (const language of ['vi', 'en']) {
    const context = await browser.newContext({ viewport: { width, height: 987 } })
    await context.addInitScript(({ theme, language }) => {
      localStorage.setItem('tw-theme', theme)
      localStorage.setItem('tw-language', language)
      localStorage.setItem('tw-shell-rail-collapsed', 'false')
    }, { theme, language })
    await context.route('**/*', route => {
      const request = route.request()
      if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method())) { writes.push(request.url()); return route.abort() }
      if (![new URL(origin).origin, 'http://127.0.0.1:8010'].includes(new URL(request.url()).origin)) return route.abort()
      return route.continue()
    })
    const page = await context.newPage()
    page.on('pageerror', error => errors.push(error.message))
    for (const [view, extra] of [['overview', ''], ['replay', '&select=1'], ['trade', '&select=1&sessions=all'], ['analytics', '&select=1'], ['analytics', '&select=1&analytics_source=prop'], ['market-data', '']]) {
      await page.goto(`${origin}/?workspace=tenant-a&area=testing&demo=1&view=${view}${extra}`)
      await page.waitForLoadState('networkidle')
      assert.equal(await page.locator('.fx-content').evaluate(e => e.scrollWidth > e.clientWidth + 1), false, `${view} overflow at ${width}`)
      for (const selector of ['.fx-topbar', '.fx-rail', '.fx-rail-section-heading.is-active .fx-nav-icon']) {
        const current = await style(page.locator(selector).first())
        assert.ok(neutral(current.color) && neutral(current.background), `${selector}: neutral ${theme}`)
      }
      const separators = await page.locator('.fx-rail-primary').evaluate(e => { const c = getComputedStyle(e); return [c.borderTopWidth, c.borderBottomWidth] })
      assert.deepEqual(separators, ['1px', '1px'])
      assert.equal(new URL(await page.locator('.fx-rail-workspace').getAttribute('href'), origin).searchParams.get('view'), 'settings')
      for (const circle of await page.locator('.fx-menu-button,.fx-shell-toggle').all()) {
        const current = await style(circle)
        assert.equal(current.width, width <= 480 ? 44 : 32, 'Header circle width')
        assert.equal(current.height, current.width, 'Header circle aspect ratio')
      }
      const circleSelectors = '.fxa-icon-button,.fxa-detail-button,.fx-select.fxa-columns-control .fx-select-trigger,.fx-dashboard-card-icon,.fxs-action-button,.fxs-edit-description,.fxa-pagination > div:not(.fx-select) > button'
      const circles = await page.locator(circleSelectors).all()
      for (const circle of circles) {
        const current = await style(circle), size = width <= 480 ? 44 : 32
        assert.equal(current.width, size, `${view} circle width`)
        assert.equal(current.height, size, `${view} circle height`)
        assert.equal(current.radius, '50%')
        assert.match(current.border, /^1px solid rgba\(0, 0, 0, 0\)$/)
      }
      const select = page.locator('.fx-select:not(.is-rich):not(.fxa-columns-control) .fx-select-trigger').first()
      if (await select.count()) {
        const current = await style(select)
        assert.equal(current.radius, '999px')
        assert.match(current.border, /^1px solid rgba\(0, 0, 0, 0\)$/)
        await select.click()
        assert.equal(await select.getAttribute('aria-expanded'), 'true')
        await page.keyboard.press('Escape')
        assert.equal(await select.getAttribute('aria-expanded'), 'false')
        assert.equal(await select.evaluate(e => e === document.activeElement), true)
        assert.equal(await select.evaluate(e => getComputedStyle(e).outlineStyle), 'solid')
      }
      if (view === 'trade' && language === 'vi') await page.screenshot({ path: `${output}/${view}-${width}-${theme}.png` })
      if (view === 'replay') assert.equal((await style(page.locator('.fxs-settings'))).background, 'rgba(0, 0, 0, 0)', 'Settings remains inline')
      if (view === 'trade' && width <= 480) {
        const pager = page.locator('.fxa-pagination > div:not(.fx-select) > button')
        assert.equal(await pager.count(), 3, 'Compact pager keeps previous/current/next')
        await pager.last().click()
        assert.equal(await page.locator('.fxa-pagination [aria-current=page]').innerText(), '2')
      }
      results.push({ view, extra, width, theme, language, pass: true })
    }
    await page.locator('.fx-menu-button').click()
    if (width <= 760) {
      assert.equal(await page.locator('.fx-rail').getAttribute('role'), 'dialog')
      assert.equal(await page.locator('.fx-rail-workspace-copy strong').isVisible(), true)
      await page.keyboard.press('Escape')
    } else {
      assert.equal(await page.locator('.fx-rail-workspace-copy').isVisible(), false)
      await page.locator('.fx-menu-button').click()
    }
    await context.close()
  }
  for (const [width, coarse] of [[320, false], [360, false], [1320, true]]) {
    const context = await browser.newContext({ viewport: { width, height: 987 }, hasTouch: coarse })
    await context.route('**/*', route => ['GET', 'HEAD', 'OPTIONS'].includes(route.request().method()) ? route.continue() : route.abort())
    const page = await context.newPage()
    await page.goto(`${origin}/?workspace=tenant-a&area=testing&demo=1&view=trade&select=1&sessions=all`)
    await page.waitForLoadState('networkidle')
    for (const circle of await page.locator('.fx-menu-button,.fx-shell-toggle,.fxa-icon-button,.fxa-pagination > div:not(.fx-select) > button').all()) {
      const current = await style(circle)
      assert.equal(current.width, 44)
      assert.equal(current.height, 44)
    }
    assert.equal(await page.locator('.fx-content').evaluate(e => e.scrollWidth > e.clientWidth + 1), false)
    assert.equal((await style(page.locator('.fxa-pagination .fx-select-trigger'))).height, 44)
    await page.screenshot({ path: `${output}/trades-${width}-coarse-${coarse}.png` })
    results.push({ width, coarse, compactTargets: true, pass: true })
    await context.close()
  }
  assert.deepEqual(errors, [])
  assert.deepEqual(writes, [])
  await fs.writeFile(`${output}/report.json`, JSON.stringify({ pass: true, results, errors, writes }, null, 2))
  console.log(`Neutral controls: ${results.length} route checks and 12 navigation journeys passed; no writes.`)
} finally { await browser.close() }
