import { chromium } from '../../../web/node_modules/playwright/index.mjs'
import { mkdir, writeFile } from 'node:fs/promises'

const out = 'foundation_v2/evidence/testing-alignment-20261007/primary'
await mkdir(out, { recursive: true })
const browser = await chromium.launch({ headless: true, ignoreDefaultArgs: ['--hide-scrollbars'] })
const receipt = { cases: [], errors: [], blockedWrites: [] }
const routes = { dashboard: 'view=overview', sessions: 'view=replay&select=1&session=476f4b498e1a49ed9d48a75719f4d270', trades: 'view=trade&select=1&sessions=all', analytics: 'view=analytics&select=1&demo=1', prop: 'view=analytics&select=1&analytics_source=prop', market: 'view=market-data', data: 'view=data', reference: 'ui_reference=1' }
try {
  for (const [theme, language, width] of [['dark','vi',1440], ['light','en',768], ['dark','vi',360]]) {
    const context = await browser.newContext({ viewport: { width, height: 987 }, reducedMotion: 'reduce' })
    await context.addInitScript(({theme, language}) => { localStorage.setItem('tw-theme',theme); localStorage.setItem('tw-language',language) }, {theme, language})
    await context.routeWebSocket('**/*', socket => socket.close())
    await context.route('**/*', route => {
      const request = route.request()
      if (!['GET','HEAD','OPTIONS'].includes(request.method())) { receipt.blockedWrites.push(request.url()); return route.abort() }
      if (!['http://127.0.0.1:5180','http://127.0.0.1:8010'].includes(new URL(request.url()).origin)) return route.abort()
      return route.continue()
    })
    const page = await context.newPage()
    page.setDefaultTimeout(12000)
    page.on('pageerror', error => receipt.errors.push(String(error)))
    for (const [name, query] of Object.entries(routes)) {
      await page.goto(`http://127.0.0.1:5180/?workspace=tenant-a&area=testing&${query}`)
      await page.waitForLoadState('networkidle')
      const controls = await page.evaluate(() => [...document.querySelectorAll('.fx-content button, .fx-content a, .fx-subnav a, .fx-dashboard-metric > span')].flatMap(element => {
        const box = element.getBoundingClientRect(), style = getComputedStyle(element)
        if (!box.width || !box.height) return []
        const icons = [...element.querySelectorAll(':scope > svg, :scope > .fx-dashboard-metric-icon > svg, :scope > .fx-subnav-icon > svg')]
        return icons.map(icon => {
          const rect = icon.getBoundingClientRect()
          if (!rect.width || !rect.height) return null
          return { class:element.className, text:(element.innerText || element.getAttribute('aria-label') || '').slice(0,70), display:style.display, align:style.alignItems, lineHeight:style.lineHeight, height:box.height, iconWidth:rect.width, iconHeight:rect.height, centerDelta:+(rect.y + rect.height/2 - box.y - box.height/2).toFixed(2) }
        }).filter(Boolean)
      }))
      receipt.cases.push({name, theme, language, width, controls, overflow:await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)})
      await page.screenshot({path:`${out}/${name}-${theme}-${language}-${width}.png`, fullPage:true})
    }
    await context.close()
  }
} finally { await browser.close(); await writeFile(`${out}/audit.json`, JSON.stringify(receipt,null,2)); console.log(JSON.stringify({cases:receipt.cases.length,errors:receipt.errors,blockedWrites:receipt.blockedWrites,misaligned:receipt.cases.flatMap(c => c.controls.filter(x => Math.abs(x.centerDelta)>1).map(x => ({name:c.name,width:c.width,...x})))},null,2)) }
