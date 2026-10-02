import assert from 'node:assert/strict'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import { createHash } from 'node:crypto'
import { readdirSync, readFileSync } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'

const out = path.dirname(fileURLToPath(import.meta.url))
const foundation = path.resolve(out, '../../..')
const workspace = path.resolve(foundation, '../../..')
const require = createRequire(path.join(workspace, 'tooling/ui-qa/package.json'))
const { chromium } = require('playwright')
const expectedSource = '71373c3a4a02e1d3cd68ff3e6bffbd92a8dfdb153a5f3c8d39aa3ac5cc8030fa'
const sourceHash = () => {
  const root = path.join(foundation, 'web/src'), hash = createHash('sha256')
  for (const name of readdirSync(root, { recursive: true }).filter(name => /\.(jsx?|css)$/.test(name)).sort()) hash.update(name).update(readFileSync(path.join(root, name)))
  return hash.digest('hex')
}
const sha = bytes => createHash('sha256').update(bytes).digest('hex')
const origin = 'http://127.0.0.1:5180'
const report = { status: 'IN_PROGRESS', scope: 'Read-only focused rendered layout/context for contrast triage; no source repair or full WCAG claim', sourceBefore: sourceHash(), data: [], research: [], screenshots: [], pageErrors: [], blockedRequests: [], failures: [] }
assert.equal(report.sourceBefore, expectedSource)
await mkdir(out, { recursive: true })
const browser = await chromium.launch({ headless: true, executablePath: 'C:/Users/MIIKEY/AppData/Local/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-win64/chrome-headless-shell.exe' })
report.browser = browser.version()

async function open(theme, width, view) {
  const context = await browser.newContext({ viewport: { width, height: 900 }, locale: 'vi-VN', timezoneId: 'UTC', reducedMotion: 'reduce' })
  await context.addInitScript(theme => { localStorage.setItem('tw-theme', theme); localStorage.setItem('tw-language', 'vi') }, theme)
  await context.routeWebSocket('**/*', socket => socket.close())
  await context.route('**/*', route => {
    const request = route.request(), url = new URL(request.url())
    if (url.origin !== origin || !['GET', 'HEAD', 'OPTIONS'].includes(request.method())) { report.blockedRequests.push({ method: request.method(), url: request.url() }); return route.abort() }
    return route.continue()
  })
  const page = await context.newPage()
  page.on('pageerror', cause => report.pageErrors.push(String(cause)))
  await page.goto(`${origin}/?workspace=tenant-a&view=${view}`, { waitUntil: 'networkidle' })
  await page.evaluate(() => document.fonts.ready)
  assert.equal(await page.getByTestId('fxreplay-shell').getAttribute('data-theme'), theme)
  return { context, page }
}

async function screenshot(locator, name, metadata) {
  await locator.scrollIntoViewIfNeeded()
  const screenshotPath = path.join(out, name)
  const bytes = await locator.screenshot({ path: screenshotPath, animations: 'disabled', caret: 'hide', scale: 'css' })
  report.screenshots.push({ ...metadata, path: screenshotPath, sha256: sha(bytes) })
}

try {
  for (const theme of ['dark', 'light']) for (const width of [1440, 1280, 768, 390]) {
    const { context, page } = await open(theme, width, 'data')
    const rows = await page.locator('.rd-provider-row').evaluateAll(nodes => nodes.map(node => {
      const bounds = item => { const r = item.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height } }
      const lines = item => { const range = document.createRange(); range.selectNodeContents(item); return [...range.getClientRects()].filter(rect => rect.width && rect.height).map(rect => ({ x: rect.x, y: rect.y, width: rect.width, height: rect.height })) }
      const style = getComputedStyle(node)
      const columns = [...node.children].map(child => {
        const css = getComputedStyle(child)
        return { tag: child.tagName, className: child.className, text: child.textContent, bounds: bounds(child), minWidth: css.minWidth, overflowWrap: css.overflowWrap, wordBreak: css.wordBreak, whiteSpace: css.whiteSpace, children: [...child.children].map(textNode => ({ tag: textNode.tagName, text: textNode.textContent, bounds: bounds(textNode), fontSize: getComputedStyle(textNode).fontSize, rects: lines(textNode) })) }
      })
      return { providerId: node.querySelector('strong')?.textContent, bounds: bounds(node), gridTemplateColumns: style.gridTemplateColumns, gap: style.gap, columns }
    }))
    assert.ok(rows.length > 0)
    report.data.push({ theme, width, rows, pageWidths: await page.evaluate(() => ({ viewport: innerWidth, document: document.documentElement.scrollWidth, body: document.body.scrollWidth })) })
    if (theme === 'dark' && [1440, 1280, 768, 390].includes(width)) await screenshot(page.locator('.rd-provider-row').first(), `data-provider-${theme}-${width}.png`, { view: 'data', theme, width })
    await context.close()
  }
  for (const theme of ['dark', 'light']) {
    const { context, page } = await open(theme, 1440, 'research')
    const marker = page.locator('.rs-state-mark').filter({ hasText: '○' })
    assert.equal(await marker.count(), 1)
    const item = await marker.evaluate(node => ({ glyph: node.textContent, ariaHidden: node.getAttribute('aria-hidden'), role: node.getAttribute('role'), markup: node.parentElement.outerHTML, sectionLabel: node.closest('section')?.getAttribute('aria-label'), explicitStatus: node.parentElement.querySelector('strong')?.textContent, instructions: node.parentElement.querySelector('small')?.textContent, circleColor: getComputedStyle(node).color, circleBorderColor: getComputedStyle(node).borderColor, circleBorderWidth: getComputedStyle(node).borderWidth, pointerEvents: getComputedStyle(node).pointerEvents }))
    report.research.push({ theme, ...item })
    await screenshot(marker.locator('..'), `research-result-status-${theme}.png`, { view: 'research', theme, width: 1440 })
    await context.close()
  }
  report.sourceAfter = sourceHash()
  assert.equal(report.sourceAfter, expectedSource)
  assert.deepEqual(report.pageErrors, [])
  assert.deepEqual(report.blockedRequests, [])
  report.status = 'MEASURED_REQUIRES_CLASSIFICATION'
} catch (cause) {
  report.status = 'FAIL'
  report.failures.push(String(cause.stack || cause))
  process.exitCode = 1
} finally {
  await browser.close()
  await writeFile(path.join(out, 'layout-context-measurements.json'), JSON.stringify(report, null, 2) + '\n')
  console.log(JSON.stringify({ status: report.status, sourceAfter: report.sourceAfter, failures: report.failures, data: report.data.map(item => ({ theme: item.theme, width: item.width, pageWidths: item.pageWidths, rows: item.rows.map(row => ({ provider: row.providerId, grid: row.gridTemplateColumns, width: row.bounds.width, height: row.bounds.height, firstColumnWidth: row.columns[0].bounds.width, firstColumnTextLines: row.columns[0].children.map(child => ({ text: child.text, lines: child.rects.length })) })) })), research: report.research }, null, 2))
}
