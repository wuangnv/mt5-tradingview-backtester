import assert from 'node:assert/strict'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import { createHash } from 'node:crypto'
import { readdirSync, readFileSync } from 'node:fs'
import { readFile, writeFile, mkdir } from 'node:fs/promises'

const out = path.dirname(fileURLToPath(import.meta.url))
const foundation = path.resolve(out, '../../../..')
const workspace = path.resolve(foundation, '../../..')
const require = createRequire(path.join(workspace, 'tooling/ui-qa/package.json'))
const { chromium } = require('playwright')
const expectedSource = 'e993bb4910fc42f3faf8c7852ca6807f392deaa6d331f279f843ea8c9d21e6dd'
const oldSource = '71373c3a4a02e1d3cd68ff3e6bffbd92a8dfdb153a5f3c8d39aa3ac5cc8030fa'
const sourceHash = () => {
  const root = path.join(foundation, 'web/src'), hash = createHash('sha256')
  for (const name of readdirSync(root, { recursive: true }).filter(name => /\.(jsx?|css)$/.test(name)).sort()) hash.update(name).update(readFileSync(path.join(root, name)))
  return hash.digest('hex')
}
const sha = bytes => createHash('sha256').update(bytes).digest('hex')
const previousPath = path.join(out, '../contrast-review.json')
const previousBytes = await readFile(previousPath)
const previous = JSON.parse(previousBytes)
assert.equal(previous.sourceBefore, oldSource)
assert.equal(previous.sourceAfter, oldSource)
const origin = 'http://127.0.0.1:5180', session = '39b1d068edd64e75864f692f27237852'
const retainedR1Paths = ['../repair-r1/measurements.json', '../repair-r1/provider-text-contrast.json', '../repair-r1/REPAIR-REVIEW.md']
const retainedR1 = await Promise.all(retainedR1Paths.map(async item => ({ path: item, sha256: sha(await readFile(path.join(out, item))) })))
assert.equal(retainedR1[0].sha256, 'eee834a1755a479c6d57170de332e9bcb3632f5ebc7dc5b96ae75efb47678fa4')
assert.equal(retainedR1[1].sha256, '6d648dfe5d091a9a24d5a3605164c040a9c232dd8afba3dbd62a1aec5518de14')
const report = { status: 'RUNNING', reviewer: '/root/mt5_independent_review', scope: 'Independent focused Journal placeholder, Data provider layout and six provider text contrast groups on actual isolated local API;8 viewport/theme pairs,16route cases,48provider contrast observations; partial WCAG only', sourceBefore: sourceHash(), expectedSource, previousReceipt: { path: '../contrast-review.json', sha256: sha(previousBytes), source: oldSource, status: previous.status }, retainedR1, origin, browser: '', cases: [], screenshots: [], pageErrors: [], blockedRequests: [], failures: [], assertions: [] }
assert.equal(report.sourceBefore, expectedSource)
await mkdir(out, { recursive: true })
const browser = await chromium.launch({ headless: true, executablePath: 'C:/Users/MIIKEY/AppData/Local/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-win64/chrome-headless-shell.exe' })
report.browser = browser.version()
const check = (condition, message) => { assert.ok(condition, message); report.assertions.push(message) }

