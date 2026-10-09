import { chromium } from 'playwright'
import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
const origin = process.env.TESTING_UI_ORIGIN || 'http://127.0.0.1:5180'
const out = process.env.TW_UI_EVIDENCE_DIR || '../evidence/session-period-20261009'
await mkdir(out, { recursive: true })
const browser = await chromium.launch({ headless: true })
const report = { scope: 'Actual local GET APIs; dialog interactions only; all writes blocked', cases: [], errors: [], writes: [] }
try {
  for (const width of [1710, 1440, 360]) for (const theme of ['dark', 'light']) {
    const context = await browser.newContext({ viewport: { width, height: 987 } })
    await context.addInitScript(theme => { localStorage.setItem('tw-theme', theme); localStorage.setItem('tw-language', 'vi') }, theme)
    await context.route('**/*', route => {
      const request = route.request()
      if (new URL(request.url()).origin !== origin) return route.abort()
      if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method())) { report.writes.push(request.url()); return route.abort() }
      return route.continue()
    })
    const page = await context.newPage()
    page.on('pageerror', error => report.errors.push(error.message))
    await page.goto(origin + '/?workspace=tenant-a&view=overview&area=testing&section=dashboard')
    await page.locator('.fx-dashboard-quick-action.is-primary').click()
    const dialog = page.locator('.quick-session-dialog'), period = dialog.locator('.quick-session-period')
    await dialog.locator('input[maxlength="160"]').first().fill('Read-only period QA')
    assert.equal(await period.count(), 0)
    await dialog.locator('.dataset-asset-select .fx-select-trigger').click()
    const options = dialog.locator('.dataset-asset-select [role="option"]:not(:disabled)')
    await options.first().waitFor()
    assert.equal(await dialog.locator('.dataset-asset-select .fx-select-group-title').count(), 0)
    await options.first().click()
    await options.nth(1).click()
    await page.keyboard.press('Escape')
    await period.waitFor()
    const start = period.getByRole('textbox', { name: 'Ngày bắt đầu phiên (UTC)' })
    const end = period.getByRole('textbox', { name: 'Ngày kết thúc phiên (UTC)' })
    const endValue = async value => {
      await page.waitForFunction(({ id, value }) => document.getElementById(id)?.value === value, { id: await end.getAttribute('id'), value })
      assert.equal(await end.inputValue(), value)
    }
    const submit = dialog.locator('.quick-session-submit')
    assert.equal(await submit.isDisabled(), true)
    await start.fill('31/01/2025 08:22')
    await period.getByRole('button', { name: 'Tự động', exact: true }).focus()
    assert.equal(await submit.isEnabled(), true)
    assert.equal(await end.inputValue(), 'Tự động')
    assert.equal(await end.isDisabled(), true)
    await period.scrollIntoViewIfNeeded()
    await dialog.screenshot({ path: `${out}/${theme}-${width}-auto.png` })
    await period.getByRole('button', { name: 'Tùy chọn', exact: true }).click()
    await period.getByRole('button', { name: 'Kết thúc sau 1 tháng' }).click()
    await endValue('28/02/2025 08:22')
    await period.getByRole('button', { name: 'Kết thúc sau 1 tuần' }).click()
    await endValue('07/02/2025 08:22')
    await period.getByRole('button', { name: 'Kết thúc sau 1 ngày' }).click()
    await endValue('01/02/2025 08:22')
    await end.fill('30/01/2025 08:22')
    assert.equal(await submit.isDisabled(), true)
    await period.getByRole('button', { name: 'Kết thúc sau 1 tháng' }).click()
    assert.equal(await submit.isEnabled(), true)
    const layout = await period.evaluate(element => {
      const fields = [...element.querySelectorAll('.project-date-input > input[type=text]')].map(input => {
        const rect = input.getBoundingClientRect()
        return { x: rect.x, y: rect.y, height: rect.height, right: rect.right }
      })
      return { fields, width: element.clientWidth, scrollWidth: element.scrollWidth, dialogWidth: element.closest('dialog').clientWidth, dialogScrollWidth: element.closest('dialog').scrollWidth }
    })
    assert.ok(layout.scrollWidth <= layout.width + 1)
    assert.ok(layout.dialogScrollWidth <= layout.dialogWidth + 1)
    assert.ok(Math.abs(layout.fields[0].height - layout.fields[1].height) < 1)
    if (width > 700) assert.ok(Math.abs(layout.fields[0].y - layout.fields[1].y) < 1, 'date fields share the same visual row')
    await period.scrollIntoViewIfNeeded()
    await dialog.screenshot({ path: `${out}/${theme}-${width}-custom.png` })
    await period.getByRole('button', { name: 'Chọn ngày bắt đầu ngẫu nhiên' }).click()
    assert.equal(await submit.isEnabled(), true)
    await period.getByRole('button', { name: 'Tự động', exact: true }).click()
    assert.equal(await submit.isEnabled(), true)
    assert.equal(await end.isDisabled(), true)
    report.cases.push({ width, theme, layout, randomStart: await start.inputValue() })
    await context.close()
  }
  assert.deepEqual(report.errors, [])
  assert.deepEqual(report.writes, [])
  report.result = 'PASS'
} finally {
  await writeFile(`${out}/browser.json`, JSON.stringify(report, null, 2))
  await browser.close()
}
console.log(JSON.stringify({ result: report.result, cases: report.cases.length, errors: report.errors }))
