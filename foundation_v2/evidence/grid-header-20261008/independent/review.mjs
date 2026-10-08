import { chromium } from '../../../web/node_modules/playwright/index.mjs'
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import assert from 'node:assert/strict'
const out=path.dirname(fileURLToPath(import.meta.url));await fs.mkdir(out,{recursive:true})
const browser=await chromium.launch({headless:true});const results=[],errors=[]
const base='http://127.0.0.1:5180/?workspace=tenant-a&area=testing&'
try{
for(const theme of ['dark','light']) for(const width of [360,1440]){
 const ctx=await browser.newContext({viewport:{width,height:987}})
 await ctx.addInitScript(theme=>{localStorage.setItem('tw-theme',theme);localStorage.setItem('tw-language','vi')},theme)
 const page=await ctx.newPage();page.on('pageerror',err=>errors.push(err.message))
 for(const kind of ['trade','market-data']){
  await page.goto(base+(kind==='trade'?'view=trade&section=trades&select=1&sessions=all':'view=market-data&section=market-data'))
  const table=page.locator(kind==='trade'?'.fxa-table-scroll table':'.data-library .rd-table')
  await table.waitFor();await page.locator('.wm-pagination').waitFor();if(kind==='trade')await page.waitForFunction(()=>document.querySelector('.fxa-trades')?.getAttribute('aria-busy')!=='true');await page.waitForTimeout(250)
  const g=await table.evaluate(el=>{
   const h=el.querySelector('th'),s=getComputedStyle(h),box=h.getBoundingClientRect(),probe=document.createElement('span');probe.style.background='var(--wm-canvas)';h.append(probe);const canvas=getComputedStyle(probe).backgroundColor;probe.remove()
   const toolbar=document.querySelector('.fxa-filter-toolbar'),scroll=document.querySelector('.fxa-table-scroll')
   return {headers:el.querySelectorAll('thead').length,rows:el.querySelectorAll('thead tr').length,color:s.backgroundColor,canvas,token:s.getPropertyValue('--wm-canvas').trim(),height:box.height,border:s.borderBottomWidth,shadow:s.boxShadow,overflow:document.documentElement.scrollWidth-innerWidth,footerBottom:document.querySelector('.wm-pagination').getBoundingClientRect().bottom,toolbarGap:toolbar?scroll.getBoundingClientRect().top-toolbar.getBoundingClientRect().bottom:null}
  })
  assert.equal(g.headers,1);assert.equal(g.rows,1);assert.equal(g.color,g.canvas);assert.equal(g.overflow,0);assert(Math.abs(g.footerBottom-987)<2)
  assert(g.height>=44&&g.height<=45,JSON.stringify(g))
  if(kind==='trade'){assert.equal(g.border,'0px')}
  const scroller=page.locator(kind==='trade'?'.fxa-table-scroll':'.data-library .rd-table-wrap'),head=table.locator('th').first(),y=(await head.boundingBox()).y
  await scroller.evaluate(el=>el.scrollTop=350);await page.waitForTimeout(30);assert(Math.abs((await head.boundingBox()).y-y)<1,'actual header must stay at scroll container top');await scroller.evaluate(el=>el.scrollTop=0)
  await page.screenshot({path:path.join(out,`${kind}-${theme}-${width}.png`)})
  results.push({kind,theme,width,...g})
 }
 // Browser-only rows fixture: preserve actual layout, no service writes.
 await page.goto(base+'view=trade&section=trades&select=1&sessions=all');await page.locator('.fxa-table-scroll table').waitFor();await page.waitForFunction(()=>document.querySelector('.fxa-trades')?.getAttribute('aria-busy')!=='true')
 await page.evaluate(()=>{const body=document.querySelector('.fxa-table-scroll tbody'),cols=document.querySelectorAll('.fxa-table-scroll th').length;body.innerHTML=Array.from({length:80},(_,i)=>'<tr>'+Array.from({length:cols},(_,j)=>`<td>Fixture ${i+1}/${j+1}</td>`).join('')+'</tr>').join('')})
 const scroll=page.locator('.fxa-table-scroll');const h=scroll.locator('th').first()
 const original=await h.boundingBox();await scroll.evaluate(el=>el.scrollTop=600);await page.waitForTimeout(50)
 const after=await h.boundingBox();assert(Math.abs(original.y-after.y)<1,'sticky header shifted')
 await scroll.evaluate(el=>el.scrollTop=0)
 const sort=scroll.locator('th[aria-sort] button').first();await sort.focus();assert(await sort.evaluate(el=>document.activeElement===el));await page.keyboard.press('Enter');await page.waitForTimeout(150)
 assert.equal(await scroll.locator('th[aria-sort]').first().getAttribute('aria-sort'),'ascending')
 const b=await sort.boundingBox();assert(b.height>=44,'sort target too small')
 results.push({kind:'browser-only sticky/sort fixture',theme,width,stickyY:after.y,sortHeight:b.height})
 await ctx.close()
}
assert.deepEqual(errors,[])
await fs.writeFile(path.join(out,'results.json'),JSON.stringify({status:'PASS',results,errors},null,2));console.log(JSON.stringify({status:'PASS',cases:results.length}))
}catch(error){await fs.writeFile(path.join(out,'results.json'),JSON.stringify({status:'FAIL',error:error.message,results,errors},null,2));throw error}finally{await browser.close()}
