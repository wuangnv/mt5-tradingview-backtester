import { chromium } from 'playwright'
import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'

const base = process.env.TW_UI_BASE || 'http://127.0.0.1:5180'
const out = '../evidence/multi-asset-session-20261009/picker'
await mkdir(out, { recursive:true })
const browser = await chromium.launch({ headless:true })
const results = []
const errors = []
const url = `${base}/?workspace=tenant-a&view=overview&area=testing&section=dashboard`
const saved = (id, instrument, category, provider = 'QuantDataManager') => ({ dataset_id:id, instrument_id:instrument,
  asset_class:category, timeframe:'60s', timeframe_seconds:60, row_count:100, source:{ provider }, instrument_spec:{ account_ccy:'EUR' } })
const datasets = [saved('dataset-eur-old', 'EUR/USD', 'fx'), saved('dataset-eur-new', 'EUR/USD', 'fx'), saved('dataset-stock', 'AAPL', 'stock'),
  saved('dataset-crypto', 'BTC/USD', 'crypto'), saved('dataset-unknown', 'UNCLASSIFIED-LONG-INSTRUMENT-IDENTITY', '')]
const instruments = [{ instrument_id:'EUR/USD', provider:'QuantDataManager', name:'Euro / US Dollar', asset_class:'fx' },
  { instrument_id:'AAPL', provider:'QuantDataManager', name:'Apple Inc. — a deliberately long catalog name for layout verification', asset_class:'stock' },
  { instrument_id:'NOT-DOWNLOADED', provider:'QuantDataManager', name:'Catalog only', asset_class:'stock' }]
