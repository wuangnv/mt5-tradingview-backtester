import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { chromium } from 'playwright'

const origin = 'http://127.0.0.1:5180'
const output = '../evidence/page-state-workflow-20261010'
await mkdir(output, { recursive:true })
const browser = await chromium.launch({ headless:true, ignoreDefaultArgs:['--hide-scrollbars'] })
const context = await browser.newContext({ viewport:{ width:1710,height:987 } })
await context.addInitScript(() => { localStorage.setItem('tw-language','vi'); localStorage.setItem('tw-theme','dark') })
const page = await context.newPage()
const report = { scope:'Actual local GET smoke; explicit intercepted response fixtures for failure/empty/refresh of real components; no writes', cases:[], errors:[], writes:[] }
page.on('pageerror', error => report.errors.push(error.message))
await context.route('**/*', route => {
  if (new URL(route.request().url()).origin !== origin) return route.abort()
  if (!['GET','HEAD','OPTIONS'].includes(route.request().method())) { report.writes.push(route.request().url()); return route.abort() }
  return route.continue()
})
const href = (view, extra = '') => `${origin}/?workspace=tenant-a&area=testing&view=${view}&select=1${extra}`
try {
  let listRequest
  page.on('request', request => { if (new URL(request.url()).pathname === '/api/v2/dashboard/sessions') listRequest = new URL(request.url()) })
  await page.goto(href('overview','&dashboard_page=9'))
  await page.locator('.fx-dashboard-session-card').first().waitFor()
  assert.equal(listRequest.searchParams.get('page'),'1')
  assert.equal(listRequest.searchParams.get('page_size'),'3')
  assert.ok(await page.locator('.fx-dashboard-session-card').count() <= 3)
  assert.equal(await page.getByRole('navigation',{name:'Phân trang phiên gần đây'}).count(),0)
  const id = await page.locator('.fx-dashboard-session-card').first().getAttribute('data-session-id')
  await page.screenshot({path:`${output}/actual-overview.png`,animations:'disabled'})
  report.cases.push({ actualGET:true, case:'Dashboard requests first three after full catalog filters; ignores old pager query' })

  await page.goto(href('replay',`&session=${id}`))
  await page.locator('.fxr-session-cards').waitFor()
  await page.waitForFunction(() => !document.querySelector('.fxr-session-report .wm-skeleton'))
  const previous = await page.locator('.fxr-session-report').textContent()
  let release
  const pending = new Promise(resolve => { release = resolve })
  let requested = false
  await page.route('**/api/v2/replay/sessions/*/analytics*', async route => { requested = true; await pending; await route.fulfill({status:503,json:{detail:'fixture_refresh_failed'}}) })
  await page.evaluate(() => window.dispatchEvent(new Event('focus')))
  await page.waitForFunction(() => document.querySelector('.fxr-session-report')?.textContent.includes('Đang cập nhật kết quả phiên'))
  assert.ok(requested)
  assert.equal(await page.locator('.fxr-session-report .wm-skeleton').count(),0)
  assert.ok((await page.locator('.fxr-session-report').textContent()).includes(previous.trim()))
  release()
  await page.waitForFunction(() => document.querySelector('.fxr-session-report')?.textContent.includes('Chưa cập nhật được kết quả phiên'))
  assert.ok((await page.locator('.fxr-session-report').textContent()).includes(previous.trim()))
  await page.screenshot({path:`${output}/actual-session-stale.png`,animations:'disabled'})
  await page.unroute('**/api/v2/replay/sessions/*/analytics*')
  report.cases.push({ actualGET:true, interceptedFixture:true, case:'Same session refresh retains prior results while pending and after503' })

  await page.route('**/api/v2/replay/sessions/*/analytics*', route => route.fulfill({status:403,json:{detail:'fixture_denied'}}))
  await page.locator('.fxr-session-report .wm-read-state').getByRole('button',{name:'Thử lại'}).click()
  await page.waitForFunction(() => document.querySelector('.fxr-session-report [role=alert]'))
  assert.equal(await page.locator('[data-testid=session-performance]').count(),0,'Denial clears cached results instead of presenting stale data')
  await page.unroute('**/api/v2/replay/sessions/*/analytics*')
  report.cases.push({interceptedFixture:true,case:'403 clears prior session report'})

  await page.goto(href('replay',`&session=${id}`))
  await page.locator('.fxr-session-cards').waitFor()
  await page.route('**/api/v2/replay/sessions', route => route.fulfill({status:503,json:{detail:'fixture_catalog_refresh_failed'}}))
  await page.evaluate(() => window.dispatchEvent(new Event('focus')))
  await page.locator('.fx-session-picker > .wm-read-state').waitFor()
  assert.equal(await page.locator('.fxr-session-cards').count(),1)
  await page.unroute('**/api/v2/replay/sessions')
  let releaseCatalog
  const catalogPending = new Promise(resolve => { releaseCatalog = resolve })
  await page.route('**/api/v2/replay/sessions', async route => { await catalogPending; await route.continue() })
  await page.locator('.fx-session-picker > .wm-read-state').getByRole('button',{name:'Thử lại'}).click()
  assert.equal(await page.locator('.fxr-session-cards').count(),1,'Retrying a stale catalog preserves the selected session')
  releaseCatalog()
  await page.waitForFunction(() => !document.querySelector('.fx-session-picker > .wm-read-state'))
  await page.unroute('**/api/v2/replay/sessions')
  report.cases.push({interceptedFixture:true,case:'Stale catalog retry preserves session content while pending'})

  // Catalog failure must not mount dependent reports and present a fabricated empty ledger.
  await page.route('**/api/v2/replay/sessions', route => route.fulfill({status:503,json:{detail:'fixture_catalog_unavailable'}}))
  for (const view of ['trade','analytics']) {
    await page.goto(href(view))
    await page.locator('.fx-content [role=alert]').waitFor()
    assert.equal(await page.locator('.fx-content .fxa-trades,.fx-content .fxa-report').count(),0)
    report.cases.push({ interceptedFixture:true, view, case:'Catalog failure blocks dependent data, never masquerades as empty' })
  }
  await page.unroute('**/api/v2/replay/sessions')
  await page.route('**/api/v2/replay/sessions', route => route.fulfill({json:{items:[]}}))
  for (const view of ['replay','trade','analytics']) {
    await page.goto(href(view))
    await page.locator('[data-testid=testing-welcome]').waitFor()
    assert.equal(await page.locator('.wm-welcome-action').count(),2)
    report.cases.push({interceptedFixture:true,view,case:'No sessions renders shared centered welcome'})
  }
  await page.goto(href('replay','&session=00000000000000000000000000000000'))
  await page.getByRole('heading',{name:'Không tìm thấy phiên trong không gian làm việc này',exact:true}).waitFor()
  assert.equal(await page.locator('[data-testid=testing-welcome]').count(),0)
  await page.unroute('**/api/v2/replay/sessions')

  await page.route('**/api/v2/replay/trades*', async route => {
    const response = await route.fetch()
    const payload = await response.json()
    await route.fulfill({json:{...payload,status:'ready',ledger:[],excluded:[],scope:{...payload.scope,readable_session_count:1},pagination:{...payload.pagination,filtered_count:0,returned_count:0,page:1,page_count:0}}})
  })
  await page.goto(href('trade','&sessions=all'))
  await page.getByText('Chưa có giao dịch đóng trong phạm vi này.',{exact:true}).waitFor()
  await page.goto(href('trade','&sessions=all&side=buy'))
  await page.getByText('Không có giao dịch khớp bộ lọc.',{exact:true}).waitFor()
  await page.unroute('**/api/v2/replay/trades*')
  report.cases.push({interceptedFixture:true,case:'Actual aggregate contract distinguishes verified zero from filtered zero without inventing scope fields'})

  await page.route('**/api/v2/replay/trades*', route => route.fulfill({status:503,json:{detail:'fixture_ledger_refresh_failed'}}))
  await page.evaluate(() => window.dispatchEvent(new Event('focus')))
  await page.locator('[data-resource-state=stale]').waitFor()
  assert.equal(await page.locator('[data-testid=fx-trade-ledger]').count(),1)
  await page.getByText('Không có giao dịch khớp bộ lọc.',{exact:true}).waitFor()
  await page.unroute('**/api/v2/replay/trades*')
  await page.route('**/api/v2/replay/trades*', route => route.fulfill({status:403,json:{detail:'fixture_ledger_denied'}}))
  await page.locator('[data-resource-state=stale]').getByRole('button',{name:'Thử lại'}).click()
  await page.locator('.fx-content [role=alert]').waitFor()
  assert.equal(await page.getByText('Không có giao dịch khớp bộ lọc.',{exact:true}).count(),0)
  await page.unroute('**/api/v2/replay/trades*')
  report.cases.push({interceptedFixture:true,case:'Aggregate background503 retains previous scope; retry403 clears it'})

  // A completed-job GET fixture triggers the same library reread as production downloads.
  await page.route('**/api/v2/events', route => route.abort())
  let releaseJobs
  const jobsPending = new Promise(resolve => { releaseJobs = resolve })
  await page.route('**/api/v2/data/downloads', async route => { await jobsPending; await route.fulfill({json:{available:false,items:[{job_id:'fixture-completed-job',status:'completed',instrument_id:'EUR/USD'}]}}) })
  let libraryReads = 0
  await page.route('**/api/v2/data/datasets', async route => {
    libraryReads++
    if (libraryReads > 1) return route.fulfill({status:503,json:{detail:'fixture_library_refresh_failed'}})
    const response = await route.fetch()
    const payload = await response.json()
    await route.fulfill({json:{...payload,catalog_state:{configured:false,error:'source_unavailable',refresh_available:false},download_state:{supports_full:false}}})
  })
  await page.goto(href('market-data'))
  await page.locator('.rd-table tbody tr').first().waitFor()
  const savedCount = await page.locator('.rd-table tbody tr').count()
  await page.locator('.data-library-catalog-status').waitFor()
  releaseJobs()
  await page.locator('[data-resource-state=stale]').waitFor()
  assert.equal(await page.locator('.rd-table tbody tr').count(),savedCount)
  await page.screenshot({path:`${output}/actual-library-stale.png`,animations:'disabled'})
  await page.unroute('**/api/v2/data/datasets')
  await page.unroute('**/api/v2/data/downloads')
  await page.unroute('**/api/v2/events')
  report.cases.push({actualGET:true,interceptedFixture:true,case:'Disconnected provider and503 library reread retain saved dataset rows; no provider refresh or mutation'})

  // Use real metadata shape with an explicitly empty page; no persistence is changed.
  await page.route('**/api/v2/dashboard/sessions*', async route => {
    const response = await route.fetch()
    const payload = await response.json()
    await route.fulfill({json:{...payload,total:0,matching_count:0,items:[],pages:1,page:1}})
  })
  await page.goto(href('overview'))
  await page.locator('[data-testid=testing-welcome]').waitFor()
  assert.equal(await page.locator('.wm-welcome-action:disabled').count(),0,'Actual welcome actions remain enabled')
  await page.locator('.wm-welcome-action').first().click()
  await page.locator('.quick-session-dialog').waitFor()
  await page.getByRole('button',{name:'Đóng tạo phiên'}).click()
  report.cases.push({interceptedFixture:true,case:'Actual no-session Dashboard welcome opens shared creation form, cancel without writes'})
  await page.unroute('**/api/v2/dashboard/sessions*')

  await page.goto(href('overview','&demo=1&ui_state=no-trades'))
  await page.waitForFunction(() => document.querySelectorAll('.fx-dashboard-card-facts').length === 3 && [...document.querySelectorAll('.fx-dashboard-card-facts')].every(element => element.textContent.includes('10.000 USD')))
  assert.equal(await page.locator('.fx-dashboard-metric strong').nth(2).textContent(),'0')
  report.cases.push({fixtureOnly:true,case:'No-trades card balances10000 agree with zero ledger and Performance'})
  assert.deepEqual(report.errors,[])
  assert.deepEqual(report.writes,[])
  report.result = 'PASS'
} catch(error) { report.failure = error.stack; report.url = page.url(); await page.screenshot({path:`${output}/actual-failure.png`}); throw error }
finally { await writeFile(`${output}/real-components.json`,JSON.stringify(report,null,2)); await browser.close() }
console.log(JSON.stringify({result:report.result,cases:report.cases.length,errors:report.errors,writes:report.writes}))
