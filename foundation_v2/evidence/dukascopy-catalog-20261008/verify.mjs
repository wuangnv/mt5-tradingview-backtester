import assert from 'node:assert/strict'
import { chromium } from '../../web/node_modules/playwright/index.mjs'
import { writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

const origin='http://127.0.0.1:5180', href=origin+'/?workspace=tenant-a&view=market-data&area=testing&section=market-data'
const instruments=['EUR/USD','XAU/USD'].map(instrument_id=>({instrument_id,name:'QA metadata only',provider:'Dukascopy',provider_id:'dukascopy-catalog',asset_class:''}))
const cached={provider_id:'dukascopy-catalog',configured:true,status:'cached',retrieved_at_utc:'2026-10-08T00:00:00Z',item_count:2,stale:false,error:null,refresh_available:true,retry_after_seconds:0}
const report={cases:[],errors:[],blocked:[]}, browser=await chromium.launch()
async function setup(width,theme,kind){
  const context=await browser.newContext({viewport:{width,height:987}})
  await context.addInitScript(theme=>{localStorage.setItem('tw-theme',theme);localStorage.setItem('tw-language','vi')},theme)
  const posts=[]
  let catalog=kind==='missing'?{...cached,configured:false,status:'empty',item_count:0,refresh_available:false}:kind==='bootstrap'?{...cached,status:'empty',item_count:0}: {...cached,stale:kind==='stale'}
  await context.routeWebSocket('**/*',s=>s.close())
  await context.route('**/*',async route=>{
    const r=route.request(),u=new URL(r.url())
    if(u.origin!==origin||/^\/api\/v2\/live\//.test(u.pathname)){report.blocked.push(r.url());return route.abort()}
    if(kind!=='real' && u.pathname==='/api/v2/data/datasets')return route.fulfill({json:{items:[],catalog_items:catalog.status==='cached'?instruments:[],catalog_state:catalog}})
    if(kind!=='real' && u.pathname==='/api/v2/data/catalog/refresh' && r.method()==='POST'){
      posts.push(r.url());catalog=kind==='failed'?{...cached,error:'rate_limited',refresh_available:false,retry_after_seconds:1}:cached
      return route.fulfill({json:{catalog_items:instruments,catalog_state:catalog}})
    }
    if(!['GET','HEAD','OPTIONS'].includes(r.method())){report.blocked.push(r.method()+' '+r.url());return route.abort()}
    return route.continue()
  })
  const page=await context.newPage();page.on('pageerror',e=>report.errors.push(String(e)));await page.goto(href)
  await page.getByTestId('data-desk-dataset-table').waitFor()
  return {page,context,posts}
}
async function run(name,fn){const item={name};report.cases.push(item);try{await fn(item);item.pass=true}catch(e){item.pass=false;item.failure=String(e)}}
const screen=(page,name)=>page.screenshot({path:fileURLToPath(new URL(name+'.png',import.meta.url)),fullPage:true})
try{
  for(const width of [1710,360]) for(const theme of ['dark','light']) await run(`real-missing-key-${width}-${theme}`,async item=>{
    const s=await setup(width,theme,'real');try{
      await s.page.getByText('Chưa cấu hình Dukascopy API key.',{exact:true}).waitFor()
      assert(await s.page.getByRole('button',{name:'Cập nhật danh sách',exact:true}).isDisabled())
      assert.equal(await s.page.locator('tbody tr').count(),0)
      assert.equal(await s.page.locator('.fx-content').evaluate(e=>e.scrollWidth-e.clientWidth),0)
      await screen(s.page,item.name)
    }finally{await s.context.close()}
  })
  for(const kind of ['cached','stale','bootstrap','failed']) await run(`fixture-${kind}`,async item=>{
    const s=await setup(kind==='stale'?360:1710,'dark',kind);try{
      await s.page.locator('tbody tr').last().waitFor();assert.equal(await s.page.locator('tbody tr').count(),2)
      if(kind==='bootstrap')assert.equal(s.posts.length,1)
      else assert.equal(s.posts.length,0)
      assert.equal(await s.page.locator('tbody tr').first().getByText('Chưa phân loại',{exact:true}).count(),1)
      assert.equal(await s.page.locator('tbody tr').first().getByText('Chưa tải',{exact:true}).count(),1)
      assert(await s.page.locator('.data-library-download').first().isDisabled())
      await s.page.getByRole('searchbox').fill('EUR');assert.equal(await s.page.locator('tbody tr').count(),1)
      await s.page.getByRole('searchbox').fill('')
      if(kind==='failed'){
        const update=s.page.getByRole('button',{name:'Cập nhật danh sách',exact:true});await update.click()
        await s.page.getByText('Dukascopy đang giới hạn yêu cầu. Hãy thử lại sau.',{exact:false}).waitFor()
        assert(await update.isDisabled());assert.equal(await s.page.locator('tbody tr').count(),2)
        await update.waitFor();await s.page.waitForTimeout(1200);assert(await update.isEnabled())
        assert.equal(s.posts.length,1)
      }
      if(kind==='cached'){await s.page.reload();await s.page.locator('tbody tr').last().waitFor();assert.equal(s.posts.length,0)}
      await screen(s.page,item.name);item.posts=s.posts.length
    }finally{await s.context.close()}
  })
}finally{await browser.close()}
await writeFile(new URL('verification.json',import.meta.url),JSON.stringify(report,null,2))
console.log(JSON.stringify({passed:report.cases.filter(x=>x.pass).length,total:report.cases.length,failures:report.cases.filter(x=>!x.pass),errors:report.errors,blocked:report.blocked}))
if(report.errors.length||report.blocked.length||report.cases.some(x=>!x.pass))process.exitCode=1
