import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'

const webRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const origin = process.env.TW_UI_ORIGIN || 'http://127.0.0.1:5180'
assert.equal(new URL(origin).hostname, '127.0.0.1')
const out = path.resolve(process.env.TW_UI_EVIDENCE || path.join(webRoot, '../../../..', '.artifacts/mt5-shell-controls'))
const report = { scope: 'Real local read-only shell geometry, preferences and keyboard interactions; no broker or API writes', cases: [], blockedRequests: [], pageErrors: [] }
await mkdir(out, { recursive: true })
const browser = await chromium.launch({ headless: true })

async function assertGeometry(page) {
  const metrics = await page.evaluate(() => {
    const menu = document.querySelector('.fx-menu-button')
    const button = menu.getBoundingClientRect()
    const brand = document.querySelector('.fx-topbar-brand').getBoundingClientRect()
    const logo = document.querySelector('.fx-wordmark').getBoundingClientRect()
    const rail = document.querySelector('.fx-rail').getBoundingClientRect()
    const cornersHit = [[2, 2], [button.width - 2, button.height - 2]].every(([dx, dy]) => menu.contains(document.elementFromPoint(button.x + dx, button.y + dy)))
    const controls = [...document.querySelectorAll('.fx-topbar-actions button')].map(element => element.getBoundingClientRect().toJSON())
    return { button: button.toJSON(), brand: brand.toJSON(), logo: logo.toJSON(), rail: rail.toJSON(), cornersHit, controls, overflow: document.documentElement.scrollWidth - innerWidth }
  })
  assert.equal(metrics.button.width, 44)
  assert.equal(metrics.button.height, 44)
  assert.ok(metrics.button.x >= metrics.brand.x && metrics.button.right <= metrics.brand.right, 'Menu target stays inside its brand cell')
  assert.equal(metrics.cornersHit, true, 'The whole target is clickable, not just the icon')
  if (metrics.logo.width) assert.ok(metrics.logo.x >= metrics.button.right + 8, 'Expanded logo does not overlap menu')
  else assert.equal(metrics.button.x + 22, metrics.rail.x + metrics.rail.width / 2, 'Compact menu is centered over the rail')
  for (let i = 1; i < metrics.controls.length; i++) assert.ok(metrics.controls[i].x >= metrics.controls[i - 1].right, 'Header controls do not overlap')
  assert.ok(metrics.overflow <= 1)
  return metrics
}

async function assertReadable(locator) {
  const colors = await locator.evaluate(element => {
    let surface = element
    while (surface && getComputedStyle(surface).backgroundColor === 'rgba(0, 0, 0, 0)') surface = surface.parentElement
    return { text: getComputedStyle(element).color, background: getComputedStyle(surface).backgroundColor }
  })
  const luminance = color => color.match(/[\d.]+/g).slice(0, 3).map(value => {
    const channel = Number(value) / 255
    return channel <= .04045 ? channel / 12.92 : ((channel + .055) / 1.055) ** 2.4
  }).reduce((sum, channel, index) => sum + channel * [.2126, .7152, .0722][index], 0)
  const foreground = luminance(colors.text)
  const background = luminance(colors.background)
  const ratio = (Math.max(foreground, background) + .05) / (Math.min(foreground, background) + .05)
  assert.ok(ratio >= 4.5, `Body text contrast ${ratio.toFixed(2)}: ${JSON.stringify(colors)}`)
  return ratio
}

