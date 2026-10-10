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
  for (const width of [1440, 390, 360, 320]) for (const theme of ['dark', 'light']) {
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
      const mainBounds = await page.locator('.fx-main').boundingBox()
      assert.ok(bounds.x >= mainBounds.x + 12 - 1, 'State menu stays outside the sidebar clipping region')
      await option.click()
      if (state !== 'real') await page.locator(`[data-testid=view-state-preview][data-preview-state=${state}]`).waitFor()
    }
    for (const { value } of previewOptions('overview').filter(option => !['real', 'demo'].includes(option.value))) {
      await choose(value)
      const preview = page.locator('.fx-content')
      const note = page.locator('.fx-subnav-action .wm-view-state-note')
      assert.equal(await note.count(), 1, 'Preview label belongs to the shared subnav action')
      assert.equal(await preview.locator('.wm-view-state-note').count(), 0, 'No separate preview label in page content')
      const noteBounds = await note.boundingBox()
      const triggerBounds = await page.locator('.wm-view-state-select .fx-select-trigger').boundingBox()
      assert.ok(triggerBounds.x >= 0 && triggerBounds.x + triggerBounds.width <= width, 'State selector stays inside viewport')
      if (width <= 600) {
        const navBounds = await page.locator('.fx-subnav-primary').boundingBox()
        assert.ok(navBounds.width >= 180, 'Preview controls preserve useful mobile navigation width')
        assert.ok(navBounds.y + navBounds.height <= noteBounds.y, 'Mobile preview controls sit below navigation')
      }
      assert.ok(noteBounds.x + noteBounds.width <= triggerBounds.x, 'Preview label stays left of the state selector')
      assert.ok(Math.abs(noteBounds.y + noteBounds.height / 2 - triggerBounds.y - triggerBounds.height / 2) <= 1, 'Preview label aligns with selector centre')
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
        assert.equal(await page.evaluate(() => Boolean(document.querySelector('.fx-dashboard-recent').compareDocumentPosition(document.querySelector('.fx-dashboard-results')) & Node.DOCUMENT_POSITION_FOLLOWING)), true, 'Recent sessions precede Performance in the shared layout')
        const expected = value === 'partial' ? 2 : 3
        assert.equal(await preview.locator('.fx-dashboard-session-card').count(), expected)
        await preview.locator('.fx-dashboard-metric strong').nth(2).waitFor()
        await page.waitForFunction(count => document.querySelectorAll('.fx-dashboard-metric strong')[2]?.textContent === count, value === 'partial' ? '40' : '60')
        if (value === 'unknown') assert.deepEqual((await preview.locator('.fx-dashboard-metric strong').allTextContents()).slice(0, 2), ['—', '—'])
        if (value === 'refreshing') assert.equal(await preview.locator('.wm-view-state-update').getAttribute('aria-busy'), 'true')
        if (value === 'many') {
          const pagination = page.getByRole('navigation', { name: 'Phân trang phiên gần đây' })
          const sessionIds = new Set()
          for (let index = 0; index < 4; index++) {
            assert.equal(await preview.locator('.fx-dashboard-session-card').count(), 3)
            for (const id of await preview.locator('.fx-dashboard-session-card').evaluateAll(cards => cards.map(card => card.dataset.sessionId))) {
              assert.equal(sessionIds.has(id), false, 'Pages do not repeat a session')
              sessionIds.add(id)
            }
            assert.equal(await preview.locator('.fx-dashboard-metric strong').nth(2).textContent(), '60', 'Performance does not change with the recent-session page')
            if (index < 3) {
              await pagination.getByRole('button', { name: 'Trang sau', exact: true }).click()
              await page.waitForFunction(pageNumber => document.querySelector('.fx-dashboard-recent .wm-pagination [aria-current="page"]')?.textContent === String(pageNumber), index + 2)
            }
          }
          assert.equal(sessionIds.size, 12)
          assert.equal(await pagination.getByRole('button', { name: 'Trang sau', exact: true }).isDisabled(), true)
          await preview.getByRole('searchbox', { name: 'Tìm phiên gần đây' }).fill('Gold Swing')
          assert.equal(await preview.locator('.fx-dashboard-session-card').count(), 1)
          assert.equal(await preview.locator('.fx-dashboard-session-card').getAttribute('data-session-id'), 'demo-gold')
          await preview.getByRole('searchbox', { name: 'Tìm phiên gần đây' }).fill('')
          assert.equal(await preview.locator('.fx-dashboard-session-card').count(), 3)
        }
      }
      if (['loading', 'empty', 'error', 'stale', 'partial', 'unknown', 'many'].includes(value)) await page.screenshot({ path: `${output}/${theme}-${width}-${value}.png` })
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
    assert.equal(await page.evaluate(() => Boolean(document.querySelector('.fx-dashboard-recent').compareDocumentPosition(document.querySelector('.fx-dashboard-results')) & Node.DOCUMENT_POSITION_FOLLOWING)), true, 'Actual data uses the same section order')
    assert.ok(await page.locator('.fx-dashboard-session-card').count() <= 3)
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
    assert.equal(await page.locator('.fx-subnav-action .wm-view-state-note').count(), 1, 'Every supported page shares the preview label location')
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
  await page.goto(`${origin}/?workspace=tenant-a&view=overview&area=testing&section=dashboard&demo=1&ui_state=many`)
  const practice = page.locator('.fx-dashboard-session-card[data-session-id="demo-practice-12"]')
  await practice.waitFor()
  await practice.locator('.fx-dashboard-card-summary').click()
  await page.waitForURL(url => url.searchParams.get('view') === 'replay')
  await page.waitForFunction(() => document.querySelector('.fxr-session-control .fx-select-trigger strong')?.textContent === 'Practice 12')
  assert.match(await page.locator('.fxr-session-control .fx-select-trigger').textContent(), /10\.000 USD/)
  await page.reload()
  await page.waitForFunction(() => document.querySelector('.fxr-session-control .fx-select-trigger strong')?.textContent === 'Practice 12')
  await page.goto(`${origin}/?workspace=tenant-a&view=overview&area=testing&section=dashboard&demo=1&ui_state=many`)
  await practice.waitFor()
  await practice.locator('a[href*="view=analytics"]').click()
  await page.waitForURL(url => url.searchParams.get('view') === 'analytics')
  await page.waitForFunction(() => document.querySelector('.fxa-session-trigger')?.getAttribute('aria-label')?.includes('Practice 12'))
  report.cases.push({ view: 'overview', state: 'many', journey: 'extra-session summary/reload/analytics; no fallback to an original session' })
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
