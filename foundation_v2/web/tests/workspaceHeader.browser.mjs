import assert from 'node:assert/strict'
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import path from 'node:path'
import { chromium } from 'playwright'

const origin = 'http://127.0.0.1:5180'
const session = '39b1d068edd64e75864f692f27237852'
const out = path.resolve(process.env.HEADER_EVIDENCE || '../evidence/ui-workspace-header-20261004')
await mkdir(out, { recursive: true })
async function fingerprint() {
  const hash = createHash('sha256')
  for (const name of (await readdir('src', { recursive: true })).filter(name => /\.(jsx?|css)$/.test(name)).sort()) hash.update(name).update(await readFile(path.join('src', name)))
  return hash.digest('hex')
}
const report = { scope: 'Actual GET-only local QA services; spacing and nested Analytics navigation only', sourceBefore: await fingerprint(), cases: [], errors: [], blocked: [] }
const browser = await chromium.launch({ headless: true, executablePath: 'C:/Users/MIIKEY/AppData/Local/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-win64/chrome-headless-shell.exe' })
const axe = await readFile('../../../../.artifacts/wm-integration-quality-tools/node_modules/axe-core/axe.min.js', 'utf8')
const routes = [
  ['overview', '.fx-dashboard-quick-actions', ''],
  ['replay', '.fxr-session-toolbar', ''],
  ['trade', '.fxr-session-toolbar', ''],
  ['analytics', '.fxr-session-toolbar', ''],
  ['analytics', '.fxa-prop-selector', '&analytics_source=prop'],
]
try {
  for (const theme of ['dark', 'light']) for (const width of [1440, 768, 360]) {
    const context = await browser.newContext({ viewport: { width, height: 987 }, reducedMotion: 'reduce' })
    await context.addInitScript(theme => { localStorage.setItem('tw-theme', theme); localStorage.setItem('tw-language', 'vi') }, theme)
    await context.route('**/*', route => {
      const request = route.request()
      if (new URL(request.url()).origin !== origin || !['GET', 'HEAD', 'OPTIONS'].includes(request.method())) { report.blocked.push(request.url()); return route.abort() }
      return route.continue()
    })
    await context.routeWebSocket('**/*', socket => socket.close())
    const page = await context.newPage()
    page.setDefaultTimeout(20000)
    page.on('pageerror', error => report.errors.push(error.message))
    for (const [view, firstSelector, extra] of routes) {
      await page.goto(`${origin}/?workspace=tenant-a&view=${view}&session=${session}&select=1&cursor=20${extra}`, { waitUntil: 'domcontentloaded' })
      await page.locator(firstSelector).waitFor()
      if (view === 'overview') await page.locator('.fx-dashboard-results[aria-busy="false"]').waitFor()
      else if (view === 'replay') await page.getByTestId('session-performance').waitFor()
      else if (view === 'trade') await page.getByTestId('fx-trade-ledger').waitFor()
      else if (extra) await page.getByTestId('prop-analytics').getByText('Chưa có báo cáo Prop firm.', { exact: false }).waitFor()
      else await page.getByTestId('analytics-performance').waitFor()
      const geometry = await page.evaluate(selector => {
        const header = document.querySelector('.fx-subnav').getBoundingClientRect()
        const first = document.querySelector(selector).getBoundingClientRect()
        const primary = document.querySelector('.fx-subnav-primary').getBoundingClientRect()
        const active = document.querySelector('.fx-subnav-primary a[aria-current="page"]').getBoundingClientRect()
        const secondary = document.querySelector('.fx-subsubnav')?.getBoundingClientRect()
        return { gap: first.top - header.bottom, activeVisible: active.left >= header.left - 1 && active.right <= header.right + 1, header: { top: header.top, bottom: header.bottom }, primary: { top: primary.top, bottom: primary.bottom }, secondary: secondary && { top: secondary.top, bottom: secondary.bottom }, overflow: document.documentElement.scrollWidth - innerWidth }
      }, firstSelector)
      assert.ok(geometry.gap >= 23 && geometry.gap <= 45, `${view}/${extra}/${width}: content separation ${geometry.gap}px`)
      assert.ok(geometry.overflow <= 1)
      assert.equal(geometry.activeVisible, true, 'Active primary page remains visible in narrow navigation')
      assert.equal(await page.locator('.fx-subnav-primary a[aria-current="page"]').count(), 1)
      assert.equal(await page.getByRole('button', { name: /^(Tải lại|Làm mới)/ }).count(), 0)
      if (view === 'analytics') {
        const secondary = page.getByRole('navigation', { name: 'Nguồn Analytics', exact: true })
        assert.equal(await secondary.count(), 1)
        assert.equal(await page.locator('.fx-content .fxa-source-tabs').count(), 0)
        const active = extra ? 'Prop firm' : 'Sessions'
        assert.equal(await secondary.getByRole('link', { name: active, exact: true }).getAttribute('aria-current'), 'page')
        assert.ok(geometry.secondary.bottom <= geometry.header.bottom + 1, 'Source row remains inside the header after data loads')
        assert.equal(await secondary.getByRole('link', { name: active, exact: true }).evaluate(element => {
          const box = element.getBoundingClientRect()
          return element.contains(document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2))
        }), true, 'Source link is visible and receives pointer events')
        if (width > 760) assert.ok(geometry.secondary.top < geometry.primary.bottom && geometry.secondary.bottom > geometry.primary.top, 'Nested source shares the desktop header row')
        else assert.ok(geometry.secondary.top >= geometry.primary.bottom - 1, 'Nested source is immediately below primary navigation on mobile')
        const underline = await secondary.getByRole('link', { name: active, exact: true }).evaluate(element => ({ height: getComputedStyle(element, '::after').height, color: getComputedStyle(element, '::after').backgroundColor }))
        assert.equal(underline.height, '2px'); assert.notEqual(underline.color, 'rgba(0, 0, 0, 0)')
        await secondary.getByRole('link', { name: active, exact: true }).focus()
        assert.equal(await secondary.getByRole('link', { name: active, exact: true }).evaluate(element => getComputedStyle(element).outlineStyle), 'solid')
        await page.locator(firstSelector).click({ position: { x: 1, y: 1 } })
      } else assert.equal(await page.locator('.fx-subsubnav').count(), 0)
      await page.addScriptTag({ content: axe })
      const audit = await page.evaluate(() => axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] } }))
      assert.deepEqual(audit.violations.map(item => ({ id: item.id, target: item.nodes.map(node => node.target) })), [])
      await page.screenshot({ path: path.join(out, `${view}${extra ? '-prop' : ''}-${theme}-${width}.png`) })
      report.cases.push({ view, source: extra ? 'prop' : view === 'analytics' ? 'sessions' : null, theme, width, geometry, axeViolations: 0 })
    }
    await page.goto(`${origin}/?workspace=tenant-a&view=analytics&session=${session}&select=1&cursor=20&prop_session=header-scope-prop&attempt=header-scope-attempt`, { waitUntil: 'domcontentloaded' })
    const sources = page.getByRole('navigation', { name: 'Nguồn Analytics', exact: true })
    await sources.getByRole('link', { name: 'Prop firm', exact: true }).click()
    await page.getByTestId('prop-analytics').waitFor()
    assert.equal(new URL(page.url()).searchParams.get('session'), session)
    assert.equal(new URL(page.url()).searchParams.get('cursor'), '20')
    assert.equal(new URL(page.url()).searchParams.get('prop_session'), 'header-scope-prop')
    assert.equal(new URL(page.url()).searchParams.get('attempt'), 'header-scope-attempt')
    await page.reload({ waitUntil: 'domcontentloaded' })
    assert.equal(await page.getByRole('navigation', { name: 'Nguồn Analytics', exact: true }).getByRole('link', { name: 'Prop firm', exact: true }).getAttribute('aria-current'), 'page')
    await page.getByRole('navigation', { name: 'Nguồn Analytics', exact: true }).getByRole('link', { name: 'Sessions', exact: true }).focus()
    await page.keyboard.press('Enter')
    await page.getByTestId('analytics-performance').waitFor()
    assert.equal(new URL(page.url()).searchParams.get('prop_session'), 'header-scope-prop')
    assert.equal(new URL(page.url()).searchParams.get('attempt'), 'header-scope-attempt')
    assert.match(await page.locator('.fxa-report-scope').innerText(), /^20 \/ 20/)
    report.cases.push({ theme, width, journey: 'Source click/reload/keyboard Enter preserves session and historical cursor20' })
    await context.close()
  }
  assert.deepEqual(report.errors, []); assert.deepEqual(report.blocked, [])
  report.sourceAfter = await fingerprint()
  assert.equal(report.sourceBefore, report.sourceAfter)
  await writeFile(path.join(out, 'report.json'), JSON.stringify(report, null, 2))
  console.log(`PASS ${report.cases.length} actual header cases; zero page errors/writes/axe violations`)
} catch (error) { report.failure = String(error.stack || error); await writeFile(path.join(out, 'failure.json'), JSON.stringify(report, null, 2)); throw error }
finally { await browser.close() }
