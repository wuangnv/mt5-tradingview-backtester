import assert from 'node:assert/strict'
import {chromium} from '../../web/node_modules/playwright/index.mjs'
import {readFile,writeFile} from 'node:fs/promises'
import {createHash} from 'node:crypto'
import {fileURLToPath} from 'node:url'
const out=new URL('./',import.meta.url),origin='http://127.0.0.1:5180',href=origin+'/?workspace=tenant-a&view=market-data&area=testing&section=market-data'
const report={cases:[],errors:[],blocked:[]},browser=await chromium.launch({headless:true})
async function setup(width,theme,fixture=''){
 const context=await browser.newContext({viewport:{width,height:987},reducedMotion:'reduce'}),traffic=[];let datasets=[]
 await context.addInitScript(theme=>{localStorage.setItem('tw-theme',theme);localStorage.setItem('tw-language','vi')},theme);await context.routeWebSocket('**/*',s=>s.close())
 await context.route('**/*',async route=>{const r=route.request(),u=new URL(r.url());if(u.pathname.startsWith('/api/'))traffic.push({method:r.method(),path:u.pathname})
 if(!['GET','HEAD','OPTIONS'].includes(r.method())||![origin,'http://127.0.0.1:8010'].includes(u.origin)||/^\/api\/v2\/(live|data\/market-assets)/.test(u.pathname)){report.blocked.push({method:r.method(),url:r.url()});return route.abort()}
 if(u.pathname==='/api/v2/data/datasets'){
  if(fixture==='empty')return route.fulfill({json:{items:[]}})
  if(fixture==='failed')return route.fulfill({status:503,json:{detail:'Independent readonly catalog failure'}})
  const response=await route.fetch(),body=await response.json();datasets=body.items;return route.fulfill({response,json:body})
 }return route.continue()});const page=await context.newPage();page.on('pageerror',e=>report.errors.push(String(e)));await page.goto(href);await page.getByTestId('data-desk-root').waitFor();return{context,page,traffic,datasets:()=>datasets}
}
async function screen(page,name){await page.screenshot({path:fileURLToPath(new URL(name+'.png',out)),fullPage:true})}
const geometry=()=>{
 const content=document.querySelector('.fx-content'),r=content.getBoundingClientRect(),bounds={left:r.left+content.clientLeft,right:r.left+content.clientLeft+content.clientWidth},wrapper=document.querySelector('.rd-table-wrap')?.getBoundingClientRect()
 const lines=Array.from(document.querySelectorAll('.data-library-paging,.data-library-disclosure,.rd-provider-row')).filter(e=>e.getBoundingClientRect().height).map(e=>{const s=getComputedStyle(e,'::after'),b=e.getBoundingClientRect();return{class:e.className,left:b.left+parseFloat(s.left),right:b.right-parseFloat(s.right),height:s.height,color:s.backgroundColor}})
 const table=document.querySelector('.rd-table'),cells=table?{first:getComputedStyle(table.querySelector('tbody tr td:first-child')).paddingLeft,last:getComputedStyle(table.querySelector('tbody tr td:last-child')).paddingRight,gutter:getComputedStyle(document.querySelector('.fx-app')).getPropertyValue('--wm-page-gutter').trim()}:null
 return{bounds,wrapper:wrapper?{left:wrapper.left,right:wrapper.right}:null,lines,cells,pageOverflow:document.documentElement.scrollWidth-innerWidth}
}
async function run(name,fn){const c={name};report.cases.push(c);try{await fn(c);c.pass=true}catch(e){c.pass=false;c.failure=String(e);console.log(JSON.stringify(c))}}
try{
 for(const theme of ['dark','light'])for(const width of [360,1428])await run(`${theme}-${width}`,async item=>{
  const{context,page,traffic,datasets}=await setup(width,theme);try{
   const root=page.getByTestId('data-desk-root');await root.getByTestId('data-desk-dataset-table').waitFor();assert.equal(datasets().length,44);assert.match(await root.locator('.data-library-count').innerText(),/44/)
   assert.equal(await root.locator('h1').count(),0);assert.equal(await root.locator('.data-library-offline-note').count(),0);assert.equal(await root.getByRole('tab').count(),0)
   assert.equal(await root.locator('tbody tr').first().locator('td').nth(1).innerText(),'MT5');assert.equal(await root.locator('tbody tr td:nth-child(2) small').count(),0)
   item.closed=await page.evaluate(geometry);assert.equal(item.closed.pageOverflow,0)
   assert(Math.abs(item.closed.wrapper.left-item.closed.bounds.left)<1);assert(Math.abs(item.closed.wrapper.right-item.closed.bounds.right)<1)
   assert.equal(item.closed.cells.first,item.closed.cells.gutter);assert.equal(item.closed.cells.last,item.closed.cells.gutter)
   for(const line of item.closed.lines){assert(Math.abs(line.left-item.closed.bounds.left)<1);assert(Math.abs(line.right-item.closed.bounds.right)<1);assert.equal(line.height,'1px')}
   item.pagination=await root.locator('.data-library-paging > div > span').evaluate(e=>{const range=document.createRange();range.selectNodeContents(e);return{text:e.textContent,lines:new Set([...range.getClientRects()].map(r=>Math.round(r.top))).size,width:e.getBoundingClientRect().width}});assert.equal(item.pagination.lines,1,'Page indicator must stay on one line')
   await screen(page,item.name)
   const scroller=root.locator('.rd-table-wrap');await scroller.focus();assert.equal(await scroller.evaluate(e=>e===document.activeElement),true)
   if(width===360){await page.keyboard.press('ArrowRight');await page.waitForTimeout(160);assert(await scroller.evaluate(e=>e.scrollLeft)>0);await scroller.evaluate(e=>e.scrollLeft=0)}
   await root.locator('tbody tr').first().locator('td button').first().click();const details=root.getByTestId('dataset-details');await details.waitFor();const source=await details.locator('.rd-detail-grid > div').nth(1).locator('dd').innerText();assert.equal(source,datasets()[0].source.provider);item.provenance={table:'MT5',details:source,providerId:datasets()[0].provider_id}
   await root.locator('.data-library-disclosure').nth(1).locator(':scope > summary').click();item.expanded=await page.evaluate(geometry);for(const line of item.expanded.lines){assert(Math.abs(line.left-item.expanded.bounds.left)<1);assert(Math.abs(line.right-item.expanded.bounds.right)<1)}assert.equal(item.expanded.pageOverflow,0)
   await screen(page,item.name+'-details');const importer=root.locator('.data-library-import');await importer.focus();await page.keyboard.press('Enter');const file=page.getByTestId('data-desk-file-input');await file.waitFor({state:'visible'});assert.equal(await file.evaluate(e=>e===document.activeElement),true);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth-innerWidth),0);item.importFocus=true;await screen(page,item.name+'-csv');item.traffic=traffic
  }finally{await context.close()}
 })
 for(const fixture of ['empty','failed'])await run('fixture-'+fixture,async item=>{
  const{context,page,traffic}=await setup(360,'dark',fixture);try{const root=page.getByTestId('data-desk-root');await root.getByTestId(fixture==='empty'?'data-desk-empty':'data-desk-retry').waitFor();const importer=root.locator('.data-library-import');assert.equal(await importer.isDisabled(),false);await importer.focus();await page.keyboard.press('Enter');await page.getByTestId('data-desk-file-input').waitFor({state:'visible'});assert.equal(await page.getByTestId('data-desk-file-input').evaluate(e=>e===document.activeElement),true);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth-innerWidth),0);item.traffic=traffic;await screen(page,item.name)}finally{await context.close()}
 })
 report.pass=report.cases.every(c=>c.pass)&&!report.errors.length&&!report.blocked.length
}finally{report.hashes={};for(const f of ['DataDeskWorkspace.jsx','data-library.css'])report.hashes[f]=createHash('sha256').update(await readFile(new URL('../../web/src/'+f,out))).digest('hex');await writeFile(new URL('review.json',out),JSON.stringify(report,null,2));await browser.close();console.log(JSON.stringify({pass:report.pass,cases:report.cases.map(c=>({name:c.name,pass:c.pass,failure:c.failure})),errors:report.errors,blocked:report.blocked,hashes:report.hashes},null,2))}
