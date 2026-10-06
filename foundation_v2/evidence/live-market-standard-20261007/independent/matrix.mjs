import assert from 'node:assert/strict'
import { chromium } from '../../../web/node_modules/playwright/index.mjs'
import { readFile, writeFile, readdir } from 'node:fs/promises'
import { createHash } from 'node:crypto'

const out = 'foundation_v2/evidence/live-market-standard-20261007/independent/'
const src = 'foundation_v2/web/src/'
const files = (await readdir(src)).filter(name => /live|MarketAssetCatalog|market-sync|DemoPreview|demoFixtures|demoMode|FxReplayShell|fx-shell-story|TestingReadState|TestingIcon|FxSelect|fx-select|testing-copy|testing-standard|component-interactions|page-layout|testingLocale|workspaceContext|main.jsx/i.test(name))
const pins = () => Promise.all(files.map(async file => ({ file, sha256: createHash('sha256').update(await readFile(src + file)).digest('hex') })))
const report = { cases: [], failures: [], errors: [], blocked: [], before: await pins(), stage: process.env.LIVE_DIAGNOSTIC ? 'diagnostic-not-acceptance' : 'frozen-acceptance' }
const browser = await chromium.launch({ headless: true, ignoreDefaultArgs: ['--hide-scrollbars'] })
const routes = ['market-data', 'calendar', 'trades', 'notes', 'tag-analytics', 'analytics', 'trading-accounts', 'transactions']

