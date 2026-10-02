import assert from 'node:assert/strict'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import { createHash } from 'node:crypto'
import { readdirSync, readFileSync } from 'node:fs'
import { readFile, writeFile, mkdir } from 'node:fs/promises'

const out = path.dirname(fileURLToPath(import.meta.url))
const foundation = path.resolve(out, '../../..')
const web = path.join(foundation, 'web')
const workspace = path.resolve(foundation, '../../..')
const require = createRequire(path.join(workspace, 'tooling/ui-qa/package.json'))
const { chromium } = require('playwright')
const { PNG } = require(path.join(workspace, 'tooling/ui-qa/node_modules/playwright-core/lib/utilsBundle.js'))
const sourcePath = path.join(out, '../ui/a11y-full.json')
const input = JSON.parse(await readFile(sourcePath, 'utf8'))
const sourceHash = () => {
  const root = path.join(web, 'src'), hash = createHash('sha256')
  for (const name of readdirSync(root, { recursive: true }).filter(name => /\.(jsx?|css)$/.test(name)).sort()) hash.update(name).update(readFileSync(path.join(root, name)))
  return hash.digest('hex')
}
const sha = bytes => createHash('sha256').update(bytes).digest('hex')
assert.equal(sourceHash(), input.sourceAfter)
const origin = 'http://127.0.0.1:5180', session = '39b1d068edd64e75864f692f27237852'
const queries = { overview: 'view=overview', sessions: 'view=replay&select=1', replay: `view=replay&surface=workspace&session=${session}`, live: 'view=live', data: 'view=data', research: 'view=research', journal: `view=journal&session=${session}` }
const targets = new Map()
for (const result of input.results) for (const rule of result.audit.incomplete) for (const node of rule.nodes) {
  assert.equal(rule.id, 'color-contrast')
  assert.equal(node.target.length, 1)
  const selector = node.target[0]
  if (!targets.has(selector)) targets.set(selector, { selector, html: node.html, reason: node.failureSummary, routes: new Set() })
  targets.get(selector).routes.add(result.routeId)
}
assert.equal(targets.size, 18)
const report = { status: 'IN_PROGRESS', scope: 'Independent read-only contrast and rendered-visibility triage for 18 unique automated incompletes; partial WCAG only', sourceReceipt: sourcePath, sourceReceiptSha256: sha(await readFile(sourcePath)), sourceBefore: sourceHash(), origin, browser: '', results: [], reducedMotion: [], supplementalScreenshots: [], pageErrors: [], blockedRequests: [], failures: [] }
await mkdir(out, { recursive: true })
const browser = await chromium.launch({ headless: true, executablePath: 'C:/Users/MIIKEY/AppData/Local/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-win64/chrome-headless-shell.exe' })
report.browser = browser.version()

function parseColor(css) {
  const values = css.match(/[\d.]+/g)?.map(Number)
  if (!values || values.length < 3 || !css.startsWith('rgb')) throw new Error('Unsupported color ' + css)
  return [...values.slice(0, 3), values.length > 3 ? values[3] : 1]
}
function over(foreground, background) {
  const a = foreground[3]
  return [0, 1, 2].map(i => foreground[i] * a + background[i] * (1 - a)).concat(1)
}
function ratio(foreground, background) {
  const luminance = rgba => rgba.slice(0, 3).map(c => c / 255).map(c => c <= .04045 ? c / 12.92 : ((c + .055) / 1.055) ** 2.4).reduce((sum, c, i) => sum + c * [.2126, .7152, .0722][i], 0)
  const l1 = luminance(foreground), l2 = luminance(background)
  return (Math.max(l1, l2) + .05) / (Math.min(l1, l2) + .05)
}
function dominantColor(bytes) {
  const png = PNG.sync.read(bytes), counts = new Map()
  for (let i = 0; i < png.data.length; i += 4) {
    const key = [...png.data.subarray(i, i + 4)].join(',')
    counts.set(key, (counts.get(key) || 0) + 1)
  }
  const [key, count] = [...counts].sort((a, b) => b[1] - a[1])[0]
  return { rgba: key.split(',').map(Number), fraction: count / (png.width * png.height), width: png.width, height: png.height }
}

