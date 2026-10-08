import { chromium } from '../../../web/node_modules/playwright/index.mjs'
import { writeFile } from 'node:fs/promises'
const browser=await chromium.launch(),report=[]
for(const theme of ['dark','light']) {
 const c=await browser.newContext({viewport:{width:1710,height:987}})
 await c.addInitScript(theme=>{localStorage.setItem('tw-theme',theme);localStorage.setItem('tw-language','vi')},theme)
 await c.routeWebSocket('**/*',s=>s.close())
 await c.route('**/*',r=>{const u=new URL(r.request().url());return u.origin==='http://127.0.0.1:5180'&&!u.pathname.startsWith('/api/v2/live')&&['GET','HEAD','OPTIONS'].includes(r.request().method())?r.continue():r.abort()})
 const p=await c.newPage();await p.goto('http://127.0.0.1:5180/?workspace=tenant-a&view=market-data&area=testing&section=market-data');await p.locator('.rd-table tbody tr').first().waitFor()
 report.push({theme,headers:await p.locator('.rd-table th').allTextContents()})
 if(report.at(-1).headers.length!==9)throw Error('Expected nine columns')
 await p.locator('.data-library-search input').fill('EUR/USD');await p.screenshot({path:new URL(`actual-${theme}.png`,import.meta.url).pathname.replace(/^\//,'')});await c.close()
}
await browser.close();await writeFile(new URL('actual-results.json',import.meta.url),JSON.stringify(report,null,2));console.log(JSON.stringify(report))