async function run(section, demo, theme, language, width) {
  const name = `${demo ? 'demo' : 'actual'}-${section}-${theme}-${language}-${width}`
  report.phase = name
  const context = await browser.newContext({ viewport: { width, height: 987 } })
  const page = await context.newPage()
  const result = { name }
  await page.addInitScript(({ theme, language }) => {
    localStorage.setItem('tw-theme', theme)
    localStorage.setItem('tw-language', language)
  }, { theme, language })
  await context.routeWebSocket('**/*', socket => socket.close())
  await context.route('**/*', route => {
    const req = route.request(), url = new URL(req.url())
    if (!['http://127.0.0.1:5180', 'http://127.0.0.1:8010'].includes(url.origin) || !['GET', 'HEAD', 'OPTIONS'].includes(req.method())) {
      report.blocked.push({ name, method: req.method(), url: req.url() }); return route.abort()
    }
    return route.continue()
  })
  page.on('pageerror', error => report.errors.push({ name, error: String(error) }))
  try {
    const market = section === 'market-data', transactions = section === 'transactions'
    const query = new URLSearchParams({ workspace: 'tenant-a', view: market ? 'market-data' : 'live', area: market ? 'testing' : 'live', section: transactions ? 'trading-accounts' : section })
    if (transactions) query.set('account_tab', 'transactions')
    if (demo) query.set('demo', '1')
    await page.goto('http://127.0.0.1:5180/?' + query)
    await page.waitForLoadState('networkidle')
    const shell = page.getByTestId('fxreplay-shell')
    assert.equal(await shell.getAttribute('data-theme'), theme)
    assert.equal(await shell.getAttribute('lang'), language)
    result.url = page.url()
    result.content = await page.locator('.fx-content').innerText()
    if (demo && width === 360) await page.screenshot({ path: out + name + '-landing.png' })
    result.inventory = await page.evaluate(() => {
      const visible = e => { const r = e.getBoundingClientRect(), s = getComputedStyle(e); return r.width > 0 && r.height > 0 && s.display !== 'none' && s.visibility !== 'hidden' }
      const rect = e => { const r = e.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height, cy: r.y + r.height / 2 } }
      const content = document.querySelector('.fx-content')
      const controls = [...content.querySelectorAll('button,a,summary')].filter(visible).flatMap(e => [...e.querySelectorAll(':scope > svg')].filter(visible).map(icon => ({ label: e.getAttribute('aria-label') || e.textContent.trim(), control: rect(e), icon: rect(icon), dy: rect(icon).cy - rect(e).cy })))
      return { docOverflow: document.documentElement.scrollWidth - innerWidth, headings: [...content.querySelectorAll('h1:not(.sr-only)')].filter(visible).map(e => e.childNodes[0]?.textContent.trim() || e.textContent.trim()), navTitles: [...document.querySelectorAll('.fx-subnav a[aria-current="page"]')].map(e => e.textContent.trim()), reloads: [...content.querySelectorAll('button')].filter(visible).map(e => e.getAttribute('aria-label') || e.textContent.trim()).filter(text => /^(Tải lại|Reload|Refresh)( notes)?$/i.test(text)), controls, fields: [...content.querySelectorAll('input,.fx-select-trigger')].filter(visible).map(e => ({ label: e.getAttribute('aria-label') || e.textContent.trim(), box: rect(e) })) }
    })
    assert.ok(result.inventory.docOverflow <= 1, 'page-level horizontal overflow')
    assert.equal(result.inventory.headings.filter(title => result.inventory.navTitles.includes(title)).length, 0, 'duplicate page h1 repeats selected child-nav title')
    assert.equal(result.inventory.reloads.length, 0, 'manual reload button')
    assert.equal(result.inventory.controls.filter(item => item.icon.width <= 24 && Math.abs(item.dy) > 1).length, 0, 'inline content SVG center alignment')
    if (!market) {
      assert.ok(!/PREP_ONLY|FAIL-CLOSED|External write|permission boundary/i.test(result.content), 'developer permission scaffold remains visible')
      assert.ok(!/PMI|Nonfarm|NFP|Market calendar|Economic calendar/.test(result.content), 'economic calendar reused')
      assert.ok(await page.locator('.fx-subnav').getByRole('link', { name: language === 'vi' ? /^Phân tích$/ : /^Analytics$/ }).count() > 0, 'Live Analytics navigation absent')
    }
    for (const select of await page.locator('.fx-content .fx-select-trigger').all()) {
      if (!await select.isVisible() || await select.isDisabled()) continue
      await select.click()
      const options = page.getByRole('option')
      assert.ok(await options.count() > 0, 'select has no options')
      const option = options.first()
      await option.hover()
      await page.waitForTimeout(180)
      result.selects ??= []
      result.selects.push({ label: await select.getAttribute('aria-label'), options: await options.allTextContents(), hover: await option.evaluate(e => { const s = getComputedStyle(e); return { color: s.color, background: s.backgroundColor } }) })
      await page.keyboard.press('Escape')
      assert.equal(await options.count(), 0, 'Escape fails to close select')
    }
    await page.mouse.move(1, 1)
    if (demo && theme === 'dark' && width === 1440 || !demo && theme === 'light' && width === 360) {
      await page.addScriptTag({ path: '../../.artifacts/wm-integration-quality-tools/node_modules/axe-core/axe.min.js' })
      result.axe = await page.evaluate(async () => {
        const { violations, passes, incomplete } = await axe.run(document)
        const compact = rows => rows.map(({ id, impact, nodes }) => ({ id, impact, nodes: nodes.map(({ target, failureSummary }) => ({ target, failureSummary })) }))
        return { violations: compact(violations), incomplete: compact(incomplete), passes: passes.length }
      })
      assert.equal(result.axe.violations.length, 0, 'Axe accessibility violations')
    }
    if (width === 1440 || demo) await page.screenshot({ path: out + name + '.png' })
    report.cases.push(result)
  } catch (error) {
    report.failures.push({ name, error: String(error), state: result })
    await page.screenshot({ path: out + name + '-failure.png' })
  }
  await context.close()
  await writeFile(out + 'matrix-progress.json', JSON.stringify(report, null, 2))
}
try {
  const modes = process.env.LIVE_PROBE ? [true] : [false, true]
  const layouts = process.env.LIVE_PROBE ? [['dark', 'en', 1440]] : [['dark', 'vi', 1440], ['light', 'en', 1440], ['dark', 'en', 360], ['light', 'vi', 360]]
  for (const demo of modes) for (const [theme, language, width] of layouts) for (const section of routes) await run(section, demo, theme, language, width)
  report.after = await pins()
  report.sourceUnchanged = JSON.stringify(report.before) === JSON.stringify(report.after)
  assert.equal(report.failures.length, 0)
  assert.equal(report.errors.length, 0)
  assert.equal(report.blocked.length, 0)
  assert.ok(report.sourceUnchanged, 'source crossed during run')
  report.pass = true
} catch (error) { report.failure = String(error); process.exitCode = 1 }
finally {
  await browser.close()
  await writeFile(out + (process.env.LIVE_DIAGNOSTIC ? 'matrix-diagnostic.json' : 'matrix-report.json'), JSON.stringify(report, null, 2))
  console.log(JSON.stringify({ pass: report.pass, stage: report.stage, cases: report.cases.length, failures: report.failures.map(({ name, error }) => ({ name, error })), errors: report.errors, blocked: report.blocked, sourceUnchanged: report.sourceUnchanged }))
}