function parseColor(css) {
  const values = css.match(/[\d.]+/g)?.map(Number)
  assert.ok(css.startsWith('rgb') && values?.length >= 3)
  return values.slice(0, 3).concat(values.length > 3 ? values[3] : 1)
}
function over(foreground, background) {
  return [0, 1, 2].map(i => foreground[i] * foreground[3] + background[i] * (1 - foreground[3])).concat(1)
}
function ratio(foreground, background) {
  const luminance = rgb => rgb.slice(0, 3).map(c => c / 255).map(c => c <= .04045 ? c / 12.92 : ((c + .055) / 1.055) ** 2.4).reduce((sum, c, i) => sum + c * [.2126, .7152, .0722][i], 0)
  const a = luminance(foreground), b = luminance(background)
  return (Math.max(a, b) + .05) / (Math.min(a, b) + .05)
}
async function open(theme, width, height, view) {
  const context = await browser.newContext({ viewport: { width, height }, locale: 'vi-VN', timezoneId: 'UTC', reducedMotion: 'reduce' })
  await context.addInitScript(theme => { localStorage.setItem('tw-theme', theme); localStorage.setItem('tw-language', 'vi') }, theme)
  await context.routeWebSocket('**/*', socket => socket.close())
  await context.route('**/*', route => {
    const request = route.request(), url = new URL(request.url())
    if (url.origin !== origin || !['GET', 'HEAD', 'OPTIONS'].includes(request.method())) { report.blockedRequests.push({ method: request.method(), url: request.url() }); return route.abort() }
    return route.continue()
  })
  const page = await context.newPage()
  page.on('pageerror', cause => report.pageErrors.push(String(cause)))
  const query = view === 'journal' ? `view=journal&session=${session}` : `view=${view}`
  await page.goto(`${origin}/?workspace=tenant-a&${query}`, { waitUntil: 'networkidle' })
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
async function assertOverflow(page, label) {
  const widths = await page.evaluate(() => ({ viewport: innerWidth, document: document.documentElement.scrollWidth, body: document.body.scrollWidth, content: [...document.querySelectorAll('.fx-content')].map(node => ({ client: node.clientWidth, scroll: node.scrollWidth })) }))
  check(widths.document <= widths.viewport + 1 && widths.body <= widths.viewport + 1 && widths.content.every(item => item.scroll <= item.client + 1), `${label}: no document/body/fx-content horizontal overflow`)
  return widths
}

try {
  for (const theme of ['dark', 'light']) for (const [width, height] of [[1440, 900], [1280, 800], [768, 1024], [390, 844]]) {
    {
      const label = `Journal ${theme} ${width}`
      const { context, page } = await open(theme, width, height, 'journal')
      const textarea = page.locator('textarea[rows="8"]')
      assert.equal(await textarea.count(), 1)
      await textarea.scrollIntoViewIfNeeded()
      const fields = await page.locator('.ja-field input[placeholder], .ja-field textarea[placeholder]').evaluateAll(nodes => nodes.map(node => {
        const style = getComputedStyle(node), placeholder = getComputedStyle(node, '::placeholder'), chain = []
        for (let item = node; item; item = item.parentElement) {
          const css = getComputedStyle(item)
          chain.push({ tag: item.tagName, className: item.className, backgroundColor: css.backgroundColor, backgroundImage: css.backgroundImage, opacity: css.opacity })
        }
        const bounds = node.getBoundingClientRect()
        return { tag: node.tagName, rows: node.getAttribute('rows'), placeholder: node.getAttribute('placeholder'), value: node.value, disabled: node.disabled, fontSize: style.fontSize, fontWeight: style.fontWeight, color: style.color, placeholderStyle: { color: placeholder.color, opacity: placeholder.opacity }, bounds: { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height }, inViewport: bounds.right > 0 && bounds.left < innerWidth && bounds.bottom > 0 && bounds.top < innerHeight, chain }
      }))
      check(fields.some(field => field.rows === '8' && !field.disabled && field.value === '' && field.inViewport), `${label}: actual enabled empty content field is visible`)
      for (const field of fields.filter(field => !field.disabled && field.value === '')) {
        check(field.chain.every(layer => Number(layer.opacity) === 1 && layer.backgroundImage === 'none'), `${label} ${field.placeholder}: no opacity/background-image ambiguity`)
        check(Number(field.placeholderStyle.opacity) === 1, `${label} ${field.placeholder}: placeholder opacity1`)
        let background = [255, 255, 255, 1]
        for (const layer of [...field.chain].reverse()) background = over(parseColor(layer.backgroundColor), background)
        const foreground = over(parseColor(field.placeholderStyle.color), background)
        field.resolvedBackground = background
        field.renderedPlaceholder = foreground
        field.placeholderContrastRatio = ratio(foreground, background)
        check(field.placeholderContrastRatio >= 4.5, `${label} ${field.placeholder}: placeholder normal-text ratio>=4.5`)
      }
      const pageWidths = await assertOverflow(page, label)
      report.cases.push({ route: 'journal', theme, width, height, fields, pageWidths })
      await screenshot(textarea, `journal-${theme}-${width}.png`, { route: 'journal', theme, width, height })
      await context.close()
    }
    {
      const label = `Data ${theme} ${width}`
      const { context, page } = await open(theme, width, height, 'data')
      const rowLocator = page.locator('.rd-provider-row').filter({ hasText: 'local-catalog' })
      assert.equal(await rowLocator.count(), 1)
      await rowLocator.scrollIntoViewIfNeeded()
      const row = await rowLocator.evaluate(node => {
        const bounds = item => { const r = item.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height, right: r.right, bottom: r.bottom } }
        const textRects = item => { const range = document.createRange(); range.selectNodeContents(item); return [...range.getClientRects()].filter(rect => rect.width && rect.height).map(rect => ({ x: rect.x, y: rect.y, width: rect.width, height: rect.height, right: rect.right })) }
        const metadata = node.firstElementChild
        const capability = [...metadata.querySelectorAll('small')].find(item => item.textContent === 'Có: read_metadata')
        const word = document.createRange(), start = capability.firstChild.textContent.indexOf('read_metadata')
        word.setStart(capability.firstChild, start); word.setEnd(capability.firstChild, start + 'read_metadata'.length)
        const css = getComputedStyle(node)
        const textGroups = [...metadata.children, ...node.children[1].children, node.children[2]].map(textNode => {
          const style = getComputedStyle(textNode), chain = []
          for (let item = textNode; item; item = item.parentElement) {
            const layer = getComputedStyle(item)
            chain.push({ tag: item.tagName, className: item.className, background: layer.backgroundColor, image: layer.backgroundImage, opacity: layer.opacity })
          }
          const r = textNode.getBoundingClientRect()
          return { text: textNode.textContent, className: textNode.className, color: style.color, fontSize: style.fontSize, fontWeight: style.fontWeight, bounds: bounds(textNode), inViewport: r.x >= 0 && r.right <= innerWidth && r.y >= 0 && r.bottom <= innerHeight, chain }
        })
        return { providerId: node.querySelector('strong')?.textContent, bounds: bounds(node), gridTemplateColumns: css.gridTemplateColumns, textGroups, columns: [...node.children].map(child => ({ className: child.className, text: child.textContent, bounds: bounds(child), minWidth: getComputedStyle(child).minWidth, textAlign: getComputedStyle(child).textAlign })), firstColumnText: [...metadata.children].map(child => ({ text: child.textContent, bounds: bounds(child), rects: textRects(child) })), readMetadataWordRects: [...word.getClientRects()].map(rect => ({ x: rect.x, y: rect.y, width: rect.width, height: rect.height, right: rect.right })), contentUnchanged: metadata.textContent === 'local-catalogCó: read_metadataoffline_local · entitlement: dataset_metadata_only' }
      })
      check(row.providerId === 'local-catalog' && row.contentUnchanged, `${label}: actual provider identity/capability/entitlement preserved`)
      check(row.columns[0].bounds.width > 100, `${label}: provider first cell width>100px`)
      check(row.bounds.height <= 200, `${label}: provider row height<=200px`)
      check(row.firstColumnText[0].rects.length === 1 && row.firstColumnText[1].rects.length === 1, `${label}: provider name and Có: read_metadata each fit one line`)
      check(row.readMetadataWordRects.length === 1, `${label}: read_metadata word remains whole`)
      check(row.firstColumnText[2].rects.length <= 3, `${label}: entitlement<=3 readable lines`)
      check(row.columns.every(column => column.bounds.width > 100 && column.bounds.x >= row.bounds.x - 1 && column.bounds.right <= row.bounds.right + 1), `${label}: all provider tracks remain inside row and have usable width`)
      check(row.columns.slice(1).every((column, index) => column.bounds.y >= row.columns[index].bounds.bottom - 1), `${label}: metadata/status/capability stack without overlap`)
      check(row.columns[1].minWidth === '0px' && row.columns[1].textAlign === 'left', `${label}: readiness state no longer forces150px/right alignment`)
      check(row.textGroups.length === 6, `${label}: all six actual provider text groups checked`)
      for (const textGroup of row.textGroups) {
        check(textGroup.inViewport && textGroup.chain.every(layer => layer.opacity === '1' && layer.image === 'none'), `${label} ${textGroup.text}: visible text, no opacity/background ambiguity`)
        let background = [255, 255, 255, 1]
        for (const layer of [...textGroup.chain].reverse()) background = over(parseColor(layer.background), background)
        const foreground = over(parseColor(textGroup.color), background)
        textGroup.resolvedBackground = background
        textGroup.renderedForeground = foreground
        textGroup.contrastRatio = ratio(foreground, background)
        textGroup.threshold = 4.5
        check(textGroup.contrastRatio >= 4.5, `${label} ${textGroup.text}: normal-text contrast>=4.5`)
      }
      const pageWidths = await assertOverflow(page, label)
      report.cases.push({ route: 'data', theme, width, height, row, pageWidths })
      await screenshot(rowLocator, `data-${theme}-${width}.png`, { route: 'data', theme, width, height })
      await context.close()
    }
  }
  report.sourceAfter = sourceHash()
  assert.equal(report.sourceAfter, expectedSource)
  assert.equal(sha(await readFile(previousPath)), report.previousReceipt.sha256)
  for (const prior of retainedR1) assert.equal(sha(await readFile(path.join(out, prior.path))), prior.sha256)
  assert.equal(report.cases.length, 16)
  assert.equal(report.screenshots.length, 16)
  assert.deepEqual(report.pageErrors, [])
  assert.deepEqual(report.blockedRequests, [])
  report.status = 'FOCUSED_ASSERTIONS_PASS_PENDING_RENDERED_REVIEW'
} catch (cause) {
  report.status = 'FAIL_FINDING'
  report.sourceAfter = sourceHash()
  report.failures.push(String(cause.stack || cause))
  process.exitCode = 1
} finally {
  await browser.close()
  await writeFile(path.join(out, 'measurements.json'), JSON.stringify(report, null, 2) + '\n')
  console.log(JSON.stringify({ status: report.status, sourceBefore: report.sourceBefore, sourceAfter: report.sourceAfter, cases: report.cases.length, assertions: report.assertions.length, failures: report.failures, journal: report.cases.filter(item => item.route === 'journal').map(item => ({ theme: item.theme, width: item.width, fields: item.fields.length, ratios: [...new Set(item.fields.map(field => field.placeholderContrastRatio))] })), data: report.cases.filter(item => item.route === 'data').map(item => ({ theme: item.theme, width: item.width, firstColumnWidth: item.row.columns[0].bounds.width, rowHeight: item.row.bounds.height, lineCounts: item.row.firstColumnText.map(text => text.rects.length), textRatios: item.row.textGroups.map(group => ({ text: group.text, ratio: group.contrastRatio })) })) }, null, 2))
}
