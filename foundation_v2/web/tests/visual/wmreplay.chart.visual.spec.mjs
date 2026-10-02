import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import { createHash } from 'node:crypto'
import { readdirSync, readFileSync } from 'node:fs'
import { readFile, writeFile, mkdir } from 'node:fs/promises'

const here = path.dirname(fileURLToPath(import.meta.url))
const workspace = path.resolve(here, '../../../../../..')
const { test, expect } = createRequire(path.join(workspace, 'tooling/ui-qa/package.json'))('@playwright/test')
const fixtureBytes = await readFile(path.join(here, 'chart-fixture.json'))
const fixture = JSON.parse(fixtureBytes)
const origin = process.env.TW_VISUAL_ORIGIN || 'http://127.0.0.1:5180'
if (new URL(origin).hostname !== '127.0.0.1') throw new Error('Only isolated loopback UI origins are allowed')
const candidate = process.env.TW_VISUAL_CANDIDATE === '1'
const candidateRoot = path.resolve(process.env.TW_CHART_CANDIDATE_ROOT || path.join(workspace, '.artifacts/wm-all-plan-20261002/chart-candidate'))
const sha = bytes => createHash('sha256').update(bytes).digest('hex')
function sourceHash() {
  const root = path.resolve(here, '../../src'), hash = createHash('sha256')
  for (const name of readdirSync(root, { recursive: true }).filter(name => /\.(jsx?|css)$/.test(name)).sort()) hash.update(name).update(readFileSync(path.join(root, name)))
  return hash.digest('hex')
}
const price = number => new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 8 }).format(number)
const timestamp = number => new Intl.DateTimeFormat('vi-VN', { dateStyle: 'short', timeStyle: 'medium', timeZone: 'UTC' }).format(new Date(number * 1000))

