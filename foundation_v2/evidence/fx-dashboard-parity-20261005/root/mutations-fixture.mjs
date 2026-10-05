import assert from 'node:assert/strict'
import { chromium } from '../../../web/node_modules/playwright/index.mjs'
import { mkdir, writeFile } from 'node:fs/promises'

const out = '.artifacts/fx-dashboard-parity-20261005/root'
await mkdir(out, { recursive: true })
const report = { scope: 'Synthetic browser API responses for metadata/branch contracts. Actual API GET-only and compared unchanged.', requests: [], blocked: [] }
const browser = await chromium.launch({ headless: true })
const context = await browser.newContext({ viewport: { width: 1440, height: 987 } })
const read = async path => {
  const response = await context.request.get('http://127.0.0.1:8010' + path, { headers: { 'X-Workspace-Id': 'tenant-a' } })
  assert.equal(response.status(), 200); return response.json()
}
const original = await read('/api/v2/replay/sessions')
let items = structuredClone(original.items).filter(item => !item.archived).slice(0, 1)
const source = structuredClone(items[0])
let conflict = true
await context.route('**/*', async route => {
  const request = route.request(), url = new URL(request.url())
  if (url.origin !== 'http://127.0.0.1:5180') { report.blocked.push(request.url()); return route.abort() }
  if (url.pathname === '/api/v2/replay/sessions' && request.method() === 'GET') return route.fulfill({ json: { ...original, items } })
  if (['PATCH', 'POST'].includes(request.method()) && url.pathname.startsWith('/api/v2/replay/sessions/')) {
    const body = request.postDataJSON(), item = items.find(item => url.pathname.split('/')[5] === item.record_id)
    assert.equal(request.headers()['x-workspace-id'], 'tenant-a')
    assert.equal(body.expected_revision, item.revision)
    report.requests.push({ method: request.method(), path: url.pathname, body })
    if (conflict) { conflict = false; item.revision++; return route.fulfill({ status: 409, json: { detail: 'synthetic_revision_conflict' } }) }
    if (request.method() === 'PATCH') {
      const { expected_revision, ...changes } = body
      Object.assign(item, changes, { revision: item.revision + 1 })
      return route.fulfill({ json: item })
    }
    assert.equal(body.cursor_index, item.cursor_index)
    const copy = { ...item, record_id: 'fixture-copy', name: item.name + ' (copy)', revision: 1 }
    items.push(copy)
    return route.fulfill({ json: copy })
  }
  if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method())) { report.blocked.push(request.url()); return route.abort() }
  return route.continue()
})
await context.routeWebSocket('**/*', socket => socket.close())
const page = await context.newPage()
page.setDefaultTimeout(10000)
try {
  await page.goto('http://127.0.0.1:5180/?workspace=tenant-a&view=overview&area=testing&section=dashboard')
  await page.waitForLoadState('networkidle')
  await page.getByRole('button', { name: 'Sửa ' + source.name, exact: true }).click()
  await page.getByRole('dialog').getByLabel('Tên phiên', { exact: true }).fill('Synthetic renamed')
  await page.getByRole('button', { name: 'Lưu thay đổi', exact: true }).click()
  await page.getByRole('dialog').getByRole('alert').waitFor()
  assert.match(await page.getByRole('dialog').getByRole('alert').innerText(), /revision mới/)
  assert.equal(await page.getByRole('dialog').getByLabel('Tên phiên', { exact: true }).inputValue(), 'Synthetic renamed')
  await page.getByRole('button', { name: 'Lưu thay đổi', exact: true }).click()
  await page.getByRole('button', { name: 'Tạo bản sao Synthetic renamed', exact: true }).waitFor()
  assert.equal(report.requests[1].body.expected_revision, source.revision + 1)
  await page.getByRole('button', { name: 'Tạo bản sao Synthetic renamed', exact: true }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Tạo bản sao', exact: true }).click()
  await page.locator('[data-session-id="fixture-copy"]').waitFor()
  await page.getByRole('button', { name: 'Lưu trữ Synthetic renamed', exact: true }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Lưu trữ', exact: true }).click()
  await page.locator(`[data-session-id="${source.record_id}"]`).waitFor({ state: 'detached' })
  assert.equal(items.find(item => item.record_id === source.record_id).archived, true)
  assert.deepEqual(await read('/api/v2/replay/sessions'), original)
  assert.deepEqual(report.blocked, [])
  report.pass = true
} catch (error) { report.failure = error.stack; process.exitCode = 1 }
finally { await browser.close(); await writeFile(out + '/mutations-fixture.json', JSON.stringify(report, null, 2)); console.log(JSON.stringify(report)) }
