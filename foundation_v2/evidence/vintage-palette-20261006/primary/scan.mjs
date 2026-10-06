import { chromium } from '../../../web/node_modules/playwright/index.mjs'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
const out=path.dirname(fileURLToPath(import.meta.url))
await mkdir(out,{recursive:true})
const browser=await chromium.launch({headless:true})
const records=[]
const routes=[
 ['overview','area=testing&section=dashboard&demo=1'],
 ['replay','area=testing&section=sessions&select=1&demo=1'],
 ['trade','area=testing&section=trades&select=1&sessions=all&demo=1'],
 ['analytics','area=testing&section=analytics&select=1&demo=1'],
 ['market-data','area=testing&section=market-data&demo=1'],
 ['live','area=live&section=calendar&demo=1'],
 ['playbook','area=strategies&section=my-strategies&demo=1'],
 ['research','area=strategies'], ['risk','surface=workspace'],
 ['trade','surface=workspace&intent=order'], ['journal','demo=1'], ['learn','area=education'], ['settings','area=settings'], ['data','area=strategies'],
]
for(const theme of ['dark','light']) {
 const context=await browser.newContext({viewport:{width:1377,height:987}})
 await context.addInitScript(theme=>{localStorage.setItem('tw-theme',theme);localStorage.setItem('tw-language','vi')},theme)
 await context.route('**/*',r=> {
  const u=new URL(r.request().url());return ['http://127.0.0.1:5180','http://127.0.0.1:8010'].includes(u.origin)&&['GET','HEAD','OPTIONS'].includes(r.request().method())?r.continue():r.abort()
 })
 const page=await context.newPage()
 for(const [view,query]of routes){
  const errors=[];const error=e=>errors.push(String(e));page.on('pageerror',error)
  await page.goto(`http://127.0.0.1:5180/?workspace=tenant-a&view=${view}&${query}`)
  await page.locator('.fx-app').waitFor()
  await page.locator('.wm-skeleton').waitFor({state:'hidden',timeout:12000})
  await page.waitForTimeout(300)
  const record=await page.evaluate(()=>{
   const root=document.querySelector('.fx-app'),s=getComputedStyle(root),colors={};
   for(const el of document.querySelectorAll('.fx-app *')){
    if(!el.checkVisibility()||['svg','path','circle','line','rect'].includes(el.localName))continue
    const c=getComputedStyle(el);for(const key of ['color','backgroundColor']){
     const value=c[key];if(value==='rgba(0, 0, 0, 0)')continue
     const k=key+':'+value; const row=colors[k]??={count:0,examples:[]};row.count++;if(row.examples.length<3)row.examples.push(el.localName+'.'+el.className)
    }
   }
   return {palette:['canvas','surface','primary','text','muted'].map(k=>[k,s.getPropertyValue('--project-'+k).trim()]),colors:Object.entries(colors).sort((a,b)=>b[1].count-a[1].count).slice(0,24),overflow:document.documentElement.scrollWidth>innerWidth}
  })
  records.push({theme,view,query,...record,errors})
  if(['overview','analytics','live','settings','journal'].includes(view))await page.screenshot({path:path.join(out,`${view}-${theme}.png`)})
  page.off('pageerror',error)
 }
 await context.close()
}
await browser.close()
await writeFile(path.join(out,'scan.json'),JSON.stringify(records,null,2))
console.log(JSON.stringify(records.map(({theme,view,overflow,errors})=>({theme,view,overflow,errors}))))
