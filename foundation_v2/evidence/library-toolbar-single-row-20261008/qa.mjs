import assert from 'node:assert/strict'
import {chromium} from '../../web/node_modules/playwright/index.mjs'
import {readFile,writeFile} from 'node:fs/promises'
import {fileURLToPath} from 'node:url'

const payload=JSON.parse(await readFile(new URL('../../.runtime/qdm-catalog-qa.json',import.meta.url),'utf8'))
const browser=await chromium.launch(),report={scope:'UI fixtures with real QDM catalog payload; no API mutations/downloads',cases:[]}
const url='http://127.0.0.1:5180/?workspace=tenant-a&view=market-data&area=testing&section=market-data'
try {
 for(const width of [1710,1526,1448,1440,1366,1280,768,360]) {
  const context=await browser.newContext({viewport:{width,height:987}})
  await context.addInitScript(()=>{localStorage.setItem('tw-language','vi');localStorage.setItem('tw-theme','dark')})
  await context.route('**/api/**',route=>{
   const path=new URL(route.request().url()).pathname
   if(route.request().method()!=='GET')throw new Error(`Unexpected mutation ${path}`)
   if(path.endsWith('/data/datasets'))return route.fulfill({json:payload})
   if(path.endsWith('/data/downloads'))return route.fulfill({json:{available:true,items:[],supports_pause:false,supports_cancel:false}})
   return route.fulfill({json:{items:[]}})
  })
  const page=await context.newPage(),errors=[]
  page.on('pageerror',e=>errors.push(String(e)));page.setDefaultTimeout(8000)
  await page.goto(url)
  const status=page.getByRole('button',{name:'Trạng thái tải',exact:true}),clear=page.getByRole('button',{name:'Xóa bộ lọc',exact:true})
  await status.waitFor()
  assert.equal(await status.innerText(),'Đã tải')
  assert.equal(await clear.isDisabled(),true)
  const geometry=()=>page.evaluate(()=>{
   const bounds=s=>{const r=document.querySelector(s).getBoundingClientRect();return{x:r.x,y:r.y,width:r.width,height:r.height}}
   return{toolbar:bounds('.data-library-toolbar'),search:bounds('.data-library-search'),status:bounds('.data-library-status'),filters:bounds('.data-library-filters')}
  })
  const baseline=await geometry(),states=[]
  const choose=async(label,value)=>{await page.getByRole('button',{name:label,exact:true}).click();await page.getByRole('option',{name:value,exact:true}).click()}
  for(const value of ['Tất cả trạng thái','Đang tải','Chưa tải','Đã tải']) {
   await choose('Trạng thái tải',value)
   assert.equal(await clear.isDisabled(),value==='Đã tải')
   const actual=await geometry()
   for(const key of ['toolbar','search','status','filters']) {
    assert(Math.abs(actual[key].y-baseline[key].y)<1,`${width}/${value}: ${key} moved`)
    assert(Math.abs(actual[key].height-baseline[key].height)<1,`${width}/${value}: ${key} resized`)
   }
   assert(Math.abs(actual.status.width-baseline.status.width)<1)
   if(width>=1440)assert(Math.abs((actual.search.y+actual.search.height/2)-(actual.status.y+actual.status.height/2))<1,'desktop controls must share row')
   states.push(value)
   if(value==='Tất cả trạng thái')await page.screenshot({path:fileURLToPath(new URL(`all-${width}.png`,import.meta.url))})
   if(value!=='Đã tải') {
    await clear.click()
    assert.equal(await status.innerText(),'Đã tải')
    assert.equal(await clear.isDisabled(),true)
   }
  }
  await choose('Trạng thái tải','Tất cả trạng thái')
  await page.getByRole('button',{name:'Trang sau',exact:true}).click()
  await clear.click()
  assert.equal(await page.getByRole('button',{name:'Trang 1',exact:true}).getAttribute('aria-current'),'page')
  await page.getByText('Không có dữ liệu phù hợp bộ lọc.',{exact:true}).waitFor()
  await choose('Danh mục','Forex');assert.equal(await clear.isEnabled(),true)
  await choose('Nguồn dữ liệu','Dukascopy')
  await page.getByRole('searchbox').fill('eur')
  await clear.click()
  assert.equal(await page.getByRole('searchbox').inputValue(),'')
  assert.equal(await page.getByRole('button',{name:'Danh mục',exact:true}).innerText(),'Tất cả danh mục')
  assert.equal(await page.getByRole('button',{name:'Nguồn dữ liệu',exact:true}).innerText(),'Tất cả nguồn')
  assert.equal(await clear.isDisabled(),true)
  // Sort has its own control and must not count as a filter.
  await choose('Sắp xếp dữ liệu','Mới cập nhật');assert.equal(await clear.isDisabled(),true)
  await page.reload();await status.waitFor();assert.equal(await clear.isDisabled(),true)
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false)
  assert.deepEqual(errors,[])
  report.cases.push({width,pass:true,baseline,states,checks:['stable toolbar across status choices','clear restores downloaded','default clear disabled','category/provider/search reset','pagination reset','sort stays separate','reload default','no overflow/errors']})
  await context.close()
 }
 report.pass=true
}catch(e){report.pass=false;report.error=String(e);process.exitCode=1}
finally{await writeFile(new URL('qa.json',import.meta.url),JSON.stringify(report,null,2));await browser.close();console.log(JSON.stringify(report))}
