import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'

const webRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const origin = process.env.TW_UI_ORIGIN || 'http://127.0.0.1:5180'
assert.equal(new URL(origin).hostname, '127.0.0.1', 'Use an explicitly selected loopback UI')
const out = path.resolve(process.env.TW_UI_EVIDENCE || path.join(webRoot, '../evidence/wm-ui-integration-20261001/mobile-drawer'))
const storageKey = 'tw-shell-rail-collapsed'
const route = (view) => `${origin}/?workspace=tenant-a&view=${view}`
const report = { scope: 'Shell-only responsive navigation against local services; no API mutation or mock', scenarios: [], blockedRequests: [], pageErrors: [] }
await mkdir(out, { recursive: true })
const browser = await chromium.launch({ headless: true })

async function measure(page) {
  return page.evaluate(() => {
    const main = document.querySelector('.fx-content')
    const rail = document.querySelector('.fx-rail')
    return {
      width: innerWidth,
      contentWidth: main.getBoundingClientRect().width,
      railWidth: rail?.getBoundingClientRect().width ?? 0,
      documentOverflow: document.documentElement.scrollWidth - innerWidth,
      contentOverflow: main.scrollWidth - main.clientWidth,
      persisted: localStorage.getItem('tw-shell-rail-collapsed'),
    }
  })
}

async function assertCompact(page, expectedPreference) {
  await page.waitForFunction(() => document.querySelector('.fx-menu-button')?.getAttribute('aria-expanded') === 'false')
  const metrics = await measure(page)
  assert.equal(metrics.railWidth, 58, 'Phone always has a compact 58px rail')
  assert.equal(metrics.contentWidth, metrics.width - 58, 'Sidebar cannot squeeze the main area')
  assert.ok(metrics.documentOverflow <= 1, `Document overflow: ${JSON.stringify(metrics)}`)
  assert.ok(metrics.contentOverflow <= 1, `Content overflow: ${JSON.stringify(metrics)}`)
  assert.equal(metrics.persisted, expectedPreference, 'Mobile does not change desktop storage')
  return metrics
}

async function openDrawer(page, keyboard = false) {
  if (keyboard) {
    await page.locator('.fx-menu-button').focus()
    await page.keyboard.press('Enter')
  } else await page.locator('.fx-menu-button').click()
  await page.getByRole('dialog', { name: 'Điều hướng chính WMREPLAY' }).waitFor()
  await page.waitForFunction(() => document.activeElement?.getAttribute('aria-label') === 'Đóng điều hướng')
  assert.equal(await page.locator('.fx-menu-button').getAttribute('aria-expanded'), 'true')
  assert.equal(await page.locator('.fx-rail').getAttribute('aria-modal'), 'true')
  assert.equal(await page.locator('.fx-main').evaluate((element) => element.inert), true)
  assert.equal(await page.locator('.fx-topbar').evaluate((element) => element.inert), true)
  const metrics = await measure(page)
  assert.equal(metrics.contentWidth, metrics.width - 58, 'Opening drawer leaves content geometry unchanged')
  assert.equal(metrics.railWidth, 280)
  assert.ok(metrics.documentOverflow <= 1)
  assert.ok(metrics.contentOverflow <= 1)
  assert.equal(await page.locator('.fx-rail-section-label').first().isVisible(), true, 'Drawer labels are readable')
  return metrics
}

async function assertDismissed(page, expectedPreference) {
  await page.getByRole('dialog').waitFor({ state: 'detached' })
  await page.waitForFunction(() => document.activeElement === document.querySelector('.fx-menu-button'))
  assert.equal(await page.locator('.fx-main').evaluate((element) => element.inert), false)
  return assertCompact(page, expectedPreference)
}

