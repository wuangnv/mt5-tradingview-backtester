import assert from 'node:assert/strict'
import {chromium} from '../../../web/node_modules/playwright/index.mjs'
import {mkdir,writeFile} from 'node:fs/promises'
import {fileURLToPath} from 'node:url'
const origin='http://127.0.0.1:5180',out=new URL('./',import.meta.url)
await mkdir(out,{recursive:true});const browser=await chromium.launch(),report={cases:[],errors:[],scope:'Actual local cached GET plus isolated catalog refresh fixtures; no real writes/provider/live access'}
async function run(theme,width,mode='actual',touch=false){
 const c={theme,width,mode,touch};report.cases.push(c)
 const context=await browser.newContext({viewport:{width,height:987},hasTouch:touch});context.setDefaultTimeout(7000)
 await context.addInitScript(theme=>{localStorage.setItem('tw-theme',theme);localStorage.setItem('tw-language','vi')},theme)
 let posts=0,release
 const assets=[{instrument_id:'EURUSD',provider:'Dukascopy',provider_id:'dukascopy-catalog',asset_class:'fx'},{instrument_id:'XAUUSD',provider:'Dukascopy',provider_id:'dukascopy-catalog',asset_class:'metal'}]
 const catalog={configured:true,status:'cached',item_count:2,refresh_available:mode!=='cooldown',retry_after_seconds:mode==='cooldown'?2:0,retrieved_at_utc:'2026-10-07T00:00:00Z',stale:mode==='stale'}
 await context.routeWebSocket('**/*',socket=>socket.close())
 await context.route('**/*',async route=>{
  const req=route.request(),url=new URL(req.url())
  if(url.origin!==origin||/^\/api\/v2\/(live|data\/(market-assets|providers|categories))/.test(url.pathname))return route.abort()
  if(url.pathname==='/api/v2/data/catalog/refresh'){
   posts++;if(mode==='pending'||mode==='pending-error')await new Promise(resolve=>{release=resolve})
   return route.fulfill({status:mode==='failure'||mode==='pending-error'?503:200,contentType:'application/json',body:JSON.stringify(mode==='failure'||mode==='pending-error'?{detail:'fixture_failure'}:{catalog_items:assets,catalog_state:{...catalog,item_count:3,stale:false,retrieved_at_utc:'2026-10-08T12:00:00Z',...(mode==='rate-limit'?{error:'rate_limited',refresh_available:false,retry_after_seconds:300}:{})}})})
  }
  if(!['GET','HEAD','OPTIONS'].includes(req.method()))return route.abort()
  if(mode!=='actual'&&url.pathname==='/api/v2/data/datasets')return route.fulfill({contentType:'application/json',body:JSON.stringify({items:[],catalog_items:assets,catalog_state:catalog,download_state:{available:false}})})
  if(mode!=='actual'&&url.pathname==='/api/v2/data/downloads')return route.fulfill({contentType:'application/json',body:'{"items":[],"available":false}'})
  return route.continue()
 })
 const page=await context.newPage();page.on('pageerror',e=>report.errors.push(String(e)))
 try{
  await page.goto(`${origin}/?workspace=tenant-a&view=market-data&area=testing&section=market-data`)
  const opener=page.getByRole('button',{name:'Danh mục tài sản',exact:true}),drawer=page.getByRole('dialog',{name:'Danh mục tài sản',exact:true}),close=drawer.getByRole('button',{name:'Đóng',exact:true}),refresh=drawer.locator('.fxs-settings-save')
  await opener.waitFor();assert.equal(await page.locator('.data-library-filter-toggle').count(),1)
  await opener.hover();c.hover=await opener.evaluate(e=>({background:getComputedStyle(e).backgroundColor,decoration:getComputedStyle(e).textDecorationLine,border:getComputedStyle(e).borderWidth}))
  assert.equal(c.hover.background,'rgba(0, 0, 0, 0)');assert.equal(c.hover.decoration,'underline');assert.equal(c.hover.border,'0px')
  const more=page.locator('.data-library-more').first();c.more=await more.evaluate(e=>{const r=e.getBoundingClientRect();return {width:r.width,height:r.height,radius:getComputedStyle(e).borderRadius}});assert.equal(c.more.width,c.more.height);assert.equal(c.more.width,touch?44:36);assert.equal(c.more.radius,'50%')
  await opener.focus();await page.keyboard.press('Enter');assert.equal(posts,0)
  const bounds=await drawer.boundingBox();assert.equal(bounds.width,Math.min(680,width));assert.equal(bounds.x+bounds.width,width);assert.equal(bounds.y,0);assert.equal(bounds.height,987)
  assert.equal(await drawer.evaluate(e=>e.scrollWidth>e.clientWidth),false)
  await page.keyboard.press('Shift+Tab');assert.equal(await drawer.evaluate(e=>e.contains(document.activeElement)),true);await page.keyboard.press('Tab');assert.equal(await drawer.evaluate(e=>e.contains(document.activeElement)),true)
  if(mode==='cooldown'){assert.equal(await refresh.isDisabled(),true);await page.waitForFunction(()=>!document.querySelector('.fxs-settings-save').disabled,{},{timeout:4000});assert.equal(posts,0)}
  if(mode==='stale')assert.match(await drawer.innerText(),/đã cũ/)
  if(mode!=='actual'&&mode!=='cooldown'){
   await refresh.click()
   if(mode==='pending'||mode==='pending-error'){
    const overlay=drawer.locator('.data-library-update-overlay');await overlay.waitFor();assert.equal(await drawer.getAttribute('aria-busy'),'true');assert.equal(await close.isDisabled(),true);assert.equal(await drawer.locator('.fxs-settings-panel').getAttribute('inert'),'')
    assert.equal(await overlay.locator('progress').getAttribute('value'),null)
    await page.keyboard.press('Escape');assert.equal(await drawer.getAttribute('open'),'')
    if(width>680){await page.mouse.click(20,500);assert.equal(await drawer.getAttribute('open'),'')}
    await page.keyboard.press('Tab');assert.equal(await drawer.evaluate(e=>document.activeElement===e),true)
    await page.waitForFunction(()=>/Đã chờ [1-9]/.test(document.querySelector('.data-library-update-overlay')?.innerText||''))
    await page.screenshot({path:fileURLToPath(new URL(`final-busy-${mode}-${theme}-${width}.png`,out))});release()
   }
   await page.waitForFunction(()=>document.querySelector('.data-library-catalog-drawer')?.getAttribute('aria-busy')==='false')
   assert.equal(posts,1);assert.equal(await drawer.locator('.data-library-update-overlay').count(),0);assert.equal(await close.isDisabled(),false)
   if(mode==='failure'||mode==='pending-error')assert.match(await drawer.innerText(),/Không cập nhật được/)
   else if(mode==='rate-limit'){assert.match(await drawer.innerText(),/giới hạn yêu cầu/);assert.equal(await refresh.isDisabled(),true)}
   else {assert.match(await drawer.innerText(),/Đã cập nhật danh mục/);assert.equal(await drawer.locator('dd').nth(1).innerText(),'3')}
  }
  await page.screenshot({path:fileURLToPath(new URL(`final-${mode}-${theme}-${width}.png`,out))})
  await page.keyboard.press('Escape');await drawer.waitFor({state:'detached'});assert.equal(await opener.evaluate(e=>document.activeElement===e),true)
  await opener.click();if(width>680){await page.mouse.click(20,500);await drawer.waitFor({state:'detached'});assert.equal(await opener.evaluate(e=>document.activeElement===e),true)}else await close.click()
  if(mode==='success'){
   await page.getByRole('button',{name:'Hiện bộ lọc dữ liệu',exact:true}).click();await page.getByRole('button',{name:'Danh mục',exact:true}).click();await page.getByRole('option',{name:'Kim loại',exact:true}).click();assert.equal(await page.locator('.rd-table tbody tr').count(),1)
   await opener.click();await close.click();assert.equal(await page.locator('.rd-table tbody tr').count(),1)
   const csv=page.locator('.data-library-import');c.csvColor=await csv.evaluate(e=>getComputedStyle(e).backgroundColor);await csv.click();const csvDialog=page.getByRole('dialog',{name:'Nhập CSV',exact:true});await csvDialog.waitFor();await csvDialog.getByRole('button',{name:'Đóng',exact:true}).click()
  }
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);c.posts=posts;c.pass=true
 }catch(e){c.pass=false;c.error=String(e);await page.screenshot({path:fileURLToPath(new URL(`final-FAIL-${mode}-${theme}-${width}.png`,out))}).catch(()=>{})}
 finally{release?.();await context.close()}
}
try{for(const theme of ['dark','light'])for(const width of [360,768,1440])await run(theme,width);for(const mode of ['cooldown','stale','failure','rate-limit','pending','pending-error','success'])await run('dark',1440,mode);await run('light',360,'pending');await run('dark',360,'actual',true)}
finally{report.pass=report.cases.every(c=>c.pass)&&!report.errors.length;await writeFile(new URL('final-results.json',out),JSON.stringify(report,null,2));await browser.close();console.log(JSON.stringify({pass:report.pass,cases:report.cases.length,failures:report.cases.filter(c=>!c.pass),errors:report.errors}));if(!report.pass)process.exitCode=1}
