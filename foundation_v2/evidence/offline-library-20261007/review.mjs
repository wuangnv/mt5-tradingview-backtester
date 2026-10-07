import assert from 'node:assert/strict'
import { chromium } from '../../web/node_modules/playwright/index.mjs'
import { readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'

const out = new URL('./', import.meta.url), origin = 'http://127.0.0.1:5180'
const base = origin + '/?workspace=tenant-a&view=market-data&area=testing&section=market-data'
const report = { cases: [], errors: [], blocked: [] }, browser = await chromium.launch({ headless: true })
const selectedCases = process.argv[2] ? new RegExp(process.argv[2]) : null
const baselineContext = await browser.newContext()
const response = await baselineContext.request.get(origin + '/api/v2/data/datasets', { headers: { 'X-Workspace-Id': 'tenant-a' } })
assert.equal(response.status(), 200)
const baseline = (await response.json()).items
assert.equal(baseline.length, 44)
report.baseline = { count: baseline.length, sources: [...new Set(baseline.map(i => i.source?.provider || i.provider_id))] }
await baselineContext.close()

async function setup({ width = 1710, theme = 'dark', language = 'vi', href = base, fixture = '' } = {}) {
  const context = await browser.newContext({ viewport: { width, height: 987 } }), traffic = [], writes = []
  let retries = 0, imported = false
  await context.addInitScript(({ theme, language }) => { localStorage.setItem('tw-theme', theme); localStorage.setItem('tw-language', language) }, { theme, language })
  await context.routeWebSocket('**/*', s => s.close())
  await context.route('**/*', async route => {
    const r = route.request(), u = new URL(r.url())
    if (u.pathname.startsWith('/api/')) traffic.push({ method: r.method(), path: u.pathname, workspace: r.headers()['x-workspace-id'] })
    if (/^\/api\/v2\/(live|data\/market-assets)/.test(u.pathname)) { report.blocked.push({method:r.method(),url:r.url(),reason:'offline-only forbidden API'}); return route.abort() }
    if (u.origin === origin && r.method() === 'POST' && u.pathname === '/api/v2/replay/sessions') {
      writes.push({ path: u.pathname, body: r.postDataJSON(), workspace: r.headers()['x-workspace-id'] })
      return route.fulfill({ status: 422, json: { detail: 'Independent stops before persistence' } })
    }
    if (u.origin === origin && fixture.startsWith('csv') && r.method() === 'POST' && u.pathname.startsWith('/api/v2/data/csv/')) {
      const body = r.postDataJSON(); if(fixture==='csv-pending') await new Promise(resolve=>setTimeout(resolve,750)); writes.push({ path: u.pathname, body, workspace: r.headers()['x-workspace-id'] })
      if(u.pathname.endsWith('/preview') && fixture==='csv-error') return route.fulfill({status:422,json:{detail:'Independent invalid CSV'}})
      if (u.pathname.endsWith('/preview')) return route.fulfill({ json: { preview: { dataset_id: 'independent-csv', row_count: 2, unique_row_count: 2, quality: { disposition: ['csv-review','csv-pending'].includes(fixture)?'review':fixture==='csv-missing'?'missing_data':'pass', duplicates: 0, out_of_order: 0, gaps: [] }, available_range: { from_utc: '2026-01-01T00:00:00Z', to_utc: '2026-01-01T01:00:00Z' }, raw_sha256: 'isolated', normalized_sha256: 'isolated' } } })
      imported = true; return route.fulfill({ json: { dataset: { ...baseline[0], dataset_id: 'independent-csv', instrument_id: 'CSVFIXTURE' } } })
    }
    if (!['GET', 'HEAD', 'OPTIONS'].includes(r.method()) || ![origin, 'http://127.0.0.1:8010'].includes(u.origin)) { report.blocked.push({ method: r.method(), url: r.url() }); return route.abort() }
    if (u.pathname === '/api/v2/data/datasets') {
      retries++
      if (fixture === 'empty') return route.fulfill({ json: { items: [] } })
      if (fixture === 'denied') return route.fulfill({ status: 403, json: { detail: 'Independent workspace denied' } })
      if (fixture === 'failed' || fixture === 'recovery' && retries === 1) return route.fulfill({ status: 503, json: { detail: 'Independent catalog unavailable' } })
      if (fixture.startsWith('csv') && imported) return route.fulfill({ json: { items: [...baseline, { ...baseline[0], dataset_id: 'independent-csv', instrument_id: 'CSVFIXTURE' }] } })
    }
    if (u.pathname === '/api/v2/data/providers' && ['partial', 'failed'].includes(fixture)) return route.fulfill({ status: 503, json: { detail: 'Independent source unavailable' } })
    return route.continue()
  })
  const page = await context.newPage()
  page.on('pageerror', e => report.errors.push(String(e)))
  await page.goto(href); await page.getByTestId('data-desk-root').waitFor()
  return { context, page, traffic, writes, countRetries: () => retries }
}
async function screenshot(page, name) { await page.screenshot({ path: fileURLToPath(new URL(name + '.png', out)), fullPage: true }) }
async function choose(select, value) { await select.locator('.fx-select-trigger').click(); await select.getByRole('option', { name: value, exact: true }).click() }
async function caseRun(name, callback) {
  if (selectedCases && !selectedCases.test(name)) return
  const item = { name }
  report.cases.push(item)
  try { await callback(item); item.pass = true }
  catch (error) { item.pass = false; item.failure = String(error); console.log(JSON.stringify(item)) }
}

try {
  for (const theme of ['dark', 'light']) for (const width of [360, 1710]) for (const language of ['vi', 'en']) await caseRun(`real-${theme}-${language}-${width}`, async item => {
    const { context, page, traffic, writes } = await setup({ theme, width, language })
    const root = page.getByTestId('data-desk-root'), table = root.getByTestId('data-desk-dataset-table'), rows = table.locator('tbody tr'), tabs = root.getByRole('tab'), search = root.locator('.data-library-filters input')
    try {
      await table.waitFor(); assert.equal(await rows.count(), 25)
      item.countText = await root.locator('.data-library-count').innerText(); assert.match(item.countText, /44/)
      assert.equal(await tabs.count(),0); assert.equal(await page.getByTestId('market-assets').count(), 0)
      assert.match(await root.locator('.data-library-offline-note').innerText(), /Dukascopy/); assert.match(await rows.first().locator('td').nth(1).innerText(), /offline|Offline/)
      assert.equal(traffic.some(r => r.path === '/api/v2/data/market-assets'), false)
      assert.equal(await root.locator('.data-library-disclosure[open]').count(), 0)
      item.title = await root.locator('h1').innerText()
      item.searchGeometry = await root.locator('.data-library-filters label').evaluate(e => {
        const icon=e.querySelector('svg').getBoundingClientRect(), input=e.querySelector('input').getBoundingClientRect()
        return {iconLeft:icon.x,inputLeft:input.x,iconRight:icon.right,inputRight:input.right,centerDelta:Math.abs(icon.y+icon.height/2-input.y-input.height/2)}
      })
      assert(item.searchGeometry.iconLeft>=item.searchGeometry.inputLeft)
      assert(item.searchGeometry.iconRight<=item.searchGeometry.inputRight)
      assert(item.searchGeometry.centerDelta<1)
      item.primaryCopy = await table.locator('thead').innerText(); item.quality = await rows.first().locator('td').nth(4).innerText()
      if (language === 'en') assert.doesNotMatch(item.primaryCopy + item.quality, /Sản phẩm|Số nến|Chưa xác minh|Đã xác minh/)
      item.firstDates = await rows.first().locator('td').nth(2).innerText(); item.firstCount = await rows.first().locator('td').nth(3).innerText()
      assert.equal(await root.locator('.rd-topbar a').count(),0)
      await screenshot(page, item.name)
      if (width === 360) {
        const scroller = root.locator('.rd-table-wrap')
        await scroller.focus(); assert.equal(await scroller.evaluate(e => e === document.activeElement), true)
        await page.keyboard.press('ArrowRight'); await page.waitForTimeout(180)
        item.keyboardScroll = await scroller.evaluate(e => e.scrollLeft); assert(item.keyboardScroll > 0)
        await scroller.evaluate(e => { e.scrollLeft = 0 })
      }
      const paging = root.locator('.data-library-paging')
      await paging.locator('button').last().click(); assert.equal(await rows.count(), 19)
      await choose(paging.locator('.fx-select'), '50'); assert.equal(await rows.count(), 44)
      await search.fill('independent-no-match'); await root.getByTestId('data-desk-empty').waitFor(); assert.equal(await table.count(), 0)
      await search.fill(''); await table.waitFor(); assert.equal(await rows.count(), 44)
      const source = report.baseline.sources[0]
      await choose(root.locator('.data-library-filters .fx-select'), source)
      assert.equal(await rows.count(), baseline.filter(i => (i.source?.provider || i.provider_id) === source).length)
      await choose(root.locator('.data-library-filters .fx-select'), language === 'en' ? 'All sources' : 'Tất cả nguồn')
      await search.fill(baseline[0].instrument_id); assert(await rows.count() > 0)
      const row = rows.filter({ has: page.getByTestId('dataset-row-' + baseline[0].dataset_id) })
      await row.locator('.data-library-create').click()
      const modal = page.locator('dialog.quick-session-dialog')
      await modal.waitFor()
      await page.waitForFunction(() => document.querySelectorAll('dialog.quick-session-dialog .quick-session-field')[1]?.querySelector('.fx-select-trigger')?.disabled === false)
      item.initialAsset = await modal.locator('.quick-session-field').nth(1).locator('.fx-select-trigger').innerText(); assert.equal(item.initialAsset, baseline[0].instrument_id)
      await modal.locator('.quick-session-fields > label').first().locator('input').fill('Independent data library')
      await modal.locator('.quick-session-balance input').fill('25,000.75')
      if (width === 360 && language === 'vi') await screenshot(page, `initial-modal-${theme}`)
      await modal.locator('.quick-session-submit').click(); await modal.locator('.quick-session-error').waitFor()
      assert.equal(writes.length, 1); assert.equal(writes[0].body.dataset_id, baseline[0].dataset_id); assert.equal(writes[0].body.starting_balance, '25000.75')
      await page.keyboard.press('Escape'); assert.equal(await modal.count(), 0)
      await search.fill(''); await rows.first().locator('td button').first().click(); await root.getByTestId('dataset-details').waitFor(); assert.equal(await root.locator('.data-library-disclosure[open]').count(), 1)
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth), 0)
      item.writes = writes; item.traffic = traffic; item.overflow = 0
    } finally { await context.close() }
  })

  await caseRun('legacy-deeplink-sync-ignored', async item => {
    const dataset = baseline[1], {context,page,traffic}=await setup({href:base.replace('view=market-data','view=data')+'&data_tab=sync&dataset='+dataset.dataset_id})
    try {await page.getByTestId('dataset-details').waitFor();assert.match(await page.getByTestId('dataset-details').innerText(),new RegExp(dataset.dataset_id));assert.equal(await page.getByRole('tab').count(),0);assert.equal(await page.getByTestId('market-assets').count(),0);await page.reload();await page.getByTestId('data-desk-dataset-table').waitFor();assert.equal(await page.getByRole('tab').count(),0);item.traffic=traffic;await screenshot(page,item.name)}finally{await context.close()}
  })
  await caseRun('unknown-deeplink', async item => {
    const { context, page } = await setup({ href: base + '&dataset=independent-unknown' })
    try { await page.getByTestId('data-desk-dataset-table').waitFor(); assert.equal(await page.locator('tr.is-selected').count(), 0); assert.equal(await page.getByTestId('dataset-details').count(), 0); assert.match(await page.getByTestId('data-desk-root').innerText(), /Dataset trong đường dẫn chưa có/); await screenshot(page, item.name) } finally { await context.close() }
  })
  await caseRun('legacy-stale-area', async item => {
    const { context, page } = await setup({ href: base.replace('view=market-data', 'view=data').replace('area=testing', 'area=live').replace('section=market-data', 'section=calendar') })
    try {
      await page.getByTestId('data-desk-dataset-table').waitFor()
      item.area = await page.locator('.fx-app').getAttribute('data-ui-area'); assert.equal(item.area, 'testing')
      item.activeSubnav = await page.locator('.fx-subnav-link.is-active').innerText(); assert.match(item.activeSubnav, /Kho dữ liệu/)
      item.canonical = await page.evaluate(async () => { const { buildWorkspaceHref } = await import('/src/workspaceContext.js'); return buildWorkspaceHref('data', 'tenant-a', new URLSearchParams('demo=1&session=old&cursor=4'), { dataset:'chosen', session:null, cursor:null }) })
      const u = new URL(item.canonical, origin); assert.equal(u.searchParams.get('view'), 'market-data'); assert.equal(u.searchParams.get('demo'), '1'); assert.equal(u.searchParams.get('dataset'), 'chosen'); assert.equal(u.searchParams.has('session'), false)
    } finally { await context.close() }
  })
  for (const fixture of ['partial', 'failed', 'empty', 'denied', 'recovery']) await caseRun('fixture-' + fixture, async item => {
    const { context, page, traffic, countRetries } = await setup({ fixture })
    try {
      const root = page.getByTestId('data-desk-root')
      if (fixture === 'partial') { await root.getByTestId('data-desk-dataset-table').waitFor(); assert.equal(await root.locator('tbody tr').count(), 25); await root.locator('.data-library-disclosure').nth(1).locator('summary').click(); assert.match(await root.innerText(), /Chưa đọc được thông tin nguồn/); await screenshot(page, item.name) }
      else if (fixture === 'empty') { await root.getByTestId('data-desk-empty').waitFor(); assert.match(await root.getByTestId('data-desk-empty').innerText(), /Chưa có dữ liệu offline/); await screenshot(page, item.name) }
      else {
        await root.getByTestId('data-desk-retry').waitFor(); assert.equal(await root.getByTestId('data-desk-dataset-table').count(), 0)
        if (fixture === 'recovery') { await root.getByTestId('data-desk-retry').click(); await root.getByTestId('data-desk-dataset-table').waitFor(); assert.equal(await root.locator('tbody tr').count(), 25); assert.equal(countRetries(), 2) }
        else { for (let n = 0; n < 3; n++) { await root.getByTestId('data-desk-retry').click(); await root.getByTestId('data-desk-retry').waitFor() } assert.equal(await root.getByTestId('data-desk-retry').isDisabled(), true); assert.equal(countRetries(), 4) }
        await screenshot(page, item.name)
      }
      item.traffic = traffic; assert.equal(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth), 0)
    } finally { await context.close() }
  })
  for (const language of ['vi', 'en']) await caseRun('demo-' + language, async item => {
    const { context, page, traffic, writes } = await setup({ language, width: 360, href: base + '&demo=1' })
    try {
      await page.getByTestId('data-desk-dataset-table').waitFor(); const creates = page.locator('.data-library-create'); assert(await creates.count() > 0)
      for (let n = 0; n < await creates.count(); n++) assert.equal(await creates.nth(n).isDisabled(), true)
      assert.equal(await page.locator('.rd-topbar button').isDisabled(), true)
      assert.equal(await page.getByRole('tab').count(),0)
      await page.locator('.data-library-disclosure').last().locator('summary').click(); assert.equal(await page.getByTestId('data-desk-file-input').count(), 0)
      assert.equal(traffic.length, 0); assert.equal(writes.length, 0); await screenshot(page, item.name); item.traffic = traffic
    } finally { await context.close() }
  })
  for (const width of [360,1710]) await caseRun('csv-header-keyboard-' + width, async item => {
    const {context,page,traffic,writes}=await setup({width})
    try {
      await page.emulateMedia({reducedMotion:'reduce'})
      await page.getByTestId('data-desk-dataset-table').waitFor()
      const button=page.locator('.rd-topbar button'),file=page.getByTestId('data-desk-file-input')
      await button.focus();await page.keyboard.press('Enter');await file.waitFor({state:'visible'})
      assert.equal(await file.evaluate(e=>e===document.activeElement),true)
      assert.equal(await page.locator('.data-library-disclosure').last().getAttribute('open'),'')
      const rect=await file.boundingBox();assert(rect.y>=0&&rect.y<987)
      assert.equal(writes.length,0);item.traffic=traffic;item.focus=true;item.reducedMotion=true;await screenshot(page,item.name)
    }finally{await context.close()}
  })
  await caseRun('csv-preview-import-isolated', async item => {
    const { context, page, writes } = await setup({ fixture: 'csv' })
    try {
      await page.getByTestId('data-desk-dataset-table').waitFor()
      await choose(page.locator('.data-library-filters .fx-select'), report.baseline.sources[0])
      await page.locator('.data-library-filters input').fill('independent-no-match'); await page.getByTestId('data-desk-empty').waitFor()
      await page.locator('.data-library-disclosure').last().locator(':scope > summary').click()
      const file = page.getByTestId('data-desk-file-input'); await file.setInputFiles({ name: 'independent.csv', mimeType: 'text/csv', buffer: Buffer.from('time,open,high,low,close\n2026-01-01T00:00:00Z,1,2,1,2\n2026-01-01T01:00:00Z,2,3,2,3\n') })
      assert.equal(writes.length, 0); assert.equal(await page.getByTestId('data-desk-import-button').isDisabled(), true)
      await page.getByTestId('data-desk-preview-button').click(); await page.getByTestId('data-desk-quality-report').waitFor(); assert.equal(writes.length, 1)
      assert.equal(await page.getByTestId('data-desk-import-button').isDisabled(), false)
      await page.locator('input[name=instrumentId]').fill('EURUSDm2'); assert.equal(await page.getByTestId('data-desk-import-button').isDisabled(), true)
      await page.getByTestId('data-desk-preview-button').click(); await page.getByTestId('data-desk-quality-report').waitFor(); assert.equal(writes.length, 2)
      await page.getByTestId('data-desk-import-button').click(); await page.getByTestId('data-desk-import-success').waitFor(); assert.equal(writes.length, 3)
      await page.waitForFunction(() => document.querySelector('.data-library-count')?.textContent.includes('45'))
      assert.equal(await page.getByRole('tab').count(),0)
      assert.equal(new URL(page.url()).searchParams.has('data_tab'), false)
      assert.equal(await page.locator('.data-library-filters input').inputValue(), '')
      assert.equal(await page.locator('.data-library-filters .fx-select-trigger').innerText(), 'Tất cả nguồn')
      await page.getByTestId('dataset-details').waitFor(); assert.match(await page.getByTestId('dataset-details').innerText(), /independent-csv/)
      assert.equal(writes[2].body.csv_text.includes('time,open'), true); assert.equal(writes[2].workspace, 'tenant-a'); assert.equal(writes[2].body.instrument.instrument_id, 'EURUSDm2')
      assert.equal(Object.keys(writes[2].body).some(k => /path|file/i.test(k)), false)
      await page.reload(); await page.getByTestId('data-desk-dataset-table').waitFor(); assert.match(await page.locator('.data-library-count').innerText(), /45/)
      item.writes = writes; await screenshot(page, item.name)
    } finally { await context.close() }
  })
  for (const fixture of ['csv-empty', 'csv-error', 'csv-review', 'csv-missing']) await caseRun(fixture, async item => {
    const { context, page, writes, traffic } = await setup({ fixture })
    try {
      await page.getByTestId('data-desk-dataset-table').waitFor()
      await page.locator('.data-library-disclosure').last().locator(':scope > summary').click()
      const file = page.getByTestId('data-desk-file-input'), preview = page.getByTestId('data-desk-preview-button'), importer = page.getByTestId('data-desk-import-button')
      await file.setInputFiles({ name:'independent.csv', mimeType:'text/csv', buffer:Buffer.from(fixture==='csv-empty'?'':'time,open,high,low,close\n2026-01-01T00:00:00Z,1,2,1,2\n2026-01-01T01:00:00Z,2,3,2,3\n') })
      assert.equal(writes.length, 0)
      if (fixture === 'csv-empty') {
        await page.getByTestId('data-desk-import-error').waitFor()
        assert.match(await page.getByTestId('data-desk-import-error').innerText(), /File trống/)
        assert.equal(await importer.isDisabled(), true)
      } else {
        await preview.click()
        if (fixture==='csv-error') { await page.getByTestId('data-desk-import-error').waitFor(); assert.equal(await importer.isDisabled(),true); assert.equal(writes.length,1) }
        else {
          await page.getByTestId('data-desk-quality-report').waitFor(); assert.equal(await importer.isDisabled(),true)
          if (fixture==='csv-review') {
            await page.locator('.rd-import-review-check input').check(); assert.equal(await importer.isDisabled(),false)
            await importer.click(); await page.getByTestId('data-desk-import-success').waitFor(); assert.equal(writes.length,2)
          } else assert.equal(writes.length,1)
        }
      }
      item.writes = writes; item.traffic=traffic; await screenshot(page,item.name)
    } finally { await context.close() }
  })
  await caseRun('csv-pending-controls',async item=>{
    const {context,page,writes}=await setup({fixture:'csv-pending'})
    try{
      await page.getByTestId('data-desk-dataset-table').waitFor();await page.locator('.rd-topbar button').click()
      const file=page.getByTestId('data-desk-file-input'),instrument=page.locator('input[name=instrumentId]'),preview=page.getByTestId('data-desk-preview-button'),importer=page.getByTestId('data-desk-import-button')
      await file.setInputFiles({name:'independent.csv',mimeType:'text/csv',buffer:Buffer.from('time,open,high,low,close\n2026-01-01T00:00:00Z,1,2,1,2\n2026-01-01T01:00:00Z,2,3,2,3\n')})
      await preview.click();assert.equal(await file.isDisabled(),true);assert.equal(await instrument.isDisabled(),true);assert.equal(await preview.isDisabled(),true);assert.equal(await importer.isDisabled(),true)
      await page.getByTestId('data-desk-quality-report').waitFor();assert.equal(await file.isDisabled(),false);assert.equal(await instrument.isDisabled(),false)
      const ack=page.locator('.rd-import-review-check input');await ack.check();await importer.click();assert.equal(await ack.isDisabled(),true);assert.equal(await file.isDisabled(),true);assert.equal(await instrument.isDisabled(),true)
      await page.getByTestId('data-desk-import-success').waitFor();assert.equal(await file.isDisabled(),false);assert.equal(await instrument.isDisabled(),false);assert.equal(writes.length,2)
      item.writes=writes;item.previewLocked=true;item.importLocked=true;await screenshot(page,item.name)
    }finally{await context.close()}
  })
  report.pass = report.cases.every(c => c.pass) && report.errors.length === 0 && report.blocked.length === 0
} finally {
  report.hashes = {}
  for (const f of ['main.jsx', 'workspaceContext.js', 'DataDeskWorkspace.jsx', 'MarketAssetCatalog.jsx', 'QuickSessionDialog.jsx', 'DemoPreview.jsx', 'testing-copy.json', 'data-library.css']) report.hashes[f] = createHash('sha256').update(await readFile(new URL('../../web/src/' + f, out))).digest('hex')
  await writeFile(new URL(process.argv[3] || 'review.json', out), JSON.stringify(report, null, 2)); await browser.close()
  console.log(JSON.stringify({ pass: report.pass, cases: report.cases.map(c => ({ name: c.name, pass: c.pass, failure: c.failure })), errors: report.errors, blocked: report.blocked }, null, 2))
}
