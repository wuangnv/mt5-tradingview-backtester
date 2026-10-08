import assert from 'node:assert/strict'
import {chromium} from '../../web/node_modules/playwright/index.mjs'
import {writeFile} from 'node:fs/promises'
const browser=await chromium.launch(),context=await browser.newContext(),origin='http://127.0.0.1:5180'
await context.addInitScript(()=>{localStorage.setItem('tw-language','vi')})
let finish,posts=0
await context.route('**/*',async route=>{
 const r=route.request(),u=new URL(r.url())
 if(u.origin!==origin||/^\/api\/v2\/(live|data\/(providers|market-assets))/.test(u.pathname))return route.abort()
 if(u.pathname==='/api/v2/data/datasets')return route.fulfill({json:{items:[],catalog_items:[],catalog_state:{configured:true,status:'cached',item_count:0,refresh_available:true}}})
 if(u.pathname==='/api/v2/data/downloads')return route.fulfill({json:{items:[],available:false}})
 if(u.pathname==='/api/v2/data/catalog/refresh'){posts++;await new Promise(resolve=>finish=resolve);return route.abort().catch(()=>{})}
 if(!['GET','HEAD','OPTIONS'].includes(r.method()))return route.abort()
 return route.continue()
})
const page=await context.newPage(),report={scope:'Delayed mocked POST and virtual browser clock, no real catalog write'}
try{
 await page.goto(origin+'/?workspace=tenant-a&view=market-data&area=testing&section=market-data')
 await page.getByRole('button',{name:'Danh mục tài sản',exact:true}).click()
 const drawer=page.getByRole('dialog',{name:'Danh mục tài sản',exact:true})
 await page.clock.install()
 await drawer.getByRole('button',{name:'Cập nhật danh mục',exact:true}).click()
 await drawer.locator('.data-library-update-overlay').waitFor()
 await page.clock.runFor(44000);assert.equal(await drawer.getAttribute('aria-busy'),'true')
 await page.clock.runFor(1001)
 await drawer.locator('.data-library-update-overlay').waitFor({state:'detached'})
 await drawer.getByText('Không cập nhật được danh sách Dukascopy.',{exact:true}).waitFor()
 assert.equal(await drawer.getByRole('button',{name:'Đóng',exact:true}).isEnabled(),true)
 assert.equal(posts,1);report.pass=true
}catch(e){report.pass=false;report.error=String(e);process.exitCode=1}
finally{finish?.();await context.close();await browser.close();await writeFile(new URL('timeout-results.json',import.meta.url),JSON.stringify(report,null,2));console.log(JSON.stringify(report))}
