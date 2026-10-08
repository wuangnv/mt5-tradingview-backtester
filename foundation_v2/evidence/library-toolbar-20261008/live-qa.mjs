import assert from 'node:assert/strict'
import {chromium} from '../../web/node_modules/playwright/index.mjs'
import {writeFile} from 'node:fs/promises'
import {fileURLToPath} from 'node:url'
const browser=await chromium.launch(),report={scope:'Live UI5180/API8010 read-only; no download/catalog mutations'}
try{
 const page=await browser.newPage({viewport:{width:1526,height:987}})
 await page.addInitScript(()=>{localStorage.setItem('tw-language','vi');localStorage.setItem('tw-theme','dark')})
 const writes=[]
 page.on('request',r=>{if(new URL(r.url()).pathname.startsWith('/api/')&&r.method()!=='GET')writes.push(r.url())})
 await page.goto('http://127.0.0.1:5180/?workspace=tenant-a&view=market-data&area=testing&section=market-data')
 const status=page.getByRole('button',{name:'Trạng thái tải',exact:true}),clear=page.getByRole('button',{name:'Xóa bộ lọc',exact:true})
 await status.waitFor();assert.equal(await clear.isDisabled(),true)
 await status.click();await page.getByRole('option',{name:'Tất cả trạng thái',exact:true}).click()
 assert.equal(await clear.isEnabled(),true)
 await page.getByRole('searchbox').fill('EUR/USD')
 await page.getByRole('button',{name:'Tải về',exact:true}).waitFor()
 assert.equal(await page.getByRole('button',{name:'Tải về',exact:true}).isEnabled(),true)
 assert.equal(await page.getByTestId('data-desk-dataset-table').locator('tbody tr td').nth(2).innerText(),'Dukascopy')
 const geometry=await page.evaluate(()=>{
  const rect=s=>document.querySelector(s).getBoundingClientRect()
  const a=rect('.data-library-search'),b=rect('.data-library-status')
  return{searchCenter:a.y+a.height/2,statusCenter:b.y+b.height/2,toolbarHeight:rect('.data-library-toolbar').height}
 })
 assert(Math.abs(geometry.searchCenter-geometry.statusCenter)<1)
 await page.screenshot({path:fileURLToPath(new URL('live-1526.png',import.meta.url))})
 await clear.click();assert.equal(await status.innerText(),'Đã tải');assert.equal(await clear.isDisabled(),true)
 assert.deepEqual(writes,[])
 report.pass=true;report.geometry=geometry;report.checks=['all status shares search row','clear restores downloaded/default disabled','EUR/USD Dukascopy download button enabled','no API writes']
}catch(e){report.pass=false;report.error=String(e);process.exitCode=1}
finally{await writeFile(new URL('live-qa.json',import.meta.url),JSON.stringify(report,null,2));await browser.close();console.log(JSON.stringify(report))}