async function open(page) {
  await page.goto(url)
  await page.locator('.fx-dashboard-quick-action').first().click()
  const trigger = page.locator('.dataset-asset-select .fx-select-trigger')
  await trigger.click()
  const menu = page.locator('.dataset-asset-select .fx-select-menu')
  await menu.waitFor()
  return { trigger, menu }
}
async function bounds(page, menu) {
  const box = await menu.boundingBox()
  const clip = await page.locator('.quick-session-body').boundingBox()
  assert.ok(box.x >= clip.x && box.x + box.width <= clip.x + clip.width + 1, JSON.stringify({ box, clip }))
  assert.ok(box.y >= clip.y - 1 && box.y + box.height <= clip.y + clip.height + 1, JSON.stringify({ box, clip }))
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false)
}
try {
  for (const width of [1710, 1440, 768, 360]) {
    const page = await browser.newPage({ viewport:{ width, height:987 } })
    page.on('pageerror', error => errors.push(error.message))
    page.setDefaultTimeout(8000)
    // Live read-only: block mutations, leave all GET requests on the real workspace API.
    await page.route('**/api/**', route => route.request().method() === 'GET' ? route.continue() : route.abort())
    const { trigger, menu } = await open(page)
    await menu.getByRole('option').first().waitFor()
    assert.equal(await menu.getByRole('option', { name:'Chọn tài sản', exact:true }).count(), 0)
    assert.match(await menu.innerText(), /M1 · Dukascopy/)
    await bounds(page, menu)
    await page.screenshot({ path:`${out}/live-${width}.png` })
    await menu.locator('input').pressSequentially('no-such-asset')
    assert.equal(await menu.locator('input').inputValue(), 'no-such-asset')
    assert.equal(await menu.locator('input').evaluate(node => node === document.activeElement), true)
    await bounds(page, menu)
    await menu.getByRole('status').waitFor()
    await menu.locator('input').press('Escape')
    assert.equal(await trigger.getAttribute('aria-expanded'), 'false')
    assert.equal(await trigger.evaluate(node => node === document.activeElement), true)
    assert.equal(await page.locator('.quick-session-dialog').getAttribute('open'), '')
    results.push({ type:'live-read-only', width, pass:true })
    await page.close()
  }
  for (const [width, theme, language] of [[1440,'dark','vi'], [768,'light','en'], [360,'dark','vi']]) {
    const page = await browser.newPage({ viewport:{ width, height:987 } })
    page.on('pageerror', error => errors.push(error.message))
    page.setDefaultTimeout(8000)
    await page.addInitScript(({ theme, language }) => { localStorage.setItem('tw-theme',theme); localStorage.setItem('tw-language',language) }, { theme, language })
    let posted
    await page.route('**/api/v2/data/datasets', route => route.fulfill({ json:{ items:datasets, catalog_items:instruments } }))
    // Recent session entries are read from actual parent state, with a labeled fixture here.
    await page.route('**/api/v2/replay/sessions', route => {
      if (route.request().method() === 'POST') { posted = route.request().postDataJSON(); return route.fulfill({ status:422, json:{ detail:'fixture-create-blocked' } }) }
      return route.fulfill({ json:{ items:[{ record_id:'fixture-recent', revision:1, dataset_id:'dataset-eur-new', name:'Fixture recent', instrument_id:'EUR/USD', updated_at_utc:'2026-10-08T12:00:00Z', dataset_available:true }] } })
    })
    const { trigger, menu } = await open(page)
    await menu.getByRole('option').nth(4).waitFor()
    await menu.getByRole('group', { name:/^(Dùng gần đây|Recently used)$/ }).waitFor()
    assert.equal(await page.getByTestId('fxreplay-shell').getAttribute('data-theme'), theme)
    assert.equal(await menu.getByRole('option').count(), 5)
    assert.equal(await menu.getByRole('option', { name:/NOT-DOWNLOADED/ }).count(), 0)
    await bounds(page, menu)
    await page.screenshot({ path:`${out}/fixture-${width}-${theme}.png` })
    await menu.getByRole('button', { name:/^(Cổ phiếu|Stocks)$/ }).click()
    assert.equal(await menu.getByRole('option').count(), 1)
    await menu.getByRole('button', { name:/^(Tất cả|All)$/ }).click()
    await menu.locator('input').fill('Euro / US Dollar')
    assert.equal(await menu.getByRole('option').count(), 2)
    await menu.locator('input').press('ArrowDown')
    assert.equal(await menu.getByRole('option').first().evaluate(node => node === document.activeElement), true)
    await page.keyboard.press('End')
    await page.keyboard.press('Enter')
    const tags = page.locator('.dataset-asset-select .fx-select-tags')
    assert.match(await menu.getByRole('option', { selected:true }).innerText(), /#eur-old/)
    assert.equal(await trigger.getAttribute('aria-expanded'), 'true')
    await menu.locator('input').fill('')
    await menu.getByRole('button', { name:'Crypto', exact:true }).click()
    await menu.getByRole('option').click()
    assert.match(await tags.innerText(), /BTC\/USD/)
    await menu.getByRole('button', { name:'Forex', exact:true }).click()
    await menu.getByRole('option').first().click()
    assert.match(await menu.getByRole('option', { selected:true }).innerText(), /#eur-new/)
    assert.equal(await tags.locator('.fx-select-tag').count(), 2)
    await menu.locator('input').press('Escape')
    await tags.getByRole('button', { name:/BTC\/USD/ }).click()
    assert.doesNotMatch(await tags.innerText(), /BTC\/USD/)
    await trigger.click()
    await menu.getByRole('button', { name:'Crypto', exact:true }).click()
    await menu.getByRole('option').click()
    await menu.getByRole('button', { name:'Forex', exact:true }).click()
    await page.locator('.quick-session-header h2').hover()
    const style = await menu.getByRole('option', { selected:true }).evaluate(node => ({ bg:getComputedStyle(node).backgroundColor, color:getComputedStyle(node.querySelector('.fx-select-check')).color, check:node.querySelector('.fx-select-check').getBoundingClientRect().left, category:node.querySelector('.dataset-asset-category').getBoundingClientRect().right, arrows:node.querySelectorAll('svg').length }))
    assert.equal(style.bg, 'rgba(0, 0, 0, 0)')
    assert.equal(style.arrows, 0)
    assert.ok(style.check > style.category)
    const highlight = await page.getByTestId('fxreplay-shell').evaluate(node => { const probe=document.createElement('span'); probe.style.color='var(--project-highlight)';node.appendChild(probe); const color=getComputedStyle(probe).color;probe.remove();return color })
    assert.equal(style.color, highlight)
    const stars = await page.locator('.quick-session-required').evaluateAll(nodes => nodes.map(node => getComputedStyle(node).color))
    assert.equal(stars.length, 3)
    assert.ok(stars.every(color => color === stars[0] && color !== 'rgb(0, 0, 0)'))
    await bounds(page, menu)
    await page.screenshot({ path:`${out}/selected-${width}-${theme}.png` })
    await menu.locator('input').press('Escape')
    await page.locator('.quick-session-fields > label input').first().fill('Fixture asset selection')
    await page.locator('.quick-session-submit').click()
    await page.getByText(/fixture-create-blocked/).waitFor()
    assert.equal(posted.dataset_id, 'dataset-eur-new')
    assert.deepEqual(posted.dataset_ids, ['dataset-eur-new', 'dataset-crypto'])
    assert.equal(posted.starting_balance, '100000')
    assert.equal(posted.chart_engine, 'legacy')
    await trigger.click()
    await page.locator('.quick-session-header h2').click()
    assert.equal(await trigger.getAttribute('aria-expanded'), 'false')
    results.push({ type:'labeled-fixture', width, theme, language, pass:true, postedDataset:posted.dataset_id })
    await page.close()
  }
  for (const state of ['empty', 'error']) {
    const page = await browser.newPage({ viewport:{ width:360, height:740 } })
    page.on('pageerror', error => errors.push(error.message))
    page.setDefaultTimeout(8000)
    await page.route('**/api/**', route => route.request().method() === 'GET' ? route.continue() : route.abort())
    await page.route('**/api/v2/data/datasets', route => route.fulfill({ status:state === 'empty' ? 200 : 503, json:state === 'empty' ? { items:[], catalog_items:instruments } : { detail:'fixture-unavailable' } }))
    await page.goto(url)
    await page.locator('.fx-dashboard-quick-action').first().click()
    const trigger = page.locator('.dataset-asset-select .fx-select-trigger')
    if (state === 'error') {
      await page.locator('.quick-session-dialog [role=alert]').waitFor()
      assert.equal(await trigger.isDisabled(), true)
      await page.route('**/api/v2/data/datasets', route => route.fulfill({ json:{ items:datasets, catalog_items:instruments } }))
      await page.locator('.quick-session-dialog').getByRole('button', { name:'Thử lại', exact:true }).click()
      await trigger.click()
      await page.locator('.dataset-asset-select [role=option]').first().waitFor()
    } else {
      await trigger.click()
      await page.locator('.dataset-asset-select [role=status]').waitFor()
      assert.equal(await page.locator('.dataset-asset-select [role=option]').count(), 0)
    }
    assert.equal(await page.locator('.quick-session-submit').isDisabled(), true)
    await bounds(page, page.locator('.dataset-asset-select .fx-select-menu'))
    await page.screenshot({ path:`${out}/fixture-${state}-360.png` })
    results.push({ type:'labeled-fixture', state, width:360, pass:true })
    await page.close()
  }
  const page = await browser.newPage({ viewport:{ width:1440, height:987 } })
  page.on('pageerror', error => errors.push(error.message))
  page.setDefaultTimeout(8000)
  await page.route('**/api/**', route => route.request().method() === 'GET' ? route.continue() : route.abort())
  await page.goto(`${base}/?workspace=tenant-a&view=analytics&demo=1&area=testing&section=analytics`)
  const type = page.getByRole('button', { name:'Loại', exact:true })
  await type.click()
  const menu = page.getByRole('dialog', { name:'Loại', exact:true })
  const all = menu.getByRole('checkbox')
  const option = menu.getByRole('option').first()
  assert.equal(await all.getAttribute('aria-checked'), 'true')
  await option.click()
  assert.equal(await all.getAttribute('aria-checked'), 'mixed')
  await all.focus()
  await page.keyboard.press('Space')
  assert.equal(await all.getAttribute('aria-checked'), 'true')
  await page.keyboard.press('Escape')
  assert.equal(await type.evaluate(node => node === document.activeElement), true)
  await page.goto(`${url}&demo=1`)
  const sort = page.getByRole('button', { name:'Sắp xếp phiên', exact:true })
  await sort.click()
  const options = page.locator('.fx-select-menu [role=option]')
  await options.last().hover()
  const geometry = await options.last().evaluate(e => {
    const r = e.getBoundingClientRect(), p = e.parentElement.getBoundingClientRect()
    return { left:r.left - p.left, right:p.right - r.right }
  })
  assert.ok(geometry.left >= 2 && Math.abs(geometry.left - geometry.right) < 1, JSON.stringify(geometry))
  const selected = await options.last().textContent()
  await options.last().click()
  assert.equal(await sort.textContent(), selected)
  results.push({ type:'shared-select-regression', pass:true })
  assert.deepEqual(errors, [])
  await page.close()
} finally {
  await browser.close()
  await writeFile(`${out}/report.json`, JSON.stringify(results, null, 2))
}
console.log(JSON.stringify(results))
