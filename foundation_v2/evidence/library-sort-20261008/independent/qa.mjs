import assert from 'node:assert/strict'
import {chromium} from '../../../web/node_modules/playwright/index.mjs'
import {mkdir,writeFile} from 'node:fs/promises'
import {fileURLToPath} from 'node:url'
const origin='http://127.0.0.1:5180',out=new URL('./',import.meta.url)
await mkdir(out,{recursive:true});const browser=await chromium.launch(),report={cases:[],errors:[],scope:'Actual library cached GET and separate mixed-state browser GET fixtures; POST/DELETE/provider/live blocked'}
async function run(theme,width,lang,fixture){
 const c={theme,width,lang,fixture};report.cases.push(c)
 const ctx=await browser.newContext({viewport:{width,height:987}});ctx.setDefaultTimeout(7000)
 await ctx.addInitScript(({theme,lang})=>{localStorage.setItem('tw-theme',theme);localStorage.setItem('tw-language',lang)},{theme,lang})
 const assets=['AAA','BBB','CCC','DDD'].map(instrument_id=>({instrument_id,provider:'Dukascopy',provider_id:'dukascopy-catalog',asset_class:'fx'}))
 const datasets=[{...assets[3],dataset_id:'ddd',timeframe:'M1',source:{provider:'Dukascopy'},created_at_utc:'2026-10-08T00:00:00Z'},{...assets[1],dataset_id:'bbb',timeframe:'M1',source:{provider:'Dukascopy'},created_at_utc:'2026-10-07T00:00:00Z'}]
 const mutations=[]
 await ctx.routeWebSocket('**/*',s=>s.close())
 await ctx.route('**/*',route=>{
  const req=route.request(),url=new URL(req.url())
  if(url.origin!==origin||/^\/api\/v2\/(live|data\/(providers|market-assets|categories))/.test(url.pathname))return route.abort()
  if(!['GET','HEAD','OPTIONS'].includes(req.method())){mutations.push(req.url());return route.abort()}
  if(fixture&&url.pathname==='/api/v2/data/datasets')return route.fulfill({contentType:'application/json',body:JSON.stringify({items:datasets,catalog_items:assets,catalog_state:{configured:true,status:'cached',item_count:4,refresh_available:false,retrieved_at_utc:'2026-10-08T00:00:00Z'},download_state:{available:false}})})
  if(fixture&&url.pathname==='/api/v2/data/downloads')return route.fulfill({contentType:'application/json',body:'{"items":[],"available":false}'})
  return route.continue()
 })
 const page=await ctx.newPage();page.on('pageerror',e=>report.errors.push(String(e)))
 try{
  await page.goto(`${origin}/?workspace=tenant-a&view=market-data&area=testing&section=market-data`)
  const trigger=page.locator('.data-library-sort > button'),popup=page.locator('.data-library-sort .fx-select-menu')
  await trigger.waitFor();await page.locator('.rd-table thead').waitFor({timeout:15000});await trigger.click();await popup.waitFor()
  const labels=await popup.getByRole('option').allInnerTexts();c.labels=labels
  assert.deepEqual(labels.map(s=>s.replace(/\s*✓$/,'')),lang==='vi'?['Tên A–Z','Tên Z–A','Đã tải','Chưa tải','Mới cập nhật']:['Name A–Z','Name Z–A','Downloaded','Not downloaded','Recently updated'])
  c.geometry=await popup.evaluate(e=>{const r=e.getBoundingClientRect(),a=e.parentElement.querySelector('button').getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,right:r.right,height:r.height,anchorRight:a.right,overflow:e.scrollWidth>e.clientWidth}})
  assert(c.geometry.width>=176);assert(c.geometry.x>=0&&c.geometry.right<=width+1);assert.equal(c.geometry.overflow,false);assert(Math.abs(c.geometry.right-c.geometry.anchorRight)<1)
  await page.screenshot({path:fileURLToPath(new URL(`sort-${fixture?'fixture':'actual'}-${theme}-${width}-${lang}.png`,out))})
  await page.keyboard.press('Escape');assert.equal(await popup.count(),0);assert.equal(await trigger.evaluate(e=>document.activeElement===e),true)
  if(fixture){
   const expected=[['AAA','BBB','CCC','DDD'],['DDD','CCC','BBB','AAA'],['BBB','DDD','AAA','CCC'],['AAA','CCC','BBB','DDD'],['DDD','BBB','AAA','CCC']]
   for(let i=0;i<5;i++){await trigger.click();await popup.getByRole('option').nth(i).click();assert.deepEqual(await page.locator('.rd-table tbody tr > td:first-child strong').allInnerTexts(),expected[i]);assert.equal(await page.locator('.rd-table tbody tr').count(),4)}
   await trigger.focus();await page.keyboard.press('ArrowDown');await page.keyboard.press('Home');await page.keyboard.press('Enter');assert.deepEqual(await page.locator('.rd-table tbody tr > td:first-child strong').allInnerTexts(),expected[0])
  }
  assert.equal(mutations.length,0);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);c.pass=true
 }catch(e){c.pass=false;c.error=String(e);await page.screenshot({path:fileURLToPath(new URL(`FAIL-${fixture?'fixture':'actual'}-${theme}-${width}-${lang}.png`,out))}).catch(()=>{})}
 finally{await ctx.close()}
}
try{for(const theme of ['dark','light'])for(const [width,lang] of [[1710,'vi'],[360,'en']])for(const fixture of [false,true])await run(theme,width,lang,fixture)}
finally{report.pass=report.cases.every(c=>c.pass)&&!report.errors.length;await writeFile(new URL('results.json',out),JSON.stringify(report,null,2));await browser.close();console.log(JSON.stringify({pass:report.pass,cases:report.cases.length,failures:report.cases.filter(c=>!c.pass),errors:report.errors}));if(!report.pass)process.exitCode=1}
