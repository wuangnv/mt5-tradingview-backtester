import assert from 'node:assert/strict'
import { chromium } from '../../../web/node_modules/playwright/index.mjs'
import { readFile, writeFile, readdir } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { DEMO_ASSETS, DEMO_LIVE } from '../../../web/src/demoFixtures.js'
const out = 'foundation_v2/evidence/live-market-standard-20261007/independent/'
const src = 'foundation_v2/web/src/'
const names = (await readdir(src)).filter(name => /live|MarketAssetCatalog|market-sync|DemoPreview|demoFixtures|FxReplayShell|fx-shell-story|TestingIcon|testing-copy|testing-standard|FxSelect|fx-select|main.jsx|AnalyticsFilterControls|FxAnalytics|FxTradeLedger|SessionPicker|session-catalog/i.test(name))
const pins = () => Promise.all(names.map(async file => ({ file, sha256: createHash('sha256').update(await readFile(src + file)).digest('hex') })))
const report = { scope: 'r7 shared pagination layout: positive intercepted actual versus demo, Live controls and Testing regression', before: await pins(), cases: [], failures: [], errors: [], blocked: [] }
const browser = await chromium.launch({ headless: true, ignoreDefaultArgs: ['--hide-scrollbars'] })
const routes = [
  ['market-data', false, 'market-data', 'testing', 'market-data'], ['market-data', true, 'market-data', 'testing', 'market-data'],
  ['live-calendar', false, 'live', 'live', 'calendar'], ['live-trades', true, 'live', 'live', 'trades'],
  ['testing-trades', true, 'trade', 'testing', 'trades'], ['testing-analytics', true, 'analytics', 'testing', 'analytics'],
  ['testing-sessions', true, 'replay', 'testing', 'sessions'], ['data-desk', false, 'data', 'testing', 'market-data'],
]
try {
  for (const [theme, language, width] of [['dark', 'vi', 1440], ['light', 'en', 360]]) for (const [name, demo, view, area, section] of routes) {
    if (process.env.LAYOUT_DESKTOP_ONLY && (width !== 1440 || name === 'testing-sessions')) continue
    if (process.env.LAYOUT_MARKET_ONLY && !['market-data', 'data-desk'].includes(name)) continue
    const id = `r7-${demo ? 'demo' : 'fixture'}-${name}-${theme}-${language}-${width}`
    const context = await browser.newContext({ viewport: { width, height: 987 } }), page = await context.newPage()
    await page.addInitScript(({ theme, language }) => { localStorage.setItem('tw-theme', theme); localStorage.setItem('tw-language', language) }, { theme, language })
    await context.routeWebSocket('**/*', socket => socket.close())
    await context.route('**/*', route => { const req = route.request(), u = new URL(req.url()); if (!['http://127.0.0.1:5180', 'http://127.0.0.1:8010'].includes(u.origin) || !['GET', 'HEAD', 'OPTIONS'].includes(req.method())) { report.blocked.push({ id, method: req.method(), url: req.url() }); return route.abort() } return route.continue() })
    await context.route('**/api/v2/data/market-assets', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ...DEMO_ASSETS, source: 'Independent QA fixture' }) }))
    await context.route('**/api/v2/live/status', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ...DEMO_LIVE, status: 'ready', stale: false, source: 'Independent QA fixture' }) }))
    page.on('pageerror', error => report.errors.push({ id, error: String(error) }))
    const result = { id }
    try {
      const query = new URLSearchParams({ workspace: 'tenant-a', view, select: '1' }); if (name !== 'data-desk') { query.set('area', area); query.set('section', section) } if (demo) query.set('demo', '1')
      await page.goto('http://127.0.0.1:5180/?' + query); await page.waitForLoadState('networkidle')
      result.layout = await page.evaluate(() => {
        const box = e => { const r = e.getBoundingClientRect(); return { x: r.x, right: r.right, y: r.y, bottom: r.bottom, width: r.width, height: r.height, cy: r.y + r.height / 2 } }
        const visible = e => { const r = e.getBoundingClientRect(), s = getComputedStyle(e); return r.width > 0 && r.height > 0 && s.display !== 'none' && s.visibility !== 'hidden' }
        const content = document.querySelector('.fx-content'), css = getComputedStyle(content), tokenCss = getComputedStyle(document.querySelector('.market-assets,.live-workspace') || document.querySelector('.fx-app'))
        return { url: location.href, area: document.querySelector('.fx-app').getAttribute('data-ui-area'), docOverflow: document.documentElement.scrollWidth - innerWidth, content: box(content), font: css.fontFamily, expectedHeight: Number.parseFloat(tokenCss.getPropertyValue('--wm-control-height')), compactHeight: Number.parseFloat(tokenCss.getPropertyValue('--wm-icon-action-size')) || 32, pagers: [...document.querySelectorAll('.fx-content .fxa-pagination')].filter(visible).map(e => ({ box: box(e), display: getComputedStyle(e).display, rightInset: Number.parseFloat(getComputedStyle(e).paddingRight) + Number.parseFloat(getComputedStyle(e).borderRightWidth), children: [...e.children].filter(visible).map(e => ({ class: e.className, box: box(e) })), select: e.querySelector('.fx-select-trigger') ? box(e.querySelector('.fx-select-trigger')) : null })), buttons: [...document.querySelectorAll('.fx-content .fxa-button,.fx-content .fxr-button')].filter(visible).map(e => ({ text: e.getAttribute('aria-label') || e.textContent.trim(), compact: Boolean(e.closest('.fxa-pagination') || e.matches('.fxa-icon-button,.fxa-detail-button,.fxs-action-button')), font: getComputedStyle(e).fontFamily, parentFont: getComputedStyle(e.parentElement).fontFamily, box: box(e) })) }
      })
      assert.ok(result.layout.docOverflow <= 1)
      for (const button of result.layout.buttons) { assert.equal(button.font.split(',')[0].replaceAll('"', ''), button.parentFont.split(',')[0].replaceAll('"', ''), 'shared action font differs from component'); assert.ok(button.box.height >= (button.compact ? result.layout.compactHeight : result.layout.expectedHeight) - 0.5) }
      for (const pager of result.layout.pagers) {
        assert.equal(pager.display, 'flex', 'pager relies on lazy consumer CSS')
        assert.ok(pager.box.right <= result.layout.content.right + 1)
        if (pager.select) {
          assert.equal(pager.select.height, result.layout.expectedHeight)
          if (width === 1440) { assert.ok(pager.select.width < pager.box.width / 2, 'row selector expands full pager width'); assert.ok(Math.abs(pager.children[0].box.cy - pager.select.cy) <= 1, 'desktop row selector wraps below pager'); assert.ok(Math.abs(pager.box.right - pager.rightInset - pager.select.right) <= 2, 'row selector not aligned right') }
        }
      }
      if (name === 'market-data' || name === 'data-desk') assert.ok(result.layout.pagers.length > 0, 'positive catalog pager absent')
      await page.screenshot({ path: out + id + '.png' }); report.cases.push(result)
    } catch (error) { report.failures.push({ id, error: String(error), result }); await page.screenshot({ path: out + id + '-failure.png' }) }
    finally { await context.close(); await writeFile(out + 'layout-delta-progress.json', JSON.stringify(report, null, 2)) }
  }
  report.after = await pins(); report.sourceUnchanged = JSON.stringify(report.before) === JSON.stringify(report.after)
  assert.equal(report.failures.length, 0); assert.equal(report.errors.length, 0); assert.equal(report.blocked.length, 0); assert.ok(report.sourceUnchanged); report.pass = true
} catch (error) { report.failure = String(error); process.exitCode = 1 }
finally { await browser.close(); await writeFile(out + 'layout-delta-report.json', JSON.stringify(report, null, 2)); console.log(JSON.stringify({ pass: report.pass, cases: report.cases.length, failures: report.failures.map(({ id, error }) => ({ id, error })), errors: report.errors, blocked: report.blocked, sourceUnchanged: report.sourceUnchanged })) }
