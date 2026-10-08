import assert from 'node:assert/strict'
import {chromium} from '../../web/node_modules/playwright/index.mjs'
import {writeFile} from 'node:fs/promises'
import {fileURLToPath} from 'node:url'
const origin='http://127.0.0.1:5180',out=new URL('./',import.meta.url),browser=await chromium.launch()
const report={cases:[],errors:[],scope:'Actual cached catalog GET; refresh behavior uses separate delayed fixtures. No real provider request/data mutation.'}
async function run(theme,width,lang='vi',mode='actual',touch=false){
 const entry={theme,width,lang,mode,touch};report.cases.push(entry)
 const context=await browser.newContext({viewport:{width,height:987},hasTouch:touch})
 await context.addInitScript(({theme,lang})=>{localStorage.setItem('tw-theme',theme);localStorage.setItem('tw-language',lang)},{theme,lang})
 let release,posts=0
 const catalog={configured:true,status:'cached',item_count:2,retrieved_at_utc:'2026-10-07T12:00:00Z',refresh_available:mode!=='cooldown',retry_after_seconds:mode==='cooldown'?1:0,stale:false,error:null}
 const items=[{instrument_id:'EUR/USD',provider:'Dukascopy',asset_class:'fx',provider_id:'dukascopy-catalog'},{instrument_id:'XAU/USD',provider:'Dukascopy',asset_class:'metal',provider_id:'dukascopy-catalog'}]
 await context.routeWebSocket('**/*',socket=>socket.close())
 await context.route('**/*',async route=>{
  const request=route.request(),url=new URL(request.url())
  if(url.origin!==origin||/^\/api\/v2\/(live|data\/(market-assets|providers))/.test(url.pathname))return route.abort()
  if(mode!=='actual'&&url.pathname==='/api/v2/data/datasets')return route.fulfill({json:{items:[],catalog_items:items,catalog_state:catalog}})
  if(mode!=='actual'&&url.pathname==='/api/v2/data/downloads')return route.fulfill({json:{items:[],available:false}})
  if(url.pathname==='/api/v2/data/catalog/refresh'&&request.method()==='POST'){
   posts++;if(mode==='actual')return route.abort()
   await new Promise(resolve=>release=resolve)
   if(mode==='failure')return route.fulfill({status:503,json:{detail:'source_unavailable'}})
   return route.fulfill({json:{catalog_items:items,catalog_state:{...catalog,retrieved_at_utc:'2026-10-08T12:00:00Z',refresh_available:false,retry_after_seconds:1,error:mode==='rate-limit'?'rate_limited':null}}})
  }
  if(!['GET','HEAD','OPTIONS'].includes(request.method()))return route.abort()
  return route.continue()
 })
 const page=await context.newPage();page.on('pageerror',e=>report.errors.push(String(e)))
 const vi=lang==='vi'
 try{
  await page.goto(`${origin}/?workspace=tenant-a&view=market-data&area=testing&section=market-data`)
  const trigger=page.getByRole('button',{name:vi?'Danh mục tài sản':'Asset catalog',exact:true}),drawer=page.getByRole('dialog',{name:vi?'Danh mục tài sản':'Asset catalog',exact:true})
  await trigger.waitFor();await trigger.hover()
  const style=await trigger.evaluate(e=>{const s=getComputedStyle(e);return {bg:s.backgroundColor,decoration:s.textDecorationLine}});assert.equal(style.bg,'rgba(0, 0, 0, 0)');assert.equal(style.decoration,'underline')
  const more=page.locator('.data-library-more').first();await more.hover();const rect=await more.boundingBox();assert.equal(rect.width,rect.height);assert.equal(rect.width,touch?44:36)
  const csv=page.getByRole('button',{name:vi?'Nhập CSV':'Import CSV',exact:true});assert.equal(await csv.evaluate(e=>{const p=document.createElement('i');p.style.color='var(--wm-action-bg)';e.append(p);const token=getComputedStyle(p).color;p.remove();return getComputedStyle(e).backgroundColor===token}),true)
  await page.getByRole('button',{name:vi?'Hiện bộ lọc dữ liệu':'Show data filters',exact:true}).click()
  await page.getByRole('button',{name:vi?'Danh mục':'Category',exact:true}).click();await page.keyboard.press('Escape')
  await trigger.focus();await page.keyboard.press('Tab');await page.keyboard.press('Shift+Tab');assert.equal(await trigger.evaluate(e=>getComputedStyle(e).outlineStyle),'solid')
  await page.keyboard.press('Enter');await drawer.waitFor();assert.equal(posts,0)
  const bounds=await drawer.boundingBox();assert.equal(Math.round(bounds.width),Math.min(680,width));assert.equal(Math.round(bounds.x+bounds.width),width);assert.equal(Math.round(bounds.height),987);assert.equal(Math.round(bounds.y),0)
  const close=drawer.getByRole('button',{name:vi?'Đóng':'Close',exact:true}),refresh=drawer.getByRole('button',{name:vi?'Cập nhật danh mục':'Update catalog',exact:true})
  if(mode==='cooldown'){assert.equal(await refresh.isDisabled(),true);await drawer.getByText(vi?'Vui lòng chờ trước khi cập nhật lại.':'Please wait before updating again.',{exact:true}).waitFor();await page.waitForFunction(()=>!document.querySelector('.data-library-catalog-drawer .fxs-settings-save').disabled)}
  if(!['actual','cooldown'].includes(mode)){
   await refresh.click();await drawer.locator('.data-library-update-overlay').waitFor()
   assert.equal(await drawer.getAttribute('aria-busy'),'true');assert.equal(await drawer.locator('.fxs-settings-panel').getAttribute('inert'),'');assert.equal(await drawer.locator('.fxs-drawer-close').isDisabled(),true)
   assert.equal(await drawer.getByRole('progressbar').getAttribute('value'),null)
   await page.keyboard.press('Tab');assert.equal(await drawer.evaluate(e=>document.activeElement===e),true)
   await page.keyboard.press('Escape');assert.equal(await drawer.isVisible(),true)
   if(width>680){await page.mouse.click(10,400);assert.equal(await drawer.isVisible(),true)}
   await drawer.getByText(vi?'Đã chờ 1 giây':'Elapsed: 1 s',{exact:true}).waitFor()
   await page.screenshot({path:fileURLToPath(new URL(`final-busy-${theme}-${width}-${mode}.png`,out))})
   release();await drawer.locator('.data-library-update-overlay').waitFor({state:'detached'})
   const message=mode==='failure'?(vi?'Không cập nhật được danh sách Dukascopy.':'Could not update the Dukascopy instrument list.'):mode==='rate-limit'?(vi?'Dukascopy đang giới hạn yêu cầu. Hãy thử lại sau.':'Dukascopy is rate limiting requests. Try again later.'):(vi?'Đã cập nhật danh mục.':'Catalog updated.')
   await drawer.getByText(message,{exact:true}).waitFor();assert.equal(await close.isEnabled(),true);assert.equal(posts,1)
  }
  await page.screenshot({path:fileURLToPath(new URL(`final-${mode}-${theme}-${lang}-${width}.png`,out))})
  assert.equal(await drawer.evaluate(e=>e.scrollWidth<=e.clientWidth),true)
  await close.focus();await page.keyboard.press('Shift+Tab');assert.equal(await page.evaluate(()=>document.activeElement.closest('dialog')!==null),true)
  await page.keyboard.press('Escape');await drawer.waitFor({state:'detached'});assert.equal(await trigger.evaluate(e=>document.activeElement===e),true)
  await csv.click();const csvDialog=page.getByRole('dialog',{name:vi?'Nhập CSV':'Import CSV',exact:true});await csvDialog.waitFor();await page.keyboard.press('Escape');await csvDialog.waitFor({state:'detached'})
  if(mode==='actual' && width===1440){await more.hover();await page.screenshot({path:fileURLToPath(new URL(`final-toolbar-${theme}.png`,out))})}
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);entry.pass=true;entry.posts=posts
 }catch(e){entry.pass=false;entry.error=String(e);await page.screenshot({path:fileURLToPath(new URL(`final-FAIL-${mode}-${theme}-${lang}-${width}.png`,out))}).catch(()=>{})}
 finally{release?.();await context.close()}
}
try{for(const theme of ['dark','light'])for(const width of [360,768,1440])await run(theme,width,width===768?'en':'vi');await run('dark',360,'vi','actual',true);await run('dark',1440,'vi','success');await run('light',360,'en','success');await run('dark',1440,'vi','failure');await run('light',768,'en','rate-limit');await run('dark',1440,'vi','cooldown')}
finally{report.pass=report.cases.every(e=>e.pass)&&!report.errors.length;await writeFile(new URL('final-results.json',out),JSON.stringify(report,null,2));await browser.close();console.log(JSON.stringify(report));if(!report.pass)process.exitCode=1}
