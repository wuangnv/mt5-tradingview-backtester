import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { chromium } from 'playwright'

const origin = process.env.TESTING_UI_ORIGIN || 'http://127.0.0.1:5180'
const out = process.env.TW_UI_EVIDENCE_DIR || '../evidence/menu-audit-20261009'
await mkdir(out, { recursive: true })
const browser = await chromium.launch({ headless: true })
const results = [], errors = [], writes = []
const query = '?workspace=tenant-a&area=testing'

async function assertAligned(menu) {
  const geometry = await menu.locator('.fx-select-all,[role=option]').evaluateAll(rows => rows.map(row => {
    const checkbox = row.querySelector('.fx-select-checkbox')?.getBoundingClientRect()
    const text = row.querySelector('.fx-select-option-label')?.getBoundingClientRect()
    const bounds = row.getBoundingClientRect()
    const css = getComputedStyle(row)
    return { checkboxX: checkbox?.x, textX: text?.x, right: bounds.right, textRight: text?.right, height: bounds.height, gap: css.gap, lineHeight: css.lineHeight }
  }))
  assert.ok(geometry.length > 1)
  for (const row of geometry) {
    assert.ok(Math.abs(row.checkboxX - geometry[0].checkboxX) < 1, 'checkboxes share left edge')
    assert.ok(Math.abs(row.textX - geometry[0].textX) < 1, 'select all and option captions share left edge')
    assert.ok(row.textRight <= row.right + 1, 'caption stays inside row')
    assert.equal(row.gap, '8px')
    assert.equal(row.lineHeight, '20px')
  }
  return geometry
}

