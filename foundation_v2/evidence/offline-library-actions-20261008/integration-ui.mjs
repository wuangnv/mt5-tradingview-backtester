import assert from 'node:assert/strict'
import { chromium } from '../../web/node_modules/playwright/index.mjs'
import { writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
const backend=process.env.TW_OFFLINE_QA_BACKEND
assert.equal(backend,'http://127.0.0.1:8032')
const browser=await chromium.launch(),report={scope:'Actual disposable fixture API via explicit routing; synthetic worker, no user service mutations',cases:[],errors:[]}
async function run(theme,width){
 const entry={theme,width};report.cases.push(entry)
 const context=await browser.newContext({viewport:{width,height:987}})
 await context.addInitScript(theme=>{localStorage.setItem('tw-theme',theme);localStorage.setItem('tw-language','vi')},theme)
 let fullRequests=0,deletes=0
 await context.routeWebSocket('**/*',socket=>socket.close())
 await context.route('**/*',async route=>{
  const request=route.request(),url=new URL(request.url())
  if(url.origin!=='http://127.0.0.1:5180'||/^\/api\/v2\/(live|data\/(market-assets|providers))/.test(url.pathname))return route.abort()
  if(url.pathname.startsWith('/api/v2/')){
   if(!['GET','HEAD','OPTIONS'].includes(request.method())){
    if(url.pathname==='/api/v2/data/downloads/full'&&request.method()==='POST')fullRequests++
    else if(url.pathname.startsWith('/api/v2/data/datasets/')&&request.method()==='DELETE')deletes++
    else if(/^\/api\/v2\/data\/downloads\/[^/]+\/cancel$/.test(url.pathname)&&request.method()==='POST'){}
    else return route.abort()
   }
   return route.fulfill({response:await route.fetch({url:backend+url.pathname+url.search})})
  }
  return route.continue()
 })
 const page=await context.newPage();page.on('pageerror',error=>report.errors.push(String(error)))
 try{
  await page.goto('http://127.0.0.1:5180/?workspace=tenant-a&view=market-data&area=testing&section=market-data')
  const table=page.getByTestId('data-desk-dataset-table'), row=table.locator('tbody tr').filter({has:page.getByText('GBP/USD',{exact:true})})
  await row.waitFor();const wrap=page.getByRole('region',{name:'Dữ liệu đã có',exact:true});await wrap.evaluate(e=>e.scrollLeft=e.scrollWidth)
  const widths=await table.locator('th').evaluateAll(items=>items.map(item=>item.getBoundingClientRect().width))
  await row.getByRole('button',{name:'Tải về',exact:true}).click();await row.getByRole('button',{name:'Tiến độ tải GBP/USD',exact:true}).waitFor()
  assert.equal(fullRequests,1);assert.equal(await page.locator('input[type=date]').count(),0)
  await page.screenshot({path:fileURLToPath(new URL(`integrated-progress-${theme}-${width}.png`,import.meta.url))})
  await table.locator('tbody tr').filter({has:page.getByText('GBP/USD',{exact:true})}).getByRole('button',{name:'Đã tải',exact:true}).waitFor()
  assert.deepEqual(await table.locator('th').evaluateAll(items=>items.map(item=>item.getBoundingClientRect().width)),widths)
  await row.getByRole('button',{name:'Thao tác dữ liệu GBP/USD',exact:true}).click()
  assert.equal(await page.getByRole('menuitem',{name:'Cập nhật',exact:true}).isDisabled(),true)
  await page.getByRole('menuitem',{name:'Xoá',exact:true}).click()
  const confirm=page.getByRole('dialog',{name:'Xoá dữ liệu',exact:true});await confirm.waitFor()
  assert.equal(deletes,0);await confirm.getByRole('button',{name:'Xoá',exact:true}).click()
  await confirm.waitFor({state:'detached'});assert.equal(deletes,1)
  await row.getByRole('button',{name:'Tải về',exact:true}).waitFor();assert.equal(await row.getByRole('button',{name:'Tải về',exact:true}).isEnabled(),true)
  await row.getByRole('button',{name:'Tải về',exact:true}).click();await row.getByRole('button',{name:'Tiến độ tải GBP/USD',exact:true}).waitFor()
  assert.equal(fullRequests,2);await row.getByRole('button',{name:'Tiến độ tải GBP/USD',exact:true}).click()
  const progress=page.getByRole('dialog',{name:'Tiến độ tải dữ liệu',exact:true});await progress.waitFor()
  await progress.getByText('Tổng dung lượng chưa xác định.',{exact:false}).waitFor()
  await progress.getByRole('button',{name:'Huỷ tải',exact:true}).click();await progress.waitFor({state:'detached'})
  await row.getByRole('button',{name:'Tải về',exact:true}).waitFor()
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true)
  entry.pass=true
 }catch(error){entry.pass=false;entry.error=String(error);await page.screenshot({path:fileURLToPath(new URL(`integrated-FAIL-${theme}-${width}.png`,import.meta.url))})}
 finally{await context.close()}
}
try{await run('dark',1710);await run('light',390)}finally{report.pass=report.cases.every(item=>item.pass)&&!report.errors.length;await writeFile(new URL('integration-ui-results.json',import.meta.url),JSON.stringify(report,null,2));await browser.close();console.log(JSON.stringify(report));if(!report.pass)process.exitCode=1}
