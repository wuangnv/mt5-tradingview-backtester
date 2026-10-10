import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { chromium } from 'playwright'
import { previewOptions } from '../src/demoMode.js'

const origin = process.env.TESTING_UI_ORIGIN || 'http://127.0.0.1:5180'
const output = process.env.TW_UI_EVIDENCE_DIR || '../evidence/page-state-workflow-20261010'
assert.equal(new URL(origin).hostname, '127.0.0.1')
await mkdir(output, { recursive: true })
const browser = await chromium.launch({ headless: true, ignoreDefaultArgs: ['--hide-scrollbars'] })
const report = { scope: 'Shared product components with deterministic fixtures; real data untouched; all writes/external requests blocked', cases: [], errors: [], previewRequests: [], writes: [] }
const sections = { overview: 'dashboard', replay: 'sessions', trade: 'trades', analytics: 'analytics', 'market-data': 'market-data' }
const url = (view, state = 'demo') => `${origin}/?workspace=tenant-a&area=testing&view=${view}&section=${sections[view]}&select=1&demo=1&ui_state=${state}`
try {
  for (const width of [1710, 390]) for (const theme of ['dark', 'light']) {
    const context = await browser.newContext({ viewport: { width, height: 987 } })
    await context.addInitScript(theme => { localStorage.setItem('tw-theme', theme); localStorage.setItem('tw-language', 'vi') }, theme)
    const page = await context.newPage()
    page.on('pageerror', error => report.errors.push(error.message))
    page.on('request', request => { if (new URL(request.url()).pathname.startsWith('/api/') && new URL(page.url()).searchParams.get('demo') === '1') report.previewRequests.push(request.url()) })
    await context.route('**/*', route => {
      const request = route.request()
      if (new URL(request.url()).origin !== origin) return route.abort()
      if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method())) { report.writes.push(request.url()); return route.abort() }
      return route.continue()
    })
    for (const view of Object.keys(sections)) for (const { value: state } of previewOptions(view).filter(option => option.value !== 'real' && !option.disabled)) {
      await page.goto(url(view, state))
      await page.locator(`[data-testid=view-state-preview][data-preview-state="${state}"]`).waitFor()
      const content = page.locator('.fx-content')
      if (state === 'loading') {
        const skeleton = page.locator('.wm-page-skeleton')
        await skeleton.waitFor()
        assert.equal(await skeleton.getAttribute('aria-busy'), 'true')
        const [c, s] = await Promise.all([content.boundingBox(), skeleton.boundingBox()])
        assert.ok(Math.abs(c.y + c.height - s.y - s.height) <= 1, `${view} skeleton fills viewport`)
      } else if (state === 'denied') {
        assert.equal(await content.locator('[role=alert]').count(), 1)
        assert.equal(await content.locator('.fx-dashboard-session-card,.fxa-trades,.fxr-session-cards,.rd-table').count(), 0)
      } else if (state === 'empty' && view !== 'market-data') {
        const welcome = page.locator('[data-testid=testing-welcome]')
        await welcome.waitFor()
        assert.equal(await welcome.locator('.wm-welcome-action').count(), 2)
        assert.equal(await content.locator('.fx-dashboard-session-card,.fxa-report').count(), 0)
        const [c, w] = await Promise.all([content.boundingBox(), welcome.locator(':scope > div').boundingBox()])
        assert.ok(Math.abs(c.x + c.width / 2 - w.x - w.width / 2) <= 1, 'Welcome centered horizontally')
        if (width > 600) assert.ok(Math.abs(c.y + c.height / 2 - w.y - w.height / 2) <= 1, 'Welcome centered vertically')
      } else {
        if (view === 'overview') {
          await content.locator('[data-testid=dashboard-recent]').waitFor()
          const count = state === 'filtered' ? 0 : state === 'partial' ? 2 : 3
          await page.waitForFunction(count => document.querySelectorAll('.fx-dashboard-session-card').length === count, count)
          assert.equal(await content.getByRole('navigation', { name: 'Phân trang phiên gần đây' }).count(), 0)
          const gap = await content.evaluate(content => content.querySelector('.fx-dashboard-results').getBoundingClientRect().top - content.querySelector('.fx-dashboard-recent').getBoundingClientRect().bottom)
          assert.ok(gap >= 31, 'Performance has a separate section gap')
          if (state !== 'error') {
            await page.locator('[data-testid=dashboard-performance]').waitFor()
            await page.waitForFunction(value => document.querySelectorAll('.fx-dashboard-metric strong')[2]?.textContent === value, state === 'no-trades' ? '0' : state === 'partial' ? '40' : '60')
            if (state === 'no-trades') await page.waitForFunction(() => [...document.querySelectorAll('.fx-dashboard-card-facts')].every(element => element.textContent.includes('10.000 USD')))
          }
        } else if (view === 'replay') {
          await content.locator('.fxr-session-cards').waitFor()
          assert.equal(await content.locator('.fxr-description-card').count(), 1, 'Results states retain session description')
        } else if (view === 'market-data') {
          await content.locator('[data-testid=data-desk-root]').waitFor()
          if (state === 'error') await content.locator('[role=alert]').waitFor()
          else {
            await content.locator('.rd-table').waitFor()
            await page.waitForFunction(count => document.querySelectorAll('.rd-table tbody tr').length === count, ['empty', 'filtered'].includes(state) ? 0 : 3)
            if (state === 'unavailable') await content.locator('.data-library-catalog-status').waitFor()
          }
        } else {
          await content.locator('.fxa-filters').waitFor()
          if (state === 'error') assert.equal(await content.locator('.fxa-report').count(), 0)
          if (view === 'trade' && state !== 'error') {
            await content.locator('.fxa-trades').waitFor()
            const layout = await content.evaluate(content => ({ bottom: content.querySelector('.fxa-trades').getBoundingClientRect().bottom, contentBottom: content.getBoundingClientRect().bottom, overflow: getComputedStyle(content).overflowY }))
            assert.equal(layout.overflow, 'hidden')
            assert.ok(Math.abs(layout.bottom - layout.contentBottom) <= 1, 'Ledger owns remaining viewport')
            assert.equal(await content.locator('.fxa-trades tbody tr').count(), ['filtered', 'no-trades'].includes(state) ? 0 : 10)
          }
        }
        if (state === 'error') assert.equal(await content.getByRole('button', { name: 'Thử lại', exact: true }).count(), 0, 'Preview has no redundant retry')
        if (state === 'refreshing') assert.ok(await content.locator('[aria-busy=true]').count() > 0)
      }
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth), false, `${view}/${state} no document overflow`)
      if (['loading', 'empty', 'error', 'unavailable'].includes(state)) await page.screenshot({ path: `${output}/${theme}-${width}-${view}-${state}.png`, animations: 'disabled' })
      report.cases.push({ view, state, width, theme, fixtureOnly: true })
    }
    await page.goto(url('overview', 'filtered'))
    await page.getByRole('searchbox', { name: 'Tìm phiên gần đây' }).fill('Gold Swing')
    await page.waitForFunction(() => document.querySelectorAll('.fx-dashboard-session-card').length === 1)
    assert.equal(await page.locator('.fx-dashboard-session-card').getAttribute('data-session-id'), 'demo-gold')
    await page.getByRole('searchbox', { name: 'Tìm phiên gần đây' }).fill('')
    await page.waitForFunction(() => document.querySelectorAll('.fx-dashboard-session-card').length === 3)
    await page.evaluate(() => { window.__previewShell = [document.querySelector('.fx-topbar'), document.querySelector('.fx-rail')] })
    await page.locator('.wm-view-state-select .fx-select-trigger').click()
    await page.getByRole('option').filter({ has: page.locator('.fx-select-option-label', { hasText: 'Dữ liệu mẫu' }) }).click()
    await page.locator('[data-preview-state=demo]').waitFor()
    assert.equal(await page.evaluate(() => window.__previewShell[0] === document.querySelector('.fx-topbar') && window.__previewShell[1] === document.querySelector('.fx-rail')), true)
    await page.goBack()
    await page.locator('[data-preview-state=filtered]').waitFor()
    await page.reload()
    await page.locator('[data-preview-state=filtered]').waitFor()
    report.cases.push({ width, theme, journey: 'filtered restore, selector, shell preservation, history/reload' })
    await context.close()
  }
  assert.deepEqual(report.errors, [])
  assert.deepEqual(report.previewRequests, [])
  assert.deepEqual(report.writes, [])
  report.result = 'PASS'
} catch (error) { report.failure = error.stack; throw error }
finally { await writeFile(`${output}/browser.json`, JSON.stringify(report, null, 2)); await browser.close() }
console.log(JSON.stringify({ result: report.result, cases: report.cases.length, errors: report.errors, previewRequests: report.previewRequests, writes: report.writes }))
