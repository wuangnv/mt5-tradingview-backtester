import assert from 'node:assert/strict'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import { createHash } from 'node:crypto'
import { readdirSync, readFileSync } from 'node:fs'
import { writeFile, mkdir } from 'node:fs/promises'
const out = path.dirname(fileURLToPath(import.meta.url)), foundation = path.resolve(out, '../../../..'), workspaceRoot = path.resolve(foundation, '../../..')
const require = createRequire(path.join(workspaceRoot, 'tooling/ui-qa/package.json'))
const { chromium } = require('playwright')
const expected = '8205c89b2d79a832cb853ccad28b08ca13e1d9da67b2c185a517742752a180f1'
const sha = bytes => createHash('sha256').update(bytes).digest('hex')
const sourceHash = () => {
  const root = path.join(foundation, 'web/src'), hash = createHash('sha256')
  for (const name of readdirSync(root, { recursive: true }).filter(name => /\.(jsx?|css)$/.test(name)).sort()) hash.update(name).update(readFileSync(path.join(root, name)))
  return hash.digest('hex')
}
const origin = 'http://127.0.0.1:5180', session = '39b1d068edd64e75864f692f27237852'
const report = { status: 'RUNNING', scope: 'New loaded-chart Learn CTA real isolated QA session/history context;read-only keyboard/layout/cutoff;not fullLearn or chart acceptance', sourceBefore: sourceHash(), cases: [], screenshots: [], pageErrors: [], blockedRequests: [], failures: [] }
assert.equal(report.sourceBefore, expected)
await mkdir(out, { recursive: true })
const browser = await chromium.launch({ headless: true, executablePath: 'C:/Users/MIIKEY/AppData/Local/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-win64/chrome-headless-shell.exe' })
report.browser = browser.version()
try {
  for (const theme of ['dark', 'light']) for (const [width, height] of [[1440, 900], [1280, 800], [768, 1024], [390, 844]]) {
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
    const item = { theme, width, height, cutoffs: [] }
    for (const cursor of [60, 20]) {
      await page.goto(`${origin}/?workspace=tenant-a&view=replay&surface=workspace&session=${session}&cursor=${cursor}`, { waitUntil: 'networkidle' })
      await page.evaluate(() => document.fonts.ready)
      const chart = page.getByTestId('replay-chart')
      assert.equal(await chart.getAttribute('data-visible-row-count'), String(cursor + 1))
      const link = page.locator('.chart-bottom-range').getByRole('link', { name: 'Học & thuật ngữ', exact: true })
      assert.equal(await link.count(), 1)
      await link.scrollIntoViewIfNeeded()
      const href = await link.getAttribute('href'), target = new URL(href, origin)
      assert.equal(target.origin, origin)
      for (const [key, value] of Object.entries({ workspace: 'tenant-a', view: 'learn', session, cursor: String(cursor), from: 'replay' })) assert.equal(target.searchParams.get(key), value)
      assert.ok(target.searchParams.get('dataset'))
      assert.ok(Number(target.searchParams.get('cutoff')) > 0)
      const label = await chart.getAttribute('aria-label')
      const jumpBefore = await page.getByTestId('replay-jump').inputValue()
      assert.equal(jumpBefore, String(cursor))
      if (cursor === 20) { assert.equal(await page.getByTestId('step-1').isDisabled(), true); assert.equal(await page.getByTestId('play-toggle').isDisabled(), true) }
      await page.locator('.chart-bottom-range').getByRole('button', { name: 'Tới cutoff', exact: true }).focus()
      await page.keyboard.press('Tab')
      assert.equal(await link.evaluate(node => document.activeElement === node), true)
      const geometry = await link.evaluate(node => {
        const r = node.getBoundingClientRect(), group = node.parentElement, g = group.getBoundingClientRect(), css = getComputedStyle(node)
        const top = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)
        return { link: { x: r.x, y: r.y, width: r.width, height: r.height, right: r.right, bottom: r.bottom }, group: { x: g.x, y: g.y, width: g.width, height: g.height }, text: node.textContent, color: css.color, fontSize: css.fontSize, outline: css.outline, outlineOffset: css.outlineOffset, focusVisible: node.matches(':focus-visible'), hitOwn: top === node || node.contains(top), viewport: { width: innerWidth, height: innerHeight }, overflow: { document: document.documentElement.scrollWidth - innerWidth, content: document.querySelector('.fx-content').scrollWidth - document.querySelector('.fx-content').clientWidth }, groupWrap: getComputedStyle(group).flexWrap, groupOverflow: group.scrollWidth - group.clientWidth }
      })
      assert.ok(geometry.focusVisible && geometry.hitOwn)
      assert.ok(geometry.link.x >= 0 && geometry.link.right <= width + 1 && geometry.link.y >= 0 && geometry.link.bottom <= height + 1)
      assert.ok(geometry.overflow.document <= 1 && geometry.overflow.content <= 1)
      assert.ok(!geometry.outline.startsWith('none') && !geometry.outline.includes(' 0px'))
      if (cursor === 20) {
        const screenshotPath = path.join(out, `learn-focus-${theme}-${width}.png`)
        const bytes = await page.locator('.chart-bottom-range').screenshot({ path: screenshotPath, animations: 'disabled', caret: 'hide', scale: 'css' })
        report.screenshots.push({ theme, width, cursor, path: screenshotPath, sha256: sha(bytes) })
      }
      await page.keyboard.press('Enter')
      await page.waitForURL(url => url.searchParams.get('view') === 'learn')
      await page.waitForLoadState('networkidle')
      const after = new URL(page.url())
      for (const key of ['workspace', 'view', 'session', 'cursor', 'cutoff', 'dataset', 'from']) assert.equal(after.searchParams.get(key), target.searchParams.get(key))
      await page.goto(`${origin}/?workspace=tenant-a&view=replay&surface=workspace&session=${session}&cursor=${cursor}`, { waitUntil: 'networkidle' })
      assert.equal(await chart.getAttribute('data-visible-row-count'), String(cursor + 1))
      assert.equal(await page.getByTestId('replay-jump').inputValue(), jumpBefore)
      assert.equal(await chart.getAttribute('aria-label'), label)
      item.cutoffs.push({ cursor, count: cursor + 1, href, learnUrl: after.href, geometry, keyboardTabEnteredLink: true, enterNavigated: true, returnPrefixUnchanged: true, accessibleSummary: label })
    }
    report.cases.push(item)
    await context.close()
  }
  report.sourceAfter = sourceHash()
  assert.equal(report.sourceAfter, expected)
  assert.deepEqual(report.pageErrors, [])
  assert.deepEqual(report.blockedRequests, [])
  report.status = 'SCOPED_KEYBOARD_LAYOUT_CUTOFF_PASS_PENDING_RENDERED_REVIEW'
} catch (cause) {
  report.status = 'FAIL_FINDING'
  report.sourceAfter = sourceHash()
  report.failures.push(String(cause.stack || cause)); process.exitCode = 1
} finally {
  await browser.close()
  await writeFile(path.join(out, 'learn-link-verification.json'), JSON.stringify(report, null, 2) + '\n')
  console.log(JSON.stringify({ status: report.status, sourceBefore: report.sourceBefore, sourceAfter: report.sourceAfter, cases: report.cases.length, failures: report.failures, casesSummary: report.cases.map(item => ({ theme: item.theme, width: item.width, cutoffs: item.cutoffs.map(cutoff => ({ cursor: cutoff.cursor, href: cutoff.href, outline: cutoff.geometry.outline, layout: cutoff.geometry.link, wrap: cutoff.geometry.groupWrap })) })) }, null, 2))
}
