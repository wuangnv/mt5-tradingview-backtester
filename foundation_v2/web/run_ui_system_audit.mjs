import { chromium } from 'playwright'
import { mkdir, writeFile, readdir, readFile } from 'node:fs/promises'

const out = process.env.TW_SYSTEM_EVIDENCE || '../evidence/compact-system-20261009'
const phase = process.env.TW_SYSTEM_PHASE || 'before'
await mkdir(`${out}/${phase}`, { recursive: true })
const sources = []
for (const dir of ['src', 'public']) {
  for (const file of await readdir(dir)) {
    if (!file.endsWith('.css')) continue
    const css = await readFile(`${dir}/${file}`, 'utf8')
    sources.push({ file:`${dir}/${file}`, lines:css.split('\n').length,
      values:Object.fromEntries(['font-size','font-weight','border-radius','transition','animation'].map(key => [key,
        Array.from(new Set(Array.from(css.matchAll(new RegExp(`(?<![-\\w])${key}\\s*:\\s*([^;}]+)`, 'g')), m => m[1].trim())))])),
      literals:[...new Set(css.match(/#[a-fA-F0-9]{3,8}\b/g) || [])] })
  }
}
await writeFile(`${out}/${phase}/sources.json`, JSON.stringify(sources, null, 2))
const routes = [
  ['dashboard','overview','testing','dashboard'], ['sessions','replay','testing','sessions','&select=1'],
  ['trades','trade','testing','trades','&demo=1'], ['analytics','analytics','testing','analytics','&demo=1'],
  ['prop','prop','testing','prop'], ['market-data','market-data','testing','market-data'],
  ['research','research','research','research'], ['journal','journal','testing','journal'],
  ['risk','risk','research','risk'], ['playbook','playbook','testing','playbook'],
  ['learn','learn','learn','learn'], ['settings','settings','testing','settings'],
  ['live','live','live','market'], ['reference','overview','testing','dashboard','&ui_reference=1'],
]
const browser = await chromium.launch({headless:true, ignoreDefaultArgs:['--hide-scrollbars']})
const report = [], errors = []
try {
  for (const theme of ['dark','light']) {
    const page = await browser.newPage({viewport:{width:1710,height:987}})
    await page.addInitScript(theme => { localStorage.setItem('tw-theme',theme); localStorage.setItem('tw-language','vi') }, theme)
    await page.route('**/api/**', route => route.request().method() === 'GET' ? route.continue() : route.abort())
    page.on('pageerror', e => errors.push(e.message))
    for (const [name,view,area,section,extra=''] of routes) {
      await page.goto(`http://127.0.0.1:5180/?workspace=tenant-a&view=${view}&area=${area}&section=${section}${extra}`)
      await page.locator('.fx-content > :not(.wm-skeleton)').first().waitFor({timeout:15000})
      await page.waitForLoadState('networkidle', {timeout:8000}).catch(() => {})
      const measures = await page.locator('.fx-content :is(button,a,input,select,textarea,h1,h2,h3)').evaluateAll(elements => elements.filter(e => e.getBoundingClientRect().width && e.getBoundingClientRect().height).map(e => {
        const s = getComputedStyle(e), b=e.getBoundingClientRect()
        return {tag:e.tagName,class:e.className,text:(e.getAttribute('aria-label') || e.textContent || '').trim().slice(0,90),
          width:Math.round(b.width),height:Math.round(b.height),font:s.fontSize,weight:s.fontWeight,line:s.lineHeight,
          radius:s.borderRadius,border:s.borderTopWidth,color:s.color,bg:s.backgroundColor,transition:s.transition,animation:s.animationName}
      }))
      report.push({name,theme,overflow:await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),measures})
      console.log(`${phase}: ${name} ${theme} (${measures.length} controls/text)`)
      if (['dashboard','market-data','analytics','settings','reference'].includes(name)) await page.screenshot({path:`${out}/${phase}/${name}-${theme}.png`,fullPage:true,animations:'disabled'})
      if (name === 'dashboard') {
        await page.locator('.fx-dashboard-quick-action').first().click()
        await page.waitForFunction(()=>{const trigger=document.querySelector('.quick-session-strategy .fx-select-trigger');return trigger && !trigger.disabled})
        await page.waitForFunction(()=>{const trigger=document.querySelector('.dataset-asset-select .fx-select-trigger');return trigger && !trigger.disabled})
        await page.screenshot({path:`${out}/${phase}/create-${theme}.png`,animations:'disabled'})
        const controls = await page.locator('.quick-session-dialog :is(button,input,textarea)').evaluateAll(elements => elements.filter(e => e.getBoundingClientRect().width).map(e => {
          const s=getComputedStyle(e);return {class:e.className,text:(e.textContent || '').trim().slice(0,45),height:e.getBoundingClientRect().height,font:s.fontSize,radius:s.borderRadius}
        }))
        report.push({name:'create',theme,measures:controls})
      }
    }
    await page.close()
  }
} finally { await browser.close() }
await writeFile(`${out}/${phase}/runtime.json`, JSON.stringify({report,errors},null,2))
console.log(JSON.stringify({routes:report.length,errors,controls:report.reduce((n,r)=>n+r.measures.length,0),heights:[...new Set(report.flatMap(r=>r.measures.filter(m=>m.tag==='BUTTON').map(m=>m.height)))].sort((a,b)=>a-b)}))
