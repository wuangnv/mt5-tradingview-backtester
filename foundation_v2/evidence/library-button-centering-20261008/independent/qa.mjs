import assert from 'node:assert/strict'
import {chromium} from '../../../web/node_modules/playwright/index.mjs'
import {mkdir,writeFile} from 'node:fs/promises'
import {fileURLToPath} from 'node:url'
const origin='http://127.0.0.1:5180',out=new URL('./',import.meta.url)
await mkdir(out,{recursive:true})
const browser=await chromium.launch(),report={scope:'Read-only actual Library and explicitly labeled Pause/Resume presentation fixtures. No mutation/provider requests.',cases:[],errors:[]}
const assets=['PAUSED','RUNNING','UNSAVED'].map(instrument_id=>({instrument_id,name:'Explicit control centering fixture',provider:'Dukascopy',provider_id:'dukascopy-catalog',asset_class:'fx'}))
async function measure(button){return button.evaluate(el=>{const r=el.getBoundingClientRect(),s=el.querySelector('svg').getBoundingClientRect(),texts=[...el.childNodes].filter(n=>n.nodeType===Node.TEXT_NODE&&n.textContent.trim()).map(n=>{const range=document.createRange();range.selectNodeContents(n);return range.getBoundingClientRect()}),rects=[s,...texts],left=Math.min(...rects.map(b=>b.left)),right=Math.max(...rects.map(b=>b.right)),top=Math.min(...rects.map(b=>b.top)),bottom=Math.max(...rects.map(b=>b.bottom)),css=getComputedStyle(el);return {text:el.textContent,button:{x:r.x,y:r.y,width:r.width,height:r.height},union:{left,right,top,bottom},center:{x:(left+right-r.left-r.right)/2,y:(top+bottom-r.top-r.bottom)/2},gaps:{left:left-r.left,right:r.right-right,top:top-r.top,bottom:r.bottom-bottom},background:css.backgroundColor,justify:css.justifyContent,svgDisplay:getComputedStyle(el.querySelector('svg')).display}})}
async function run(theme,width,language,fixture=false){
 const c={theme,width,language,fixture,checks:[]};report.cases.push(c)
 const context=await browser.newContext({viewport:{width,height:987}});context.setDefaultTimeout(7000)
 await context.addInitScript(({theme,language})=>{localStorage.setItem('tw-theme',theme);localStorage.setItem('tw-language',language)},{theme,language})
 const writes=[];await context.routeWebSocket('**/*',s=>s.close());await context.route('**/*',route=>{const req=route.request(),url=new URL(req.url());if(url.origin!==origin||url.pathname.startsWith('/api/v2/live'))return route.abort();if(!['GET','HEAD','OPTIONS'].includes(req.method())){writes.push(req.url());return route.abort()}
  if(fixture&&url.pathname==='/api/v2/data/datasets')return route.fulfill({json:{items:[],catalog_items:assets,catalog_state:{status:'cached',configured:true,item_count:assets.length},download_state:{available:true,supports_full:true,supported_instruments:assets.map(a=>a.instrument_id),earliest_dates:Object.fromEntries(assets.map(a=>[a.instrument_id,'2003-05-04']))}}})
  if(fixture&&url.pathname==='/api/v2/data/downloads')return route.fulfill({json:{items:['PAUSED','RUNNING'].map(instrument_id=>({job_id:`fixture-${instrument_id}`,instrument_id,status:instrument_id==='PAUSED'?'paused':'running',stage:'downloading',completed_days:4,total_days:10,transferred_bytes:102400})),available:true,supports_pause:true}})
  return route.continue()
 })
 const page=await context.newPage();page.on('pageerror',e=>report.errors.push(String(e)))
 try{
  await page.goto(`${origin}/?workspace=tenant-a&view=market-data&area=testing&section=market-data`);await page.locator('.rd-table tbody tr').first().waitFor({timeout:15000})
  if(fixture)await page.waitForFunction(()=>[...document.querySelectorAll('.data-library-progress')].some(el=>el.textContent.includes('MiB/s')),null,{timeout:7000})
  const metrics=await page.locator('.rd-table th').evaluateAll(headers=>({status:headers[8].getBoundingClientRect().width,actions:headers[9].getBoundingClientRect().width}));assert.equal(metrics.status,112);assert.equal(metrics.actions,196)
  const rows=fixture?['UNSAVED','PAUSED','RUNNING']:['0005.HK/HKD']
  for(const asset of rows){
   const row=page.locator('.rd-table tbody tr').filter({has:page.locator('strong',{hasText:asset})}).first(),actions=row.locator('td').last(),button=actions.locator('button').first();await button.scrollIntoViewIfNeeded();await page.mouse.move(0,0);await page.waitForTimeout(250)
   const rest=await measure(button);assert.equal(rest.button.width,116);assert.equal(rest.justify,'center');assert(Math.abs(rest.center.x)<=.5&&Math.abs(rest.center.y)<=1,'icon/text union not centered at rest');assert(Math.abs(rest.gaps.left-rest.gaps.right)<=1,'inner horizontal gaps asymmetric')
   const placement=await actions.evaluate(td=>{const r=td.getBoundingClientRect(),b=td.querySelector('button').getBoundingClientRect(),status=td.previousElementSibling.getBoundingClientRect(),text=document.createRange();text.selectNodeContents(td.previousElementSibling.querySelector('span'));return {buttonOffset:b.left-r.left,statusWidth:status.width,outerGap:b.left-text.getBoundingClientRect().right,buttonRight:b.right,cellRight:r.right,scrollLeft:td.closest('.rd-table-wrap').scrollLeft}});assert.equal(placement.buttonOffset,8);assert(placement.buttonRight<=placement.cellRight)
   if(asset==='UNSAVED'||!fixture){assert(placement.outerGap>=0&&placement.outerGap<80,'ordinary status→button outer gap changed')}
   await button.hover();await page.waitForTimeout(250);const hover=await measure(button);assert.deepEqual(hover.button,rest.button,'hover shifts button geometry');assert(Math.abs(hover.center.x)<=.5&&Math.abs(hover.center.y)<=1,'icon/text union not centered on hover');assert.deepEqual(hover.gaps,rest.gaps,'hover shifts content');if(!await button.isDisabled())assert.notEqual(rest.background,hover.background,'enabled hover is not distinct')
   c.checks.push({asset,metrics,placement,rest,hover,disabled:await button.isDisabled()})
   await page.screenshot({path:fileURLToPath(new URL(`${fixture?'fixture':'actual'}-${theme}-${width}-${language}-${asset.replaceAll('/','_')}-hover.png`,out))})
  }
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);assert.equal(writes.length,0);c.pass=true
 }catch(error){c.pass=false;c.error=String(error);await page.screenshot({path:fileURLToPath(new URL(`FAIL-${theme}-${width}-${language}-${fixture}.png`,out))}).catch(()=>{})}
 finally{await context.close()}
}
try{for(const theme of ['dark','light'])for(const width of [1710,360])for(const language of ['vi','en'])await run(theme,width,language);await run('dark',1710,'vi',true);await run('light',360,'en',true)}
finally{report.pass=report.cases.every(c=>c.pass)&&!report.errors.length;await writeFile(new URL('results.json',out),JSON.stringify(report,null,2));await browser.close();console.log(JSON.stringify(report));if(!report.pass)process.exitCode=1}
