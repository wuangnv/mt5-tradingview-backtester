import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import { chromium } from 'playwright'
import { DEMO_DATASETS } from '../src/demoFixtures.js'

const origin = 'http://127.0.0.1:5180'
const out = process.env.TW_ALIGNMENT_EVIDENCE || '../evidence/component-alignment-20261009/controls'
const diagnostic = process.env.TW_ALIGNMENT_DIAGNOSTIC === '1'
const browser = await chromium.launch()
const results = [], errors = [], writes = []
await fs.mkdir(out, { recursive: true })
const closeEnough = (value, expected = 0) => assert.ok(Math.abs(value - expected) < 1, `${value} should equal ${expected}`)
async function choiceGeometry(root) {
  return root.locator('label:has(> input[type=checkbox]),label:has(> input[type=radio])').evaluateAll(labels => labels.filter(e => e.getClientRects().length).map(e => {
    const mark = e.querySelector('input'), b = mark.getBoundingClientRect()
    const caption = [...e.childNodes].find(n => n !== mark && n.textContent.trim())
    const range = document.createRange(); range.selectNodeContents(caption)
    const text = range.getBoundingClientRect(), row = e.getBoundingClientRect()
    return { label: e.textContent.trim(), gap: text.x - b.right, centerY: b.y + b.height / 2 - row.y - row.height / 2, margin: getComputedStyle(mark).margin, width: b.width }
  }))
}
try {
  for (const theme of ['dark', 'light']) for (const width of [1710, 360]) {
    const context = await browser.newContext({ viewport: { width, height: 987 }, hasTouch: width === 360 })
    await context.addInitScript(theme => { localStorage.setItem('tw-theme', theme); localStorage.setItem('tw-language', 'vi') }, theme)
    await context.route('**/*', route => {
      const r = route.request(), url = new URL(r.url())
      if (url.origin !== origin) return route.abort()
      if (!['GET', 'HEAD', 'OPTIONS'].includes(r.method())) { writes.push(r.url()); return route.abort() }
      if (url.pathname === '/api/v2/data/datasets') return route.fulfill({ json: { items: DEMO_DATASETS } })
      return route.continue()
    })
    const page = await context.newPage(); page.setDefaultTimeout(10000)
    page.on('pageerror', error => errors.push(error.message))
    const go = async query => { await page.goto(`${origin}/?workspace=tenant-a&area=testing&${query}`); await page.waitForLoadState('networkidle') }
    await go('view=trade&sessions=all&select=1&demo=1')
    const table = page.getByTestId('fx-trade-ledger').locator('table')
    const cells = await table.evaluate(table => {
      const center = e => { const b = e.getBoundingClientRect(); return b.x + b.width / 2 }
      return [0, 1].map(index => {
        const header = table.tHead.rows[0].cells[index], body = table.tBodies[0].rows[0].cells[index]
        const control = body.querySelector('input,button')
        return { index, centerDelta: center(control) - center(header), headerCenter: center(header), bodyCenter: center(control), margin: getComputedStyle(control).margin }
      })
    })
    if (!diagnostic) cells.forEach(cell => closeEnough(cell.centerDelta))
    results.push({ case: 'ledger selection/action axes', theme, width, cells })
    const columnAlignment = () => table.locator('tr').evaluateAll(rows => rows.map(row => [...row.cells].map(cell => ({ text: cell.textContent.trim(), numeric: cell.classList.contains('is-numeric'), align: getComputedStyle(cell).textAlign }))))
    if (!diagnostic) {
      const alignment = await columnAlignment()
      assert.equal(alignment[0].filter(cell => cell.numeric).length, 11)
      alignment.forEach(row => row.filter(cell => cell.numeric).forEach(cell => assert.equal(cell.align, 'right')))
      await page.locator('.fxa-columns-control .fx-select-trigger').click()
      await page.locator('.fx-select-menu [role=option]').first().click()
      await page.keyboard.press('Escape')
      const changed = await columnAlignment()
      assert.equal(changed[0].length, alignment[0].length - 1)
      changed.forEach(row => row.filter(cell => cell.numeric).forEach(cell => assert.equal(cell.align, 'right')))
      assert.equal(changed[0].filter(cell => cell.numeric).length, 11)
      results.push({ case: 'numeric alignment survives column selection', theme, width })
    }
    await table.screenshot({ path: `${out}/table-${theme}-${width}.png` })
    await page.locator('.fxa-filter-actions > button[aria-haspopup=dialog]').first().click()
    const drawer = page.locator('.fxl-filter-drawer'); await drawer.waitFor()
    await drawer.locator('details').evaluateAll(elements => elements.forEach(e => { e.open = true }))
    const choices = await choiceGeometry(drawer)
    if (!diagnostic) choices.forEach(choice => { closeEnough(choice.gap, 8); closeEnough(choice.centerY); assert.equal(choice.margin, '0px') })
    results.push({ case: 'drawer checkbox captions', theme, width, choices })
    await drawer.screenshot({ path: `${out}/drawer-${theme}-${width}.png` })
    await page.keyboard.press('Escape')
    await go('ui_reference=1')
    const referenceAxis = await page.locator('.wm-reference-row-sample').evaluate(table => {
      const center = e => { const b = e.getBoundingClientRect(); return b.x + b.width / 2 }
      return [...table.tBodies[0].rows].map(row => center(row.cells[2].querySelector('button')) - center(table.tHead.rows[0].cells[2]))
    })
    if (!diagnostic) referenceAxis.forEach(value => closeEnough(value))
    results.push({ case: 'reference table action axis', theme, width, referenceAxis })
    await go('view=analytics&select=1&demo=1&analytics_tab=simulation')
    const scenarios = page.locator('.fxa-scenario-details')
    assert.equal(await scenarios.count(), 2)
    await scenarios.evaluateAll(elements => elements.forEach(e => { e.open = true }))
    const numeric = await scenarios.locator('th:nth-child(n+3),td:nth-child(n+3)').evaluateAll(elements => elements.map(e => getComputedStyle(e).textAlign))
    if (!diagnostic) { assert.ok(numeric.length); numeric.forEach(value => assert.equal(value, 'right')) }
    results.push({ case: 'scenario numeric header/body edges', theme, width, cells: numeric.length })
    await go('view=replay&select=1&demo=1')
    await page.locator('.fxs-settings').click()
    const settings = page.locator('.fxs-settings-drawer'); await settings.waitFor()
    const fields = await settings.locator('label').evaluateAll(elements => elements.filter(e => e.querySelector('input,textarea')).map(e => {
      const control = e.querySelector('input,textarea'), label = e.getBoundingClientRect(), b = control.getBoundingClientRect()
      return { label: e.childNodes[0].textContent.trim(), startDelta: b.x - label.x, endDelta: label.right - b.right }
    }))
    if (!diagnostic) fields.forEach(field => { closeEnough(field.startDelta); closeEnough(field.endDelta) })
    results.push({ case: 'session drawer label/field edges', theme, width, fields })
    await settings.screenshot({ path: `${out}/settings-${theme}-${width}.png` }); await page.keyboard.press('Escape')
    await go('view=overview')
    await page.locator('.fx-dashboard-quick-action.is-primary').click()
    const quick = page.locator('.quick-session-dialog'); await quick.waitFor()
    const metrics = await quick.locator('.quick-session-balance').evaluate(e => {
      const input = e.querySelector('input'), suffix = e.querySelector('span'), b = input.getBoundingClientRect(), s = suffix.getBoundingClientRect()
      return { centerDelta: s.y + s.height / 2 - b.y - b.height / 2 }
    })
    if (!diagnostic) closeEnough(metrics.centerDelta)
    results.push({ case: 'balance input/currency axis', theme, width, metrics })
    await quick.screenshot({ path: `${out}/quick-${theme}-${width}.png` }); await page.keyboard.press('Escape')
    await go('view=risk')
    const riskChoice = await choiceGeometry(page.locator('.risk-workspace'))
    if (!diagnostic) { assert.ok(riskChoice.length); riskChoice.forEach(choice => { closeEnough(choice.gap, 8); closeEnough(choice.centerY) }) }
    results.push({ case: 'Risk checkbox caption', theme, width, choices: riskChoice })
    await go('view=market-data&demo=1')
    const toolbar = await page.locator('.data-library-toolbar').evaluate(e => {
      const field = e.querySelector('input'), selects = [...e.querySelectorAll('.fx-select-trigger')]
      const b = field.getBoundingClientRect()
      return selects.map(select => { const s = select.getBoundingClientRect(); return { label: select.getAttribute('aria-label'), heightDelta: b.height - s.height, centerDelta: b.y + b.height / 2 - s.y - s.height / 2 } })
    })
    if (!diagnostic) toolbar.forEach(control => { closeEnough(control.heightDelta); if (width > 760) closeEnough(control.centerDelta) })
    results.push({ case: 'Market search/filter height and axis', theme, width, toolbar })
    await context.close()
  }
  assert.deepEqual(errors, []); assert.deepEqual(writes, [])
  await fs.writeFile(`${out}/report.json`, JSON.stringify({ diagnostic, results, errors, writes }, null, 2))
  console.log(`${results.length} component alignment journeys ${diagnostic ? 'recorded for diagnosis' : 'PASS'}`)
} catch (error) {
  await fs.writeFile(`${out}/failure.json`, JSON.stringify({ error: error.stack, results, errors, writes }, null, 2)); throw error
} finally { await browser.close() }
