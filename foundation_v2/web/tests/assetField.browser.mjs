import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { chromium } from 'playwright'

const origin = process.env.TESTING_UI_ORIGIN || 'http://127.0.0.1:5180'
const out = process.env.TW_UI_EVIDENCE_DIR || '../.runtime/asset-field'
const baseline = process.env.TW_UI_BASELINE === '1'
await mkdir(out, { recursive: true })
const browser = await chromium.launch({ headless: true })
const report = { cases: [], errors: [], writes: [], baseline }
try {
  for (const width of [1710, 1440, 360]) for (const theme of ['dark', 'light']) {
    const context = await browser.newContext({ viewport: { width, height: 987 } })
    await context.addInitScript(theme => { localStorage.setItem('tw-theme', theme); localStorage.setItem('tw-language', 'vi') }, theme)
    await context.route('**/*', route => {
      const request = route.request()
      if (new URL(request.url()).origin !== origin) return route.abort()
      if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method())) { report.writes.push(request.url()); return route.abort() }
      return route.continue()
    })
    const page = await context.newPage()
    page.setDefaultTimeout(10000)
    page.on('pageerror', error => report.errors.push(error.message))
    await page.goto(`${origin}/?workspace=tenant-a&view=overview&area=testing&section=dashboard`)
    await page.locator('.fx-dashboard-quick-action.is-primary').click()
    const dialog = page.locator('.quick-session-dialog')
    const field = dialog.locator('.fx-select-tag-field')
    const trigger = field.locator('.fx-select-trigger')
    const menu = dialog.locator('.dataset-asset-select .fx-select-menu')
    await trigger.click()
    await menu.waitFor()
    const options = menu.locator('[role=option]:not(:disabled)')
    assert.ok(await options.count() >= 2, 'local fixture has at least two downloaded assets')
    for (let index = 0; index < 2; index++) {
      const option = options.nth(index)
      if (await option.getAttribute('aria-selected') !== 'true') await option.click()
    }
    assert.equal(await field.locator('.fx-select-tag').count(), 2)
    await page.keyboard.press('Escape')
    const state = async () => field.evaluate(async element => {
      await Promise.all(element.getAnimations({ subtree: true }).map(a => a.finished.catch(() => {})))
      const bounds = element.getBoundingClientRect(), css = getComputedStyle(element)
      return { background: css.backgroundColor, height: bounds.height, width: bounds.width, scrollWidth: element.scrollWidth, chips: [...element.querySelectorAll('.fx-select-tag')].map(tag => {
        const tagCss = getComputedStyle(tag), rect = tag.getBoundingClientRect()
        return { background: tagCss.backgroundColor, border: tagCss.borderTopWidth, height: rect.height, x: rect.x, right: rect.right }
      }) }
    })
    await dialog.locator('input[maxlength="160"]').first().focus()
    await page.mouse.move(10, 10)
    const rest = await state()
    await field.hover()
    const hover = await state()
    const row = { theme, width, rest, hover, toggles: [] }
    const clickField = () => field.click({ position: { x: Math.max(2, rest.width / 2), y: rest.height / 2 } })
    for (const target of ['wrapper', 'arrow', 'tag']) {
      if (await menu.count()) await page.keyboard.press('Escape')
      const click = target === 'wrapper' ? clickField : target === 'arrow' ? () => trigger.click() : () => field.locator('.fx-select-tag > span').first().click()
      await click()
      assert.equal(await trigger.getAttribute('aria-expanded'), 'true')
      await click()
      const expanded = await trigger.getAttribute('aria-expanded')
      row.toggles.push({ target, secondClickExpanded: expanded })
      if (!baseline) assert.equal(expanded, 'false', `${theme}/${width}/${target} second click closes`)
    }
    if (await menu.count()) await page.keyboard.press('Escape')
    await field.hover()
    await state()
    await field.screenshot({ path: `${out}/${theme}-${width}-hover.png` })
    if (!baseline) {
      assert.equal(rest.height, hover.height, 'hover does not change geometry')
      assert.ok(hover.chips.every(chip => chip.background !== hover.background), 'chips stay distinct from hovered field')
      assert.ok(hover.chips.every(chip => chip.border === '1px' && chip.height <= 28), 'compact bounded chips')
      assert.ok(hover.scrollWidth <= hover.width + 1, 'selected assets fit field')
      const alignment = await field.locator('.fx-select-tag').evaluateAll(tags => tags.map(tag => {
        const center = element => { const rect = element.getBoundingClientRect(); return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 } }
        const label = tag.querySelector('span'), button = tag.querySelector('button'), icon = button.querySelector('svg')
        return { chip: center(tag), label: center(label), button: center(button), icon: center(icon), labelCursor: getComputedStyle(label).cursor, buttonCursor: getComputedStyle(button).cursor }
      }))
      for (const item of alignment) {
        assert.ok(Math.abs(item.chip.y - item.label.y) < 1, 'asset label centered in chip')
        assert.ok(Math.abs(item.chip.y - item.icon.y) < 1, 'remove icon centered in chip')
        assert.ok(Math.abs(item.button.x - item.icon.x) < 1, 'remove icon centered in its hit area')
        assert.equal(item.labelCursor, 'pointer')
        assert.equal(item.buttonCursor, 'pointer')
      }
      row.alignment = alignment
      const cursor = locator => locator.evaluate(e => getComputedStyle(e).cursor)
      assert.equal(await cursor(field), 'pointer')
      assert.equal(await cursor(trigger), 'pointer')
      assert.equal(await cursor(dialog.locator('input[maxlength="160"]').first()), 'text')
      assert.equal(await cursor(dialog.locator('.quick-session-balance')), 'text')
      assert.equal(await cursor(dialog.locator('.quick-session-field .fx-select-trigger:disabled')), 'default')
      assert.equal(await cursor(dialog.locator('.quick-session-submit')), 'default')
      const remove = field.getByRole('button', { name: /^Bỏ tài sản/ }).first()
      const removeStyle = () => remove.evaluate(async element => {
        await Promise.all(element.getAnimations().map(a => a.finished.catch(() => {})))
        const css = getComputedStyle(element), chip = getComputedStyle(element.parentElement)
        const rgb = token => `rgb(${chip.getPropertyValue(token).trim().slice(1).match(/.{2}/g).map(n => parseInt(n, 16)).join(', ')})`
        return { background: css.backgroundColor, border: css.borderTopWidth, opacity: Number(css.opacity), outline: css.outlineStyle, outlineWidth: css.outlineWidth, outlineColor: css.outlineColor, chipBackground: chip.backgroundColor, chipColor: chip.color, orange: rgb('--project-action'), onOrange: rgb('--project-on-action') }
      })
      await dialog.locator('input[maxlength="160"]').first().focus()
      await page.mouse.move(10, 10)
      const removeRest = await removeStyle()
      await remove.hover()
      const removeHover = await removeStyle()
      assert.equal(removeHover.chipBackground, removeHover.orange)
      assert.equal(removeHover.chipColor, removeHover.onOrange)
      assert.equal(removeHover.background, 'rgba(0, 0, 0, 0)')
      assert.equal(removeHover.border, '0px')
      assert.ok(removeHover.opacity > removeRest.opacity, 'remove icon brightens without a hover surface')
      row.remove = { rest: removeRest, hover: removeHover }
      await field.screenshot({ path: `${out}/${theme}-${width}-remove-hover.png` })
      await page.keyboard.press('Tab')
      await remove.focus()
      const removeFocus = await removeStyle()
      assert.equal(removeFocus.opacity, 1)
      assert.equal(removeFocus.outline, 'solid')
      assert.equal(removeFocus.outlineWidth, '2px')
      assert.equal(removeFocus.outlineColor, removeFocus.onOrange, 'keyboard ring contrasts with orange chip')
      row.remove.focus = removeFocus
      await trigger.click()
      await menu.locator('input').fill('does-not-exist')
      assert.equal(await menu.locator('[role=option]').count(), 0)
      await menu.locator('input').fill('')
      await page.keyboard.press('Escape')
      assert.ok(await trigger.evaluate(e => document.activeElement === e))
      await trigger.focus()
      await page.keyboard.press('Enter')
      assert.equal(await trigger.getAttribute('aria-expanded'), 'true')
      await page.keyboard.press('Escape')
      await field.getByRole('button', { name: /^Bỏ tài sản/ }).first().click()
      assert.equal(await field.locator('.fx-select-tag').count(), 1, 'remove asset does not toggle popup')
      assert.equal(await trigger.getAttribute('aria-expanded'), 'false')
      await trigger.click()
      await field.getByRole('button', { name: /^Bỏ tài sản/ }).first().click()
      assert.equal(await trigger.getAttribute('aria-expanded'), 'true', 'remove last asset keeps an open menu open')
      assert.equal(await field.locator('.fx-select-tag').count(), 0)
      await page.keyboard.press('Escape')
      await clickField()
      assert.equal(await trigger.getAttribute('aria-expanded'), 'true', 'empty field opens')
      await clickField()
      assert.equal(await trigger.getAttribute('aria-expanded'), 'false', 'empty field closes on repeat click')
      assert.equal(await cursor(field), 'pointer', 'empty field remains clickable')
    }
    report.cases.push(row)
    await context.close()
  }
  assert.deepEqual(report.errors, [])
  assert.deepEqual(report.writes, [])
  report.pass = true
} finally {
  await browser.close()
  await writeFile(`${out}/report.json`, JSON.stringify(report, null, 2))
}
console.log(JSON.stringify({ pass: report.pass, baseline, cases: report.cases.length, errors: report.errors, writes: report.writes }))