try {
  for (const width of [1440, 768, 390, 320]) for (const theme of ['dark', 'light']) {
    const context = await browser.newContext({ viewport: { width, height: 900 }, reducedMotion: 'reduce' })
    await context.route('**/*', async route => {
      const request = route.request()
      const url = new URL(request.url())
      if (['http:', 'https:'].includes(url.protocol) && (url.origin !== origin || !['GET', 'HEAD', 'OPTIONS'].includes(request.method()))) {
        report.blockedRequests.push({ method: request.method(), url: request.url() })
        return route.abort()
      }
      await route.continue()
    })
    const page = await context.newPage()
    page.on('pageerror', error => report.pageErrors.push(String(error)))
    await page.addInitScript(theme => {
      localStorage.setItem('tw-theme', theme)
      localStorage.setItem('tw-language', 'vi')
      if (localStorage.getItem('tw-shell-rail-collapsed') === null) localStorage.setItem('tw-shell-rail-collapsed', 'true')
    }, theme)
    await page.goto(`${origin}/?workspace=tenant-a&view=replay&select=1`, { waitUntil: 'networkidle' })
    const emptyContrast = await assertReadable(page.locator('.fxr-empty-state p'))
    const menu = page.locator('.fx-menu-button')
    const initial = await assertGeometry(page)
    assert.equal(await menu.getAttribute('aria-expanded'), 'false')
    assert.equal(await menu.getAttribute('aria-label'), width <= 760 ? 'Mở điều hướng' : 'Mở rộng điều hướng')
    const collapsedIcon = await menu.locator('svg').innerHTML()
    await menu.focus()
    assert.equal(await menu.evaluate(element => getComputedStyle(element).outlineStyle), 'solid')
    await page.keyboard.press('Enter')
    if (width <= 760) {
      await page.getByRole('dialog', { name: 'Điều hướng chính WMREPLAY' }).waitFor()
      await page.keyboard.press('Escape')
      await page.getByRole('dialog').waitFor({ state: 'detached' })
      assert.equal(await menu.evaluate(element => element === document.activeElement), true)
      assert.equal(await page.evaluate(() => localStorage.getItem('tw-shell-rail-collapsed')), 'true')
    } else {
      assert.equal(await menu.getAttribute('aria-expanded'), 'true')
      assert.equal(await menu.getAttribute('aria-label'), 'Thu gọn điều hướng')
      assert.notEqual(await menu.locator('svg').innerHTML(), collapsedIcon)
      const expanded = await assertGeometry(page)
      assert.equal(expanded.rail.width, 248)
      await page.reload({ waitUntil: 'networkidle' })
      assert.equal(await menu.getAttribute('aria-expanded'), 'true', 'Desktop choice persists after reload')
      await page.screenshot({ path: path.join(out, `${width}-${theme}-expanded.png`) })
      await menu.click()
    }
    await assertGeometry(page)
    // The native select remains the real control; its decorative chevron must
    // be centered independently of the machine's font metrics.
    const chevron = page.locator('.fxr-select-chevron')
    const icon = await chevron.locator('svg').boundingBox()
    const circle = await chevron.boundingBox()
    assert.ok(Math.abs(icon.x + icon.width / 2 - circle.x - circle.width / 2) < 1)
    assert.ok(Math.abs(icon.y + icon.height / 2 - circle.y - circle.height / 2) < 1)
    assert.equal(await page.getByRole('combobox', { name: 'Chọn phiên replay' }).isEnabled(), true)
    await page.getByTestId('language-toggle').click()
    assert.equal(await page.locator('html').getAttribute('lang'), 'en')
    assert.equal(await menu.getAttribute('aria-label'), width <= 760 ? 'Open navigation' : 'Expand navigation')
    assert.equal(await page.getByTestId('language-toggle').textContent(), 'VI')
    await page.getByTestId('language-toggle').click()
    await page.getByTestId('theme-toggle').click()
    assert.equal(await page.getByTestId('fxreplay-shell').getAttribute('data-theme'), theme === 'dark' ? 'light' : 'dark')
    await page.getByTestId('theme-toggle').click()
    await page.getByTestId('help-toggle').click()
    await page.getByRole('dialog', { name: 'Phím tắt WMREPLAY' }).waitFor()
    await page.keyboard.press('Escape')
    await page.getByRole('dialog').waitFor({ state: 'detached' })
    assert.equal(await page.getByTestId('help-toggle').evaluate(element => element === document.activeElement), true)
    await page.screenshot({ path: path.join(out, `${width}-${theme}-compact.png`) })
    let historicalContrast = null
    if (process.env.TW_UI_SESSION) {
      await page.goto(`${origin}/?workspace=tenant-a&view=analytics&session=${encodeURIComponent(process.env.TW_UI_SESSION)}&cursor=20`, { waitUntil: 'networkidle' })
      const note = page.getByTestId('analytics-historical-scope')
      await note.waitFor()
      historicalContrast = await assertReadable(note)
      await page.screenshot({ path: path.join(out, `${width}-${theme}-historical.png`) })
    }
    report.cases.push({ width, theme, initial, keyboard: true, stateIcon: true, preferences: true, help: true, selectChevronCentered: true, emptyContrast, historicalContrast })
    await context.close()
  }
  assert.deepEqual(report.blockedRequests, [])
  assert.deepEqual(report.pageErrors, [])
  report.status = 'PASS'
} catch (error) {
  report.status = 'FAIL'
  report.error = error.stack
  process.exitCode = 1
} finally {
  await browser.close()
  await writeFile(path.join(out, 'report.json'), JSON.stringify(report, null, 2))
  console.log(JSON.stringify({ status: report.status, cases: report.cases.length, out, error: report.error }))
}
