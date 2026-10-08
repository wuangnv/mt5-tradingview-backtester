import assert from 'node:assert/strict'
import { chromium } from '../../web/node_modules/playwright/index.mjs'
import { mkdir, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
const out = new URL('./', import.meta.url), origin = 'http://127.0.0.1:5180'
await mkdir(out, { recursive: true })
const browser = await chromium.launch()
const report = { scope: 'read-only actual pages and labeled browser fixtures; no database or live access', cases: [], errors: [] }
const libraryUrl = '/?workspace=tenant-a&view=market-data&area=testing&section=market-data'
const tradesUrl = '/?workspace=tenant-a&view=trade&area=testing&section=trades&select=1&sessions=all'
const job = { job_id:'fixture', instrument_id:'EUR/USD', from_date:'2026-10-05', to_date:'2026-10-05', completed_days:1, total_days:1, retry_after_seconds:0 }
const instruments = Array.from({ length:173 }, (_, index) => ({ instrument_id:`ASSET${String(index).padStart(3,'0')}/USD`, name:'Labeled fixture asset', provider:'Dukascopy', provider_id:'dukascopy-catalog', asset_class:'fx' }))
async function geometry(page) {
  return page.locator('.wm-pagination').evaluate(e => {
    const r = e.getBoundingClientRect(), parent = e.closest('.fx-content').getBoundingClientRect(), cluster = e.querySelector('.wm-pagination-controls').getBoundingClientRect(), style = getComputedStyle(e)
    return { left:r.left, right:r.right, bottom:r.bottom, parentLeft:parent.left, parentRight:parent.right, parentBottom:parent.bottom, clusterCenter:(cluster.left+cluster.right)/2, center:(r.left+r.right)/2, border:style.borderTopWidth, overflow:document.documentElement.scrollWidth-innerWidth }
  })
}
async function run(theme, width, kind, scenario = 'actual', height = 987) {
  const entry = { theme, width, height, kind, scenario }; report.cases.push(entry)
  const context = await browser.newContext({ viewport:{ width, height } })
  await context.addInitScript(theme => { localStorage.setItem('tw-theme',theme); localStorage.setItem('tw-language','vi') }, theme)
  await context.routeWebSocket('**/*', socket => socket.close())
  await context.route('**/*', route => {
    const req = route.request(), url = new URL(req.url())
    if (url.origin !== origin || /^\/api\/v2\/(live|data\/(providers|market-assets))/.test(url.pathname) || !['GET','HEAD','OPTIONS'].includes(req.method())) return route.abort()
    if (scenario !== 'actual' && url.pathname === '/api/v2/data/datasets') return route.fulfill({ json:{ items:[], catalog_items:scenario === 'empty' ? [] : instruments, catalog_state:{ status:'cached', configured:true, refresh_available:false }, download_state:{ available:true } } })
    if (scenario !== 'actual' && url.pathname === '/api/v2/data/downloads') return route.fulfill({ json:{ available:true, items:[{ ...job, status:scenario === 'running' ? 'running' : scenario === 'failed' ? 'failed' : 'completed', error:scenario === 'failed' ? 'source_unavailable' : undefined }] } })
    return route.continue()
  })
  const page = await context.newPage(); page.on('pageerror', error => report.errors.push(String(error)))
  try {
    await page.goto(origin + (kind === 'library' ? libraryUrl : tradesUrl) + (scenario === 'missing-dataset' ? '&dataset=missing-fixture' : ''))
    await page.locator('.wm-pagination').waitFor()
    if (kind === 'library' && !['running','failed'].includes(scenario)) assert.equal(await page.locator('.data-library-download-jobs').count(), 0)
    if (scenario === 'running') { await page.getByRole('progressbar').waitFor(); await page.getByRole('button',{name:'Huỷ tải',exact:true}).waitFor() }
    if (scenario === 'failed') await page.getByRole('button',{name:'Tiếp tục tải',exact:true}).waitFor()
    if (scenario === 'missing-dataset') await page.getByText('Dataset trong đường dẫn chưa có trong kho này. Hãy chọn dữ liệu khác.',{exact:true}).waitFor()
    const pager = page.locator('.wm-pagination'), size = pager.getByRole('button',{name:'Số dòng mỗi trang',exact:true})
    await pager.getByRole('button',{name:'Trang 1',exact:true}).waitFor()
    entry.geometry = await geometry(page)
    assert.equal(entry.geometry.overflow, 0)
    assert(Math.abs(entry.geometry.clusterCenter-entry.geometry.center) < 2)
    assert(Math.abs(entry.geometry.bottom-entry.geometry.parentBottom) < 2)
    assert(Math.abs(entry.geometry.left-entry.geometry.parentLeft) < 2)
    assert(Math.abs(entry.geometry.right-entry.geometry.parentRight) < 2)
    assert.equal(entry.geometry.border, '1px')
    const colors = await pager.evaluate(e => {
      const current = getComputedStyle(e.querySelector('[aria-current="page"]')), other = getComputedStyle(e.querySelector('button:not([aria-current])')), r = e.querySelector('.wm-pagination-button').getBoundingClientRect()
      return { current:current.backgroundColor, other:other.backgroundColor, width:r.width, height:r.height }
    })
    assert.notEqual(colors.current, colors.other); assert.equal(colors.other,'rgba(0, 0, 0, 0)')
    assert.equal(colors.width, colors.height); entry.styles = colors
    await size.click(); await page.getByRole('listbox').waitFor()
    const menu = await page.locator('.wm-pagination .fx-select-menu').boundingBox(), anchor = await size.boundingBox()
    assert(menu.y + menu.height <= anchor.y); assert(menu.x >= 0 && menu.x+menu.width <= width)
    await page.keyboard.press('Escape'); assert.equal(await size.evaluate(e => e === document.activeElement), true)
    if (scenario === 'many') {
      if(width <= 480) for(let index=0;index<6;index++) await pager.getByRole('button',{name:'Trang sau',exact:true}).click()
      else await pager.getByRole('button',{name:'Trang cuối',exact:true}).click()
      await page.waitForFunction(() => document.querySelector('.wm-pagination [aria-current="page"]')?.textContent === '7')
      assert(await pager.getByRole('button',{name:'Trang sau',exact:true}).isDisabled())
      assert.equal(await page.locator('.rd-table tbody tr').count(), 23)
      await size.click(); await page.getByRole('option',{name:'50',exact:true}).click()
      await page.waitForFunction(() => document.querySelector('.wm-pagination [aria-current="page"]')?.textContent === '1')
      assert.equal(await page.locator('.rd-table tbody tr').count(), 50)
      const before = await geometry(page)
      await page.locator('.rd-table-wrap').evaluate(e => { e.scrollLeft = 300; e.scrollTop = 300 })
      assert.deepEqual(await geometry(page), before)
      await page.getByRole('searchbox').fill('ASSET172')
      await page.waitForFunction(() => document.querySelectorAll('.rd-table tbody tr').length === 1)
      assert(await pager.getByRole('button',{name:'Trang sau',exact:true}).isDisabled())
      await page.getByRole('searchbox').fill('nothing-matches')
      await page.getByTestId('data-desk-empty').waitFor()
      assert(Math.abs((await geometry(page)).bottom-entry.geometry.parentBottom) < 2)
      await page.getByRole('searchbox').fill('')
    }
    await page.screenshot({ path:fileURLToPath(new URL(`${kind}-${scenario}-${theme}-${width}${height === 987 ? '' : `-${height}`}.png`,out)), fullPage:true })
    entry.pass = true
  } catch (error) { entry.pass=false; entry.error=String(error); await page.screenshot({ path:fileURLToPath(new URL(`FAIL-${kind}-${scenario}-${theme}-${width}.png`,out)),fullPage:true }).catch(()=>{}) }
  finally { await context.close() }
}
try {
  for (const theme of ['dark','light']) for (const width of [360,768,1440]) for (const kind of ['library','trades']) await run(theme,width,kind)
  for (const width of [360,1440]) await run('dark',width,'library','many')
  for (const scenario of ['empty','running','failed']) await run('light',360,'library',scenario)
  for (const scenario of ['actual','running','failed']) await run('dark',360,'library',scenario,600)
  await run('light',320,'trades','actual',600)
  await run('dark',1440,'library','missing-dataset')
} finally {
  report.pass=report.cases.every(entry=>entry.pass)&&!report.errors.length
  await writeFile(new URL('qa.json',out),JSON.stringify(report,null,2)); await browser.close()
  console.log(JSON.stringify({pass:report.pass,cases:report.cases.length,failures:report.cases.filter(entry=>!entry.pass),errors:report.errors})); if(!report.pass)process.exitCode=1
}
