import assert from 'node:assert/strict'
import { chromium } from '../../web/node_modules/playwright/index.mjs'
import { writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
const browser=await chromium.launch(), report={scope:'Actual local cached service GET; all mutations and external endpoints blocked.',cases:[]}
try {
 for(const [theme,width] of [['dark',1440],['light',360]]) {
  const context=await browser.newContext({viewport:{width,height:987}}), entry={theme,width}; report.cases.push(entry)
  await context.addInitScript(theme=>{localStorage.setItem('tw-theme',theme);localStorage.setItem('tw-language','vi')},theme)
  let mutations=0
  await context.routeWebSocket('**/*',socket=>socket.close())
  await context.route('**/*',route=>{const request=route.request(),url=new URL(request.url());if(url.origin!=='http://127.0.0.1:5180'||/^\/api\/v2\/(live|data\/(providers|market-assets))/.test(url.pathname))return route.abort();if(!['GET','HEAD','OPTIONS'].includes(request.method())){mutations++;return route.abort()}return route.continue()})
  const page=await context.newPage()
  try {
   await page.goto('http://127.0.0.1:5180/?workspace=tenant-a&view=market-data&area=testing&section=market-data')
   const toolbar=page.locator('.data-library-toolbar'), drawer=page.getByRole('dialog',{name:'Danh mục tài sản',exact:true})
   await toolbar.getByRole('button',{name:'Hiện bộ lọc dữ liệu',exact:true}).click()
   await toolbar.getByRole('button',{name:'Danh mục tài sản',exact:true}).click(); await drawer.waitFor()
   const source=drawer.getByRole('button',{name:'Nguồn dữ liệu',exact:true})
   await source.click(); await drawer.getByRole('option',{name:'Dukascopy',exact:true}).click()
   assert.equal((await toolbar.getByRole('button',{name:'Nguồn dữ liệu',exact:true}).innerText()).trim(),'Tất cả nguồn')
   await page.screenshot({path:fileURLToPath(new URL(`actual-${theme}-${width}.png`,import.meta.url))})
   await page.keyboard.press('Escape'); await drawer.waitFor({state:'detached'})
   await toolbar.getByRole('button',{name:'Nguồn dữ liệu',exact:true}).click(); await toolbar.getByRole('option',{name:'Dukascopy',exact:true}).click()
   await toolbar.getByRole('button',{name:'Danh mục tài sản',exact:true}).click(); assert.equal((await source.innerText()).trim(),'Dukascopy')
   assert.equal(mutations,0); entry.pass=true
  }catch(error){entry.pass=false;entry.error=String(error)}finally{await context.close()}
 }
}finally{report.pass=report.cases.every(item=>item.pass);await writeFile(new URL('actual-results.json',import.meta.url),JSON.stringify(report,null,2));await browser.close();console.log(JSON.stringify(report));if(!report.pass)process.exitCode=1}