async function measure(locator) {
  return locator.evaluate(node => {
    const bounds = node.getBoundingClientRect(), style = getComputedStyle(node), chain = []
    for (let item = node; item; item = item.parentElement) {
      const css = getComputedStyle(item)
      chain.push({ tag: item.tagName, className: item.className, color: css.color, backgroundColor: css.backgroundColor, backgroundImage: css.backgroundImage, opacity: css.opacity })
    }
    const placeholder = node.matches('textarea,input') ? getComputedStyle(node, '::placeholder') : null
    const range = document.createRange()
    range.selectNodeContents(node)
    const textRects = [...range.getClientRects()].filter(r => r.width && r.height).map(rect => {
      const x = rect.x + rect.width / 2, y = rect.y + rect.height / 2, top = document.elementFromPoint(x, y)
      return { x: rect.x, y: rect.y, width: rect.width, height: rect.height, inViewport: x >= 0 && x <= innerWidth && y >= 0 && y <= innerHeight, hitOwn: top === node || node.contains(top), hitTag: top?.tagName, hitClass: top?.className, hitText: top?.textContent?.trim().slice(0, 160) }
    })
    const top = document.elementFromPoint(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2)
    return { text: node.textContent?.trim(), value: node.value, placeholder: node.getAttribute('placeholder'), fontSize: style.fontSize, fontWeight: style.fontWeight, color: style.color, opacity: style.opacity, backgroundColor: style.backgroundColor, backgroundImage: style.backgroundImage, display: style.display, visibility: style.visibility, disabled: Boolean(node.disabled || node.closest(':disabled')), ariaHidden: node.getAttribute('aria-hidden'), role: node.getAttribute('role'), accessibleControlName: node.closest('a,button')?.getAttribute('aria-label'), pairedText: node.parentElement?.textContent?.trim().slice(0, 240), placeholderStyle: placeholder ? { color: placeholder.color, opacity: placeholder.opacity } : null, bounds: { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height }, hitOwn: top === node || node.contains(top), textRects, chain }
  })
}

