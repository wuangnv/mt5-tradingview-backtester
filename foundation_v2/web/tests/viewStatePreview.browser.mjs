import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { chromium } from 'playwright'
import { previewOptions } from '../src/demoMode.js'

const origin = process.env.TESTING_UI_ORIGIN || 'http://127.0.0.1:5180'
const output = process.env.TW_UI_EVIDENCE_DIR || '../evidence/view-state-preview-20261010'
assert.equal(new URL(origin).hostname, '127.0.0.1')
await mkdir(output, { recursive: true })
const browser = await chromium.launch({ headless: true })
const report = { scope: 'Production components and deterministic preview data; real mode uses actual local GET APIs; writes blocked', cases: [], errors: [], previewRequests: [], writes: [] }
try {
  for (const width of [1440, 390]) for (const theme of ['dark', 'light']) {
    const context = await browser.newContext({ viewport: { width, height: 987 } })
    await context.addInitScript(theme => { localStorage.setItem('tw-theme', theme); localStorage.setItem('tw-language', 'vi') }, theme)
    const page = await context.newPage()
    let documents = 0
    page.on('pageerror', error => report.errors.push(error.message))
    page.on('request', request => {
      if (request.isNavigationRequest() && request.frame() === page.mainFrame()) documents++
      if (new URL(request.url()).pathname.startsWith('/api/') && new URL(page.url()).searchParams.get('demo') === '1') report.previewRequests.push(request.url())
    })
    await context.route('**/*', route => {
      const request = route.request()
      if (new URL(request.url()).origin !== origin) return route.abort()
      if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method())) { report.writes.push(request.url()); return route.abort() }
      return route.continue()
    })
    await page.goto(`${origin}/?workspace=tenant-a&view=overview&area=testing&section=dashboard&demo=1`)
    await page.locator('[data-testid=view-state-preview][data-preview-state=demo]').waitFor()
    await page.locator('.fx-dashboard-session-card').first().waitFor()
    await page.locator('.wm-view-state-select .fx-select-trigger').click()
    await page.screenshot({ path: `${output}/${theme}-${width}-menu.png`, animations: 'disabled' })
    await page.keyboard.press('Escape')
    await page.evaluate(() => { window.__previewShell = { shell: document.querySelector('[data-testid=fxreplay-shell]'), rail: document.querySelector('.fx-rail'), header: document.querySelector('.fx-topbar') } })
    const choose = async state => {
      await page.locator('.wm-view-state-select .fx-select-trigger').click()
      const label = previewOptions('overview').find(option => option.value === state).label
      const option = page.getByRole('option').filter({ has: page.locator('.fx-select-option-label', { hasText: label }) }).first()
      const bounds = await page.locator('.wm-view-state-select .fx-select-menu').boundingBox()
      assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= width + 1, 'State menu fits viewport')
      await option.click()
      if (state !== 'real') await page.locator(`[data-testid=view-state-preview][data-preview-state=${state}]`).waitFor()
    }
    for (const { value } of previewOptions('overview').filter(option => !['real', 'demo'].includes(option.value))) {
      await choose(value)
      const preview = page.locator('.fx-content')
      if (value === 'loading') {
        assert.equal(await preview.locator('.wm-skeleton').getAttribute('aria-busy'), 'true')
        assert.equal(await preview.locator('.fx-dashboard-session-card').count(), 0)
      } else if (['empty', 'error', 'denied', 'unavailable', 'filtered'].includes(value)) {
        assert.equal(await preview.locator('.wm-read-state').count(), 1)
        assert.equal(await preview.locator('.fx-dashboard-metric, .fx-dashboard-session-card').count(), 0)
        if (['denied', 'unavailable'].includes(value)) assert.equal(await preview.getByRole('button', { name: 'Thử lại' }).count(), 0)
        if (value === 'error') assert.equal(await preview.getByRole('button', { name: 'Thử lại' }).evaluate(button => getComputedStyle(button).whiteSpace), 'nowrap')
      } else {
        await preview.locator('.fx-dashboard-session-card').first().waitFor()
        const expected = value === 'partial' ? 2 : 3
        assert.equal(await preview.locator('.fx-dashboard-session-card').count(), expected)
        await preview.locator('.fx-dashboard-metric strong').nth(2).waitFor()
        await page.waitForFunction(count => document.querySelectorAll('.fx-dashboard-metric strong')[2]?.textContent === count, value === 'partial' ? '40' : '60')
        if (value === 'unknown') assert.deepEqual((await preview.locator('.fx-dashboard-metric strong').allTextContents()).slice(0, 2), ['—', '—'])
        if (value === 'refreshing') assert.equal(await preview.locator('.wm-view-state-update').getAttribute('aria-busy'), 'true')
      }
      if (['loading', 'empty', 'error', 'stale', 'partial', 'unknown'].includes(value)) await page.screenshot({ path: `${output}/${theme}-${width}-${value}.png` })
      report.cases.push({ view: 'overview', width, theme, state: value })
    }
    await choose('error')
    await page.locator('.fx-content').getByRole('button', { name: 'Thử lại' }).click()
    await page.locator('[data-preview-state=demo]').waitFor()
    await page.locator('.fx-dashboard-session-card').first().waitFor()
    await page.goBack()
    await page.locator('[data-preview-state=error]').waitFor()
    assert.equal(await page.evaluate(() => window.__previewShell.shell === document.querySelector('[data-testid=fxreplay-shell]') && window.__previewShell.rail === document.querySelector('.fx-rail') && window.__previewShell.header === document.querySelector('.fx-topbar')), true)
    await page.reload()
    await page.locator('[data-preview-state=error]').waitFor()
    await page.evaluate(() => { window.__previewShell = { shell: document.querySelector('[data-testid=fxreplay-shell]'), rail: document.querySelector('.fx-rail'), header: document.querySelector('.fx-topbar') } })
    await choose('real')
    await page.locator('.fx-dashboard-session-card').first().waitFor()
    assert.equal(await page.getByTestId('view-state-preview').count(), 0)
    assert.equal(new URL(page.url()).searchParams.has('demo'), false)
    assert.equal(new URL(page.url()).searchParams.has('ui_state'), false)
    assert.equal(await page.evaluate(() => window.__previewShell.shell === document.querySelector('[data-testid=fxreplay-shell]') && window.__previewShell.rail === document.querySelector('.fx-rail') && window.__previewShell.header === document.querySelector('.fx-topbar')), true)
    assert.equal(documents, 2, 'Only initial navigation and explicit reload load a document')
    await context.close()
  }

  const context = await browser.newContext({ viewport: { width: 1440, height: 987 } })
  const page = await context.newPage()
  page.on('pageerror', error => report.errors.push(error.message))
  await context.route('**/*', route => {
    const request = route.request()
    if (new URL(request.url()).origin !== origin) return route.abort()
    if (new URL(request.url()).pathname.startsWith('/api/')) { report.previewRequests.push(request.url()); return route.abort() }
    return route.continue()
  })
  for (const view of ['replay', 'trade', 'analytics', 'market-data', 'live', 'playbook', 'journal', 'testing']) {
    await page.goto(`${origin}/?workspace=tenant-a&view=${view}&select=1&demo=1&ui_state=loading`)
    await page.locator('[data-preview-state=loading]').waitFor()
    await page.locator('.wm-skeleton').waitFor()
    await page.locator('.wm-view-state-select .fx-select-trigger').click()
    await page.getByRole('option').filter({ hasText: 'Dữ liệu mẫu' }).first().click()
    await page.locator('[data-preview-state=demo]').waitFor()
    await page.waitForFunction(() => !document.querySelector('.fx-content .wm-skeleton'))
    if (view === 'trade') {
      const layout = await page.locator('.fx-content').evaluate(content => {
        const ledger = content.querySelector('.fxa-trades')
        const parent = ledger?.parentElement
        return { directChild: parent?.parentElement === content, overflow: getComputedStyle(content).overflowY,
          bottom: ledger?.getBoundingClientRect().bottom, contentBottom: content.getBoundingClientRect().bottom }
      })
      assert.equal(layout.directChild, true, 'Preview preserves ledger direct-child layout')
      assert.equal(layout.overflow, 'hidden', 'Only ledger rows scroll')
      assert.ok(layout.bottom <= layout.contentBottom + 1, 'Ledger stays within content viewport')
    }
    report.cases.push({ view, state: 'demo', fixtureOnly: true })
  }
  await context.close()
  assert.deepEqual(report.errors, [])
  assert.deepEqual(report.previewRequests, [])
  assert.deepEqual(report.writes, [])
  report.result = 'PASS'
} finally {
  await writeFile(`${output}/browser.json`, JSON.stringify(report, null, 2))
  await browser.close()
}
console.log(JSON.stringify({ result: report.result, cases: report.cases.length, errors: report.errors, previewRequests: report.previewRequests, writes: report.writes }))
