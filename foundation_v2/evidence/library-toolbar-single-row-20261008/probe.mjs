import {chromium} from '../../web/node_modules/playwright/index.mjs'
import {writeFile} from 'node:fs/promises'
const browser=await chromium.launch(),report=[]
try {
 const page=await browser.newPage({viewport:{width:1448,height:987}})
 await page.addInitScript(()=>{localStorage.setItem('tw-language','vi');localStorage.setItem('tw-theme','dark')})
 await page.goto('http://127.0.0.1:5180/?workspace=tenant-a&view=market-data&area=testing&section=market-data')
 await page.getByRole('button',{name:'Trạng thái tải',exact:true}).waitFor()
 await page.screenshot({path:new URL('before-1448.png',import.meta.url).pathname.replace(/^\/([A-Z]:)/,'$1')})
 for(const width of [1710,1526,1448,1440,1366,1280]) {
  await page.setViewportSize({width,height:987})
  report.push(await page.evaluate(()=>{
   const bounds=s=>{const e=document.querySelector(s),r=e.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height,scrollWidth:e.scrollWidth}}
   return {viewport:innerWidth,shell:bounds('.data-library'),toolbar:bounds('.data-library-toolbar'),search:bounds('.data-library-search'),filters:bounds('.data-library-filters'),children:[...document.querySelector('.data-library-filters').children].map(e=>({text:e.innerText,width:e.getBoundingClientRect().width}))}
  }))
 }
 await writeFile(new URL('before.json',import.meta.url),JSON.stringify(report,null,2))
 console.log(JSON.stringify(report))
} finally {await browser.close()}
