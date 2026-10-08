import assert from 'node:assert/strict'
import { chromium } from '../../../web/node_modules/playwright/index.mjs'
import { mkdir, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

const out=new URL('./',import.meta.url),origin='http://127.0.0.1:5180'
const actualOnly=process.argv.includes('--actual-only')
await mkdir(out,{recursive:true})
const browser=await chromium.launch({ignoreDefaultArgs:['--hide-scrollbars']})
const report={scope:'Independent UI state review. Actual local GET-only catalog plus explicitly labeled response fixtures; writes, external origins and WebSockets blocked.',cases:[],errors:[]}
const assets=['AAA','BBB','CCC'].map(instrument_id=>({instrument_id,name:'Fixture asset',provider:'Dukascopy',provider_id:'dukascopy-catalog',asset_class:'fx'}))
const saved={dataset_id:'fixture-saved',instrument_id:'BBB',provider:'Dukascopy',source:{provider:'Dukascopy',export_settings:'{"price":"bid"}'},asset_class:'fx',timeframe:'M1',timeframe_seconds:60,row_count:100,size_bytes:102400,first_timestamp:1704067200,last_timestamp:1704073140,quality_report:{disposition:'accepted',gaps:[],duplicate_count:0},created_at_utc:'2026-10-08T00:00:00Z'}
const style=locator=>locator.evaluate(el=>{const s=getComputedStyle(el),r=el.getBoundingClientRect();return {bg:s.backgroundColor,border:s.borderColor,borderWidth:s.borderWidth,color:s.color,radius:s.borderRadius,outline:s.outlineStyle,outlineWidth:s.outlineWidth,width:r.width,height:r.height}})
const stable=(a,b)=>{assert.equal(a.width,b.width,'hover changes width');assert.equal(a.height,b.height,'hover changes height');assert.equal(a.borderWidth,b.borderWidth,'hover changes border geometry')}
async function shot(page,name){await page.screenshot({path:fileURLToPath(new URL(name+'.png',out))})}
async function run(theme,width,fixture){
 const item={theme,width,fixture,checks:[]};report.cases.push(item)
 const context=await browser.newContext({viewport:{width,height:987}});context.setDefaultTimeout(8000)
 await context.addInitScript(theme=>{localStorage.setItem('tw-theme',theme);localStorage.setItem('tw-language','vi')},theme)
 const writes=[]
 await context.routeWebSocket('**/*',socket=>socket.close())
 await context.route('**/*',route=>{
  const req=route.request(),url=new URL(req.url())
  if(url.origin!==origin||url.pathname.startsWith('/api/v2/live'))return route.abort()
  if(!['GET','HEAD','OPTIONS'].includes(req.method())){writes.push(req.url());return route.abort()}
  if(fixture&&url.pathname==='/api/v2/data/datasets')return route.fulfill({json:{items:[saved],catalog_items:assets,catalog_state:{status:'cached',configured:true,refresh_available:true,item_count:3,retrieved_at_utc:'2026-10-08T00:00:00Z'},download_state:{available:true,supports_full:true,supported_instruments:['AAA','BBB','CCC'],earliest_dates:{AAA:'2003-05-04',BBB:'2003-05-04',CCC:'2003-05-04'}}}})
  if(fixture&&url.pathname==='/api/v2/data/downloads')return route.fulfill({json:{items:[],available:true,supports_pause:true}})
  return route.continue()
 })
 const page=await context.newPage();page.on('pageerror',e=>report.errors.push(String(e)))
 try{
  await page.goto(`${origin}/?workspace=tenant-a&view=market-data&area=testing&section=market-data`)
  await page.locator('.rd-table tbody tr').first().waitFor({timeout:15000})
  if(fixture){await page.evaluate(async()=>{for(const path of ['/src/AnalyticsWorkspace.jsx','/src/SessionPicker.jsx','/src/JournalWorkspace.jsx','/src/PlaybookWorkspace.jsx','/src/TradeWorkspace.jsx','/src/RiskWorkspace.jsx'])await import(path)});item.checks.push({name:'Library interaction assertions also run after loading other lazy route CSS'})}
  const searchInput=page.locator('.data-library-search input');await searchInput.evaluate(el=>el.blur());const inputBase=await style(searchInput)
  await searchInput.focus();await page.keyboard.press('Tab');await page.keyboard.press('Shift+Tab');await page.waitForTimeout(170);const inputFocus=await style(searchInput)
  assert(inputFocus.outline!=='none'||inputFocus.border!==inputBase.border,'keyboard search focus has no visible border/ring')
  item.checks.push({name:'Search keyboard focus visible',inputBase,inputFocus})
  await page.locator('.data-library-search input').fill(fixture?'AAA':'0005')
  const row=page.locator('.rd-table tbody tr').first(),download=row.locator('.data-library-download'),more=row.locator('.data-library-more')
  await download.scrollIntoViewIfNeeded();await page.mouse.move(0,0);await page.waitForTimeout(170)
  const base=await style(download);assert.equal(base.bg,'rgba(0, 0, 0, 0)','row Download should rest as ghost action')
  assert.equal((await style(more)).bg,'rgba(0, 0, 0, 0)','row ellipsis should rest as ghost action')
  await download.hover();await page.waitForTimeout(170)
  const hovered=await style(download),rowHover=await style(row)
  stable(base,hovered);assert.notEqual(hovered.bg,rowHover.bg,'Download hover swallowed by row hover')
  item.checks.push({name:'Nested Download hover distinct and no layout shift',base,hovered,row:rowHover})
  await shot(page,`${fixture?'fixture':'actual'}-${theme}-${width}-download`)
  await more.hover();await page.waitForTimeout(170);const moreHover=await style(more)
  assert.notEqual(moreHover.bg,(await style(row)).bg,'ellipsis hover swallowed by row hover')
  assert.equal(moreHover.width,moreHover.height,'icon target oval')
  await more.click();assert.equal(await more.getAttribute('aria-expanded'),'true')
  await page.mouse.move(0,0);const opened=await style(more)
  assert.notEqual(opened.bg,(await style(row)).bg,'open ellipsis loses state')
  await page.keyboard.press('Escape');assert.equal(await more.getAttribute('aria-expanded'),'false')
  assert.equal(await more.evaluate(el=>document.activeElement===el),true)
  await page.keyboard.press('Tab');await page.keyboard.press('Shift+Tab')
  const focused=await style(more);assert.notEqual(focused.outline,'none','keyboard focus invisible')
  item.checks.push({name:'Ellipsis round/open/focus',moreHover,opened,focused})
  if(fixture){
   await page.locator('.data-library-search input').fill('BBB')
   const savedRow=page.locator('.rd-table tbody tr').first(),disabled=savedRow.locator('.data-library-download')
   assert(await disabled.isDisabled());const before=await style(disabled);await disabled.hover();await page.waitForTimeout(170);stable(before,await style(disabled))
   await savedRow.locator('.data-library-more').click()
   const menu=page.getByRole('menu');assert(await menu.getByRole('menuitem',{name:'Cập nhật',exact:true}).isDisabled())
   await menu.getByRole('menuitem',{name:'Xoá',exact:true}).click()
   const dialog=page.getByRole('dialog',{name:'Xoá dữ liệu',exact:true}),danger=dialog.locator('.is-danger'),cancel=dialog.getByRole('button',{name:'Hủy',exact:true})
   const dangerBase=await style(danger);await danger.hover();await page.waitForTimeout(170);const dangerHover=await style(danger)
   assert.equal(dangerBase.color,'rgb(255, 255, 255)');assert.equal(dangerHover.color,dangerBase.color);assert.notEqual(dangerBase.bg,(await style(cancel)).bg);stable(dangerBase,dangerHover)
   item.checks.push({name:'Disabled update and filled danger',dangerBase,dangerHover})
   await shot(page,`fixture-${theme}-${width}-danger`);await page.keyboard.press('Escape')
  }
  if(!fixture){
   await page.locator('.data-library-search input').fill('EUR/USD')
   const progress=page.locator('.data-library-progress').first();await progress.waitFor();await progress.scrollIntoViewIfNeeded()
   await page.mouse.move(0,0);await page.waitForTimeout(170);const base=await style(progress)
   await progress.hover();await page.waitForTimeout(170);const hovered=await style(progress)
   stable(base,hovered);assert.notEqual(hovered.bg,base.bg,'progress hover never gains control surface');assert.notEqual(hovered.bg,await progress.evaluate(el=>getComputedStyle(el.closest('tr')).backgroundColor))
   await shot(page,'actual-dark-1710-progress');item.checks.push({name:'Actual paused progress distinct from row; resume/cancel untouched',base,hovered})
  }
  const catalog=page.locator('.data-library-catalog-trigger');await catalog.hover();await page.waitForTimeout(170)
  assert.equal((await style(catalog)).bg,'rgba(0, 0, 0, 0)')
  assert.match(await catalog.evaluate(el=>getComputedStyle(el).textDecorationLine),/underline/)
  await catalog.click();const drawer=page.getByRole('dialog',{name:'Danh mục tài sản',exact:true});await drawer.waitFor()
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,'page overflow')
  await shot(page,`${fixture?'fixture':'actual'}-${theme}-${width}-drawer`);await page.keyboard.press('Escape')
  await page.goto(`${origin}/?workspace=tenant-a&area=testing&ui_reference=1`);await page.locator('.wm-reference-controls').waitFor()
  const secondary=page.locator('.wm-reference-controls > button:not(:disabled)');const secondaryBase=await style(secondary)
  await secondary.hover();await page.waitForTimeout(170);stable(secondaryBase,await style(secondary))
  const disabledSecondary=page.locator('.wm-reference-controls > button:disabled');assert(await disabledSecondary.isDisabled())
  const select=page.locator('.wm-reference-controls .fx-select').first().locator('.fx-select-trigger');const selectBase=await style(select)
  await select.hover();await page.waitForTimeout(170);stable(selectBase,await style(select));await select.click();assert.equal(await select.getAttribute('aria-expanded'),'true')
  await page.keyboard.press('Escape');await shot(page,`reference-${theme}-${width}`)
  if(fixture){
   await page.goto(`${origin}/?workspace=tenant-a&view=overview&area=testing&section=dashboard&demo=1`)
   const card=page.locator('.fx-dashboard-session-card').first();await card.waitFor()
   const cardHead=card.locator('.fx-dashboard-session-card-head'),icon=card.locator('.fx-dashboard-card-icon').filter({has:page.locator('svg')}).nth(1)
   await icon.scrollIntoViewIfNeeded();await page.mouse.move(0,0);await page.waitForTimeout(170)
   const base=await style(icon);await icon.hover();await page.waitForTimeout(170)
   stable(base,await style(icon));assert.notEqual((await style(icon)).bg,(await style(cardHead)).bg)
   const deleteTrigger=card.locator('.fxs-action-button.is-danger');await page.mouse.move(0,0);await page.waitForTimeout(170);const deleteBase=await style(deleteTrigger)
   assert.equal(deleteBase.bg,theme==='dark'?'rgb(197, 62, 72)':'rgb(181, 55, 60)');assert.equal(deleteBase.color,'rgb(255, 255, 255)')
   await deleteTrigger.hover();await page.waitForTimeout(170);const deleteHover=await style(deleteTrigger)
   assert.equal(deleteHover.bg,theme==='dark'?'rgb(204, 65, 75)':'rgb(152, 41, 47)');assert.equal(deleteHover.color,'rgb(255, 255, 255)');stable(deleteBase,deleteHover)
   item.checks.push({name:'Enabled Dashboard danger red/white at rest and hover',deleteBase,deleteHover})
   await deleteTrigger.click()
   const dialog=page.getByRole('dialog',{name:'Xóa phiên',exact:true});await dialog.waitFor()
   assert(await dialog.locator('.fxs-delete-confirm').isDisabled())
   await shot(page,`dashboard-${theme}-${width}-dialog`);await page.keyboard.press('Escape')
   await page.goto(`${origin}/?workspace=tenant-a&view=trade&area=testing&section=trades&demo=1`)
   await page.locator('.fxa-table-scroll tbody tr').first().waitFor()
   const pager=page.locator('.wm-pagination');await pager.waitFor();assert(await pager.locator('[aria-current="page"]').count()>0)
   const detail=page.locator('.fxa-detail-button').first();await detail.scrollIntoViewIfNeeded();await detail.hover();await page.waitForTimeout(170)
   assert.notEqual((await style(detail)).bg,await detail.evaluate(el=>getComputedStyle(el.closest('tr')).backgroundColor))
   await shot(page,`trades-${theme}-${width}-hover`)
   item.checks.push({name:'Demo Dashboard nested icon/delete dialog and Trades detail/pager'})
  }
  assert.equal(writes.length,0);item.pass=true
 }catch(error){item.error=String(error);item.pass=false;await shot(page,`FAIL-${theme}-${width}-${fixture}`).catch(()=>{})}
 finally{await context.close()}
}
try{
 if(!actualOnly)for(const theme of ['dark','light'])for(const width of [1710,768,360])await run(theme,width,true)
 await run('dark',1710,false)
}finally{report.pass=report.cases.every(c=>c.pass)&&!report.errors.length;await writeFile(new URL(actualOnly?'actual-results.json':'results.json',out),JSON.stringify(report,null,2));await browser.close();console.log(JSON.stringify(report));if(!report.pass)process.exitCode=1}
