import assert from 'node:assert/strict'
import { chromium } from '../../web/node_modules/playwright/index.mjs'
import { writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

const origin='http://127.0.0.1:5180', href=origin+'/?workspace=tenant-a&view=market-data&area=testing&section=market-data'
const fixture=(id,symbol,category,provider='QA CSV')=>({dataset_id:id,instrument_id:symbol,timeframe:'1h',timeframe_seconds:3600,row_count:2,created_at_utc:'2026-01-01T00:00:00Z',source:{source_id:'qa:'+symbol,provider,license_use:'qa-only'},available_range:{from_utc:'2026-01-01T00:00:00Z',to_utc:'2026-01-01T01:00:00Z'},quality:{disposition:'pass'},quality_status:'fixture-only',holdout_policy:{mode:'none'},instrument_spec:{asset_class:category,base_ccy:'EUR',quote_ccy:'USD',account_ccy:'USD'}})
const datasets=[fixture('qa-eur','EURUSD','fx'),fixture('qa-gold','XAUUSD','metal'),fixture('qa-stock','AAPL','stock','QA secondary')]
const catalog=[{instrument_id:'GBPUSD',provider:'QA CSV',provider_id:'qa',asset_class:'fx',name:'Fixture metadata only'}]
const report={cases:[],errors:[],blocked:[]}, browser=await chromium.launch({headless:true})
async function setup(width,theme,kind='fixture',language='vi') {
  const context=await browser.newContext({viewport:{width,height:987}}), traffic=[]
  let rows=kind==='fixture'?datasets:[], resolvePending, pending=false, importedPayload
  await context.addInitScript(({theme,language})=>{localStorage.setItem('tw-theme',theme);localStorage.setItem('tw-language',language)},{theme,language})
  await context.routeWebSocket('**/*',s=>s.close())
  await context.route('**/*',async route=>{
    const r=route.request(),u=new URL(r.url());if(u.pathname.startsWith('/api/'))traffic.push(r.method()+' '+u.pathname)
    if(u.origin!==origin || /^\/api\/v2\/(live|data\/market-assets)/.test(u.pathname)){report.blocked.push(r.url());return route.abort()}
    if(kind!=='real' && u.pathname==='/api/v2/data/datasets') return kind==='error'?route.fulfill({status:503,json:{detail:'Fixture failure'}}):route.fulfill({json:{items:rows,catalog_items:kind==='fixture'?catalog:[]}})
    if(kind==='import' && u.pathname==='/api/v2/data/csv/preview'){
      pending=true;await new Promise(resolve=>{resolvePending=resolve});pending=false
      return route.fulfill({json:{preview:{...datasets[1],quality:{disposition:'pass'},unique_row_count:2}}})
    }
    if(kind==='import' && u.pathname==='/api/v2/data/csv/import'){
      importedPayload=r.postDataJSON();rows=[datasets[1]]
      return route.fulfill({json:{dataset:datasets[1]}})
    }
    if(!['GET','HEAD','OPTIONS'].includes(r.method())){report.blocked.push(r.method()+' '+u.pathname);return route.abort()}
    return route.continue()
  })
  const page=await context.newPage();page.on('pageerror',e=>report.errors.push(String(e)));await page.goto(href);await page.getByTestId('data-desk-root').waitFor()
  return {page,context,traffic,pending:()=>pending,release:()=>resolvePending(),payload:()=>importedPayload}
}
const screen=(page,name)=>page.screenshot({path:fileURLToPath(new URL(name+'.png',import.meta.url)),fullPage:true})
async function run(name,fn){const item={name};report.cases.push(item);try{await fn(item);item.pass=true}catch(e){item.pass=false;item.failure=String(e)}}
try{
  for(const [width,theme,language] of [[1710,'dark','vi'],[1260,'light','vi'],[768,'dark','vi'],[360,'light','vi'],[360,'dark','en']])await run(`fixture-layout-${theme}-${language}-${width}`,async item=>{
    const s=await setup(width,theme,'fixture',language);try{
      const root=s.page.getByTestId('data-desk-root'), table=root.getByTestId('data-desk-dataset-table')
      await table.locator('tbody tr').last().waitFor();assert.equal(await table.locator('tbody tr').count(),4)
      assert.equal(await root.locator('.data-library-count,.data-library-create').count(),0)
      assert.equal(await root.getByText('Tạo phiên',{exact:true}).count(),0)
      assert.equal(await table.locator('th').count(),7)
      item.geometry=await root.evaluate(e=>{
        const search=e.querySelector('.data-library-search').getBoundingClientRect(), controls=e.querySelector('.data-library-filters').getBoundingClientRect(), tool=e.querySelector('.data-library-toolbar').getBoundingClientRect(), clip=document.querySelector('.fx-content')
        return {searchLeft:search.left,toolbarLeft:tool.left,controlsRight:controls.right,toolbarRight:tool.right,overflow:clip.scrollWidth-clip.clientWidth}
      })
      assert.equal(Math.round(item.geometry.searchLeft),Math.round(item.geometry.toolbarLeft));assert.equal(Math.round(item.geometry.controlsRight),Math.round(item.geometry.toolbarRight));assert.equal(item.geometry.overflow,0)
      await screen(s.page,item.name)
      const toggle=root.locator('.data-library-filter-toggle');await toggle.click();await root.getByRole('button',{name:language==='en'?'Category':'Danh mục',exact:true}).waitFor()
      await screen(s.page,item.name+'-filters')
      const clipOverflow=await s.page.locator('.fx-content').evaluate(e=>e.scrollWidth-e.clientWidth);assert.equal(clipOverflow,0)
      await toggle.click();assert.equal(await toggle.getAttribute('aria-expanded'),'false')
      const scroll=root.locator('.rd-table-wrap');await scroll.evaluate(e=>e.scrollLeft=e.scrollWidth)
      const opener=table.locator('.data-library-more').first();await opener.click();const menu=s.page.getByRole('menu');await menu.waitFor()
      assert.equal(await s.page.getByRole('dialog').count(),0)
      const bounds=await menu.boundingBox();assert(bounds.x>=0 && bounds.x+bounds.width<=width)
      await screen(s.page,item.name+'-menu');await s.page.keyboard.press('End');assert(await menu.getByRole('menuitem').last().evaluate(e=>e===document.activeElement))
      await s.page.keyboard.press('Escape');await menu.waitFor({state:'hidden'});assert(await opener.evaluate(e=>e===document.activeElement))
      assert(await table.locator('.data-library-download').first().isDisabled());assert(await table.locator('.data-library-download').filter({hasText:language==='en'?'Download':'Tải về'}).last().isDisabled())
      item.traffic=s.traffic
    }finally{await s.context.close()}
  })
  await run('fixture-filter-sort-menu-update',async item=>{
    const s=await setup(1428,'dark');try{
      const root=s.page.getByTestId('data-desk-root');await root.locator('tbody tr').last().waitFor()
      await root.locator('.data-library-filter-toggle').click();await root.getByRole('button',{name:'Danh mục',exact:true}).click();await s.page.getByRole('option',{name:'Kim loại',exact:true}).click();assert.equal(await root.locator('tbody tr').count(),1)
      await root.getByRole('button',{name:'Nguồn dữ liệu',exact:true}).click();await s.page.getByRole('option',{name:'QA secondary',exact:true}).click();await root.getByTestId('data-desk-empty').waitFor()
      await root.locator('.data-library-filter-toggle').click();assert.equal(await root.locator('tbody tr').count(),4)
      await root.getByRole('button',{name:'Sắp xếp dữ liệu',exact:true}).click();await s.page.getByRole('option',{name:'Tên Z–A',exact:true}).click();assert.match(await root.locator('tbody tr').first().innerText(),/XAUUSD/)
      await root.getByRole('searchbox').fill('xau');assert.equal(await root.locator('tbody tr').count(),1)
      const opener=root.locator('.data-library-more');await opener.click();await s.page.getByRole('menuitem',{name:'Xem chi tiết',exact:true}).click();await s.page.getByRole('dialog',{name:'Chi tiết dữ liệu và chất lượng'}).waitFor();await s.page.keyboard.press('Escape');assert(await opener.evaluate(e=>e===document.activeElement))
      await opener.click();await s.page.getByRole('menuitem',{name:'Nhập bản cập nhật',exact:true}).click();const dialog=s.page.getByRole('dialog',{name:'Nhập CSV',exact:true});await dialog.waitFor()
      assert.equal(await dialog.locator('input[name=instrumentId]').inputValue(),'XAUUSD');assert.equal(await dialog.locator('select[name=assetClass]').inputValue(),'metal');assert.equal(await dialog.locator('input[name=provider]').inputValue(),'QA CSV');await s.page.keyboard.press('Escape')
      await opener.click();await root.getByRole('searchbox').click();assert.equal(await s.page.getByRole('menu').count(),0)
      item.traffic=s.traffic
    }finally{await s.context.close()}
  })
  for(const theme of ['dark','light']) await run(`real-empty-${theme}`,async item=>{
    const s=await setup(1428,theme,'real');try{
      const root=s.page.getByTestId('data-desk-root');await root.getByTestId('data-desk-dataset-table').waitFor();assert.equal(await root.locator('tbody tr').count(),0)
      assert.equal(await root.locator('.data-library-count,.data-library-paging').count(),0)
      await root.locator('.data-library-import').click();await s.page.getByTestId('data-desk-file-input').waitFor();await s.page.keyboard.press('Escape');await screen(s.page,item.name);item.traffic=s.traffic
    }finally{await s.context.close()}
  })
  await run('fixture-error-retry-import',async item=>{
    const s=await setup(360,'light','error');try{
      await s.page.getByTestId('data-desk-retry').waitFor();await s.page.getByTestId('data-desk-retry').click();await s.page.getByTestId('data-desk-retry').waitFor();await s.page.locator('.data-library-import').click();await s.page.getByTestId('data-desk-file-input').waitFor();await s.page.keyboard.press('Escape');item.traffic=s.traffic
    }finally{await s.context.close()}
  })
  await run('fixture-csv-pending-category-import',async item=>{
    const s=await setup(360,'dark','import');try{
      await s.page.locator('.data-library-import').click();const dialog=s.page.getByRole('dialog',{name:'Nhập CSV',exact:true});await dialog.locator('select[name=assetClass]').selectOption('metal');await dialog.locator('input[name=instrumentId]').fill('XAUUSD')
      await s.page.getByTestId('data-desk-file-input').setInputFiles({name:'fixture.csv',mimeType:'text/csv',buffer:Buffer.from('time,open,high,low,close\n2026-01-01T00:00:00Z,1,2,1,2\n2026-01-01T01:00:00Z,2,3,2,3')})
      await s.page.getByTestId('data-desk-preview-button').click();await s.page.waitForFunction(()=>document.querySelector('.data-library-dialog[aria-busy=true]'));assert(s.pending());assert(await dialog.getByRole('button',{name:'Đóng',exact:true}).isDisabled());await s.page.keyboard.press('Escape');assert(await dialog.isVisible());s.release()
      await s.page.getByTestId('data-desk-quality-report').waitFor();await s.page.getByTestId('data-desk-import-button').click();await s.page.getByRole('dialog',{name:'Chi tiết dữ liệu và chất lượng'}).waitFor();assert.equal(s.payload().instrument.asset_class,'metal');await s.page.keyboard.press('Escape');await s.page.getByTestId('dataset-row-qa-gold').waitFor();item.traffic=s.traffic
    }finally{await s.context.close()}
  })
  await run('real-dashboard-empty-notice-removed',async item=>{
    const s=await setup(1260,'dark','real');try{await s.page.goto(origin+'/?workspace=tenant-a&view=overview&area=testing&section=dashboard');await s.page.getByTestId('dashboard-data-state').waitFor();assert.equal(await s.page.getByText('Không có giao dịch đóng trong phạm vi này.',{exact:true}).count(),0);item.traffic=s.traffic}finally{await s.context.close()}
  })
  report.pass=report.cases.every(c=>c.pass)&&!report.errors.length&&!report.blocked.length
}finally{await browser.close();await writeFile(new URL('verification.json',import.meta.url),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));if(!report.pass)process.exitCode=1}
