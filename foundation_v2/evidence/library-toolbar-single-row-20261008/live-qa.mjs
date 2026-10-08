import assert from 'node:assert/strict'
import {chromium} from '../../web/node_modules/playwright/index.mjs'
import {writeFile} from 'node:fs/promises'
import {fileURLToPath} from 'node:url'

const browser=await chromium.launch(),report={scope:'Live UI5180/API8010 read-only; no downloads or API writes',cases:[]}
try {
 const page=await browser.newPage({viewport:{width:1448,height:987}}),writes=[],errors=[]
 await page.addInitScript(()=>{localStorage.setItem('tw-language','vi');localStorage.setItem('tw-theme','dark')})
 page.on('request',r=>{if(new URL(r.url()).pathname.startsWith('/api/')&&r.method()!=='GET')writes.push(r.url())})
 page.on('pageerror',e=>errors.push(String(e)))
 await page.goto('http://127.0.0.1:5180/?workspace=tenant-a&view=market-data&area=testing&section=market-data')
 const status=page.getByRole('button',{name:'Trạng thái tải',exact:true}),clear=page.getByRole('button',{name:'Xóa bộ lọc',exact:true})
 await status.waitFor()
 await page.getByRole('button',{name:'Danh mục tài sản',exact:true}).waitFor()
 for(const width of [1448,1440,1526,1710]) {
  await page.setViewportSize({width,height:987})
  const states=[]
  for(const name of ['Đang tải','Tất cả trạng thái','Chưa tải','Đã tải']) {
   await status.click();await page.getByRole('option',{name,exact:true}).click()
   assert.equal(await clear.isDisabled(),name==='Đã tải')
   const geometry=await page.evaluate(()=>{
    const toolbar=document.querySelector('.data-library-toolbar'),r=toolbar.getBoundingClientRect()
    const controls=[toolbar.firstElementChild,...toolbar.lastElementChild.children].map(e=>{
     const b=e.getBoundingClientRect();return {x:b.x,right:b.right,center:b.y+b.height/2,width:b.width}
    })
    return {height:r.height,width:r.width,scrollWidth:toolbar.scrollWidth,controls}
   })
   assert.equal(geometry.height,44,`${width}/${name}: toolbar must be one row`)
   assert(geometry.scrollWidth<=geometry.width+1,`${width}/${name}: toolbar overflow`)
   assert(geometry.controls[0].width>=160)
   for(const [i,control] of geometry.controls.entries()) {
    assert(Math.abs(control.center-geometry.controls[0].center)<1,`${width}/${name}: misaligned control ${i}`)
    if(i)assert(control.x>=geometry.controls[i-1].right,`${width}/${name}: overlapping control ${i}`)
   }
   states.push({name,geometry})
   if(width===1448&&['Đang tải','Tất cả trạng thái'].includes(name))await page.screenshot({path:fileURLToPath(new URL(name==='Đang tải'?'live-1448-downloading.png':'live-1448-all.png',import.meta.url))})
  }
  report.cases.push({width,pass:true,states})
 }
 await page.setViewportSize({width:1448,height:987})
 await status.focus();await page.keyboard.press('ArrowDown')
 await page.getByRole('option',{name:'Đã tải',exact:true}).waitFor()
 assert.equal(await page.getByRole('option',{name:'Đã tải',exact:true}).evaluate(e=>e===document.activeElement),true)
 await page.keyboard.press('Escape');assert.equal(await status.getAttribute('aria-expanded'),'false')
 await status.click();await page.getByRole('option',{name:'Tất cả trạng thái',exact:true}).click()
 await page.getByRole('searchbox').fill('EUR/USD')
 await page.getByRole('button',{name:'Tải về',exact:true}).waitFor()
 assert.equal(await page.getByRole('button',{name:'Tải về',exact:true}).isEnabled(),true)
 await clear.click();assert.equal(await status.innerText(),'Đã tải');assert.equal(await clear.isDisabled(),true)
 assert.deepEqual(writes,[]);assert.deepEqual(errors,[])
 report.pass=true;report.checks=['single row and no overlap at all desktop widths/statuses','search remains usable','clear resets to downloaded','keyboard dropdown open/escape','EUR/USD download enabled','no API writes/browser errors']
} catch(e) {report.pass=false;report.error=String(e);process.exitCode=1}
finally {await writeFile(new URL('live-qa.json',import.meta.url),JSON.stringify(report,null,2));await browser.close();console.log(JSON.stringify({pass:report.pass,cases:report.cases.map(c=>({width:c.width,pass:c.pass})),error:report.error}))}
