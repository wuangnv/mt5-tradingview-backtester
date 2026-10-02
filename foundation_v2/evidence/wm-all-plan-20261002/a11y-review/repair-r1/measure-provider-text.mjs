import assert from 'node:assert/strict'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import { createHash } from 'node:crypto'
import { readdirSync, readFileSync } from 'node:fs'
import { writeFile } from 'node:fs/promises'
const out = path.dirname(fileURLToPath(import.meta.url))
const foundation = path.resolve(out, '../../../..'), workspace = path.resolve(foundation, '../../..')
const require = createRequire(path.join(workspace, 'tooling/ui-qa/package.json'))
const { chromium } = require('playwright')
const expected = '476d20e4862abf1bfc69060aa978bf09fb7bc002b25a54e84980c74d1fed7901'
const sourceHash = () => {
  const root = path.join(foundation, 'web/src'), hash = createHash('sha256')
  for (const name of readdirSync(root, { recursive: true }).filter(name => /\.(jsx?|css)$/.test(name)).sort()) hash.update(name).update(readFileSync(path.join(root, name)))
  return hash.digest('hex')
}
const parse = css => { const values = css.match(/[\d.]+/g).map(Number); return values.slice(0, 3).concat(values.length > 3 ? values[3] : 1) }
const over = (f, b) => [0, 1, 2].map(i => f[i] * f[3] + b[i] * (1 - f[3])).concat(1)
const luminance = rgb => rgb.slice(0, 3).map(c => c / 255).map(c => c <= .04045 ? c / 12.92 : ((c + .055) / 1.055) ** 2.4).reduce((sum, c, i) => sum + c * [.2126, .7152, .0722][i], 0)
const ratio = (f, b) => (Math.max(luminance(f), luminance(b)) + .05) / (Math.min(luminance(f), luminance(b)) + .05)
const origin = 'http://127.0.0.1:5180'
const report = { status: 'RUNNING', scope: 'Focused manual contrast check on visible provider text after stacked layout repair;2themes/1440;additional finding, not full WCAG', sourceBefore: sourceHash(), results: [], pageErrors: [], blockedRequests: [], failures: [] }
assert.equal(report.sourceBefore, expected)
const browser = await chromium.launch({ headless: true, executablePath: 'C:/Users/MIIKEY/AppData/Local/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-win64/chrome-headless-shell.exe' })
try {
  for (const theme of ['dark', 'light']) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'vi-VN', timezoneId: 'UTC', reducedMotion: 'reduce' })
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
    const row = page.locator('.rd-provider-row')
    assert.equal(await row.count(), 1)
    await row.scrollIntoViewIfNeeded()
    for (const selector of ['.rd-provider-row > div:first-child > strong', '.rd-provider-row > div:first-child > small:nth-child(2)', '.rd-provider-readiness', '.rd-provider-state > span', '.rd-provider-state > small', '.rd-capability']) {
      const measured = await page.locator(selector).evaluate(node => {
        const css = getComputedStyle(node), chain = []
        for (let item = node; item; item = item.parentElement) {
          const style = getComputedStyle(item)
          chain.push({ tag: item.tagName, className: item.className, background: style.backgroundColor, image: style.backgroundImage, opacity: style.opacity })
        }
        const r = node.getBoundingClientRect()
        return { text: node.textContent, color: css.color, fontSize: css.fontSize, fontWeight: css.fontWeight, chain, inViewport: r.x >= 0 && r.right <= innerWidth && r.y >= 0 && r.bottom <= innerHeight }
      })
      assert.ok(measured.chain.every(layer => layer.opacity === '1' && layer.image === 'none'))
      assert.equal(measured.inViewport, true)
      let background = [255, 255, 255, 1]
      for (const layer of [...measured.chain].reverse()) background = over(parse(layer.background), background)
      const foreground = over(parse(measured.color), background), contrastRatio = ratio(foreground, background)
      report.results.push({ theme, selector, ...measured, background, foreground, contrastRatio, threshold: 4.5, contrastPass: contrastRatio >= 4.5 })
    }
    await context.close()
  }
  report.sourceAfter = sourceHash()
  assert.equal(report.sourceAfter, expected)
  assert.deepEqual(report.pageErrors, [])
  assert.deepEqual(report.blockedRequests, [])
  report.status = report.results.every(result => result.contrastPass) ? 'SCOPED_MEASURED_PASS' : 'CONFIRMED_CONTRAST_FINDING'
  if (report.status !== 'SCOPED_MEASURED_PASS') process.exitCode = 1
} catch (cause) {
  report.status = 'MEASUREMENT_FAIL'
  report.failures.push(String(cause.stack || cause))
  process.exitCode = 1
} finally {
  await browser.close()
  await writeFile(path.join(out, 'provider-text-contrast.json'), JSON.stringify(report, null, 2) + '\n')
  console.log(JSON.stringify({ status: report.status, sourceAfter: report.sourceAfter, failures: report.failures, results: report.results.map(result => ({ theme: result.theme, selector: result.selector, text: result.text, foreground: result.foreground, background: result.background, ratio: result.contrastRatio, pass: result.contrastPass })) }, null, 2))
}
