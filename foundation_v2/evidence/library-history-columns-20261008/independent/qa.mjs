import assert from 'node:assert/strict'
import {chromium} from '../../../web/node_modules/playwright/index.mjs'
import {mkdir,writeFile} from 'node:fs/promises'
import {fileURLToPath} from 'node:url'
const out=new URL('./',import.meta.url),origin='http://127.0.0.1:5180'
await mkdir(out,{recursive:true})
const browser=await chromium.launch({ignoreDefaultArgs:['--hide-scrollbars']})
const report={scope:'Actual GET-only catalog and labeled saved/unknown metadata fixtures. No backend writes, provider refresh/download or WebSockets.',cases:[],errors:[]}
const assets=Array.from({length:30},(_,i)=>({instrument_id:`CAT${String(i).padStart(3,'0')}`,name:'Fixture catalog asset',provider:'Dukascopy',provider_id:'dukascopy-catalog',asset_class:'fx'}))
assets.push({instrument_id:'ZZZZ',name:'Fixture unknown availability',provider:'CSV',provider_id:'fixture-csv',asset_class:'stock'})
const saved={dataset_id:'fixture-saved',instrument_id:'A000',timeframe:'M1',timeframe_seconds:60,row_count:100,size_bytes:102400,first_timestamp:1704067200,last_timestamp:1704153600,source:{provider:'Dukascopy',export_settings:'{"price":"bid"}'},asset_class:'fx',created_at_utc:'2026-10-08T00:00:00Z'}
async function footerGeometry(page){return page.evaluate(()=>{const wrap=document.querySelector('.data-library .rd-table-wrap'),footer=document.querySelector('.data-library .wm-pagination'),r=wrap.getBoundingClientRect(),f=footer.getBoundingClientRect();return {wrapBottom:getComputedStyle(wrap).borderBottomWidth,footerTop:getComputedStyle(footer).borderTopWidth,wrapY:r.bottom,footerY:f.top,footerHeight:f.height,documentOverflow:document.documentElement.scrollWidth>innerWidth,scrollbarHeight:wrap.offsetHeight-wrap.clientHeight-parseFloat(getComputedStyle(wrap).borderTopWidth),nearBottomRows:[...wrap.querySelectorAll('tbody tr')].map((row,index)=>({index:index+1,y:row.getBoundingClientRect().top,height:row.getBoundingClientRect().height,borderTop:getComputedStyle(row.cells[0]).borderTopWidth})).filter(row=>Math.abs(row.y-r.bottom)<32)}})}
async function widths(page){return page.locator('.rd-table th').evaluateAll(els=>els.map(el=>el.getBoundingClientRect().width))}
function singleDivider(g){assert.equal(g.wrapBottom,'0px','table adds second footer divider');assert.equal(g.footerTop,'1px');assert(Math.abs(g.wrapY-g.footerY)<.01,'gap between table region and footer');assert.equal(g.documentOverflow,false)}
async function shot(page,name){await page.screenshot({path:fileURLToPath(new URL(name+'.png',out))});if(/scrolled$/.test(name)){const r=await page.locator('.wm-pagination').boundingBox();await page.screenshot({path:fileURLToPath(new URL(name+'-footer.png',out)),clip:{x:r.x,y:r.y-20,width:r.width,height:r.height+20}})}}
async function run(theme,width,fixture){
 const c={theme,width,fixture,checks:[]};report.cases.push(c)
 const context=await browser.newContext({viewport:{width,height:987}});context.setDefaultTimeout(7000)
 await context.addInitScript(theme=>{localStorage.setItem('tw-theme',theme);localStorage.setItem('tw-language','vi')},theme)
 const writes=[];await context.routeWebSocket('**/*',socket=>socket.close())
 await context.route('**/*',route=>{const req=route.request(),url=new URL(req.url());if(url.origin!==origin||url.pathname.startsWith('/api/v2/live'))return route.abort();if(!['GET','HEAD','OPTIONS'].includes(req.method())){writes.push(req.url());return route.abort()}
  if(fixture&&url.pathname==='/api/v2/data/datasets')return route.fulfill({json:{items:[saved],catalog_items:assets,catalog_state:{status:'cached',configured:true,item_count:assets.length},download_state:{available:true,supports_full:true,supported_instruments:assets.map(a=>a.instrument_id),earliest_dates:Object.fromEntries(assets.filter(a=>a.provider==='Dukascopy').map(a=>[a.instrument_id,'2003-05-04']))}}})
  if(fixture&&url.pathname==='/api/v2/data/downloads')return route.fulfill({json:{items:[{job_id:'fixture-paused',instrument_id:'CAT001',status:'paused',completed_days:3,total_days:10,transferred_bytes:1000000,from_date:'2026-09-01',to_date:'2026-09-10',stage:'downloading',retry_after_seconds:0}],available:true,supports_pause:true}})
  return route.continue()
 })
 const page=await context.newPage();page.on('pageerror',e=>report.errors.push(String(e)))
 try{
  await page.goto(`${origin}/?workspace=tenant-a&view=market-data&area=testing&section=market-data`);await page.locator('.rd-table tbody tr').first().waitFor({timeout:15000})
  assert.equal(await page.locator('.rd-table th').count(),10)
  const headers=await page.locator('.rd-table th').allTextContents();assert.match(headers[4],/Từ ngày.*UTC/);assert.match(headers[5],/Đến ngày.*UTC/)
  const dates=await page.locator('.rd-table tbody tr').evaluateAll(rows=>rows.flatMap(row=>[row.cells[4].textContent,row.cells[5].textContent]));assert(dates.every(text=>text==='—'||/^\d{2}\/\d{2}\/\d{4}$/.test(text)),`date-only format: ${dates}`)
  const before=await footerGeometry(page),initialWidths=await widths(page);singleDivider(before)
  const dividerColors=await page.evaluate(()=>({row:getComputedStyle(document.querySelector('.rd-table tbody tr:nth-child(2) td')).borderTopColor,header:getComputedStyle(document.querySelector('.rd-table tbody tr:first-child td')).borderTopColor,footer:getComputedStyle(document.querySelector('.wm-pagination')).borderTopColor}));c.checks.push({name:'Body separators remain subordinate to header/footer',dividerColors});assert.notEqual(dividerColors.row,dividerColors.footer,'body rows and structural footer still same divider');assert.equal(dividerColors.header,dividerColors.footer)
  await shot(page,`${fixture?'fixture':'actual'}-${theme}-${width}-unscrolled`)
  await page.locator('.rd-table-wrap').evaluate(el=>{el.scrollTop=el.scrollHeight});const scrolled=await footerGeometry(page);singleDivider(scrolled);assert.equal(before.footerY,scrolled.footerY)
  await shot(page,`${fixture?'fixture':'actual'}-${theme}-${width}-scrolled`)
  await page.getByRole('button',{name:'Trang sau',exact:true}).click();await page.waitForTimeout(170)
  assert.deepEqual(await widths(page),initialWidths,'page two changes column widths');singleDivider(await footerGeometry(page));c.checks.push({name:'10 columns, dd/mm/yyyy, stable widths/page two, single divider and fixed footer',headers,before,scrolled,initialWidths})
  if(fixture){
   await page.locator('.data-library-search input').fill('A000');const row=page.locator('.rd-table tbody tr').first();assert.equal(await row.locator('td').nth(4).innerText(),'01/01/2024');assert.equal(await row.locator('td').nth(5).innerText(),'02/01/2024');assert.match(await row.locator('td').nth(4).getAttribute('title'),/01\/01\/2024 00:00:00/)
   await page.locator('.data-library-search input').fill('CAT000');assert.equal(await row.locator('td').nth(4).innerText(),'04/05/2003');assert.match(await row.locator('td').nth(4).getAttribute('title'),/metadata/)
   assert.match(await row.locator('td').nth(3).locator('span').getAttribute('title'),/M1.*1 phút/);assert.match(await row.locator('td').nth(3).locator('small').getAttribute('title'),/Bid.*Ask.*spread/)
   await page.locator('.data-library-search input').fill('CAT001');const actionBounds=await row.locator('td').last().evaluate(td=>{const r=td.getBoundingClientRect(),buttons=[...td.querySelectorAll('button')].map(el=>el.getBoundingClientRect());return {cellLeft:r.left,cellRight:r.right,buttonsLeft:Math.min(...buttons.map(r=>r.left)),buttonsRight:Math.max(...buttons.map(r=>r.right))}});assert(actionBounds.buttonsLeft>=actionBounds.cellLeft&&actionBounds.buttonsRight<=actionBounds.cellRight,'paused job controls spill into neighboring column');c.checks.push({name:'Paused fixture action controls contained in narrowed column',actionBounds})
   await page.locator('.data-library-search input').fill('ZZZZ');assert.equal(await row.locator('td').nth(4).innerText(),'—');assert.equal(await row.locator('td').nth(5).innerText(),'—');singleDivider(await footerGeometry(page))
   await shot(page,`fixture-${theme}-${width}-unknown`);c.checks.push({name:'Saved actual bounds vs metadata bounds; unknown remains —; M1/Bid tooltip'})
  }
  assert.equal(writes.length,0);c.pass=true
 }catch(error){c.pass=false;c.error=String(error);await shot(page,`FAIL-${fixture?'fixture':'actual'}-${theme}-${width}`).catch(()=>{})}
 finally{await context.close()}
}
try{for(const theme of ['dark','light'])for(const width of [1710,360])await run(theme,width,false);for(const theme of ['dark','light'])await run(theme,1710,true);await run('dark',360,true)}
finally{report.pass=report.cases.every(c=>c.pass)&&!report.errors.length;await writeFile(new URL('results.json',out),JSON.stringify(report,null,2));await browser.close();console.log(JSON.stringify(report));if(!report.pass)process.exitCode=1}
