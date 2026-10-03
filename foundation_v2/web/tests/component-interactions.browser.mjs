import assert from 'node:assert/strict'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { chromium } from 'playwright'

const origin = process.env.TW_UI_ORIGIN || 'http://127.0.0.1:5180'
assert.equal(new URL(origin).hostname, '127.0.0.1')
const out = path.resolve(process.env.TW_UI_EVIDENCE || '../evidence/ui-component-interactions-20261003/controls')
const session = '39b1d068edd64e75864f692f27237852'
const report = { scope: 'isolated real GET-only QA data; native select pointer/keyboard/dismissal and component states; no backend writes', cases: [], errors: [], blocked: [] }
await mkdir(out, { recursive: true })
const axe = await readFile('../../../../.artifacts/wm-integration-quality-tools/node_modules/axe-core/axe.min.js', 'utf8')
const browser = await chromium.launch({ headless: true })
try {
  for (const theme of ['dark', 'light']) for (const width of [1440, 768, 390, 320]) {
    const context = await browser.newContext({ viewport: { width, height: 987 }, reducedMotion: width === 1440 ? 'no-preference' : 'reduce' })
    await context.addInitScript(t => { localStorage.setItem('tw-theme', t); localStorage.setItem('tw-language', 'vi') }, theme)
    await context.route('**/*', async route => {
      const request = route.request(), url = new URL(request.url())
      if (url.origin !== origin || !['GET', 'HEAD', 'OPTIONS'].includes(request.method())) {
        report.blocked.push({ method: request.method(), url: request.url() })
        return route.abort()
      }
      return route.continue()
    })
    const page = await context.newPage()
    page.on('pageerror', error => report.errors.push(String(error)))
    await page.goto(`${origin}/?view=overview&workspace=tenant-a&dashboard_session=${session}`, { waitUntil: 'networkidle' })
    await page.getByTestId('dashboard-performance').waitFor()
    await page.getByText('75 USD', { exact: true }).waitFor()
    const select = page.getByRole('combobox', { name: 'Phiên kết quả' })
    const scopeLabel = page.locator('.fx-dashboard-scope > span')
    if (await scopeLabel.isVisible()) {
      const labelLines = await scopeLabel.evaluate(element => {
        const range = document.createRange()
        range.selectNodeContents(element)
        return range.getClientRects().length
      })
      assert.equal(labelLines, 1, 'Scope label remains on one line')
    }
    if (width === 768 || width === 320) await page.screenshot({ path: path.join(out, `loaded-${theme}-${width}.png`), animations: 'disabled' })
    const options = await select.locator('option').evaluateAll(items => items.map(item => ({ value: item.value, label: item.label })))
    assert.ok(options.length > 2)
    assert.equal(await select.inputValue(), session)
    const before = await select.inputValue()
    await select.click()
    await page.waitForFunction(() => {
      const element = document.querySelector('.fx-dashboard-scope select')
      return element.matches(':open') && Number(getComputedStyle(element, '::picker(select)').opacity) === 1
    })
    const appearance = await select.evaluate(element => getComputedStyle(element).appearance)
    assert.equal(appearance, 'base-select', 'This installed Chromium supports the progressive picker')
    const selectedOption = select.locator('option:checked')
    const geometry = await selectedOption.boundingBox()
    assert.ok(geometry.x >= 0 && geometry.x + geometry.width <= width + 1, 'Picker selected option fits the viewport')
    assert.ok(geometry.height >= 44)
    await page.screenshot({ path: path.join(out, `picker-${theme}-${width}.png`), animations: 'disabled' })
    await page.addScriptTag({ content: axe })
    const audit = await page.evaluate(() => axe.run(document.querySelector('.fx-app'), { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21aa'] } }))
    assert.deepEqual(audit.violations, [])
    await page.keyboard.press('Escape')
    assert.equal(await select.evaluate(element => element.matches(':open')), false)
    assert.equal(await select.inputValue(), before, 'Escape does not change result scope')
    await select.click()
    await page.getByRole('heading', { name: 'Dashboard', exact: true }).click()
    assert.equal(await select.evaluate(element => element.matches(':open')), false, 'Outside click dismisses picker')
    await select.click()
    await page.keyboard.press('Home')
    await page.keyboard.press('ArrowDown')
    await page.keyboard.press('Enter')
    assert.equal(await select.inputValue(), options[1].value)
    assert.equal(new URL(page.url()).searchParams.get('dashboard_session'), options[1].value)
    await select.selectOption(session)
    await page.getByText('75 USD', { exact: true }).waitFor()
    await page.reload({ waitUntil: 'networkidle' })
    assert.equal(await select.inputValue(), session)
    await page.getByText('75 USD', { exact: true }).waitFor()
    const firstRow = page.locator('.fx-dashboard-session-row').first()
    const resultAction = firstRow.getByRole('button', { name: 'Kết quả', exact: true })
    const rowId = await firstRow.getAttribute('data-session-id')
    await resultAction.click()
    assert.equal(await resultAction.getAttribute('aria-pressed'), 'true')
    assert.equal(await firstRow.locator('.fx-dashboard-selection-mark').count(), 1)
    assert.equal(await select.inputValue(), rowId)
    const selectedColor = await firstRow.evaluate(async element => {
      getComputedStyle(element).backgroundColor
      await Promise.all(element.getAnimations().map(animation => animation.finished))
      return getComputedStyle(element).backgroundColor
    })
    await firstRow.hover()
    assert.equal(await firstRow.evaluate(element => getComputedStyle(element).backgroundColor), selectedColor, 'Hover does not erase persistent selection')
    await page.keyboard.press('Tab')
    await select.focus()
    assert.equal(await select.evaluate(element => getComputedStyle(element).outlineStyle), 'solid')
    if (width !== 1440) assert.equal(await select.evaluate(element => getComputedStyle(element, '::picker(select)').transitionDuration), '0s')
    await page.waitForLoadState('networkidle')
    await page.screenshot({ path: path.join(out, `selected-${theme}-${width}.png`), animations: 'disabled' })
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth) <= 1)
    report.cases.push({ theme, width, options: options.length, appearance, keyboardSelection: options[1].value, selectedRow: rowId, overflow: 0, axeViolations: 0 })
    // Remove only this progressive branch to exercise the native fallback
    // contract in the installed browser, without claiming a Safari/Firefox run.
    if (theme === 'light' && width === 320) {
      await page.evaluate(() => {
        const sheet = document.querySelector('style[data-vite-dev-id$="component-interactions.css"]').sheet
        for (let index = sheet.cssRules.length - 1; index >= 0; index--) {
          if (sheet.cssRules[index] instanceof CSSSupportsRule) sheet.deleteRule(index)
        }
      })
      assert.notEqual(await select.evaluate(element => getComputedStyle(element).appearance), 'base-select')
      await select.selectOption(session)
      await page.getByText('75 USD', { exact: true }).waitFor()
      report.fallback = 'progressive CSS removed: native select retains scope/change and known result; other engines not run'
    }
    await context.close()
  }
  assert.deepEqual(report.errors, [])
  assert.deepEqual(report.blocked, [])
  report.status = 'PASS'
} catch (error) { report.status = 'FAIL'; report.failure = String(error); process.exitCode = 1 }
finally {
  await browser.close()
  await writeFile(path.join(out, 'report.json'), JSON.stringify(report, null, 2))
  console.log(JSON.stringify({ status: report.status, cases: report.cases.length, failure: report.failure }))
}
