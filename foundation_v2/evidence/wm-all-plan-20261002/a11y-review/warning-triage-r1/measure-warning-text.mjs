import assert from 'node:assert/strict'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import { createHash } from 'node:crypto'
import { readdirSync, readFileSync } from 'node:fs'
import { readFile, writeFile, mkdir } from 'node:fs/promises'
const out = path.dirname(fileURLToPath(import.meta.url)), foundation = path.resolve(out, '../../../..'), workspace = path.resolve(foundation, '../../..')
const require = createRequire(path.join(workspace, 'tooling/ui-qa/package.json'))
const { chromium } = require('playwright')
const expected = 'fba555162da33d740c254ebf79ba2670df1c0e29e7c80221d649df8dca27ebad'
const sha = bytes => createHash('sha256').update(bytes).digest('hex')
const sourceHash = () => {
  const root = path.join(foundation, 'web/src'), hash = createHash('sha256')
  for (const name of readdirSync(root, { recursive: true }).filter(name => /\.(jsx?|css)$/.test(name)).sort()) hash.update(name).update(readFileSync(path.join(root, name)))
  return hash.digest('hex')
}
const parse = css => { const values = css.match(/[\d.]+/g).map(Number); return values.slice(0, 3).concat(values.length > 3 ? values[3] : 1) }
const over = (f, b) => [0, 1, 2].map(i => f[i] * f[3] + b[i] * (1 - f[3])).concat(1)
const luminance = rgb => rgb.slice(0, 3).map(c => c / 255).map(c => c <= .04045 ? c / 12.92 : ((c + .055) / 1.055) ** 2.4).reduce((sum, c, i) => sum + c * [.2126, .7152, .0722][i], 0)
const ratio = (f, b) => (Math.max(luminance(f), luminance(b)) + .05) / (Math.min(luminance(f), luminance(b)) + .05)
const origin = 'http://127.0.0.1:5180', selector = 'aside[aria-label="Provider capabilities"] > .rd-warning-block'
const retainedPath = path.join(out, '../repair-r2/repair-review.json'), retainedHash = sha(await readFile(retainedPath))
assert.equal(retainedHash, '65720dfc18c31930ef34228c98fb045b773b289c2549431b2b0c782da0254040')
const report = { status: 'RUNNING', scope: 'Actual GET-only rendered safety-warning title and3items following stacked Data provider;dark/light1440/1280;partial WCAG triage only', sourceBefore: sourceHash(), preservedR2: { path: '../repair-r2/repair-review.json', sha256: retainedHash }, selector, cases: [], screenshots: [], pageErrors: [], blockedRequests: [], failures: [] }
assert.equal(report.sourceBefore, expected)
await mkdir(out, { recursive: true })
const browser = await chromium.launch({ headless: true, executablePath: 'C:/Users/MIIKEY/AppData/Local/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-win64/chrome-headless-shell.exe' })
report.browser = browser.version()
try {
  for (const theme of ['dark', 'light']) for (const width of [1440, 1280]) {
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
    await page.goto(`${origin}/?workspace=tenant-a&view=data`, { waitUntil: 'networkidle' })
    await page.evaluate(() => document.fonts.ready)
    assert.equal(await page.getByTestId('fxreplay-shell').getAttribute('data-theme'), theme)
    const block = page.locator(selector)
    assert.equal(await block.count(), 1)
    assert.equal(await block.locator(':scope > strong').innerText(), 'Quy tắc an toàn')
    await block.scrollIntoViewIfNeeded()
    const texts = await block.locator(':scope > strong, :scope > ul > li').evaluateAll(nodes => nodes.map(node => {
      const css = getComputedStyle(node), chain = [], r = node.getBoundingClientRect()
      for (let item = node; item; item = item.parentElement) { const style = getComputedStyle(item); chain.push({ tag: item.tagName, className: item.className, background: style.backgroundColor, image: style.backgroundImage, opacity: style.opacity }) }
      return { tag: node.tagName, text: node.textContent, color: css.color, fontSize: css.fontSize, fontWeight: css.fontWeight, bounds: { x: r.x, y: r.y, width: r.width, height: r.height }, inViewport: r.x >= 0 && r.right <= innerWidth && r.y >= 0 && r.bottom <= innerHeight, chain }
    }))
    assert.equal(texts.length, 4)
    for (const [index, text] of texts.entries()) {
      assert.ok(text.inViewport && text.chain.every(layer => layer.opacity === '1' && layer.image === 'none'))
      let background = [255, 255, 255, 1]
      for (const layer of [...text.chain].reverse()) background = over(parse(layer.background), background)
      const foreground = over(parse(text.color), background)
      text.exactSelector = `${selector} > ${index === 0 ? 'strong' : `ul > li:nth-child(${index})`}`
      text.background = background; text.foreground = foreground; text.contrastRatio = ratio(foreground, background); text.threshold = 4.5; text.contrastPass = text.contrastRatio >= 4.5
    }
    report.cases.push({ theme, width, texts })
    const screenshotPath = path.join(out, `warning-${theme}-${width}.png`)
    const screenshotBytes = await block.screenshot({ path: screenshotPath, animations: 'disabled', caret: 'hide', scale: 'css' })
    report.screenshots.push({ theme, width, path: screenshotPath, sha256: sha(screenshotBytes) })
    await context.close()
  }
  report.sourceAfter = sourceHash()
  assert.equal(report.sourceAfter, expected)
  assert.equal(sha(await readFile(retainedPath)), retainedHash)
  assert.deepEqual(report.pageErrors, [])
  assert.deepEqual(report.blockedRequests, [])
  report.status = report.cases.every(item => item.texts.every(text => text.contrastPass)) ? 'SCOPED_MEASURED_PASS_PENDING_RENDER_REVIEW' : 'CONFIRMED_WARNING_CONTRAST_FINDING'
  if (report.status !== 'SCOPED_MEASURED_PASS_PENDING_RENDER_REVIEW') process.exitCode = 1
} catch (cause) {
  report.status = 'MEASUREMENT_FAIL'
  report.failures.push(String(cause.stack || cause)); process.exitCode = 1
} finally {
  await browser.close()
  await writeFile(path.join(out, 'warning-measurements.json'), JSON.stringify(report, null, 2) + '\n')
  console.log(JSON.stringify({ status: report.status, sourceBefore: report.sourceBefore, sourceAfter: report.sourceAfter, failures: report.failures, cases: report.cases.map(item => ({ theme: item.theme, width: item.width, texts: item.texts.map(text => ({ selector: text.exactSelector, text: text.text, color: text.color, background: text.background, fontSize: text.fontSize, fontWeight: text.fontWeight, ratio: text.contrastRatio, pass: text.contrastPass })) })) }, null, 2))
}
