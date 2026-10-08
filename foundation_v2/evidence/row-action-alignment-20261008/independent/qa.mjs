import assert from 'node:assert/strict'
import {chromium} from '../../../web/node_modules/playwright/index.mjs'
import {mkdir,writeFile} from 'node:fs/promises'
import {fileURLToPath} from 'node:url'
const out=new URL('./',import.meta.url),origin='http://127.0.0.1:5180'
await mkdir(out,{recursive:true})
const browser=await chromium.launch({ignoreDefaultArgs:['--hide-scrollbars']})
const report={scope:'Actual Library local GET-only. Read-only menu/hover inspection, no mutation or download state changes.',cases:[],errors:[]}
async function measure(locator){return locator.evaluate(el=>{const r=el.getBoundingClientRect(),svg=el.querySelector('svg'),s=svg.getBoundingClientRect(),c=getComputedStyle(el);return {button:{x:r.x,y:r.y,width:r.width,height:r.height},svg:{x:s.x,y:s.y,width:s.width,height:s.height},delta:{x:s.x+s.width/2-r.x-r.width/2,y:s.y+s.height/2-r.y-r.height/2},padding:c.padding,border:c.borderWidth,background:c.backgroundColor}})}
function centered(value){assert(Math.abs(value.delta.x)<.01,`SVG x center offset ${value.delta.x}px`);assert(Math.abs(value.delta.y)<.01,`SVG y center offset ${value.delta.y}px`);assert.equal(value.button.width,value.button.height,'oval target');assert.equal(value.svg.width,16);assert.equal(value.svg.height,16)}
try{
 for(const width of [1710,360]){
  const c={width,states:{}};report.cases.push(c)
  const context=await browser.newContext({viewport:{width,height:987}});context.setDefaultTimeout(7000)
  const writes=[];await context.addInitScript(()=>{localStorage.setItem('tw-theme','dark');localStorage.setItem('tw-language','vi')})
  await context.routeWebSocket('**/*',socket=>socket.close())
  await context.route('**/*',route=>{const req=route.request(),url=new URL(req.url());if(url.origin!==origin||url.pathname.startsWith('/api/v2/live'))return route.abort();if(!['GET','HEAD','OPTIONS'].includes(req.method())){writes.push(req.url());return route.abort()}return route.continue()})
  const page=await context.newPage();page.on('pageerror',e=>report.errors.push(String(e)))
  try{
   await page.goto(`${origin}/?workspace=tenant-a&view=market-data&area=testing&section=market-data`)
   await page.locator('.rd-table tbody tr').first().waitFor({timeout:15000})
   await page.locator('.data-library-search input').fill('0005')
   const more=page.locator('.data-library-more').first();await more.scrollIntoViewIfNeeded();await page.mouse.move(0,0);await page.waitForTimeout(170)
   c.states.rest=await measure(more);centered(c.states.rest);assert.equal(c.states.rest.padding,'0px');assert.equal(c.states.rest.button.width,width===360?44:32)
   await more.hover();await page.waitForTimeout(170);c.states.hover=await measure(more);centered(c.states.hover)
   assert.deepEqual(c.states.hover.delta,c.states.rest.delta);assert.deepEqual(c.states.hover.button,c.states.rest.button)
   await more.screenshot({path:fileURLToPath(new URL(`dark-${width}-hover-icon.png`,out))})
   await page.screenshot({path:fileURLToPath(new URL(`dark-${width}-hover.png`,out))})
   await more.click();c.states.open=await measure(more);centered(c.states.open);assert.equal(await more.getAttribute('aria-expanded'),'true')
   await page.keyboard.press('Escape');assert.equal(await more.evaluate(el=>document.activeElement===el),true)
   await page.locator('.data-library-search input').fill('EUR/USD')
   if(!await page.locator('.data-library-job-control').count())c.note='No actual download controls currently present for EUR/USD; source audit only for common compact icon geometry.'
   for(const [index,icon] of (await page.locator('.data-library-job-control').all()).entries()){
    await icon.scrollIntoViewIfNeeded();const geometry=await measure(icon);centered(geometry);c.states[`jobIcon${index}`]=geometry
   }
   assert.equal(writes.length,0);c.pass=true
  }catch(error){c.pass=false;c.error=String(error);await page.screenshot({path:fileURLToPath(new URL(`FAIL-${width}.png`,out))}).catch(()=>{})}
  finally{await context.close()}
 }
}finally{report.pass=report.cases.every(c=>c.pass)&&!report.errors.length;await writeFile(new URL('results.json',out),JSON.stringify(report,null,2));await browser.close();console.log(JSON.stringify(report));if(!report.pass)process.exitCode=1}