try {
  for (const theme of ['dark', 'light']) for (const [routeId, query] of Object.entries(queries)) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'vi-VN', timezoneId: 'UTC', reducedMotion: 'reduce' })
    await context.addInitScript(theme => { localStorage.setItem('tw-theme', theme); localStorage.setItem('tw-language', 'vi') }, theme)
    await context.routeWebSocket('**/*', socket => socket.close())
    await context.route('**/*', async route => {
      const request = route.request(), url = new URL(request.url())
      if (url.origin !== origin || !['GET', 'HEAD', 'OPTIONS'].includes(request.method())) { report.blockedRequests.push({ method: request.method(), url: request.url() }); return route.abort() }
      return route.continue()
    })
    const page = await context.newPage()
    page.on('pageerror', cause => report.pageErrors.push(String(cause)))
    await page.goto(`${origin}/?workspace=tenant-a&${query}`, { waitUntil: 'networkidle' })
    await page.evaluate(() => document.fonts.ready)
    assert.equal(await page.getByTestId('fxreplay-shell').getAttribute('data-theme'), theme)
    report.reducedMotion.push(await page.evaluate(({ theme, routeId }) => {
      const nodes = [...document.querySelectorAll('.fx-app *')]
      const active = nodes.flatMap(node => [null, '::before', '::after'].map(pseudo => {
        const style = getComputedStyle(node, pseudo)
        return { tag: node.tagName, className: node.className, pseudo, animationName: style.animationName, animationDuration: style.animationDuration, transitionDuration: style.transitionDuration, scrollBehavior: style.scrollBehavior }
      })).filter(style => (style.animationName !== 'none' && style.animationDuration.split(',').some(time => parseFloat(time) > .00001)) || style.transitionDuration.split(',').some(time => parseFloat(time) > .00001) || style.scrollBehavior === 'smooth')
      return { theme, routeId, preferenceMatches: matchMedia('(prefers-reduced-motion: reduce)').matches, nonReducedComputedStyles: active }
    }, { theme, routeId }))
    for (const target of targets.values()) {
      if (!(target.routes.has(routeId) || routeId === 'live' && [...target.routes].some(r => r.startsWith('live')))) continue
      let locator = page.locator(target.selector)
      if (routeId === 'data' && target.selector === 'div:nth-child(1) > small:nth-child(2)') locator = locator.filter({ hasText: /^Có: read_metadata$/ })
      await locator.first().waitFor({ state: 'attached' })
      assert.equal(await locator.count(), 1, `${routeId} ${target.selector} must identify the actual reported node`)
      const before = await measure(locator)
      await locator.scrollIntoViewIfNeeded()
      const measured = await measure(locator)
      let background = [255, 255, 255, 1]
      for (const layer of [...measured.chain].reverse()) background = over(parseColor(layer.backgroundColor), background)
      const opacity = measured.chain.reduce((amount, layer) => amount * Number(layer.opacity), 1)
      const foregroundRaw = parseColor(measured.color), foreground = over([foregroundRaw[0], foregroundRaw[1], foregroundRaw[2], foregroundRaw[3] * opacity], background)
      const text = target.selector.startsWith('.chart-symbol') || target.selector.startsWith('div:nth-child') || target.selector.startsWith('textarea')
      const threshold = text ? Number(measured.fontSize.replace('px', '')) >= 24 || Number(measured.fontSize.replace('px', '')) >= 18.666 && Number(measured.fontWeight) >= 700 ? 3 : 4.5 : 3
      const result = { theme, routeId, selector: target.selector, automatedReason: target.reason, type: text ? 'readable-text' : 'control-or-status-glyph', threshold, beforeScroll: before, ...measured, resolvedBackground: background, renderedForeground: foreground, contrastRatio: ratio(foreground, background), opacityNeedsManual: opacity !== 1, backgroundImageNeedsManual: measured.chain.some(c => c.backgroundImage !== 'none') }
      if (target.selector.startsWith('textarea')) {
        const p = parseColor(measured.placeholderStyle.color)
        const rendered = over([p[0], p[1], p[2], p[3] * Number(measured.placeholderStyle.opacity) * opacity], background)
        result.placeholderContrastRatio = ratio(rendered, background)
        result.renderedPlaceholder = rendered
      }
      report.results.push(result)
    }
    if (['replay', 'data', 'journal'].includes(routeId)) {
      const locator = page.locator(routeId === 'replay' ? '.chart-symbol-strip' : routeId === 'data' ? '.rd-provider-list' : 'textarea[rows="8"]')
      await locator.scrollIntoViewIfNeeded()
      const screenshot = path.join(out, `${routeId}-${theme}-contrast.png`)
      const bytes = await locator.screenshot({ path: screenshot, animations: 'disabled', caret: 'hide', scale: 'css' })
      report.supplementalScreenshots.push({ theme, routeId, path: screenshot, sha256: sha(bytes), dominantBackground: dominantColor(bytes) })
    }
    await context.close()
  }
  report.sourceAfter = sourceHash()
  assert.equal(report.sourceAfter, report.sourceBefore)
  assert.deepEqual(report.pageErrors, [])
  assert.deepEqual(report.blockedRequests, [])
  report.status = 'MEASURED_REQUIRES_INDEPENDENT_CLASSIFICATION'
} catch (cause) {
  report.status = 'FAIL'
  report.failures.push(String(cause.stack || cause))
  process.exitCode = 1
} finally {
  await browser.close()
  await writeFile(path.join(out, 'contrast-measurements.json'), JSON.stringify(report, null, 2) + '\n')
  console.log(JSON.stringify({ status: report.status, cases: report.results.length, distinctTargets: new Set(report.results.map(r => r.selector)).size, failures: report.failures, lowContrast: report.results.filter(r => r.contrastRatio < r.threshold || r.placeholderContrastRatio < r.threshold).map(r => ({ theme: r.theme, route: r.routeId, selector: r.selector, ratio: r.contrastRatio, placeholderRatio: r.placeholderContrastRatio })), obscuredText: report.results.filter(r => r.textRects.some(rect => rect.inViewport && !rect.hitOwn)).map(r => ({ theme: r.theme, route: r.routeId, selector: r.selector, bounds: r.bounds, textRects: r.textRects })), nonReducedStyles: report.reducedMotion.filter(r => r.nonReducedComputedStyles.length) }, null, 2))
}