test('actual chart causal prefix, OHLC, drawings and visual fixture', async ({ page, context, browser }, testInfo) => {
  const before = sourceHash(), errors = [], unexpected = [], observed = [], assertions = [], captures = []
  page.on('pageerror', cause => errors.push(String(cause)))
  await page.addInitScript(theme => { localStorage.setItem('tw-theme', theme); localStorage.setItem('tw-language', 'vi'); localStorage.setItem('tw-shell-rail-collapsed', 'false') }, testInfo.project.metadata.theme)
  await context.routeWebSocket('**/*', socket => socket.close())
  await context.route('**/*', async route => {
    const request = route.request(), url = new URL(request.url())
    if (url.origin !== origin || !['GET', 'HEAD'].includes(request.method())) { unexpected.push(`${request.method()} ${url.href}`); return route.abort() }
    if (!url.pathname.startsWith('/api/')) return route.continue()
    if (request.headers()['x-workspace-id'] !== fixture.workspace) { unexpected.push('Wrong fixture workspace'); return route.abort() }
    let body
    if (url.pathname === '/api/v2/data/datasets') body = fixture.datasets
    else if (url.pathname === '/api/v2/chart/annotations') body = fixture.annotations
    else if (url.pathname === `/api/v2/replay/sessions/${fixture.session}`) {
      const cursor = url.searchParams.get('cursor_index')
      if (cursor !== null && !['60', '20'].includes(cursor)) { unexpected.push('Uncontrolled cursor ' + cursor); return route.abort() }
      body = cursor === '20' ? fixture.history : fixture.latest
      observed.push(body)
    } else { unexpected.push(url.pathname); return route.abort() }
    return route.fulfill({ status: 200, json: body })
  })
  const chart = page.getByTestId('replay-chart'), frame = page.locator('.chart-frame')
  const url = cursor => `${origin}/?workspace=${fixture.workspace}&view=replay&surface=workspace&session=${fixture.session}&cursor=${cursor}`
  async function ready(view, count, objects) {
    await expect(chart).toHaveAttribute('data-visible-row-count', String(count))
    await expect(chart).toHaveAttribute('data-visible-object-count', String(objects))
    const last = view.visible_rows.at(-1)
    await expect(chart).toHaveAccessibleName(new RegExp(`${count} nến đã mở`))
    const summary = await chart.getAttribute('aria-label')
    for (const value of [timestamp(last.timestamp), `mở ${price(last.open)}`, `cao ${price(last.high)}`, `thấp ${price(last.low)}`, `đóng ${price(last.close)}`]) expect(summary).toContain(value)
    await expect(page.locator('.bar-readout strong')).toHaveText([last.open, last.high, last.low, last.close].map(price))
    await expect(page.locator('.replay-evidence-strip')).toContainText(`${count} nến được phép hiển thị`)
    await expect(page.getByTestId('replay-jump')).toHaveValue(String(view.view_cursor_index))
    await expect(page.getByTestId('replay-jump')).toHaveAttribute('max', '60')
    await page.evaluate(() => document.fonts.ready)
    await page.addStyleTag({ content: '*,*::before,*::after{animation:none!important;transition:none!important;caret-color:transparent!important;scroll-behavior:auto!important}' })
    await page.getByRole('button', { name: 'Vừa toàn bộ nến đã mở', exact: true }).click()
    await page.mouse.move(0, 0)
    await expect.poll(async () => chart.evaluate(node => Number(node.dataset.rangeTo))).toBeGreaterThan(count - 2)
    const range = await chart.evaluate(node => ({ from: Number(node.dataset.rangeFrom), to: Number(node.dataset.rangeTo) }))
    expect(range.from).toBeLessThan(1)
    expect(range.to).toBeLessThanOrEqual(count + 3)
    const sampleIndex = Math.floor(count / 2), sample = view.visible_rows[sampleIndex]
    const plot = await chart.locator('canvas').first().boundingBox()
    await page.mouse.move(plot.x + (sampleIndex - range.from + .5) / (range.to - range.from + 1) * plot.width, plot.y + plot.height * .4)
    await expect(page.locator('.bar-readout-label')).toHaveText(`Crosshair #${sampleIndex}`)
    await expect(page.locator('.bar-readout strong')).toHaveText([sample.open, sample.high, sample.low, sample.close].map(price))
    await expect(page.locator('.bar-readout-time')).toContainText(timestamp(sample.timestamp))
    await page.mouse.move(0, 0)
    await expect(page.locator('.bar-readout-label')).toHaveText(`Nến hiện tại #${view.view_cursor_index}`)
    assertions.push({ cursor: view.view_cursor_index, count, objects, last, range, accessibleSummary: summary, renderedCrosshairSample: { index: sampleIndex, ...sample } })
  }
  async function capture(name, target = page) {
    if (candidate) {
      const destination = path.join(candidateRoot, testInfo.project.name)
      await mkdir(destination, { recursive: true })
      const first = await target.screenshot({ path: path.join(destination, name), animations: 'disabled', caret: 'hide', scale: 'css' })
      const second = await target.screenshot({ path: path.join(destination, name.replace('.png', '-repeat.png')), animations: 'disabled', caret: 'hide', scale: 'css' })
      expect(sha(first)).toBe(sha(second))
      captures.push({ name, sha256: sha(first) })
    } else await expect(target).toHaveScreenshot(name)
  }
  await page.goto(url(60))
  await ready(fixture.latest, 61, 4)
  await expect(page.getByTestId('analytics-workspace')).toHaveCount(0)
  await expect(page.locator('[data-testid="replay-object"]')).toHaveCount(4)
  await page.locator('.fx-content').evaluate(node => { node.scrollTop = 0 })
  await capture('chart-top.png')
  await capture('chart-pane.png', frame)
  await page.getByRole('button', { name: 'Mở danh sách đối tượng', exact: true }).click()
  for (const record of fixture.annotations.items) {
    const row = page.locator(`[data-testid="replay-object"][data-record-id="${record.record_id}"]`)
    await expect(row.getByRole('textbox')).toHaveValue(record.payload.label)
    for (const anchor of record.payload.anchors) await expect(row).toContainText(new Date(anchor.timestamp * 1000).toISOString().slice(11, 19))
  }
  await page.getByRole('button', { name: 'Đóng chi tiết', exact: true }).click()
  await page.goto(url(20))
  await ready(fixture.history, 21, 0)
  await expect(page.getByTestId('replay-history-view')).toBeVisible()
  await expect(page.getByTestId('step-1')).toBeDisabled()
  await expect(page.getByTestId('play-toggle')).toBeDisabled()
  await expect(page.locator('[data-testid="replay-object"]')).toHaveCount(0)
  await capture('chart-history-pane.png', frame)
  await page.reload()
  await expect(chart).toHaveAttribute('data-visible-row-count', '21')
  await expect(chart).toHaveAttribute('data-visible-object-count', '0')
  for (const view of observed) {
    expect(view.visible_rows).toHaveLength(view.view_cursor_index + 1)
    expect(view.visible_rows.at(-1).timestamp).toBe(view.cutoff_timestamp)
    expect(view.visible_rows.every((row, i, rows) => row.timestamp <= view.cutoff_timestamp && (!i || row.timestamp > rows[i - 1].timestamp))).toBe(true)
    expect(view.visible_rows).toEqual(fixture.latest.visible_rows.slice(0, view.view_cursor_index + 1))
  }
  const geometry = await page.evaluate(() => ({ pageOverflow: document.documentElement.scrollWidth - innerWidth, contentOverflow: document.querySelector('.fx-content').scrollWidth - document.querySelector('.fx-content').clientWidth, chartWidth: document.querySelector('[data-testid="replay-chart"]').clientWidth, chartHeight: document.querySelector('[data-testid="replay-chart"]').clientHeight }))
  expect(geometry.pageOverflow).toBeLessThanOrEqual(1)
  expect(geometry.contentOverflow).toBeLessThanOrEqual(1)
  expect(geometry.chartHeight).toBeGreaterThanOrEqual(320)
  expect(errors).toEqual([])
  expect(unexpected).toEqual([])
  expect(sourceHash()).toBe(before)
  const receipt = { status: candidate ? 'CANDIDATE_NOT_APPROVED' : 'MATCHED_APPROVED_BASELINE', scope: fixture.scope, sourceHash: before, fixtureSha256: sha(fixtureBytes), project: testInfo.project.name, viewport: testInfo.project.use.viewport, browser: browser.version(), locale: 'vi-VN', timezone: 'UTC', captures, assertions, observedPrefixCount: observed.length, geometry, errors, unexpected }
  await testInfo.attach('chart-visual-provenance', { body: JSON.stringify(receipt, null, 2), contentType: 'application/json' })
  if (candidate) await writeFile(path.join(candidateRoot, testInfo.project.name, 'chart.json'), JSON.stringify(receipt, null, 2))
})
