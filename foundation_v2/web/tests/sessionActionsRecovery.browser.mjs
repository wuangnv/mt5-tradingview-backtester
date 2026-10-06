import assert from 'node:assert/strict'
import { chromium } from 'playwright'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'

const out = path.resolve(process.env.TW_UI_EVIDENCE_DIR || '../evidence/fx-session-actions-20261006')
await mkdir(out, { recursive: true })
const browser = await chromium.launch({ headless: true })
const origin = 'http://127.0.0.1:5180'
const checks = [], errors = []
const seed = await browser.newContext()
const response = await seed.request.get(origin + '/api/v2/replay/sessions', { headers: { 'X-Workspace-Id': 'tenant-a' } })
assert.ok(response.ok())
const original = (await response.json()).items.find(item => !item.archived)
assert.ok(original)
await seed.close()

try {
  for (const view of ['overview', 'replay']) for (const mode of ['success', 'lost', 'conflict', 'linked', 'denied']) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
    const page = await context.newPage()
    page.on('pageerror', error => errors.push(error.message))
    let items = [{ ...original }], writes = [], reads = 0
    // Every mutation is fulfilled/aborted locally. No mutation reaches API8010.
    await context.route('**/api/**', async route => {
      const request = route.request(), url = new URL(request.url()), method = request.method()
      if (method === 'GET' && url.pathname === '/api/v2/replay/sessions') {
        reads++; return route.fulfill({ json: { items } })
      }
      if (['GET', 'HEAD', 'OPTIONS'].includes(method)) return route.continue()
      writes.push({ path: url.pathname, body: request.postDataJSON() })
      assert.equal(url.pathname, '/api/v2/replay/sessions/' + original.record_id + '/delete')
      assert.equal(method, 'POST')
      assert.deepEqual(request.postDataJSON(), { expected_revision: items[0].revision, confirmation_name: original.name })
      if (mode === 'success' || mode === 'lost') {
        const revision = items[0].revision + 1; items = []
        return mode === 'lost' ? route.abort('failed') : route.fulfill({ json: { record_id: original.record_id, revision, deleted: true } })
      }
      if (mode === 'conflict') { items = [{ ...items[0], revision: items[0].revision + 1 }]; return route.fulfill({ status: 409, json: { detail: 'record_revision_conflict' } }) }
      return route.fulfill({ status: mode === 'linked' ? 409 : 403, json: { detail: mode === 'linked' ? 'replay_linked_to_prop_attempt' : 'workspace_membership_denied' } })
    })
    const url = `${origin}/?workspace=tenant-a&view=${view}&area=testing&section=${view === 'overview' ? 'dashboard' : 'sessions'}&select=1&session=${original.record_id}&dataset=${original.dataset_id}&cursor=500`
    await page.goto(url); await page.waitForLoadState('networkidle')
    await page.evaluate(id => localStorage.setItem('tw:replay:last:tenant-a', id), original.record_id)
    await page.getByRole('button', { name: view === 'replay' ? 'Xóa phiên' : 'Xóa phiên ' + original.name, exact: true }).click()
    const dialog = page.getByRole('dialog', { name: 'Xóa phiên', exact: true })
    await dialog.getByLabel('Tên phiên xác nhận xóa').fill(original.name)
    await dialog.getByRole('button', { name: 'Xóa phiên', exact: true }).click()
    if (mode === 'success' || mode === 'lost') {
      await page.waitForURL(url => !url.searchParams.has('session'))
      await page.waitForLoadState('networkidle')
      assert.equal(await page.evaluate(() => localStorage.getItem('tw:replay:last:tenant-a')), null)
      assert.equal(await page.locator('[data-session-id]').count(), 0)
      for (const link of await page.locator('.fx-subnav a').evaluateAll(elements => elements.map(element => element.href))) {
        assert.ok(!link.includes(original.record_id), 'navigation drops deleted context')
      }
    } else {
      await dialog.getByRole('alert').waitFor()
      assert.equal(await dialog.getByLabel('Tên phiên xác nhận xóa').inputValue(), original.name)
      assert.equal(new URL(page.url()).searchParams.get('session'), original.record_id)
      if (mode === 'linked') assert.match(await dialog.getByRole('alert').textContent(), /Không thể xóa.*thử thách cấp vốn/i)
      if (mode === 'conflict') { await page.waitForLoadState('networkidle'); await page.waitForFunction(() => document.querySelector('.fxs-action-dialog .fxs-delete-confirm')?.disabled === false); assert.ok(await dialog.getByRole('button', { name: 'Xóa phiên', exact: true }).isEnabled()); assert.ok(reads > 1) }
    }
    assert.equal(writes.length, 1, 'no automatic mutation retry')
    checks.push(`${view}: ${mode}, scoped exact revision/name, no actual write`)
    await context.close()
  }
  // Labeled legacy archived fixture: read-only access stays honest without restore UI.
  const context = await browser.newContext(), page = await context.newPage()
  const item = { ...original, archived: true }, writes = []
  await context.route('**/api/**', route => {
    const request = route.request(), url = new URL(request.url())
    if (request.method() === 'GET' && url.pathname === '/api/v2/replay/sessions') return route.fulfill({ json: { items: [item] } })
    if (['GET', 'HEAD', 'OPTIONS'].includes(request.method())) return route.continue()
    writes.push(request.method()); return route.abort()
  })
  await page.goto(origin + '/?workspace=tenant-a&view=replay&area=testing&section=sessions&select=1&session=' + original.record_id + '&manage=archive')
  await page.waitForLoadState('networkidle')
  assert.equal(await page.getByRole('dialog').count(), 0, 'retired archive deep link is inert')
  assert.equal(await page.getByRole('button', { name: /Lưu trữ|Khôi phục/ }).count(), 0)
  assert.match(await page.locator('.fxr-session-notice').innerText(), /Phiên đã lưu trữ trước đây/)
  assert.equal(await page.getByRole('link', { name: /Go to chart|Mở chart/ }).count(), 0)
  assert.deepEqual(writes, [])
  checks.push('Previously archived fixture remains readable; no restore action or archive deep-link mutation')
  await context.close()
  assert.deepEqual(errors, [])
  await writeFile(path.join(out, 'recovery.json'), JSON.stringify({ checks, errors, mutationTransport: 'intercepted-only' }, null, 2))
  console.log(JSON.stringify({ passed: checks.length, errors, mutationTransport: 'intercepted-only' }))
} finally { await browser.close() }
