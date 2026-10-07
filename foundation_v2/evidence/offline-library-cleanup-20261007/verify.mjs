import assert from 'node:assert/strict'
import { chromium } from '../../web/node_modules/playwright/index.mjs'
import { writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

const origin='http://127.0.0.1:5180', href=origin+'/?workspace=tenant-a&view=market-data&mode=Practice&area=testing&section=market-data'
const fixture={dataset_id:'fixture-cleanup',instrument_id:'EURUSD',timeframe:'1h',timeframe_seconds:3600,row_count:2,source:{provider:'QA CSV',license_use:'fixture-only'},available_range:{from_utc:'2026-01-01T00:00:00Z',to_utc:'2026-01-01T01:00:00Z'},quality_status:'fixture',holdout_policy:{mode:'none'},instrument_spec:{account_ccy:'USD'}}
const report={cases:[],errors:[],blocked:[]}, browser=await chromium.launch({headless:true})
async function setup(width,theme,kind='real') {
  const context=await browser.newContext({viewport:{width,height:987}}), traffic=[]
  let rows=kind==='populated'?[fixture]:[], resolvePending, pending=false
  await context.addInitScript(theme=>{localStorage.setItem('tw-theme',theme);localStorage.setItem('tw-language','vi')},theme)
  await context.routeWebSocket('**/*',s=>s.close())
  await context.route('**/*',async route=>{
    const r=route.request(),u=new URL(r.url());if(u.pathname.startsWith('/api/'))traffic.push(r.method()+' '+u.pathname)
    if(u.origin!==origin || /^\/api\/v2\/(live|data\/market-assets)/.test(u.pathname)){report.blocked.push(r.url());return route.abort()}
    if(kind!=='real' && u.pathname==='/api/v2/data/datasets') return kind==='error'?route.fulfill({status:503,json:{detail:'Fixture catalog failure'}}):route.fulfill({json:{items:rows}})
    if(kind==='import' && u.pathname==='/api/v2/data/csv/preview'){
      pending=true;await new Promise(resolve=>{resolvePending=resolve});pending=false
      return route.fulfill({json:{preview:{...fixture,quality:{disposition:'pass'},unique_row_count:2}}})
    }
    if(kind==='import' && u.pathname==='/api/v2/data/csv/import'){
      pending=true;await new Promise(resolve=>{resolvePending=resolve});pending=false;rows=[fixture]
      return route.fulfill({json:{dataset:fixture}})
    }
    if(!['GET','HEAD','OPTIONS'].includes(r.method())){report.blocked.push(r.method()+' '+u.pathname);return route.abort()}
    return route.continue()
  })
  const page=await context.newPage();page.on('pageerror',e=>report.errors.push(String(e)));await page.goto(href);await page.getByTestId('data-desk-root').waitFor()
  return {page,context,traffic,pending:()=>pending,release:()=>resolvePending()}
}
async function screen(page,name){await page.screenshot({path:fileURLToPath(new URL(name+'.png',import.meta.url)),fullPage:true})}
async function run(name,fn){const item={name};report.cases.push(item);try{await fn(item);item.pass=true}catch(e){item.pass=false;item.failure=String(e)}}
try{
  for(const theme of ['dark','light'])for(const width of [360,1428])await run(`real-empty-${theme}-${width}`,async item=>{
    const s=await setup(width,theme);try{
      const root=s.page.getByTestId('data-desk-root');await root.locator('.data-library-count').getByText(/^0 /).waitFor()
      assert.equal(await root.getByTestId('data-desk-empty').count(),0)
      assert.equal(await root.locator('.data-library-disclosure,.data-library-paging,details').count(),0)
      assert.equal(await root.getByText('Chưa có dữ liệu offline. Nhập CSV để bắt đầu.').count(),0)
      await screen(s.page,item.name)
      const opener=root.locator('.data-library-import');await opener.focus();await s.page.keyboard.press('Enter')
      const dialog=s.page.getByRole('dialog',{name:'Nhập CSV',exact:true});await dialog.waitFor()
      assert(await s.page.getByTestId('data-desk-file-input').evaluate(e=>e===document.activeElement))
      item.geometry=await dialog.evaluate(e=>({left:e.getBoundingClientRect().left,right:e.getBoundingClientRect().right,width:innerWidth,overflow:e.scrollWidth-e.clientWidth,bodyOverflow:e.querySelector('.data-library-dialog-body').scrollWidth-e.querySelector('.data-library-dialog-body').clientWidth}))
      assert(item.geometry.left>=0 && item.geometry.right<=width);assert.equal(item.geometry.overflow,0);assert.equal(item.geometry.bodyOverflow,0)
      await screen(s.page,item.name+'-import');await s.page.keyboard.press('Escape');await dialog.waitFor({state:'hidden'});assert(await opener.evaluate(e=>e===document.activeElement))
      await opener.click();await dialog.waitFor();await dialog.getByRole('button',{name:'Đóng',exact:true}).click();await dialog.waitFor({state:'hidden'})
      item.traffic=s.traffic;assert(!s.traffic.some(x=>x.includes('/data/providers')))
    }finally{await s.context.close()}
  })
  await run('fixture-detail-filter-create-link',async item=>{
    const s=await setup(1428,'dark','populated');try{
      const row=s.page.getByTestId('dataset-row-'+fixture.dataset_id);await row.click()
      const dialog=s.page.getByRole('dialog',{name:'Chi tiết dữ liệu và chất lượng'});await dialog.waitFor();assert.match(await dialog.innerText(),/QA CSV/)
      const link=dialog.getByRole('link',{name:/Mở trong Research/});assert.match(await link.getAttribute('href'),/dataset=fixture-cleanup/)
      await s.page.keyboard.press('Escape');assert(await row.evaluate(e=>e===document.activeElement))
      const search=s.page.getByTestId('data-desk-root').getByRole('searchbox');await search.fill('missing');await s.page.getByText('Không có dữ liệu phù hợp bộ lọc.',{exact:true}).waitFor();assert.equal(await s.page.locator('.data-library-paging').count(),0)
      await search.fill('');await s.page.getByRole('button',{name:'Tạo phiên với EURUSD'}).click();const create=s.page.getByRole('dialog',{name:'Tạo phiên nhanh'});await create.waitFor();assert.match(await create.innerText(),/EURUSD/);await s.page.keyboard.press('Escape')
      await s.page.goto(href+'&dataset='+fixture.dataset_id);await dialog.waitFor();await screen(s.page,'fixture-deep-link');item.traffic=s.traffic
    }finally{await s.context.close()}
  })
  await run('fixture-error-import-remains-accessible',async item=>{
    const s=await setup(360,'light','error');try{await s.page.getByTestId('data-desk-retry').waitFor();await s.page.locator('.data-library-import').click();await s.page.getByTestId('data-desk-file-input').waitFor({state:'visible'});await s.page.keyboard.press('Escape');item.traffic=s.traffic}finally{await s.context.close()}
  })
  await run('fixture-import-pending-close-and-refresh',async item=>{
    const s=await setup(1428,'dark','import');try{
      await s.page.locator('.data-library-import').click();const dialog=s.page.getByRole('dialog',{name:'Nhập CSV',exact:true})
      await s.page.getByTestId('data-desk-file-input').setInputFiles({name:'fixture.csv',mimeType:'text/csv',buffer:Buffer.from('time,open,high,low,close\n2026-01-01T00:00:00Z,1,2,1,2\n2026-01-01T01:00:00Z,2,3,2,3')})
      await s.page.getByTestId('data-desk-preview-button').click();await s.page.waitForFunction(()=>document.querySelector('.data-library-dialog[aria-busy=true]'))
      assert(s.pending());assert(await dialog.getByRole('button',{name:'Đóng',exact:true}).isDisabled());await s.page.keyboard.press('Escape');assert(await dialog.isVisible());assert(await s.page.getByTestId('data-desk-file-input').isDisabled())
      s.release();await s.page.getByTestId('data-desk-quality-report').waitFor();await s.page.getByTestId('data-desk-import-button').click();await s.page.waitForFunction(()=>document.querySelector('.data-library-dialog[aria-busy=true]'));await s.page.keyboard.press('Escape');assert(await dialog.isVisible());s.release()
      await s.page.getByTestId('dataset-row-'+fixture.dataset_id).waitFor();await s.page.getByRole('dialog',{name:'Chi tiết dữ liệu và chất lượng'}).waitFor();assert.equal(await dialog.count(),0);item.traffic=s.traffic
    }finally{await s.context.close()}
  })
  report.pass=report.cases.every(c=>c.pass)&&!report.errors.length&&!report.blocked.length
}finally{await browser.close();await writeFile(new URL('verification.json',import.meta.url),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));if(!report.pass)process.exitCode=1}