try {
  for (const theme of ['dark', 'light']) {
    for (const width of [1710, 360]) {
      const context = await browser.newContext({ viewport: { width, height: 987 }, isMobile: width === 360, hasTouch: width === 360 })
      await context.addInitScript(theme => { localStorage.setItem('tw-theme', theme); localStorage.setItem('tw-language', 'vi') }, theme)
      await context.route('**/*', route => {
        const request = route.request()
        if (new URL(request.url()).origin !== new URL(origin).origin) return route.abort()
        if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method())) { writes.push(request.url()); return route.abort() }
        return route.continue()
      })
      const page = await context.newPage()
      page.setDefaultTimeout(10000)
      page.on('pageerror', error => errors.push(error.message))
      const openReference = async () => {
        await page.goto(`${origin}/${query}&ui_reference=1#controls`)
        await page.locator('#controls .fx-select-trigger').nth(1).click()
        await page.locator('.fx-select-menu').waitFor()
      }
      await openReference()
      const menu = page.locator('.fx-select-menu')
      const geometry = await assertAligned(menu)
      const all = menu.getByRole('checkbox', { name: 'Chọn tất cả', exact: true })
      assert.equal(await menu.locator('.fx-select-count').innerText(), '1 / 2 đã chọn')
      await all.click()
      assert.equal(await menu.locator('.fx-select-count').innerText(), '2 / 2 đã chọn')
      assert.equal(await all.getAttribute('aria-checked'), 'true')
      await all.click()
      assert.equal(await menu.locator('.fx-select-count').innerText(), '0 / 2 đã chọn')
      assert.equal(await all.getAttribute('aria-checked'), 'false')
      const disabled = menu.getByRole('option').last()
      assert.equal(await disabled.isDisabled(), true)
      assert.equal(await disabled.locator('.fx-select-checkbox').evaluate(e => getComputedStyle(e).opacity), '1', 'disabled effect applies once on the row')
      await menu.locator('input').fill('không có lựa chọn nào')
      await menu.getByRole('status').waitFor()
      await menu.locator('input').fill('')
      await menu.getByRole('option', { name: 'Mua', exact: true }).focus()
      assert.equal(await menu.getByRole('option', { name: 'Mua', exact: true }).evaluate(e => getComputedStyle(e).outlineOffset), '-2px', 'keyboard ring fits inside scrolling list')
      await page.keyboard.press('Space')
      assert.equal(await menu.getByRole('option', { name: 'Mua', exact: true }).getAttribute('aria-selected'), 'true')
      assert.equal(await all.getAttribute('aria-checked'), 'mixed')
      if (width === 360) assert.ok(geometry.every(row => row.height >= 44), 'select all shares touch target with options')
      await menu.screenshot({ path: `${out}/aligned-menu-${theme}-${width}.png` })
      await page.keyboard.press('Escape')
      assert.equal(await page.locator('#controls .fx-select-trigger').nth(1).evaluate(e => e === document.activeElement), true)
      results.push({ case: 'reference geometry/search/count/keyboard/disabled', theme, width, geometry, pass: true })
      // Loading another route may load a new style chunk. Reference alignment must survive it.
      await page.goto(`${origin}/${query}&view=analytics&demo=1&select=1`)
      await page.locator('.fxa-session-trigger').first().waitFor()
      await openReference()
      await assertAligned(page.locator('.fx-select-menu'))
      await page.keyboard.press('Escape')
      results.push({ case: 'alignment independent of route CSS loading', theme, width, pass: true })
      await page.goto(`${origin}/${query}&view=trade&demo=1&sessions=all&select=1`)
      await page.locator('.fxa-session-trigger').first().click()
      const sessionMenu = page.locator('.fxa-session-menu')
      await sessionMenu.waitFor()
      const sessionX = await sessionMenu.locator('.fxa-session-all,.fxa-session-options > button').evaluateAll(rows => rows.map(row => {
        const mark = row.querySelector('.fx-select-checkbox').getBoundingClientRect(), text = row.querySelector('span:last-child')?.getBoundingClientRect()
        return { x: mark.x, text: text?.x }
      }))
      assert.ok(sessionX.every(row => Math.abs(row.x - sessionX[0].x) < 1))
      await sessionMenu.screenshot({ path: `${out}/session-menu-${theme}-${width}.png` })
      await page.keyboard.press('Escape')
      if (width === 360) {
        await page.setViewportSize({ width: 360, height: 360 })
        await page.locator('.fxa-session-trigger').first().click()
        await sessionMenu.waitFor()
        const bounds = await sessionMenu.boundingBox()
        assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= 361)
        assert.ok(bounds.y >= 0 && bounds.y + bounds.height <= 361, 'session menu fits short viewport')
        const list = sessionMenu.locator('.fxa-session-options')
        assert.equal(await list.evaluate(e => getComputedStyle(e).overflowY), 'auto')
        await page.keyboard.press('Tab'); await page.keyboard.press('End')
        const last = list.getByRole('checkbox').last()
        const lastBounds = await last.boundingBox()
        assert.ok(lastBounds.y >= bounds.y && lastBounds.y + lastBounds.height <= 361, 'last session reachable by keyboard scrolling')
        await sessionMenu.screenshot({ path: `${out}/session-short-${theme}.png` })
        await page.keyboard.press('Escape')
        await page.setViewportSize({ width: 360, height: 640 })
        await page.goto(`${origin}/${query}&view=analytics&demo=1&select=1`)
        await page.locator('.fxa-session-trigger').first().click()
        assert.equal(await sessionMenu.evaluate(e => {
          const animation = e.getAnimations()[0]
          if (!animation) return true
          animation.pause(); animation.currentTime = 40
          const bounds = e.getBoundingClientRect()
          const inViewport = bounds.left >= 0 && bounds.right <= window.innerWidth
          animation.play()
          return inViewport
        }), true, 'entrance motion preserves horizontal menu placement')
        const compact = await sessionMenu.boundingBox()
        assert.ok(compact.width >= 260 && compact.width <= 336, 'compact trigger does not shrink its menu')
        assert.ok(compact.y >= 0 && compact.y + compact.height <= 641)
        await sessionMenu.screenshot({ path: `${out}/session-compact-${theme}.png` })
        results.push({ case: 'short viewport and compact session popup', theme, pass: true })
      }
      results.push({ case: 'sibling session menu', theme, width, pass: true })
      await context.close()
    }
  }
  assert.deepEqual(errors, [])
  assert.deepEqual(writes, [])
  await writeFile(`${out}/menu-report.json`, JSON.stringify({ pass: true, results, errors, writes }, null, 2))
  console.log(JSON.stringify({ pass: true, checks: results.length, out }))
} catch (error) {
  await writeFile(`${out}/menu-failure.json`, JSON.stringify({ error: error.message, results, errors, writes }, null, 2))
  throw error
} finally { await browser.close() }
