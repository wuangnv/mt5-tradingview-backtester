import fs from 'node:fs/promises'
import { chromium } from 'playwright'

const origin = 'http://127.0.0.1:5180'
const out = process.env.TW_ALIGNMENT_EVIDENCE || '../evidence/component-alignment-20261009/primary'
const browser = await chromium.launch()
const routes = {
  reference: 'ui_reference=1', overview: 'view=overview&demo=1', sessions: 'view=replay&select=1&demo=1',
  trades: 'view=trade&sessions=all&select=1&demo=1', analytics: 'view=analytics&select=1&demo=1',
  market: 'view=market-data&demo=1', settings: 'view=settings', risk: 'view=risk&demo=1',
  research: 'view=research&demo=1', learn: 'view=learn', playbook: 'view=playbook&demo=1',
  journal: 'view=journal&demo=1', prop: 'view=prop', live: 'view=live&demo=1',
}
const results = [], errors = [], writes = []
await fs.mkdir(out, { recursive: true })
try {
  for (const theme of ['dark', 'light']) for (const width of [1710, 360]) {
    const context = await browser.newContext({ viewport: { width, height: 987 } })
    await context.addInitScript(theme => { localStorage.setItem('tw-theme', theme); localStorage.setItem('tw-language', 'vi') }, theme)
    await context.route('**/*', route => {
      const r = route.request(), url = new URL(r.url())
      if (url.origin !== origin) return route.abort()
      if (!['GET', 'HEAD', 'OPTIONS'].includes(r.method())) { writes.push(r.url()); return route.abort() }
      return route.continue()
    })
    const page = await context.newPage()
    page.on('pageerror', error => errors.push({ theme, width, error: error.message }))
    for (const [name, query] of Object.entries(routes)) {
      await page.goto(`${origin}/?workspace=tenant-a&area=testing&${query}`)
      await page.waitForLoadState('networkidle')
      const metrics = await page.evaluate(() => {
        const root = document.querySelector('.fx-content')
        const visible = e => e.getClientRects().length && getComputedStyle(e).visibility !== 'hidden'
        const box = e => e.getBoundingClientRect()
        const description = e => ({ tag: e.tagName, class: e.className?.baseVal ?? e.className, label: (e.getAttribute('aria-label') || e.textContent).trim().slice(0, 100) })
        const iconIssues = [], choiceIssues = []
        const controls = [...root.querySelectorAll('button,a,[role=tab],summary')].filter(visible)
        let checkedIcons = 0
        for (const e of controls) {
          const icon = [...e.children].find(c => c.tagName.toLowerCase() === 'svg')
          if (!icon || !visible(icon)) continue
          const b = box(e), i = box(icon), dy = i.y + i.height / 2 - b.y - b.height / 2
          checkedIcons++
          const noText = !e.textContent.trim(), dx = i.x + i.width / 2 - b.x - b.width / 2
          if (Math.abs(dy) > 2 || noText && Math.abs(dx) > 2) iconIssues.push({ ...description(e), dx, dy, width: b.width, height: b.height, display: getComputedStyle(e).display })
        }
        for (const e of root.querySelectorAll('label')) {
          const input = e.querySelector(':scope > input[type=checkbox],:scope > input[type=radio]')
          if (!input || !visible(e) || !visible(input)) continue
          const b = box(e), i = box(input)
          const dy = i.y + i.height / 2 - b.y - b.height / 2
          if (Math.abs(dy) > 2 && b.height <= 60) choiceIssues.push({ ...description(e), dy, display: getComputedStyle(e).display, margin: getComputedStyle(input).margin })
        }
        return { controlCount: controls.length, checkedIcons, iconIssues, choiceIssues,
          overflow: root.scrollWidth > root.clientWidth + 1, tables: root.querySelectorAll('table').length,
          dialogs: root.querySelectorAll('dialog').length, fields: root.querySelectorAll('input,textarea').length }
      })
      results.push({ name, theme, width, ...metrics })
      if (metrics.iconIssues.length || metrics.choiceIssues.length || metrics.overflow || name === 'reference') {
        await page.screenshot({ path: `${out}/${name}-${theme}-${width}.png`, fullPage: false })
      }
      console.log(`${theme} ${width} ${name}: icons=${metrics.iconIssues.length} choices=${metrics.choiceIssues.length} overflow=${metrics.overflow}`)
    }
    await context.close()
  }
  await fs.writeFile(`${out}/audit.json`, JSON.stringify({ kind: 'diagnostic candidates; visual review required', results, errors, writes }, null, 2))
} finally { await browser.close() }
