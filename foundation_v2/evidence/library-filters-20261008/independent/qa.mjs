import assert from 'node:assert/strict'
import {chromium} from '../../../web/node_modules/playwright/index.mjs'
import {mkdir,writeFile} from 'node:fs/promises'
import {fileURLToPath} from 'node:url'
const origin='http://127.0.0.1:5180',out=new URL('./',import.meta.url)
await mkdir(out,{recursive:true});const browser=await chromium.launch(),report={cases:[],errors:[],scope:'Actual cached GET plus controlled category/source/status fixture; all mutations/provider/live blocked'}
async function run(theme,width,lang,fixture){
 const c={theme,width,lang,fixture};report.cases.push(c)
 const ctx=await browser.newContext({viewport:{width,height:987}});ctx.setDefaultTimeout(7000)
 await ctx.addInitScript(({theme,lang})=>{localStorage.setItem('tw-theme',theme);localStorage.setItem('tw-language',lang)},{theme,lang})
 const assets=Array.from({length:32},(_,i)=>({instrument_id:`A${String(i).padStart(2,'0')}`,name:`Asset ${i}`,provider:i%2?'local-csv':'Dukascopy',provider_id:i%2?'local-csv':'dukascopy-catalog',asset_class:i%4<2?'fx':'metal'}))
 const datasets=assets.filter((_,i)=>i%3===0).map((a,i)=>({...a,dataset_id:`d${a.instrument_id}`,timeframe:'M1',created_at_utc:`2026-10-${String(i+1).padStart(2,'0')}T00:00:00Z`,source:{provider:a.provider}}))
 const mutations=[]
 await ctx.routeWebSocket('**/*',s=>s.close())
 await ctx.route('**/*',route=>{
  const req=route.request(),url=new URL(req.url())
  if(url.origin!==origin||/^\/api\/v2\/(live|data\/(providers|market-assets|categories))/.test(url.pathname))return route.abort()
  if(!['GET','HEAD','OPTIONS'].includes(req.method())){mutations.push(req.url());return route.abort()}
  if(fixture&&url.pathname==='/api/v2/data/datasets')return route.fulfill({contentType:'application/json',body:JSON.stringify({items:datasets,catalog_items:assets,catalog_state:{configured:true,status:'cached',item_count:32,refresh_available:false,retrieved_at_utc:'2026-10-08T00:00:00Z'},download_state:{available:false}})})
  if(fixture&&url.pathname==='/api/v2/data/downloads')return route.fulfill({contentType:'application/json',body:'{"items":[],"available":false}'})
  return route.continue()
 })
 const page=await ctx.newPage();page.on('pageerror',e=>report.errors.push(String(e)))
 const names=lang==='vi'?['Danh mục','Nguồn dữ liệu','Trạng thái tải','Sắp xếp dữ liệu']:['Category','Data source','Download status','Sort data']
 const toolbar=page.locator('.data-library-toolbar'),select=n=>toolbar.getByRole('button',{name:names[n],exact:true}),rows=page.locator('.rd-table tbody tr')
 const choose=async(n,value)=>{await select(n).click();await page.getByRole('option',{name:value,exact:true}).click()}
 const ids=()=>rows.locator('td:first-child strong').allInnerTexts()
 try{
  await page.goto(`${origin}/?workspace=tenant-a&view=market-data&area=testing&section=market-data`);await page.locator('.rd-table thead').waitFor({timeout:15000})
  assert.equal(await page.locator('.data-library-filter-toggle').count(),0)
  assert.deepEqual(await toolbar.locator('.fx-select > button').evaluateAll(els=>els.map(e=>e.getAttribute('aria-label'))),names)
  await select(2).click();assert.deepEqual((await toolbar.locator('.fx-select').nth(2).getByRole('option').allInnerTexts()).map(s=>s.replace(/\s*✓$/,'')),lang==='vi'?['Tất cả trạng thái','Đã tải','Chưa tải']:['All statuses','Downloaded','Not downloaded']);await page.keyboard.press('Escape')
  await select(3).click();const menu=toolbar.locator('.data-library-sort .fx-select-menu');assert.deepEqual((await menu.getByRole('option').allInnerTexts()).map(s=>s.replace(/\s*✓$/,'')),lang==='vi'?['Tên A–Z','Tên Z–A','Mới cập nhật']:['Name A–Z','Name Z–A','Recently updated']);const b=await menu.boundingBox();assert(b.x>=0&&b.x+b.width<=width+1);await page.keyboard.press('Escape')
  await page.screenshot({path:fileURLToPath(new URL(`${fixture?'fixture':'actual'}-${theme}-${width}-${lang}.png`,out))})
  if(fixture){
   await page.locator('.wm-pagination-size button').click();await page.getByRole('option',{name:'10',exact:true}).click();await page.locator('.wm-pagination-pages > button:nth-last-child(2)').click();assert.equal(await page.locator('.wm-pagination-number.is-current').innerText(),'2')
   await choose(2,lang==='vi'?'Đã tải':'Downloaded');assert.equal(await page.locator('.wm-pagination-number.is-current').innerText(),'1');assert((await ids()).every(id=>datasets.some(d=>d.instrument_id===id)));await page.locator('.wm-pagination-pages > button:nth-last-child(2)').click();assert.equal(await rows.count(),1)
   await choose(2,lang==='vi'?'Chưa tải':'Not downloaded');assert.equal(await page.locator('.wm-pagination-number.is-current').innerText(),'1');assert((await ids()).every(id=>!datasets.some(d=>d.instrument_id===id)))
   await choose(2,lang==='vi'?'Tất cả trạng thái':'All statuses');assert.equal(await rows.count(),10)
   await choose(0,'Forex');await choose(1,'local-csv');await choose(2,lang==='vi'?'Đã tải':'Downloaded');assert.deepEqual(await ids(),['A09','A21'])
   await choose(3,lang==='vi'?'Tên Z–A':'Name Z–A');assert.deepEqual(await ids(),['A21','A09']);await choose(3,lang==='vi'?'Mới cập nhật':'Recently updated');assert.deepEqual(await ids(),['A21','A09'])
   const search=toolbar.locator('input[type=search]');await search.fill('A09');assert.deepEqual(await ids(),['A09']);await search.fill('NO-MATCH');assert.equal(await rows.count(),0);assert.equal(await page.locator('[data-testid=data-desk-empty]').count(),1);assert.equal(await page.locator('.wm-pagination-number.is-current').innerText(),'1');await search.fill('')
   const opener=toolbar.locator('.data-library-catalog-trigger').first(),drawer=page.locator('.data-library-catalog-drawer'),internal=drawer.getByRole('button',{name:lang==='vi'?'Nguồn dữ liệu':'Data source',exact:true})
   await opener.click();assert.match(await internal.innerText(),/local-csv/);await internal.click();await drawer.getByRole('option',{name:'Dukascopy',exact:true}).click();await page.keyboard.press('Escape');assert.match(await select(1).innerText(),/local-csv/);assert.deepEqual(await ids(),['A21','A09'])
   await choose(1,'Dukascopy');assert.deepEqual(await ids(),['A24','A12','A00']);await opener.click();assert.match(await internal.innerText(),/Dukascopy/);await page.keyboard.press('Escape')
  }
  assert.equal(mutations.length,0);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);c.pass=true
 }catch(e){c.pass=false;c.error=String(e);await page.screenshot({path:fileURLToPath(new URL(`FAIL-${fixture?'fixture':'actual'}-${theme}-${width}-${lang}.png`,out))}).catch(()=>{})}
 finally{await ctx.close()}
}
try{for(const theme of ['dark','light'])for(const [width,lang] of [[1710,'vi'],[360,'en']])for(const fixture of [false,true])await run(theme,width,lang,fixture)}
finally{report.pass=report.cases.every(c=>c.pass)&&!report.errors.length;await writeFile(new URL('results.json',out),JSON.stringify(report,null,2));await browser.close();console.log(JSON.stringify({pass:report.pass,cases:report.cases.length,failures:report.cases.filter(c=>!c.pass),errors:report.errors}));if(!report.pass)process.exitCode=1}
