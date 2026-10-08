import assert from 'node:assert/strict'
import {chromium} from '../../../web/node_modules/playwright/index.mjs'
import {writeFile} from 'node:fs/promises'
import {fileURLToPath} from 'node:url'
const origin='http://127.0.0.1:5180',browser=await chromium.launch(),report={scope:'Shipped explicitly labeled UI demo; local GET only, no actual service mutations',cases:[],errors:[]}
const context=await browser.newContext({viewport:{width:1710,height:987}})
await context.routeWebSocket('**/*',s=>s.close());await context.route('**/*',route=>{const req=route.request(),u=new URL(req.url());return u.origin===origin&&req.method()==='GET'&&!/^\/api\/v2\/live/.test(u.pathname)?route.continue():route.abort()})
await context.addInitScript(()=>{localStorage.setItem('tw-theme','dark');localStorage.setItem('tw-language','en')})
const page=await context.newPage();page.setDefaultTimeout(8000);page.on('pageerror',e=>report.errors.push(String(e)))
try{
 for(const [view,section] of [['overview','dashboard'],['trade','trades'],['analytics','analytics'],['replay','sessions'],['journal','journal']]){
  const c={view};report.cases.push(c)
  await page.goto(`${origin}/?workspace=tenant-a&view=${view}&area=testing&section=${section}&demo=1&select=1`)
  await page.waitForFunction(()=>!document.querySelector('.fx-content .wm-skeleton')&&(document.querySelector('.fx-content')?.innerText.length||0)>100,null,{timeout:15000})
  const fullText=await page.locator('.fx-content').innerText()
  c.dates=fullText.match(/\b\d{2}\/\d{2}\/\d{4}(?: \d{2}:\d{2}(?::\d{2})?)?\b/g)||[]
  c.rawIsoDates=fullText.match(/\b\d{4}-\d{2}-\d{2}\b/g)||[]
  c.amPm=/\b(?:AM|PM)\b/.test(fullText)
  c.buttons=(await page.locator('.fx-content button').allTextContents()).map(t=>t.trim()).filter(Boolean).slice(0,16)
  if(view!=='analytics')assert(c.dates.length>0);assert.equal(c.rawIsoDates.length,0);assert.equal(c.amPm,false)
  await page.screenshot({path:fileURLToPath(new URL(`demo-${view}-en-1710.png`,import.meta.url))})
  if(view==='analytics'){
   let open=page.getByRole('button',{name:/Show filters|Hiện bộ lọc/});if(await open.count())await open.click()
   const button=page.getByRole('button',{name:'Backtesting date',exact:true});if(await button.count()){
    await button.click();const from=page.getByLabel('Analytics start date',{exact:true});await from.fill('29/02/2024');assert.equal(await from.inputValue(),'29/02/2024')
    const picker=from.locator('..').locator('.project-date-native');assert.equal(await picker.inputValue(),'2024-02-29')
    await from.fill('31/02/2024');assert.equal(await from.evaluate(el=>el.validity.valid),false)
    await page.getByRole('dialog',{name:'Backtesting close-date filter',exact:true}).getByRole('button',{name:'Clear',exact:true}).click();assert.equal(await from.inputValue(),'');assert.equal(await from.evaluate(el=>el.validity.valid),true);c.dateFilterClearPass=true
    await from.fill('01/09/2026');await page.getByLabel('Analytics end date',{exact:true}).fill('30/09/2026');await page.keyboard.press('Escape');await page.getByRole('button',{name:'Apply',exact:true}).click()
    const chip=page.locator('.fxa-filter-chips button').filter({hasText:'01/09/2026'});assert.equal(await chip.count(),1);assert.match(await chip.innerText(),/30\/09\/2026/);c.appliedDateChipPass=true
    await page.screenshot({path:fileURLToPath(new URL('demo-filter-en-1710.png',import.meta.url))})
   }
  }
 }
 report.pass=!report.errors.length
}catch(e){report.pass=false;report.error=String(e)}finally{await writeFile(new URL('demo-results.json',import.meta.url),JSON.stringify(report,null,2));await context.close();await browser.close();console.log(JSON.stringify(report));if(!report.pass)process.exitCode=1}
