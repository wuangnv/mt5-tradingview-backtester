import assert from 'node:assert/strict'
import { chromium } from 'playwright'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'

const out = path.resolve(process.env.TW_DEMO_QA_OUT || '../../.artifacts/fx-trades-demo-layout-20261005/primary')
await mkdir(out, { recursive: true })
const browser = await chromium.launch({ headless: true })
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
const errors = [], writes = [], previewRequests = [], checks = []
page.on('pageerror', error => errors.push(error.message))
await page.route('**/api/**', async route => {
  const request = route.request()
  if (request.method() !== 'GET') { writes.push(request.method()); await route.abort(); return }
  if (new URL(page.url()).searchParams.get('demo') === '1') previewRequests.push(new URL(request.url()).pathname)
  await route.continue()
})

try {
  const owner = '476f4b498e1a49ed9d48a75719f4d270'
  await page.goto(`http://127.0.0.1:5180/?workspace=tenant-a&view=analytics&area=testing&section=analytics&select=1&session=${owner}&cursor=500`)
  await page.getByRole('button', { name: 'Show demo data', exact: true }).waitFor()
  await page.waitForLoadState('networkidle')
  const before = new URL(page.url()).searchParams
  await page.getByRole('button', { name: 'Show demo data', exact: true }).click()
  await page.getByRole('status').filter({ hasText: 'Demo · Dữ liệu mẫu' }).waitFor()
  await page.getByRole('button', { name: /^Session:/ }).click()
  await page.getByRole('button', { name: /Gold Swing/ }).click()
  await page.getByRole('tab', { name: 'Drawdown', exact: true }).click()
  assert.equal(new URL(page.url()).searchParams.get('session'), owner)
  assert.equal(new URL(page.url()).searchParams.get('cursor'), '500')
  await page.getByRole('button', { name: 'Show real data', exact: true }).click()
  await page.getByRole('button', { name: 'Show demo data', exact: true }).waitFor()
  await page.waitForLoadState('networkidle')
  assert.deepEqual([...new URL(page.url()).searchParams], [...before])
  checks.push('preview selection/tab stay local; real owner context restores')

  await page.goto('http://127.0.0.1:5180/?workspace=tenant-a&view=analytics&area=testing&section=analytics&select=1&analytics_source=prop&demo=1')
  const nav = page.locator('.fx-subnav')
  assert.deepEqual(await nav.locator('a').allTextContents(), ['Dashboard', 'Sessions', 'Trades', 'Analytics', 'Sessions', 'Prop firm', 'Market Data'])
  const boxes = await nav.locator('a').evaluateAll(anchors => anchors.map(anchor => { const box = anchor.getBoundingClientRect(); return { y: box.top + box.height / 2 } }))
  assert.ok(Math.max(...boxes.map(box => box.y)) - Math.min(...boxes.map(box => box.y)) < 2)
  await page.setViewportSize({ width: 360, height: 844 })
  await page.waitForFunction(() => { const box = document.querySelector('.fx-subsubnav a[aria-current="page"]').getBoundingClientRect(); return box.left >= 0 && box.right <= innerWidth + 1 })
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth), 0)
  checks.push('Analytics source tabs are adjacent, same row, visible on mobile')
  assert.deepEqual(previewRequests, [])
  assert.deepEqual(writes, [])
  assert.deepEqual(errors, [])
  await writeFile(path.join(out, 'journey.json'), JSON.stringify({ pass: true, checks, previewRequests, writes, errors }, null, 2))
  console.log(JSON.stringify({ pass: true, checks }))
} finally { await browser.close() }