try {
  for (const preference of [null, 'false']) {
    const context = await browser.newContext({ viewport: { width: preference === null ? 360 : 1440, height: 900 }, reducedMotion: 'reduce' })
    await context.route('**/*', async (requestRoute) => {
      const request = requestRoute.request()
      const url = new URL(request.url())
      if (['http:', 'https:'].includes(url.protocol) && (url.origin !== origin || !['GET', 'HEAD', 'OPTIONS'].includes(request.method()))) {
        report.blockedRequests.push({ method: request.method(), url: request.url() })
        await requestRoute.abort()
      } else await requestRoute.continue()
    })
    const page = await context.newPage()
    page.setDefaultTimeout(10000)
    page.on('pageerror', (error) => report.pageErrors.push(String(error)))
    await page.goto(route('overview'))
    await page.locator('.fx-menu-button').waitFor()
    if (preference !== null) {
      await page.evaluate(([key, value]) => localStorage.setItem(key, value), [storageKey, preference])
      await page.reload()
      await page.waitForFunction(() => document.querySelector('.fx-menu-button')?.getAttribute('aria-expanded') === 'true')
      assert.equal((await measure(page)).railWidth, 248)
      await page.setViewportSize({ width: 360, height: 900 })
    }
    const scenario = { preference, compact: await assertCompact(page, preference), themes: [] }
    for (const theme of ['dark', 'light']) {
      await page.waitForFunction(() => {
        const state = document.querySelector('[data-testid="dashboard-data-state"]')
        return state && !state.textContent.startsWith('Đang tải đúng phạm vi')
      })
      await assertCompact(page, preference)
      if (await page.locator('.fx-app').getAttribute('data-theme') !== theme) await page.getByTestId('theme-toggle').click()
      const prefix = `${preference === null ? 'fresh' : 'resized'}-${theme}`
      await page.screenshot({ path: path.join(out, `${prefix}-compact.png`) })
      const opened = await openDrawer(page, true)
      await page.screenshot({ path: path.join(out, `${prefix}-open.png`) })
      await page.keyboard.press('Shift+Tab')
      assert.match(await page.evaluate(() => document.activeElement.getAttribute('aria-label')), /^Settings:/, 'Reverse Tab wraps to the last link')
      await page.keyboard.press('Tab')
      assert.equal(await page.evaluate(() => document.activeElement.getAttribute('aria-label')), 'Đóng điều hướng', 'Tab wraps inside the drawer')
      await page.keyboard.press('Tab')
      assert.match(await page.evaluate(() => document.activeElement.getAttribute('aria-label')), /^Testing:/)
      await page.keyboard.press('Escape')
      await assertDismissed(page, preference)
      await openDrawer(page)
      await page.getByRole('button', { name: 'Đóng điều hướng', exact: true }).click()
      await assertDismissed(page, preference)
      await openDrawer(page)
      await page.locator('.fx-mobile-nav-backdrop').click({ position: { x: 350, y: 180 } })
      await assertDismissed(page, preference)
      await openDrawer(page)
      await page.getByRole('link', { name: /^Education:/ }).focus()
      await page.keyboard.press('Enter')
      await page.waitForURL((url) => url.searchParams.get('view') === 'learn')
      assert.equal(new URL(page.url()).searchParams.get('workspace'), 'tenant-a')
      await assertCompact(page, preference)
      await page.reload()
      await assertCompact(page, preference)
      assert.equal(await page.locator('.fx-app').getAttribute('data-theme'), theme, 'Theme survives keyboard navigation and reload')
      scenario.themes.push({ theme, opened, dismissedBy: ['Escape', 'close button', 'backdrop', 'keyboard navigation'], focusLoop: true, reload: true })
      await page.goto(route('overview'))
    }
    await page.setViewportSize({ width: 760, height: 900 })
    await assertCompact(page, preference)
    await openDrawer(page)
    await page.setViewportSize({ width: 761, height: 900 })
    await page.getByRole('dialog').waitFor({ state: 'detached' })
    assert.equal((await measure(page)).railWidth, preference === 'false' ? 248 : 74, '761px restores the normal sidebar')
    await page.setViewportSize({ width: 760, height: 900 })
    await assertCompact(page, preference)
    await openDrawer(page)
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.getByRole('dialog').waitFor({ state: 'detached' })
    const desktop = await measure(page)
    assert.equal(desktop.railWidth, preference === 'false' ? 248 : 74, 'Desktop preference restores after an open mobile drawer')
    assert.equal(desktop.persisted, preference)
    scenario.restoredDesktop = desktop
    await page.setViewportSize({ width: 360, height: 900 })
    await page.goto(`${route('replay')}&surface=workspace`)
    await page.locator('.is-chart-workspace').waitFor()
    assert.equal(await page.locator('.fx-rail, .fx-menu-button').count(), 0, 'Full-bleed chart has no shell navigation rail')
    const chart = await measure(page)
    assert.equal(chart.contentWidth, 360)
    assert.ok(chart.documentOverflow <= 1)
    scenario.chart = chart
    report.scenarios.push(scenario)
    await context.close()
  }
  assert.deepEqual(report.blockedRequests, [], 'No external or mutating requests were attempted')
  assert.deepEqual(report.pageErrors, [], 'No uncaught browser errors')
  report.status = 'PASS'
} catch (error) {
  report.status = 'FAIL'
  report.error = error.stack
  throw error
} finally {
  await writeFile(path.join(out, 'report.json'), `${JSON.stringify(report, null, 2)}\n`)
  await browser.close()
  console.log(JSON.stringify({ status: report.status, scenarios: report.scenarios.length, evidence: out, error: report.error }))
}
