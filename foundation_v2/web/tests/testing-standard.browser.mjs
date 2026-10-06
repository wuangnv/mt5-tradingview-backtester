import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import { chromium } from 'playwright'

const origin = process.env.TESTING_UI_ORIGIN || 'http://127.0.0.1:5180'
const output = process.env.TESTING_QA_OUTPUT || '../evidence/testing-standard-smoke'
const allowed = new Set([new URL(origin).origin, 'http://127.0.0.1:8010'])
const browser = await chromium.launch({ ignoreDefaultArgs: ['--hide-scrollbars'] })
const results = []
await fs.mkdir(output, { recursive: true })
const routes = [
  ['dashboard', 'view=overview'], ['sessions', 'view=replay&select=1'],
  ['trades', 'view=trade&sessions=all&select=1'], ['analytics', 'view=analytics&select=1'],
  ['prop', 'view=analytics&select=1&analytics_source=prop'], ['market', 'view=market-data'],
]

try {
  for (const language of ['vi', 'en']) {
    const context = await browser.newContext({ viewport: { width: 1710, height: 987 } })
    await context.addInitScript(language => {
      localStorage.setItem('tw-language', language)
      localStorage.setItem('tw-theme', 'dark')
    }, language)
    const errors = [], writes = []
    await context.route('**/*', route => {
      const request = route.request()
      if (!allowed.has(new URL(request.url()).origin)) return route.abort()
      if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method())) {
        writes.push(request.url())
        return route.abort()
      }
      return route.continue()
    })
    const page = await context.newPage()
    page.on('pageerror', error => errors.push(error.message))
    for (const [name, route] of routes) {
      await page.goto(`${origin}/?workspace=tenant-a&area=testing&demo=1&${route}`)
      await page.waitForLoadState('networkidle')
      const content = page.locator('.fx-content')
      assert.ok((await content.innerText()).trim(), name)
      assert.equal(await content.locator('select').count(), 0, `${name}: native select regression`)
      assert.equal(await content.evaluate(element => element.scrollWidth > element.clientWidth + 1), false, `${name}: page overflow`)
      assert.equal(await content.locator('h1.sr-only').evaluateAll(elements => elements.some(element => element.getBoundingClientRect().width > 1 || getComputedStyle(element).clip === 'auto')), false, `${name}: duplicated page title`)
      if (name === 'trades') {
        const current = content.locator('.fxa-pagination [aria-current=page]')
        assert.equal(await current.innerText(), '1')
        await content.locator('.fxa-pagination button').filter({ hasText: /^2$/ }).click()
        await assertEventually(() => current.innerText(), '2')
      }
      results.push({ name, language, pass: true })
    }
    await page.goto(`${origin}/?workspace=tenant-a&area=testing&ui_reference=1`)
    await page.waitForLoadState('networkidle')
    assert.equal(await page.locator('.wm-component-reference').count(), 1)
    const selects = page.locator('.wm-component-reference .fx-select-trigger')
    await selects.nth(1).click()
    const menu = page.locator('.fx-select-menu')
    assert.equal(await menu.getByRole('checkbox').getAttribute('aria-checked'), 'mixed')
    await menu.getByRole('checkbox').click()
    assert.equal(await menu.getByRole('checkbox').getAttribute('aria-checked'), 'true')
    await page.keyboard.press('Escape')
    await page.screenshot({ path: `${output}/reference-${language}.png` })
    assert.deepEqual(errors, [], `runtime errors: ${language}`)
    assert.deepEqual(writes, [], `actual writes: ${language}`)
    await context.close()
  }
  await fs.writeFile(`${output}/report.json`, JSON.stringify({ pass: true, results }, null, 2))
  console.log(`Testing smoke: ${results.length} route checks + 2 component reference journeys passed; no writes.`)
} finally {
  await browser.close()
}

async function assertEventually(read, expected) {
  const deadline = Date.now() + 3000
  while (Date.now() < deadline) {
    if (await read() === expected) return
    await new Promise(resolve => setTimeout(resolve, 50))
  }
  assert.equal(await read(), expected)
}
