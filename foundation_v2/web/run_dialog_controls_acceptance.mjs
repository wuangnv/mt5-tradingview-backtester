import { chromium } from 'playwright'
import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'

const base = process.env.TW_UI_BASE || 'http://127.0.0.1:5180'
const out = process.env.TW_DIALOG_EVIDENCE || '../evidence/dialog-controls-20261009'
await mkdir(out, { recursive:true })
const browser = await chromium.launch({ headless:true })
const results = [], errors = []
const url = (view, section, extra = '') => `${base}/?workspace=tenant-a&view=${view}&area=testing&section=${section}${extra}`
async function checkClose(page, name, close) {
  await close.waitFor()
  await close.evaluate(async el => { await Promise.all(el.closest('dialog, [role=dialog]').getAnimations({subtree:true}).map(animation => animation.finished.catch(() => {}))) })
  await page.mouse.move(0, 0)
  const initial = await close.evaluate(el => ({ color:getComputedStyle(el).color, box:el.getBoundingClientRect().toJSON() }))
  await close.hover()
  await page.waitForFunction(el => {
    const probe = document.createElement('span')
    probe.style.color = 'var(--wm-content)'; el.appendChild(probe)
    const expected = getComputedStyle(probe).color; probe.remove()
    return getComputedStyle(el).color === expected
  }, await close.elementHandle())
  const hovered = await close.evaluate(el => {
    const s = getComputedStyle(el)
    return { background:s.backgroundColor, border:s.borderTopWidth, shadow:s.boxShadow, color:s.color, box:el.getBoundingClientRect().toJSON() }
  })
  assert.equal(hovered.background, 'rgba(0, 0, 0, 0)', name)
  assert.equal(hovered.border, '0px', name)
  assert.equal(hovered.shadow, 'none', name)
  assert.notEqual(hovered.color, initial.color, name)
  assert.deepEqual(hovered.box, initial.box, name)
  await page.keyboard.press('Tab'); await close.focus()
  assert.equal(await close.evaluate(el => el.matches(':focus-visible')), true, name)
  assert.equal(await close.evaluate(el => getComputedStyle(el).outlineStyle), 'solid', name)
  results.push({ name, theme:await page.getByTestId('fxreplay-shell').getAttribute('data-theme'), pass:true })
  await close.click()
}
try {
  for (const theme of ['dark','light']) {
    const page = await browser.newPage({ viewport:{width:1710,height:987} })
    page.setDefaultTimeout(10000)
    page.on('pageerror', e => errors.push(e.message))
    await page.addInitScript(theme => { localStorage.setItem('tw-theme',theme); localStorage.setItem('tw-language','vi') }, theme)
    // Inspect local dialogs without permitting any API mutation.
    await page.route('**/api/**', route => route.request().method() === 'GET' ? route.continue() : route.abort())
    await page.goto(url('overview','dashboard'))
    await page.locator('.fx-dashboard-quick-action').first().click()
    assert.equal(await page.locator('.quick-session-tabs').evaluate(e => e.getBoundingClientRect().height), 36)
    assert.equal(await page.locator('.quick-session-close').evaluate(e => e.getBoundingClientRect().height), 32)
    await page.screenshot({ path:`${out}/quick-${theme}.png` })
    await checkClose(page, 'Quick Session', page.locator('.quick-session-close'))
    await page.getByTestId('help-toggle').click()
    await checkClose(page, 'Help', page.getByTestId('help-close'))
    await page.goto(url('market-data','market-data'))
    await page.getByRole('button', {name:'Danh mục tài sản',exact:true}).click()
    await checkClose(page, 'Asset catalog drawer', page.locator('.data-library-catalog-drawer .wm-dialog-close'))
    await page.getByRole('button', {name:'Nhập CSV',exact:true}).click()
    await checkClose(page, 'CSV import', page.locator('.data-library-dialog .wm-dialog-close'))
    await page.goto(url('trade','trades','&demo=1'))
    await page.locator('.fxa-filter-actions button').filter({hasText:'Cơ bản'}).click()
    await checkClose(page, 'Ledger filters', page.locator('.fxl-close'))
    await page.goto(url('overview','dashboard','&demo=1'))
    await page.locator('.fx-dashboard-card-icon[title="Sửa tên và mô tả"]').first().click()
    await checkClose(page, 'Session settings', page.locator('.fxs-drawer-close'))
    await page.locator('.fxs-action-button.is-danger').first().click()
    await checkClose(page, 'Session delete confirmation', page.locator('.fxs-action-dialog .wm-dialog-close'))
    await page.close()
  }
  for (const hasTouch of [false,true]) {
    const page = await browser.newPage({viewport:{width:360,height:740},hasTouch})
    await page.route('**/api/**', route => route.request().method() === 'GET' ? route.continue() : route.abort())
    await page.goto(url('overview','dashboard'))
    await page.locator('.fx-dashboard-quick-action').first().click()
    assert.equal(await page.locator('.quick-session-tabs button').first().evaluate(el => el.getBoundingClientRect().height), hasTouch ? 44 : 28)
    assert.equal(await page.locator('.quick-session-close').evaluate(el => el.getBoundingClientRect().height), hasTouch ? 44 : 32)
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false)
    await page.locator('.quick-session-tabs button').last().click()
    await page.locator('.quick-session-tabs button').first().click()
    await page.screenshot({path:`${out}/quick-mobile-${hasTouch ? 'touch':'mouse'}.png`})
    await page.locator('.quick-session-close').click()
    results.push({name:'Mobile dimensions and type switch',hasTouch,pass:true})
    await page.close()
  }
  assert.deepEqual(errors, [])
} finally {
  await browser.close()
  await writeFile(`${out}/report.json`, JSON.stringify({results,errors},null,2))
}
console.log(JSON.stringify(results))
