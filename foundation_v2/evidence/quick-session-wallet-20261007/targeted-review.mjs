import assert from 'node:assert/strict'
import { chromium } from '../../web/node_modules/playwright/index.mjs'
import { readFile, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'

const out = new URL('./', import.meta.url)
async function hashes() {
  const values = {}
  for (const f of ['QuickSessionDialog.jsx', 'quick-session.css']) values[f] = createHash('sha256').update(await readFile(new URL('../../web/src/' + f, out))).digest('hex')
  return values
}
const report = { scope: 'Targeted always-grouped modal; real local reads; isolated EUR response and POST422 fixtures', cases: [], errors: [], blocked: [], startHashes: await hashes() }
const browser = await chromium.launch({ headless: true })
try {
  for (const theme of ['dark', 'light']) for (const width of [360, 1710]) for (const unit of ['USD', 'EUR']) {
    const context = await browser.newContext({ viewport: { width, height: 987 } }), writes = []
    await context.addInitScript(t => { localStorage.setItem('tw-theme', t); localStorage.setItem('tw-language', 'vi') }, theme)
    await context.routeWebSocket('**/*', s => s.close())
    await context.route('**/*', async route => {
      const r = route.request(), u = new URL(r.url())
      if (r.method() === 'POST' && u.origin === 'http://127.0.0.1:5180' && u.pathname === '/api/v2/replay/sessions') {
        writes.push({ body: r.postDataJSON(), workspace: r.headers()['x-workspace-id'] })
        return route.fulfill({ status: 422, json: { detail: 'Independent stops before persistence' } })
      }
      if (!['GET', 'HEAD', 'OPTIONS'].includes(r.method()) || !['http://127.0.0.1:5180', 'http://127.0.0.1:8010'].includes(u.origin)) { report.blocked.push(r.url()); return route.abort() }
      if (unit === 'EUR' && u.pathname === '/api/v2/data/datasets') {
        const response = await route.fetch(), body = await response.json()
        body.items = body.items.map(i => ({ ...i, instrument_spec: { ...i.instrument_spec, account_ccy: 'EUR' } }))
        return route.fulfill({ response, json: body })
      }
      return route.continue()
    })
    const page = await context.newPage()
    page.on('pageerror', e => report.errors.push(String(e)))
    await page.goto('http://127.0.0.1:5180/?workspace=tenant-a&view=overview&area=testing&section=dashboard')
    await page.locator('.fx-dashboard-quick-action.is-primary').click()
    const d = page.locator('dialog.quick-session-dialog'), input = d.locator('.quick-session-balance input'), group = d.locator('.quick-session-balance'), submit = d.locator('.quick-session-submit'), plus = d.locator('.quick-session-new-strategy')
    await plus.waitFor()
    await page.waitForFunction(() => !document.querySelector('.quick-session-new-strategy')?.disabled)
    assert.equal(await input.inputValue(), '100,000')
    await input.focus(); assert.equal(await input.inputValue(), '100,000')
    await d.locator('h2').click(); assert.equal(await input.inputValue(), '100,000')
    const styles = e => { const s = getComputedStyle(e); return { color: s.color, background: s.backgroundColor } }
    await d.locator('h2').hover(); const base = await plus.evaluate(styles)
    await plus.hover(); await page.waitForTimeout(180); const hover = await plus.evaluate(styles)
    assert.deepEqual(base, hover); assert.equal(base.background, 'rgba(0, 0, 0, 0)')
    await d.locator('.quick-session-fields > label').first().locator('input').fill('Independent grouped wallet')
    await d.getByRole('button', { name: 'Chọn tài sản', exact: true }).click()
    await d.locator('.fx-select-menu input[type=search]').fill('EURUSDm')
    await d.getByRole('option', { name: /^EURUSDm/ }).last().click()
    const edits = []
    async function edit(initial, start, end, key, expected, pos) {
      await input.fill(initial); await input.evaluate((e, [a, b]) => e.setSelectionRange(a, b), [start, end])
      if (key.startsWith('text:')) await page.keyboard.insertText(key.slice(5)); else await page.keyboard.press(key)
      const got = await input.evaluate(e => ({ value: e.value, start: e.selectionStart, end: e.selectionEnd }))
      assert.deepEqual(got, { value: expected, start: pos, end: pos }); edits.push({ initial, start, end, key, ...got })
    }
    await edit('12345.67', 2, 2, 'text:9', '129,345.67', 3)
    await edit('12345.67', 9, 9, 'text:8', '12,345.67', 9)
    await edit('12345.6', 8, 8, 'text:7', '12,345.67', 9)
    await edit('12345.67', 3, 6, 'text:9', '129.67', 3)
    await edit('1234.56', 1, 4, 'text:9', '194.56', 2)
    await edit('1234', 2, 2, 'Backspace', '234', 0)
    await edit('1234', 1, 1, 'Delete', '134', 1)
    await edit('1234567', 6, 6, 'Backspace', '123,567', 3)
    await edit('1234.56', 5, 6, 'Delete', '123,456', 5)
    await input.fill(''); await input.pressSequentially('12345.67')
    assert.deepEqual(await input.evaluate(e => ({ value: e.value, caret: e.selectionStart })), { value: '12,345.67', caret: 9 })
    const invalid = []
    for (const v of ['', '0', '.', '0.']) { await input.fill(v); assert.equal(await submit.isDisabled(), true); invalid.push({ value: v, disabled: true }) }
    await input.fill('25000.75'); assert.equal(await submit.isDisabled(), false)
    for (const v of ['abc', '-10', '1e4', '1.234']) { await input.fill(v); assert.equal(await input.inputValue(), '25,000.75'); invalid.push({ value: v, rejected: true }) }
    assert.equal(writes.length, 0)
    await input.fill(''); await page.keyboard.insertText('25,000.75'); assert.equal(await input.inputValue(), '25,000.75')
    await page.keyboard.press('Tab'); assert.equal(await input.inputValue(), '25,000.75')
    await page.screenshot({ path: fileURLToPath(new URL(`wallet-rest-${theme}-${width}-${unit}.png`, out)) })
    const box = await group.boundingBox()
    await group.click({ position: { x: box.width - 8, y: box.height / 2 } })
    assert.equal(await input.evaluate(e => e === document.activeElement), true); assert.equal(await input.inputValue(), '25,000.75')
    const state = await input.evaluate(e => {
      const g = e.parentElement, u = g.lastElementChild, icon = g.firstElementChild, s = getComputedStyle(e), p = getComputedStyle(g), z = getComputedStyle(u), r = e.getBoundingClientRect(), v = u.getBoundingClientRect(), b = g.getBoundingClientRect(), a = icon.getBoundingClientRect(), after = getComputedStyle(icon, '::after'), svg = icon.querySelector('svg')
      return { value: e.value, unit: u.textContent, described: e.getAttribute('aria-describedby'), unitId: u.id, iconText: icon.textContent, iconHidden: icon.getAttribute('aria-hidden'), walletWidth: getComputedStyle(svg).width, walletHeight: getComputedStyle(svg).height, numberSize: s.fontSize, numberWeight: s.fontWeight, unitSize: z.fontSize, unitColor: z.color, muted: p.getPropertyValue('--wm-content-muted').trim(), inputBorder: s.borderWidth, outline: s.outlineStyle, shadow: s.boxShadow, groupBorder: p.borderColor, content: getComputedStyle(e.closest('dialog')).color, inputRight: r.right, unitLeft: v.x, unitRight: v.right, groupRight: b.right, iconGap: r.x - a.right, divider: { width: after.width, top: after.top, bottom: after.bottom, height: after.height, iconHeight: a.height, background: after.backgroundColor } }
    })
    assert.equal(state.unit, unit); assert.equal(state.described, state.unitId); assert.equal(state.iconText, ''); assert.equal(state.iconHidden, 'true')
    assert.equal(state.walletWidth, '18px'); assert.equal(state.walletHeight, '18px'); assert.equal(state.numberSize, '14px'); assert.equal(state.numberWeight, '500'); assert.equal(state.unitSize, '12px')
    assert.equal(state.inputBorder, '0px'); assert.equal(state.outline, 'none'); assert.equal(state.shadow, 'none'); assert.equal(state.groupBorder, state.content)
    assert.equal(state.divider.width, '1px'); assert.equal(state.divider.top, '0px'); assert.equal(state.divider.bottom, '0px'); assert.equal(parseFloat(state.divider.height), state.divider.iconHeight)
    assert.equal(state.iconGap, 12); assert(Math.abs(state.inputRight - state.unitLeft) < 1); assert(state.unitRight < state.groupRight)
    await page.screenshot({ path: fileURLToPath(new URL(`wallet-edit-${theme}-${width}-${unit}.png`, out)) })
    await d.locator('h2').click(); assert.equal(await input.inputValue(), '25,000.75')
    await submit.click(); await d.locator('.quick-session-error').waitFor()
    assert.equal(writes.length, 1); assert.equal(writes[0].body.starting_balance, '25000.75'); assert.equal(writes[0].workspace, 'tenant-a')
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth), 0)
    report.cases.push({ theme, width, unit, catalog: unit === 'EUR' ? 'isolated EUR response' : 'actual USD catalog', base, hover, state, edits, invalid, groupedInsertion: true, blankClick: true, focusBlurStable: true, writes, pass: true })
    await context.close()
  }
  assert.deepEqual(report.errors, []); assert.deepEqual(report.blocked, []); assert.deepEqual(await hashes(), report.startHashes); report.pass = true
} catch (e) { report.failure = String(e); throw e }
finally {
  report.hashes = await hashes(); await writeFile(new URL('targeted-computed-states.json', out), JSON.stringify(report, null, 2)); await browser.close()
  console.log(JSON.stringify({ pass: report.pass, cases: report.cases.length, failure: report.failure, hashes: report.hashes, errors: report.errors, blocked: report.blocked }, null, 2))
}
