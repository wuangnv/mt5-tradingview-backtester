import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { chromium } from 'playwright'

const origin = process.env.TESTING_UI_ORIGIN || 'http://127.0.0.1:5180'
const output = process.env.TW_UI_EVIDENCE_DIR || '../evidence/dashboard-interactions-20261009'
assert.equal(new URL(origin).hostname, '127.0.0.1')
await mkdir(output, { recursive: true })
const browser = await chromium.launch({ headless: true })
const report = { scope: 'Actual local GET APIs; session card and library interactions; writes blocked', cases: [], errors: [], writes: [] }
try {
  for (const width of [1710, 1440, 390]) for (const theme of ['dark', 'light']) {
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
    const listing = page.waitForResponse(response => new URL(response.url()).pathname === '/api/v2/dashboard/sessions' && response.status() === 200)
    await page.goto(`${origin}/?workspace=tenant-a&view=overview&area=testing&section=dashboard`)
    const oracle = (await (await listing).json()).items.find(item => item.detail.metadata.portfolio_account?.balance != null || item.detail.metadata.payload.starting_balance != null)
    assert.ok(oracle, 'Actual catalog includes an account balance')
    const card = page.locator(`.fx-dashboard-session-card[data-session-id="${oracle.record_id}"]`)
    await card.waitFor()
    const metadata = oracle.detail.metadata
    const value = metadata.portfolio_account?.balance ?? metadata.payload.execution?.balance ?? metadata.payload.starting_balance
    const currency = metadata.payload.starting_balance_ccy || oracle.detail.currency
    assert.equal(await card.locator('.fx-dashboard-card-facts > span').nth(1).textContent(), `${new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 2 }).format(Number(value))} ${currency}`)
    const head = card.locator('.fx-dashboard-session-card-head'), toggle = card.locator('.fx-dashboard-card-expand')
    const panel = card.locator('.fx-dashboard-card-disclosure')
    const settle = () => panel.evaluate(async node => { await Promise.all(node.getAnimations().map(animation => animation.finished.catch(() => {}))) })
    await page.mouse.move(0, 0)
    const idle = await head.evaluate(node => getComputedStyle(node).backgroundColor)
    await head.hover(); await head.evaluate(async node => { await Promise.all(node.getAnimations().map(animation => animation.finished.catch(() => {}))) })
    assert.notEqual(await head.evaluate(node => getComputedStyle(node).backgroundColor), idle)
    await toggle.click(); await settle()
    assert.equal(await toggle.getAttribute('aria-expanded'), 'true')
    const opened = await panel.evaluate(node => node.getBoundingClientRect().height)
    assert.ok(opened > 0)
    await card.screenshot({ path: `${output}/${theme}-${width}-expanded.png` })
    await toggle.click()
    const animation = await panel.evaluate(async node => {
      const heights = []
      for (let frame = 0; frame < 4; frame++) {
        await new Promise(requestAnimationFrame)
        heights.push(node.getBoundingClientRect().height)
      }
      return { duration: getComputedStyle(node).transitionDuration, heights }
    })
    assert.notEqual(animation.duration, '0s')
    assert.ok(animation.heights.some(height => height > 0 && height < opened), 'Collapse interpolates rather than removing content instantly')
    await settle()
    assert.equal(await panel.evaluate(node => node.getBoundingClientRect().height), 0)
    assert.equal(await panel.evaluate(node => node.inert), true)
    // Reversing an unfinished transition must obey the latest click.
    await toggle.evaluate(node => { node.click(); requestAnimationFrame(() => node.click()) })
    await page.waitForFunction(id => document.getElementById(id)?.getAttribute('aria-hidden') === 'true', await panel.getAttribute('id'))
    await settle()
    assert.equal(await toggle.getAttribute('aria-expanded'), 'false')
    assert.equal(await panel.evaluate(node => node.getBoundingClientRect().height), 0)
    await toggle.focus(); await page.keyboard.press('Enter'); await settle()
    assert.equal(await toggle.getAttribute('aria-expanded'), 'true')
    await card.locator('.fx-dashboard-card-info').click(); await settle()
    assert.equal(await toggle.getAttribute('aria-expanded'), 'false')
    await card.locator('.fx-dashboard-card-actions button').filter({ has: page.locator('svg') }).nth(1).click()
    await page.getByRole('button', { name: 'Đóng cài đặt phiên' }).click()
    assert.equal(await toggle.getAttribute('aria-expanded'), 'false', 'Action buttons do not toggle the card')
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await toggle.click(); await settle()
    assert.ok(await panel.evaluate(node => getComputedStyle(node).transitionDuration.split(',').every(duration => Number.parseFloat(duration) <= .001)))
    assert.equal(await toggle.getAttribute('aria-expanded'), 'true')
    await toggle.click(); await settle()
    assert.equal(await panel.evaluate(node => node.getBoundingClientRect().height), 0)
    await context.close()

    const libraryContext = await browser.newContext({ viewport: { width, height: 987 } })
    await libraryContext.addInitScript(theme => { localStorage.setItem('tw-theme', theme); localStorage.setItem('tw-language', 'vi') }, theme)
    await libraryContext.route('**/*', route => {
      const request = route.request()
      if (new URL(request.url()).origin !== origin) return route.abort()
      if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method())) { report.writes.push(request.url()); return route.abort() }
      return route.continue()
    })
    const library = await libraryContext.newPage()
    library.on('pageerror', error => report.errors.push(error.message))
    await library.goto(`${origin}/?workspace=tenant-a&view=market-data&area=testing&section=market-data`)
    const rows = library.getByTestId('data-desk-dataset-table').locator('tbody tr')
    await rows.first().waitFor()
    await library.mouse.move(0, 0)
    assert.equal(await library.locator('.data-library tr.is-selected').count(), 0)
    const first = rows.first()
    const rowStyle = () => first.evaluate(node => ({ row: getComputedStyle(node).backgroundColor, cell: getComputedStyle(node.cells[0]).backgroundColor }))
    const neutral = await rowStyle()
    await first.hover()
    await first.evaluate(async node => { await Promise.all(node.getAnimations().map(animation => animation.finished.catch(() => {}))) })
    assert.notDeepEqual(await rowStyle(), neutral)
    await first.locator('[data-testid^="dataset-row-"]').click()
    await library.getByRole('dialog', { name: 'Chi tiết dữ liệu và chất lượng' }).waitFor()
    assert.equal(await library.locator('.data-library tr.is-selected').count(), 1)
    await library.getByRole('dialog').getByRole('button', { name: 'Đóng', exact: true }).click()
    await library.mouse.move(0, 0)
    await first.evaluate(async node => { await Promise.all(node.getAnimations({ subtree: true }).map(animation => animation.finished.catch(() => {}))) })
    assert.equal(await library.locator('.data-library tr.is-selected').count(), 0)
    assert.deepEqual(await rowStyle(), neutral, 'Closing details and leaving the row restores its neutral appearance')
    await library.screenshot({ path: `${output}/${theme}-${width}-library.png` })
    report.cases.push({ width, theme, balance: value, currency, expandedHeight: opened, transition: animation.duration,
      collapseHeights: animation.heights, reducedMotion: true, noImplicitSelection: true })
    await libraryContext.close()
  }
  assert.deepEqual(report.errors, [])
  assert.deepEqual(report.writes, [])
  report.result = 'PASS'
} finally {
  await writeFile(`${output}/browser.json`, JSON.stringify(report, null, 2))
  await browser.close()
}
console.log(JSON.stringify({ result: report.result, cases: report.cases.length, errors: report.errors, writes: report.writes }))
