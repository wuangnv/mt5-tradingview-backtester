import assert from 'node:assert/strict'
import { chromium } from '../../web/node_modules/playwright/index.mjs'
import { mkdir, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
const out = new URL('./',import.meta.url), origin = 'http://127.0.0.1:5180'
await mkdir(out,{recursive:true})
const browser = await chromium.launch(), report = { cases:[], errors:[], scope:'read-only actual workspace; separate built-in demo trade fixture' }
async function run(theme,width,view,demo=false) {
  const entry={theme,width,view,demo};report.cases.push(entry)
  const context=await browser.newContext({viewport:{width,height:987}})
  await context.addInitScript(theme=>{localStorage.setItem('tw-theme',theme);localStorage.setItem('tw-language','vi')},theme)
  await context.routeWebSocket('**/*',socket=>socket.close())
  await context.route('**/*',route=>{const request=route.request(),url=new URL(request.url());if(url.origin!==origin||/^\/api\/v2\/(live|data\/(market-assets|providers))/.test(url.pathname)||!['GET','HEAD','OPTIONS'].includes(request.method()))return route.abort();return route.continue()})
  const page=await context.newPage();page.on('pageerror',error=>report.errors.push(String(error)))
  try {
    await page.goto(`${origin}/?workspace=tenant-a&area=testing&view=${view}&section=${view==='trade'?'trades&select=1&sessions=all':'market-data'}${demo?'&demo=1':''}`)
    const grid=page.locator(view==='trade'?'.fxa-table-scroll':'.rd-table-wrap')
    await grid.locator('thead').waitFor()
    if(view==='trade')await page.locator('.fxa-trades:not([aria-busy="true"])').waitFor()
    assert.equal(await grid.locator('thead').count(),1)
    entry.header=await grid.locator('th').first().evaluate(e=>{
      const s=getComputedStyle(e),rect=e.getBoundingClientRect(),probe=document.createElement('i');probe.style.color='var(--wm-canvas)';e.append(probe);const canvas=getComputedStyle(probe).color;probe.remove()
      const filters=document.querySelector('.fxa-filters');return {background:s.backgroundColor,canvas,height:rect.height,borderBottom:s.borderBottomWidth,shadow:s.boxShadow,filterGap:filters?rect.top-filters.getBoundingClientRect().bottom:null}
    })
    assert.equal(entry.header.background,entry.header.canvas)
    assert(entry.header.height>=43&&entry.header.height<=46)
    if(view==='trade'){assert.equal(entry.header.borderBottom,'0px');assert(Math.abs(entry.header.filterGap)<1)}
    const footer=await page.locator('.wm-pagination').boundingBox();assert(Math.abs(footer.y+footer.height-987)<1)
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth-innerWidth),0)
    if(demo){await page.getByRole('button',{name:'Số dòng mỗi trang',exact:true}).click();await page.getByRole('option',{name:'100',exact:true}).click();await page.waitForFunction(()=>document.querySelectorAll('tbody tr').length>10)}
    if(view==='market-data'||demo){
      const top=await grid.locator('th').first().boundingBox()
      await grid.evaluate(e=>{e.scrollTop=300;e.scrollLeft=150})
      assert(await grid.evaluate(e=>e.scrollTop)>0)
      const after=await grid.locator('th').first().boundingBox();assert(Math.abs(top.y-after.y)<1)
      assert.deepEqual(await page.locator('.wm-pagination').boundingBox(),footer)
      entry.sticky=true
    }
    if(demo){
      await grid.getByRole('button',{name:'Tài sản',exact:true}).click()
      assert.equal(await grid.getByRole('columnheader').filter({hasText:'Tài sản'}).getAttribute('aria-sort'),'ascending')
      assert.equal(await grid.evaluate(e=>e.scrollTop),0)
      const sortButton=grid.getByRole('button',{name:/^Tài sản/});await sortButton.focus();await page.keyboard.press('Tab');await page.keyboard.press('Shift+Tab');assert.equal(await sortButton.evaluate(e=>getComputedStyle(e).outlineStyle),'solid')
      entry.sortAndFocus=true
    }
    await page.screenshot({path:fileURLToPath(new URL(`${view}-${demo?'demo':'actual'}-${theme}-${width}.png`,out))})
    entry.pass=true
  }catch(error){entry.pass=false;entry.error=String(error);await page.screenshot({path:fileURLToPath(new URL(`FAIL-${view}-${theme}-${width}.png`,out))}).catch(()=>{})}
  finally{await context.close()}
}
try{for(const theme of ['dark','light'])for(const width of [360,768,1440])for(const view of ['trade','market-data'])await run(theme,width,view);await run('dark',1440,'trade',true);await run('light',360,'trade',true)}
finally{report.pass=report.cases.every(entry=>entry.pass)&&!report.errors.length;await writeFile(new URL('qa.json',out),JSON.stringify(report,null,2));await browser.close();console.log(JSON.stringify({pass:report.pass,cases:report.cases.length,failures:report.cases.filter(entry=>!entry.pass),errors:report.errors}));if(!report.pass)process.exitCode=1}
