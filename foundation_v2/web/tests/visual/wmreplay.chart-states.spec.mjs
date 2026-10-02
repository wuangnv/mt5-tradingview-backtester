import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import { createHash } from 'node:crypto'
import { readdirSync, readFileSync } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'

const here = path.dirname(fileURLToPath(import.meta.url))
const workspace = path.resolve(here, '../../../../../..')
const { test, expect } = createRequire(path.join(workspace, 'tooling/ui-qa/package.json'))('@playwright/test')
const fixtureBytes = readFileSync(path.join(here, 'chart-fixture.json'))
const fixture = JSON.parse(fixtureBytes)
const origin = process.env.TW_CHART_STATES_ORIGIN || 'http://127.0.0.1:5186'
if (new URL(origin).hostname !== '127.0.0.1') throw new Error('Only isolated loopback UI origins are allowed')
const output = path.resolve(process.env.TW_CHART_STATES_OUTPUT || path.join(workspace, '.artifacts/wm-all-plan-20261002/chart-states-r1'))
const sha = bytes => createHash('sha256').update(bytes).digest('hex')
const price = value => new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 8 }).format(value)
function sourceHash() {
  const root = path.resolve(here, '../../src'), hash = createHash('sha256')
  for (const name of readdirSync(root, { recursive: true }).filter(name => /\.(jsx?|css)$/.test(name)).sort()) hash.update(name).update(readFileSync(path.join(root, name)))
  return hash.digest('hex')
}

// Independent bounded OHLC path crosses the initial close in both directions.
// Never write the canonical fixture, dataset, API, or approved golden images.
const variant = structuredClone(fixture)
variant.latest.visible_rows = fixture.latest.visible_rows.map((row, index) => {
  const close = Number((1.1 + Math.sin(index * .55) * .004).toFixed(5))
  const open = Number((close + (index % 2 ? .0006 : -.0006)).toFixed(5))
  return { ...row, open, close, high: Number((Math.max(open, close) + .0003).toFixed(5)), low: Number((Math.min(open, close) - .0003).toFixed(5)), volume: 100 + index * 3 }
})
variant.history.visible_rows = variant.latest.visible_rows.slice(0, 21)
variant.annotations.items = []
variant.scope = 'SYNTHETIC_VARIANT_RENDERER_ONLY: alternating up/down OHLC, 61/21 row prefix; no backend, broker, fixture overwrite or golden promotion'

