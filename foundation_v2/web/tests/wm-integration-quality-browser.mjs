import assert from 'node:assert/strict'
import { mkdir, writeFile, readFile } from 'node:fs/promises'
import { readdirSync, readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'

const webRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const repoRoot = path.resolve(webRoot, '../..')
const workspaceRoot = path.resolve(repoRoot, '../..')
const args = Object.fromEntries(process.argv.slice(2).map((arg) => { const i = arg.indexOf('='); return [arg.slice(2, i), arg.slice(i + 1)] }))
const mode = args.mode || 'scan'
const origin = args.origin || 'http://127.0.0.1:5180'
assert.equal(new URL(origin).hostname, '127.0.0.1', 'Only an explicitly selected loopback service is supported')
const workspace = args.workspace || 'tenant-a'
const out = path.resolve(args.out || path.join(workspaceRoot, '.artifacts', `wm-integration-quality-${mode}-${Date.now()}`))
const sessionQuery = `${args.session ? `&session=${encodeURIComponent(args.session)}` : ''}${args.cursor ? `&cursor=${encodeURIComponent(args.cursor)}` : ''}`
const allRoutes = {
  overview: ['view=overview', '[data-testid="dashboard-performance"]'],
  sessions: [`view=replay&select=1${sessionQuery}`, '[data-testid="replay-session-picker"]'],
  replay: [`view=replay${sessionQuery}`, '[data-testid="replay-chart"], [data-testid="replay-session-dashboard"]'],
  analytics: [`view=analytics${sessionQuery}`, '[data-testid="analytics-workspace"]'],
  trades: [`view=trade${sessionQuery}`, '[data-testid="trade-session-picker"]'],
  learn: ['view=learn', '.learn-shell'],
  settings: ['view=settings', '[data-testid="settings-workspace"]'],
  live: ['view=live', '[data-testid="live-workspace"]'],
  liveTrades: ['view=live&section=trades', '[data-testid="live-workspace"]'],
  liveNotes: ['view=live&section=notes', '[data-testid="live-workspace"]'],
  liveTags: ['view=live&section=tag-analytics', '[data-testid="live-workspace"]'],
  liveAccounts: ['view=live&section=trading-accounts', '[data-testid="live-workspace"]'],
  playbook: ['view=playbook', '[data-testid="playbook-root"]'],
  data: ['view=data', '[data-testid="data-desk-root"]'],
  research: ['view=research', '[data-testid="research-root"]'],
  journal: ['view=journal', '[data-testid="journal-workspace"]'],
  risk: ['view=risk', '[data-testid="risk-workspace"]'],
  prop: ['view=prop', '.prop-shell'],
}
const routes = (args.routes || Object.keys(allRoutes).join(',')).split(',')
const themes = (args.themes || 'dark,light').split(',')
const widths = (args.widths || '1440,768,360').split(',').map(Number)
await mkdir(out, { recursive: true })
function fingerprint() {
  const hash = createHash('sha256')
  const root = path.join(webRoot, 'src')
  for (const name of readdirSync(root, { recursive: true }).filter((name) => /\.(jsx?|css)$/.test(name)).sort()) hash.update(name).update(readFileSync(path.join(root, name)))
  return hash.digest('hex')
}
let context
let browser
const report = { mode, origin, workspace, sourceBefore: fingerprint(), scope: 'read-only local services; no API fixtures; automated observations do not establish full WCAG or product acceptance', results: [], themePersistence: [], failures: [], unexpectedRequests: [] }

async function measure(page) {
  return page.evaluate(() => ({
    innerWidth, innerHeight, outerWidth, outerHeight, dpr: devicePixelRatio,
    cssZoom: getComputedStyle(document.documentElement).zoom,
    visualScale: visualViewport.scale, scrollWidth: document.documentElement.scrollWidth,
    overflowX: document.documentElement.scrollWidth - innerWidth,
    contentWidth: document.querySelector('.fx-content')?.getBoundingClientRect().width ?? innerWidth,
    contentOverflowX: (() => { const content = document.querySelector('.fx-content'); return content ? content.scrollWidth - content.clientWidth : 0 })(),
    mainHeading: document.querySelector('main h1')?.textContent?.trim(),
    bodyHeight: document.body.scrollHeight,
  }))
}

try {
  let worker
  if (mode === 'zoom') {
    const extension = path.join(out, 'native-zoom-extension')
    await mkdir(extension, { recursive: true })
    await writeFile(path.join(extension, 'manifest.json'), JSON.stringify({ manifest_version: 3, name: 'WM integration quality native zoom', version: '1.0', permissions: ['tabs'], host_permissions: [`${origin}/*`], background: { service_worker: 'background.js' } }))
    await writeFile(path.join(extension, 'background.js'), 'chrome.runtime.onInstalled.addListener(() => {});\n')
    context = await chromium.launchPersistentContext(path.join(out, 'isolated-profile'), { headless: true, channel: 'chromium', viewport: { width: 1440, height: 900 }, args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`] })
    worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker', { timeout: 10000 })
  } else {
    browser = await chromium.launch({ headless: true })
    context = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' })
  }
  await context.route('**/*', async (route) => {
    const request = route.request()
    const url = new URL(request.url())
    if ((url.protocol === 'http:' || url.protocol === 'https:') && (url.origin !== origin || !['GET', 'HEAD', 'OPTIONS'].includes(request.method()))) {
      report.unexpectedRequests.push({ method: request.method(), url: request.url() })
      await route.abort()
    } else await route.continue()
  })
  const axePath = args.axe || path.join(workspaceRoot, '.artifacts/wm-integration-quality-tools/node_modules/axe-core/axe.min.js')
  if (mode === 'scan') report.axeVersion = JSON.parse(await readFile(path.join(path.dirname(axePath), 'package.json'), 'utf8')).version
  for (const theme of themes) for (const routeId of routes) {
    assert.ok(allRoutes[routeId], `Unknown route ${routeId}`)
    const [query, selector] = allRoutes[routeId]
    const page = await context.newPage()
    const pageErrors = []
    const httpErrors = []
    page.on('pageerror', (error) => pageErrors.push(String(error)))
    page.on('response', (response) => { if (response.status() >= 400) httpErrors.push({ status: response.status(), url: response.url() }) })
    await page.addInitScript((selectedTheme) => localStorage.setItem('tw-theme', selectedTheme), theme)
    try {
      await page.goto(`${origin}/?${query}&workspace=${encodeURIComponent(workspace)}`, { waitUntil: 'networkidle' })
      await page.locator(selector).first().waitFor({ timeout: 10000 })
      const shell = page.getByTestId('fxreplay-shell')
      if (await shell.getAttribute('data-theme') !== theme) {
        await page.getByTestId('theme-toggle').click()
        assert.equal(await shell.getAttribute('data-theme'), theme)
      }
      if (mode === 'zoom') {
        const baseline = await measure(page)
        for (const factor of [1.25, 2, 1]) {
          const zoom = await worker.evaluate(async ({ origin, pageUrl, factor }) => {
            const tabs = await chrome.tabs.query({})
            const tab = tabs.find((item) => item.url === pageUrl && item.url.startsWith(origin))
            if (!tab) throw new Error('Owned test tab not found')
            await chrome.tabs.setZoomSettings(tab.id, { mode: 'automatic', scope: 'per-tab' })
            await chrome.tabs.setZoom(tab.id, factor)
            return { factor: await chrome.tabs.getZoom(tab.id), settings: await chrome.tabs.getZoomSettings(tab.id) }
          }, { origin, pageUrl: page.url(), factor })
          await page.waitForFunction(({ expected, baselineDpr }) => Math.abs(devicePixelRatio / baselineDpr - expected) < 0.02, { expected: factor, baselineDpr: baseline.dpr })
          await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(resolve)))))
          const metrics = await measure(page)
          const screenshot = path.join(out, `${routeId}-${theme}-zoom-${factor}.png`)
          const cdp = await context.newCDPSession(page)
          const capture = await cdp.send('Page.captureScreenshot', { format: 'png', fromSurface: true, captureBeyondViewport: false })
          await writeFile(screenshot, Buffer.from(capture.data, 'base64'))
          await cdp.detach()
          const pass = Math.abs(zoom.factor - factor) < 0.001 && Math.abs(metrics.innerWidth - baseline.innerWidth / factor) <= 2 && metrics.overflowX <= 2 && metrics.contentOverflowX <= 2 && metrics.contentWidth >= Math.min(320, metrics.innerWidth * .8) && pageErrors.length === 0
          report.results.push({ routeId, theme, factor, nativeZoomApi: zoom, baseline, metrics, pageErrors: [...pageErrors], httpErrors: [...httpErrors], screenshot, pass })
          if (!pass) report.failures.push({ routeId, theme, factor, reason: 'Native zoom reflow or overflow gate failed' })
        }
      } else {
        for (const width of widths) {
          await page.setViewportSize({ width, height: 900 })
          await page.addScriptTag({ path: axePath })
          const audit = await page.evaluate(async () => {
            const result = await axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] } })
            const details = (items) => items.map(({ id, impact, help, helpUrl, nodes }) => ({ id, impact, help, helpUrl, nodes: nodes.map(({ target, html, failureSummary }) => ({ target, html, failureSummary })) }))
            return { violations: details(result.violations), incomplete: details(result.incomplete), passes: result.passes.length }
          })
          const metrics = await measure(page)
          const screenshot = path.join(out, `${routeId}-${theme}-${width}.png`)
          await page.screenshot({ path: screenshot, fullPage: true })
          const unresolvedAria = audit.incomplete.filter((item) => item.id.startsWith('aria-'))
          const pass = audit.violations.length === 0 && unresolvedAria.length === 0 && metrics.overflowX <= 2 && metrics.contentOverflowX <= 2 && metrics.contentWidth >= Math.min(320, metrics.innerWidth * .8) && pageErrors.length === 0
          report.results.push({ routeId, theme, width, metrics, audit, unresolvedAria, pageErrors: [...pageErrors], httpErrors: [...httpErrors], screenshot, pass })
          if (!pass) report.failures.push({ routeId, theme, width, violationIds: audit.violations.map((item) => item.id), unresolvedAriaIds: unresolvedAria.map((item) => item.id), overflowX: metrics.overflowX, contentWidth: metrics.contentWidth, contentOverflowX: metrics.contentOverflowX, pageErrors: [...pageErrors] })
        }
      }
    } catch (error) {
      report.failures.push({ routeId, theme, error: String(error), pageErrors, httpErrors })
    } finally {
      await page.close()
      await writeFile(path.join(out, 'progress.json'), JSON.stringify(report, null, 2))
    }
  }
} catch (error) { report.failures.push({ error: String(error) }) }
finally {
  await context?.close()
  await browser?.close()
  report.sourceAfter = fingerprint()
  if (report.sourceBefore !== report.sourceAfter) report.failures.push({ reason: 'Source changed during scan; findings remain diagnostic only' })
  report.status = report.failures.length || report.unexpectedRequests.length ? 'FAIL' : 'SCOPED_PASS'
  await writeFile(path.join(out, 'report.json'), JSON.stringify(report, null, 2))
  console.log(JSON.stringify({ status: report.status, cases: report.results.length, failures: report.failures, out }, null, 2))
  if (report.status === 'FAIL') process.exitCode = 1
}
