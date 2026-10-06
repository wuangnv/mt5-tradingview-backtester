import assert from 'node:assert/strict'
import { chromium } from 'playwright'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'

const out = path.resolve(process.env.TW_UI_EVIDENCE_DIR || '../evidence/fx-session-actions-20261006')
await mkdir(out, { recursive: true })
const browser = await chromium.launch({ headless: true })
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
const home = 'http://127.0.0.1:5180/?workspace=tenant-a&view=overview&area=testing&section=dashboard'
const sessions = 'http://127.0.0.1:5180/?workspace=tenant-a&view=replay&area=testing&section=sessions&select=1'
const errors = [], writes = [], checks = []
page.on('pageerror', error => errors.push(error.message))
await page.route('**/api/**', route => {
  if (!['GET', 'HEAD', 'OPTIONS'].includes(route.request().method())) { writes.push(route.request().method()); return route.abort() }
  return route.continue()
})
const open = async (name, action) => {
  await page.getByRole('button', { name: action.replace(' phiên', '') + ' ' + name, exact: true }).click()
}
const dialog = name => page.getByRole('dialog', { name, exact: true })
try {
  for (const [width, theme] of [[1440, 'dark'], [768, 'dark'], [360, 'dark'], [360, 'light'], [1440, 'light']]) {
    await page.setViewportSize({ width, height: 900 })
    await page.goto(home + '&demo=1'); await page.waitForLoadState('networkidle')
    if (await page.getByTestId('fxreplay-shell').getAttribute('data-theme') !== theme) await page.getByTestId('theme-toggle').click()
    assert.equal(await page.getByTestId('fxreplay-shell').getAttribute('data-theme'), theme)
    const actions = page.locator('[data-session-id="demo-gold"] .fxs-actions')
    assert.equal(await actions.getByRole('button').count(), 2)
    for (const action of await actions.getByRole('button').all()) {
      const bounds = await action.boundingBox()
      assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= width, 'direct action fits viewport')
      assert.ok(Math.abs(bounds.width - bounds.height) < 1, 'direct action is circular')
    }
    assert.equal(await page.locator('.fxs-actions-trigger').count(), 0)
    await page.screenshot({ path: path.join(out, `actions-${theme}-${width}.png`), fullPage: true })
    await actions.getByRole('button', { name: 'Xóa Gold Swing', exact: true }).focus()
    await page.keyboard.press('Enter')
    const confirm = dialog('Xóa phiên')
    await confirm.waitFor()
    assert.ok(await confirm.getByRole('button', { name: 'Xóa phiên', exact: true }).isDisabled())
    await confirm.getByLabel('Tên phiên xác nhận xóa').fill('Gold')
    assert.ok(await confirm.getByRole('button', { name: 'Xóa phiên', exact: true }).isDisabled())
    await page.screenshot({ path: path.join(out, `delete-${theme}-${width}.png`), fullPage: true })
    await page.keyboard.press('Escape')
    await page.getByRole('heading', { name: /Gold Swing/ }).waitFor()
  }
  checks.push('Dark/light direct actions and confirm at desktop/tablet/mobile; keyboard, exact name gating, Escape cancellation')
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto(home + '&demo=1'); await page.waitForLoadState('networkidle')
  await open('Gold Swing', 'Lưu trữ phiên')
  await dialog('Lưu trữ phiên').getByRole('button', { name: 'Lưu trữ', exact: true }).click()
  assert.equal(await page.locator('[data-session-id="demo-gold"]').count(), 0)
  await page.getByRole('button', { name: 'Hiện bộ lọc phiên', exact: true }).click()
  await page.getByRole('button', { name: 'Trạng thái phiên', exact: true }).click()
  await page.getByRole('option', { name: 'Đã lưu trữ', exact: true }).click()
  await open('Gold Swing', 'Khôi phục phiên')
  await dialog('Khôi phục phiên').getByRole('button', { name: 'Khôi phục', exact: true }).click()
  await page.getByRole('button', { name: 'Trạng thái phiên', exact: true }).click()
  await page.getByRole('option', { name: 'Tất cả', exact: true }).click()
  await open('Gold Swing', 'Xóa phiên')
  await dialog('Xóa phiên').getByLabel('Tên phiên xác nhận xóa').fill('Gold Swing')
  await dialog('Xóa phiên').getByRole('button', { name: 'Xóa phiên', exact: true }).click()
  assert.equal(await page.locator('[data-session-id="demo-gold"]').count(), 0)
  checks.push('Dashboard demo archive/restore/delete operate on local state')
  await page.goto(sessions + '&demo=1&demo_session=demo-gold'); await page.waitForLoadState('networkidle')
  await open('Gold Swing', 'Lưu trữ phiên')
  await dialog('Lưu trữ phiên').getByRole('button', { name: 'Lưu trữ', exact: true }).click()
  await open('Gold Swing', 'Khôi phục phiên')
  await dialog('Khôi phục phiên').getByRole('button', { name: 'Khôi phục', exact: true }).click()
  for (let count = 0; count < 6; count++) {
    const trigger = page.locator('.fxr-session-actions .fxs-actions')
    if (!await trigger.count()) break
    const name = (await trigger.getAttribute('aria-label')).slice('Thao tác '.length)
    await open(name, 'Xóa phiên')
    await dialog('Xóa phiên').getByLabel('Tên phiên xác nhận xóa').fill(name)
    await dialog('Xóa phiên').getByRole('button', { name: 'Xóa phiên', exact: true }).click()
  }
  await page.getByRole('heading', { name: 'Chưa có phiên trong bản xem thử' }).waitFor()
  assert.equal(new URL(page.url()).searchParams.has('demo_session'), false)
  checks.push('Sessions demo deletion selects a remaining session, handles final empty state, clears demo URL')
  await page.goto(home); await page.waitForLoadState('networkidle')
  const actualCard = page.locator('[data-session-id]').first()
  const name = (await actualCard.locator('.fxs-actions').getAttribute('aria-label')).slice('Thao tác '.length)
  await open(name, 'Xóa phiên')
  await dialog('Xóa phiên').getByRole('button', { name: 'Hủy', exact: true }).click()
  await page.goto(sessions); await page.waitForLoadState('networkidle')
  const selectedName = (await page.locator('.fxr-session-actions .fxs-actions').getAttribute('aria-label')).slice('Thao tác '.length)
  await open(selectedName, 'Xóa phiên')
  await page.keyboard.press('Escape')
  assert.equal(writes.length, 0)
  checks.push('Actual Dashboard/Sessions read-only direct action/cancel journey made no writes')
  assert.deepEqual(errors, [])
  await writeFile(path.join(out, 'browser.json'), JSON.stringify({ checks, errors, writes }, null, 2))
  console.log(JSON.stringify({ passed: checks.length, errors, writes }))
} finally { await browser.close() }