test('five chart types render mixed OHLC and preserve cutoff through wheel/pan', async ({ page, context, browser }, testInfo) => {
  const before = sourceHash(), errors = [], unexpected = [], observations = [], states = []
  page.on('pageerror', error => errors.push(String(error)))
  await page.addInitScript(theme => { localStorage.setItem('tw-theme', theme); localStorage.setItem('tw-language', 'vi'); localStorage.setItem('tw-shell-rail-collapsed', 'false') }, testInfo.project.metadata.theme)
  await context.routeWebSocket('**/*', socket => socket.close())
  await context.route('**/*', async route => {
    const request = route.request(), url = new URL(request.url())
    if (url.origin !== origin || !['GET', 'HEAD'].includes(request.method())) { unexpected.push(`${request.method()} ${url.href}`); return route.abort() }
    if (!url.pathname.startsWith('/api/')) return route.continue()
    if (request.headers()['x-workspace-id'] !== variant.workspace) { unexpected.push('Wrong workspace'); return route.abort() }
    let body
    if (url.pathname === '/api/v2/data/datasets') body = variant.datasets
    else if (url.pathname === '/api/v2/chart/annotations') body = variant.annotations
    else if (url.pathname === `/api/v2/replay/sessions/${variant.session}`) {
      const cursor = url.searchParams.get('cursor_index')
      if (cursor !== null && !['20', '60'].includes(cursor)) { unexpected.push('Unexpected cursor ' + cursor); return route.abort() }
      body = cursor === '20' ? variant.history : variant.latest
      observations.push({ cursor: body.view_cursor_index, canonicalCursor: body.payload.cursor_index, rows: body.visible_rows.length, cutoff: body.cutoff_timestamp })
    } else { unexpected.push(url.pathname); return route.abort() }
    return route.fulfill({ status: 200, json: body })
  })
  const chart = page.getByTestId('replay-chart')
  const range = () => chart.evaluate(node => ({ from: Number(node.dataset.rangeFrom), to: Number(node.dataset.rangeTo) }))
  const fit = async () => {
    await page.getByRole('button', { name: 'Vừa toàn bộ nến đã mở', exact: true }).click()
    await expect.poll(async () => (await range()).to).toBeGreaterThan(59)
    await chart.scrollIntoViewIfNeeded()
  }
  const url = cursor => `${origin}/?workspace=${variant.workspace}&view=replay&surface=workspace&session=${variant.session}&cursor=${cursor}`
  const destination = path.join(output, testInfo.project.name)
  await mkdir(destination, { recursive: true })
  await page.goto(url(60))
  await expect(chart).toHaveAttribute('data-visible-row-count', '61')
  await expect(chart).toHaveAttribute('data-visible-object-count', '0')
  await page.evaluate(() => document.fonts.ready)
  await page.addStyleTag({ content: '*,*::before,*::after{animation:none!important;transition:none!important;caret-color:transparent!important;scroll-behavior:auto!important}' })
  await page.getByRole('checkbox', { name: 'Volume', exact: true }).uncheck()
  let previousPan = null
  for (const type of ['candles', 'bars', 'line', 'area', 'baseline']) {
    await page.getByRole('combobox', { name: 'Kiểu chart', exact: true }).selectOption(type)
    if (previousPan) {
      await expect.poll(async () => Math.abs((await range()).from - previousPan.from)).toBeLessThan(.01)
      await expect.poll(async () => Math.abs((await range()).to - previousPan.to)).toBeLessThan(.01)
    }
    await fit()
    const fitted = await range()
    expect(fitted.from).toBeLessThan(1)
    expect(fitted.to).toBeLessThan(64)
    const box = await chart.locator('canvas').first().boundingBox()
    const sampleIndex = 31, sample = variant.latest.visible_rows[sampleIndex]
    await page.mouse.move(box.x + (sampleIndex - fitted.from + .5) / (fitted.to - fitted.from + 1) * box.width, box.y + box.height * .4)
    await expect(page.locator('.bar-readout-label')).toHaveText(`Crosshair #${sampleIndex}`)
    await expect(page.locator('.bar-readout strong')).toHaveText([sample.open, sample.high, sample.low, sample.close].map(price))
    await page.mouse.move(0, 0)
    await expect(page.locator('.bar-readout-label')).toHaveText('Nến hiện tại #60')
    const colors = await chart.locator('canvas').evaluateAll(nodes => {
      const totals = { green: 0, red: 0, gold: 0 }
      for (const canvas of nodes) {
        const pixels = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data
        for (let i = 0; i < pixels.length; i += 4) {
          if (pixels[i] === 99 && pixels[i + 1] === 185 && pixels[i + 2] === 130) totals.green++
          if (pixels[i] === 223 && pixels[i + 1] === 118 && pixels[i + 2] === 118) totals.red++
          if (pixels[i] === 214 && pixels[i + 1] === 181 && pixels[i + 2] === 111) totals.gold++
        }
      }
      return totals
    })
    if (['candles', 'bars', 'baseline'].includes(type)) { expect(colors.green).toBeGreaterThan(10); expect(colors.red).toBeGreaterThan(10) }
    else expect(colors[type === 'line' ? 'gold' : 'green']).toBeGreaterThan(10)
    const screenshot = await chart.screenshot({ path: path.join(destination, `${type}.png`), animations: 'disabled', scale: 'css' })
    await page.mouse.move(box.x + box.width * .55, box.y + box.height * .4)
    await page.mouse.wheel(0, -350)
    await expect.poll(async () => { const current = await range(); return current.to - current.from }).toBeLessThan(fitted.to - fitted.from - 1)
    const zoomed = await range()
    await page.mouse.down()
    await page.mouse.move(box.x + box.width * .70, box.y + box.height * .4, { steps: 12 })
    await page.mouse.up()
    await expect.poll(async () => Math.abs((await range()).from - zoomed.from)).toBeGreaterThan(.5)
    const panned = await range()
    previousPan = panned
    await expect(chart).toHaveAttribute('data-visible-row-count', '61')
    await expect(page.getByTestId('replay-jump')).toHaveValue('60')
    states.push({ type, fitted, zoomed, panned, sampleIndex, sample, colors, captureSha256: sha(screenshot) })
  }
  expect(new Set(states.map(state => state.captureSha256)).size).toBe(5)
  await page.getByRole('combobox', { name: 'Kiểu chart', exact: true }).selectOption('candles')
  await page.getByRole('checkbox', { name: 'Volume', exact: true }).check()
  await page.getByRole('checkbox', { name: 'SMA 20', exact: true }).check()
  await fit()
  await page.mouse.move(0, 0)
  const readOverlays = () => chart.locator('canvas').evaluateAll(nodes => {
    const totals = { sma: 0, upVolume: 0, downVolume: 0 }
    for (const canvas of nodes) {
      const pixels = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data
      for (let i = 0; i < pixels.length; i += 4) {
        // A one-pixel SMA line is antialiased, especially at mobile width.
        // Its gold hue is distinct from this fixture's red/green main series.
        if (pixels[i] > 90 && pixels[i] - pixels[i + 1] > 15 && pixels[i + 1] - pixels[i + 2] > 25 && pixels[i + 2] < 140) totals.sma++
        if (pixels[i] === 38 && pixels[i + 1] === 76 && pixels[i + 2] === 57) totals.upVolume++
        if (pixels[i] === 96 && pixels[i + 1] === 55 && pixels[i + 2] === 55) totals.downVolume++
      }
    }
    return totals
  })
  await expect.poll(async () => Object.values(await readOverlays()).every(count => count > 10)).toBe(true)
  const overlays = await readOverlays()
  for (const count of Object.values(overlays)) expect(count).toBeGreaterThan(10)
  await chart.screenshot({ path: path.join(destination, 'candles-volume-sma.png'), animations: 'disabled', scale: 'css' })
  await page.goto(url(20))
  await expect(chart).toHaveAttribute('data-visible-row-count', '21')
  await expect(chart).toHaveAttribute('data-visible-object-count', '0')
  await expect(page.getByTestId('step-1')).toBeDisabled()
  await expect(page.getByTestId('play-toggle')).toBeDisabled()
  await expect(page.getByTestId('replay-jump')).toHaveValue('20')
  await page.reload()
  await expect(chart).toHaveAttribute('data-visible-row-count', '21')
  const last = variant.history.visible_rows.at(-1)
  await expect(page.locator('.bar-readout strong')).toHaveText([last.open, last.high, last.low, last.close].map(price))
  for (const view of observations) { expect(view.rows).toBe(view.cursor + 1); expect(view.canonicalCursor).toBe(60); expect(view.cutoff).toBe(variant.latest.visible_rows[view.cursor].timestamp) }
  const geometry = await page.evaluate(() => ({ pageOverflow: document.documentElement.scrollWidth - innerWidth, contentOverflow: document.querySelector('.fx-content').scrollWidth - document.querySelector('.fx-content').clientWidth }))
  expect(geometry.pageOverflow).toBeLessThanOrEqual(1)
  expect(geometry.contentOverflow).toBeLessThanOrEqual(1)
  expect(errors).toEqual([])
  expect(unexpected).toEqual([])
  expect(sourceHash()).toBe(before)
  expect(sha(readFileSync(path.join(here, 'chart-fixture.json')))).toBe(sha(fixtureBytes))
  const receipt = { status: 'SCOPED_BEHAVIOR_PASS_VISUAL_REVIEW_PENDING', scope: variant.scope, sourceHash: before, canonicalFixtureSha256: sha(fixtureBytes), variantSha256: sha(JSON.stringify(variant)), project: testInfo.project.name, browser: browser.version(), viewport: testInfo.project.use.viewport, states, overlays, preservesViewportOnTypeSwitch: true, observations, geometry, errors, unexpected, excluded: ['touch/pinch', 'keyboard-only chart pan', 'backend persistence', 'performance', 'independent visual approval', 'golden promotion', 'full W8'] }
  await writeFile(path.join(destination, 'receipt.json'), JSON.stringify(receipt, null, 2))
  await testInfo.attach('chart-states-provenance', { body: JSON.stringify(receipt, null, 2), contentType: 'application/json' })
})
