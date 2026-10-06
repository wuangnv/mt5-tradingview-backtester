import assert from 'node:assert/strict'
import { chromium } from '../../../web/node_modules/playwright/index.mjs'
import { mkdir, writeFile } from 'node:fs/promises'

const out = 'foundation_v2/evidence/peach-actions-20261007/primary'
await mkdir(out, { recursive: true })
const browser = await chromium.launch({ headless: true, ignoreDefaultArgs: ['--hide-scrollbars'] })
const receipt = { cases: [], errors: [], blockedWrites: [], failure: null }
const origin = 'http://127.0.0.1:5180'
const color = async (locator, property) => locator.evaluate((element, property) => getComputedStyle(element).getPropertyValue(property).trim(), property)
const token = async (page, role) => color(page.locator('.fx-app'), role)
const rgb = hex => hex.match(/[a-f0-9]{2}/gi).map(value => parseInt(value, 16))
const luminance = values => values.map(value => value / 255).map(value => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4).reduce((sum, value, i) => sum + value * [.2126, .7152, .0722][i], 0)
const contrast = (a, b) => { const values = [luminance(rgb(a)), luminance(rgb(b))].sort((a,b) => b-a); return (values[0] + .05) / (values[1] + .05) }
try {
  for (const theme of ['dark', 'light']) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 987 }, reducedMotion: 'reduce' })
    await context.addInitScript(theme => { localStorage.setItem('tw-theme', theme); localStorage.setItem('tw-language', 'vi') }, theme)
    await context.routeWebSocket('**/*', socket => socket.close())
    await context.route('**/*', route => {
      const request = route.request()
      if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method())) { receipt.blockedWrites.push(request.url()); return route.abort() }
      if (new URL(request.url()).origin !== origin) return route.abort()
      return route.continue()
    })
    const page = await context.newPage()
    page.setDefaultTimeout(12000)
    page.on('pageerror', error => receipt.errors.push(String(error)))
    const go = async (view, query = '') => { await page.goto(`${origin}/?workspace=tenant-a&area=testing&view=${view}&select=1${query}`); await page.waitForLoadState('networkidle') }
    await go('overview')
    const item = page.locator('.fx-dashboard-session-card').first()
    await item.waitFor()
    const expander = item.locator('.fx-dashboard-card-expand')
    const resting = await color(item, 'background-color')
    await item.locator('h3').click()
    assert.equal(await expander.getAttribute('aria-expanded'), 'true')
    assert.notEqual(await color(item, 'background-color'), resting)
    assert.equal(await item.locator('.fxs-no-analytics').count(), 1)
    assert.equal(await item.locator('.fxs-chart-panel').count(), 0)
    await item.locator('.fx-dashboard-card-icon[title="Tạo bản sao"]').click()
    assert.equal(await expander.getAttribute('aria-expanded'), 'true')
    await page.getByRole('button', { name: 'Hủy', exact: true }).click()
    await expander.focus(); await page.keyboard.press('Space')
    assert.equal(await expander.getAttribute('aria-expanded'), 'false')
    await page.locator('.fx-dashboard-filter-toggle').click()
    const strategy = page.locator('.fx-dashboard-list-filters .fx-select').filter({ has: page.locator('button[aria-label="Chiến lược"]') })
    await strategy.locator('button.fx-select-trigger').click()
    const search = strategy.locator('input[type="search"]')
    assert.equal(await color(search, 'background-color'), 'rgba(0, 0, 0, 0)')
    assert.equal(await color(search, 'color'), await color(strategy.locator('.fx-select-menu'), 'color'))
    await page.keyboard.press('Escape')
    await page.screenshot({ path: `${out}/dashboard-${theme}.png`, fullPage: true })
    const facts = { theme, count: await page.locator('.fx-dashboard-session-count').innerText(), contrast: {} }
    for (const [name, fg, bg, minimum] of [
      ['action', '--project-on-action', '--project-action', 4.5],
      ['actionHover', '--project-on-action', '--project-action-hover', 4.5],
      ['delete', '--project-on-danger', '--project-danger-action', 4.5],
      ['deleteHover', '--project-on-danger', '--project-danger-hover', 4.5],
      ['remaining', '--project-on-peach-soft', '--project-peach-soft', 4.5],
      ...['blue','peach','positive','negative','violet','gold'].map(role => [role, `--report-${role}`, '--project-surface', 3])
    ]) { facts.contrast[name] = contrast(await token(page, fg), await token(page, bg)); assert.ok(facts.contrast[name] >= minimum, `${theme} ${name} contrast ${facts.contrast[name]}`) }
    await go('replay', '&session=476f4b498e1a49ed9d48a75719f4d270')
    const action = page.locator('.fxr-session-actions .fxr-button-primary').first()
    const deleteButton = page.locator('.fxr-session-actions .is-danger')
    facts.primary = await color(action, 'background-color')
    facts.delete = await color(deleteButton, 'background-color')
    assert.notEqual(facts.primary, facts.delete)
    assert.equal(await color(deleteButton, 'color'), 'rgb(255, 255, 255)')
    await action.hover(); facts.primaryHover = await color(action, 'background-color'); assert.notEqual(facts.primaryHover, facts.primary)
    await deleteButton.hover(); assert.equal(await color(deleteButton, 'color'), 'rgb(255, 255, 255)')
    await page.screenshot({ path: `${out}/sessions-${theme}.png`, fullPage: true })
    await go('analytics', '&demo=1')
    const nav = page.locator('.fx-subnav-link.is-active')
    assert.equal(await color(nav, 'color'), await nav.evaluate(e => { const v = getComputedStyle(e).getPropertyValue('--project-highlight'); const node = document.createElement('span'); node.style.color = v; e.appendChild(node); const color = getComputedStyle(node).color; node.remove(); return color }))
    assert.equal(await color(page.locator('.fx-subsubnav a').first(), 'color'), await color(page.locator('.fx-subsubnav a').last(), 'color'))
    const clear = page.locator('.fxa-clear-filters')
    assert.equal(await clear.locator('svg').count(), 1)
    await clear.hover(); assert.notEqual(await color(clear, 'background-color'), 'rgba(0, 0, 0, 0)')
    await page.getByRole('button', { name: 'Kết quả', exact: true }).click()
    await page.getByRole('option', { name: 'Thắng', exact: true }).click()
    await page.keyboard.press('Escape')
    await page.locator('.fxa-apply-button').click()
    await page.locator('.fxa-filter-chip[aria-label="Bỏ bộ lọc Kết quả"]').waitFor()
    await clear.click()
    assert.equal(await page.locator('.fxa-filter-chip[aria-label="Bỏ bộ lọc Kết quả"]').count(), 0)
    await page.screenshot({ path: `${out}/analytics-${theme}.png`, fullPage: true })
    facts.chart = await color(page.locator('.fxa-curve').first(), 'color')
    receipt.cases.push(facts)
    await context.close()
  }
  assert.deepEqual(receipt.errors, [])
  assert.deepEqual(receipt.blockedWrites, [])
} catch (error) { receipt.failure = String(error); process.exitCode = 1 }
finally { await browser.close(); await writeFile(`${out}/receipt.json`, JSON.stringify(receipt, null, 2)); console.log(JSON.stringify(receipt)) }
