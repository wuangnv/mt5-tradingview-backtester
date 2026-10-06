import assert from 'node:assert/strict'
import { chromium } from 'playwright'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'

const out = path.resolve(process.env.TW_UI_EVIDENCE_DIR || '../evidence/fx-select-polish-20261006/primary')
await mkdir(out, { recursive: true })
const browser = await chromium.launch({ ignoreDefaultArgs: ['--hide-scrollbars'] })
const page = await browser.newPage()
const errors = [], writes = [], checks = []
page.on('pageerror', error => errors.push(error.message))
await page.route('**/api/**', route => {
  if (!['GET', 'HEAD', 'OPTIONS'].includes(route.request().method())) { writes.push(route.request().method()); return route.abort() }
  return route.continue()
})
const go = async (view, theme) => {
  await page.goto(`http://127.0.0.1:5180/?workspace=tenant-a&view=${view}&demo=1&area=testing&section=${view === 'overview' ? 'dashboard' : 'analytics'}`)
  if (await page.getByTestId('fxreplay-shell').getAttribute('data-theme') !== theme) await page.getByTestId('theme-toggle').click()
}
try {
  for (const width of [1710, 360]) for (const theme of ['dark', 'light']) {
    await page.setViewportSize({ width, height: 987 })
    await go('analytics', theme)
    await page.getByRole('button', { name: 'Type', exact: true }).click()
    const menu = page.getByRole('dialog', { name: 'Type', exact: true })
    const all = menu.getByRole('checkbox', { name: 'All', exact: true })
    const app = menu.getByRole('option', { name: 'App', exact: true })
    const appearance = element => {
      const box = element.querySelector('.fx-select-checkbox'), css = getComputedStyle(box), r = box.getBoundingClientRect()
      return { w: r.width, h: r.height, radius: css.borderRadius, background: css.backgroundColor, color: css.color, text: box.textContent }
    }
    assert.deepEqual(await all.evaluate(appearance), await app.evaluate(appearance))
    assert.equal(await all.getAttribute('aria-checked'), 'true')
    await app.click()
    assert.equal(await all.getAttribute('aria-checked'), 'mixed')
    await all.focus(); await page.keyboard.press('Space')
    assert.equal(await all.getAttribute('aria-checked'), 'true')
    const r = await all.boundingBox()
    await all.click({ position: { x: r.width - 10, y: r.height / 2 } })
    assert.equal(await all.getAttribute('aria-checked'), 'false')
    assert.equal(await app.getAttribute('aria-selected'), 'false')
    await all.click(); await app.hover()
    await menu.screenshot({ path: path.join(out, `type-${theme}-${width}.png`), animations: 'disabled' })
    checks.push(`Type checkbox appearance/full-row/keyboard/mixed: ${theme}/${width}`)

    await go('overview', theme)
    await page.getByRole('button', { name: 'Sắp xếp phiên', exact: true }).click()
    const option = page.getByRole('option', { name: 'Oldest to newest', exact: true })
    await option.hover()
    const geometry = await option.evaluate(e => {
      const list = e.parentElement, r = e.getBoundingClientRect(), p = list.getBoundingClientRect(), css = getComputedStyle(e)
      return { left: r.left - p.left, right: p.right - r.right, radius: css.borderRadius, gutter: list.offsetWidth - list.clientWidth, scroll: list.scrollWidth - list.clientWidth, background: css.backgroundColor }
    })
    assert.ok(Math.abs(geometry.left - geometry.right) < 1, JSON.stringify(geometry))
    assert.ok(geometry.left >= 2 && geometry.right >= 2)
    assert.equal(geometry.radius, '6px'); assert.equal(geometry.gutter, 0); assert.equal(geometry.scroll, 0)
    await page.locator('.fx-select-menu').screenshot({ path: path.join(out, `hover-${theme}-${width}.png`), animations: 'disabled' })
    await option.click(); await page.getByRole('button', { name: 'Sắp xếp phiên', exact: true }).click()
    assert.equal(await option.getAttribute('aria-selected'), 'true')
    await page.keyboard.press('Escape')
    checks.push(`Sort rounded hover/symmetric inset/select: ${theme}/${width}`)
  }
  assert.deepEqual(errors, []); assert.deepEqual(writes, [])
  await writeFile(path.join(out, 'report.json'), JSON.stringify({ checks, errors, writes }, null, 2))
  console.log(JSON.stringify({ passed: checks.length, errors, writes }))
} finally { await browser.close() }
