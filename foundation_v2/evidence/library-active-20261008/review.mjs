import assert from 'node:assert/strict'
import {chromium} from '../../web/node_modules/playwright/index.mjs'
import {expect} from '../../web/node_modules/playwright/test.mjs'
import {mkdir,writeFile,readFile} from 'node:fs/promises'
import {createHash} from 'node:crypto'
import {fileURLToPath} from 'node:url'
const origin='http://127.0.0.1:5180',out=new URL('./',import.meta.url)
await mkdir(out,{recursive:true})
const browser=await chromium.launch(),report={scope:'Isolated mocked API at actual frontend5180; ALL API intercepted; no actual backend/provider/download action.',cases:[],errors:[]}
async function run({theme,width,lang,mode='new',supportsPause=true}) {
 const c={theme,width,lang,mode,supportsPause};report.cases.push(c)
 const ctx=await browser.newContext({viewport:{width,height:987}});ctx.setDefaultTimeout(8000)
 await ctx.addInitScript(({theme,lang})=>{localStorage.setItem('tw-theme',theme);localStorage.setItem('tw-language',lang)},{theme,lang})
 const assets=Array.from({length:32},(_,i)=>({instrument_id:i===0?'EUR/USD':`Z${String(i).padStart(2,'0')}`,name:`Asset ${i}`,provider:i%2?'local-csv':'Dukascopy',provider_id:i%2?'local-csv':'dukascopy-catalog',asset_class:i%4<2?'fx':'metal'}))
 const datasets=assets.filter((_,i)=>i%3===0&&(i!==0||mode==='update')).map((a,i)=>({...a,dataset_id:`d${a.instrument_id}`,timeframe:'M1',row_count:320,size_bytes:20000,available_range:{from_utc:'2026-10-01T00:00:00Z',to_utc:'2026-10-07T23:59:00Z'},created_at_utc:`2026-10-${String(i+1).padStart(2,'0')}T00:00:00Z`,source:{provider:a.provider}}))
 let job={job_id:'qa-job',instrument_id:'EUR/USD',status:mode==='queued'?'queued':'running',from_date:'2003-05-04',to_date:'2026-10-07',completed_days:100,total_days:8557,transferred_bytes:2330000,stage:'downloading'},pauseReads=0
 const requests=[],unexpected=[],fulfill=(route,data,status=200)=>route.fulfill({status,contentType:'application/json',body:JSON.stringify(data)})
 await ctx.routeWebSocket('**/*',s=>s.close())
 await ctx.route('**/*',async route=>{
  const req=route.request(),u=new URL(req.url())
  if(u.origin!==origin)return route.abort()
  if(u.pathname.startsWith('/api/')) {
   if(u.pathname==='/api/v2/data/datasets')return fulfill(route,{items:mode==='empty'?[]:datasets,catalog_items:mode==='empty'?[]:assets,catalog_state:{configured:true,status:'cached',item_count:32,refresh_available:false,retrieved_at_utc:'2026-10-08T00:00:00Z'},download_state:{available:true,supports_full:true,supported_instruments:['EUR/USD'],earliest_dates:{'EUR/USD':'2003-05-04'}}})
   if(u.pathname==='/api/v2/data/downloads') {
    if(job.status==='pausing'&&++pauseReads>=2)job={...job,status:'paused'}
    return fulfill(route,{items:mode==='empty'?[]:[job],available:true,supports_pause:supportsPause})
   }
   const action=u.pathname.match(/^\/api\/v2\/data\/downloads\/qa-job\/(pause|resume|cancel)$/)?.[1]
   if(action&&req.method()==='POST') {
    requests.push(action)
    if(mode==='error')return fulfill(route,{detail:{code:'source_unavailable'}},503)
    job={...job,status:action==='pause'?'pausing':action==='resume'?'running':'cancelled'};pauseReads=0
    return fulfill(route,job)
   }
   if(!['GET','HEAD','OPTIONS'].includes(req.method()))unexpected.push(`${req.method()} ${u.pathname}`)
   return fulfill(route,{items:[]})
  }
  if(!['GET','HEAD','OPTIONS'].includes(req.method())){unexpected.push(`${req.method()} ${u.pathname}`);return route.abort()}
  return route.continue()
 })
 const page=await ctx.newPage();page.on('pageerror',e=>report.errors.push(String(e)))
 const vi=lang==='vi',names=vi?['Danh mục','Nguồn dữ liệu','Trạng thái tải','Sắp xếp dữ liệu']:['Category','Data source','Download status','Sort data']
 const toolbar=page.locator('.data-library-toolbar'),select=n=>toolbar.getByRole('button',{name:names[n],exact:true}),rows=page.locator('.rd-table tbody tr'),eur=rows.filter({has:page.locator('td:first-child strong',{hasText:'EUR/USD'})})
 const choose=async(n,v)=>{await select(n).click();await page.getByRole('option',{name:v,exact:true}).click()},clear=toolbar.getByRole('button',{name:vi?'Xóa bộ lọc':'Clear filters',exact:true})
 const screenshot=async suffix=>page.screenshot({path:fileURLToPath(new URL(`${mode}-${theme}-${width}-${lang}-${supportsPause}-${suffix}.png`,out))})
 try {
  await page.goto(`${origin}/?workspace=tenant-a&view=market-data&area=testing&section=market-data`);await page.locator('.rd-table thead').waitFor({timeout:15000})
  await expect(clear).toBeDisabled();assert.equal(await page.locator('.data-library-filter-toggle').count(),0)
  if(mode==='empty'){await expect(rows).toHaveCount(0);await screenshot('empty');c.pass=true;return}
  await expect(eur.locator('.data-library-progress')).toHaveCount(1);await expect(eur.locator('.data-library-more')).toHaveCount(0)
  await expect(eur.locator('td:nth-child(7)')).toHaveText(mode==='queued'?(vi?'Đang chờ tải':'Queued'):(vi?'Đang tải':'Downloading'))
  if(mode==='new'){await expect(eur.locator('td:nth-child(4)')).toContainText('2003-05-04');await expect(eur.locator('td:nth-child(4)')).toContainText(vi?'Có sẵn':'Available');await expect(eur.locator('td:nth-child(5)')).toHaveText(vi?'Sau khi tải':'After download');await expect(eur.locator('td:nth-child(6)')).toContainText(vi?'Đã nhận':'Received')}
  if(mode==='update'){await expect(eur.locator('td:nth-child(5)')).toHaveText('320');await expect(eur.locator('td:nth-child(6)')).toContainText('KiB')}
  const pause=eur.getByRole('button',{name:vi?'Tạm dừng':'Pause',exact:true}),cancel=eur.getByRole('button',{name:vi?'Huỷ tải':'Cancel download',exact:true})
  await expect(cancel).toBeEnabled();supportsPause?await expect(pause).toBeEnabled():await expect(pause).toBeDisabled()
  await eur.locator('td:last-child').scrollIntoViewIfNeeded();await screenshot('running')
  c.geometry=await eur.locator('td:last-child').evaluate(td=>{const b=td.getBoundingClientRect();return [...td.querySelectorAll('button')].map(el=>{const r=el.getBoundingClientRect();return {class:el.className,x:r.x-b.x,width:r.width,cellWidth:b.width,label:el.getAttribute('aria-label'),clippedText:[...el.querySelectorAll('span:not(.data-library-progress-fill)')].some(s=>s.scrollWidth>s.clientWidth+1)}})})
  assert(c.geometry.every(x=>x.x>=-1&&x.x+x.width<=x.cellWidth+1),'row controls overflow cell');assert(c.geometry.every(x=>!x.clippedText),'progress text clipped')
  // Make sure filter identifies both new downloads and updates of an existing dataset.
  await choose(2,vi?'Đang tải':'Downloading');await expect(rows).toHaveCount(1);await expect(eur).toHaveCount(1)
  await clear.click();await expect(clear).toBeDisabled()
  await choose(3,vi?'Tên Z–A':'Name Z–A')
  await page.locator('.wm-pagination-size button').click();await page.getByRole('option',{name:'10',exact:true}).click();await page.locator('.wm-pagination-pages > button:nth-last-child(2)').click();await expect(page.locator('.wm-pagination-number.is-current')).toHaveText('2')
  await choose(0,'Forex');await choose(1,'local-csv');await choose(2,vi?'Đã tải':'Downloaded');await toolbar.locator('input[type=search]').fill('Z09');await expect(rows).toHaveCount(1)
  await clear.click();await expect(clear).toBeDisabled();await expect(select(3)).toContainText(vi?'Tên Z–A':'Name Z–A');await expect(page.locator('.wm-pagination-number.is-current')).toHaveText('1');await expect(toolbar.locator('input[type=search]')).toHaveValue('');await expect(rows).toHaveCount(10);await expect(rows.first().locator('td:first-child strong')).toHaveText('Z31')
  await toolbar.locator('input[type=search]').fill('EUR/USD');await expect(rows).toHaveCount(1)
  if(mode==='error'){await pause.click();await expect(page.locator('.data-library-download-error')).toBeVisible();await expect(pause).toBeEnabled();await expect(eur.locator('td:nth-child(7)')).toHaveText(vi?'Đang tải':'Downloading');await screenshot('error');assert.deepEqual(requests,['pause'])}
  else if(!supportsPause){await cancel.click();await expect(eur.locator('.data-library-progress')).toHaveCount(0);assert.deepEqual(requests,['cancel'])}
  else {
   await pause.focus();await page.keyboard.press('Space');await expect(eur.locator('td:nth-child(7)')).toHaveText(vi?'Đang tạm dừng…':'Pausing…');await expect(pause).toBeDisabled();await expect(cancel).toBeEnabled();await screenshot('pausing')
   if(mode==='cancel-pausing') {
    await eur.locator('.data-library-progress').click();const dialog=page.locator('.data-library-dialog[open]');await expect(dialog.getByRole('button',{name:vi?'Huỷ tải':'Cancel download',exact:true})).toBeEnabled();await screenshot('dialog-pausing');await dialog.getByRole('button',{name:vi?'Huỷ tải':'Cancel download',exact:true}).click();await expect(dialog).toHaveCount(0);await expect(eur.locator('.data-library-progress')).toHaveCount(0);assert.deepEqual(requests,['pause','cancel'])
   } else {
   const resume=eur.getByRole('button',{name:vi?'Tiếp tục tải':'Resume download',exact:true});await expect(resume).toBeEnabled({timeout:7000});await expect(eur.locator('td:nth-child(7)')).toHaveText(vi?'Đã tạm dừng':'Paused');await screenshot('paused')
   await choose(2,vi?'Đang tải':'Downloading');await expect(rows).toHaveCount(0);await expect(page.locator('[data-testid=data-desk-empty]')).toHaveCount(1);await clear.click();await toolbar.locator('input[type=search]').fill('EUR/USD')
   await page.reload();await expect(resume).toBeEnabled();await expect(eur.locator('td:nth-child(7)')).toHaveText(vi?'Đã tạm dừng':'Paused')
   await resume.click();await expect(pause).toBeEnabled();await expect(eur.locator('td:nth-child(7)')).toHaveText(vi?'Đang tải':'Downloading')
   await cancel.click();await expect(eur.locator('.data-library-progress')).toHaveCount(0);await expect(eur.locator('.data-library-more')).toHaveCount(1);assert.deepEqual(requests,['pause','resume','cancel'])
   }
  }
  assert.equal(unexpected.length,0);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);c.actions=requests;c.pass=true
 }catch(e){c.pass=false;c.error=String(e);await screenshot('FAIL').catch(()=>{})}
 finally{await ctx.close()}
}
try {
 for(const theme of ['dark','light'])for(const [width,lang] of [[1710,'vi'],[768,'en'],[360,'en']])await run({theme,width,lang})
 for(const [mode,supportsPause] of [['update',true],['new',false],['empty',true],['error',true],['queued',true],['cancel-pausing',true]])await run({theme:'dark',width:1710,lang:'vi',mode,supportsPause})
}finally{report.pass=report.cases.every(c=>c.pass)&&!report.errors.length;report.sourceHashes={};for(const file of ['DataDeskWorkspace.jsx','DataLibraryProgress.jsx','dataLibraryModel.js','data-library.css','testing-copy.json'])report.sourceHashes[file]=createHash('sha256').update(await readFile(new URL(`../../web/src/${file}`,out))).digest('hex');await writeFile(new URL('results.json',out),JSON.stringify(report,null,2));await browser.close();console.log(JSON.stringify({pass:report.pass,cases:report.cases.length,failures:report.cases.filter(c=>!c.pass),errors:report.errors}));if(!report.pass)process.exitCode=1}
