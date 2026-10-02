import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { chromium } from 'playwright'

const here = path.dirname(fileURLToPath(import.meta.url))
const evidenceDir = process.env.TW_REPLAY_EVIDENCE_DIR || path.resolve(here, '..', 'evidence')
const viteBin = path.join(here, 'node_modules', 'vite', 'bin', 'vite.js')
const origin = 'http://127.0.0.1:4173'

const rows = [
  { timestamp: 1710000000, open: 1.08, high: 1.0804, low: 1.0798, close: 1.0802, volume: 100 },
  { timestamp: 1710000060, open: 1.0802, high: 1.0809, low: 1.0801, close: 1.0807, volume: 110 },
  { timestamp: 1710000120, open: 1.0807, high: 1.0810, low: 1.0803, close: 1.0805, volume: 120 },
  { timestamp: 1710000180, open: 1.0805, high: 1.0814, low: 1.0804, close: 1.0812, volume: 130 },
  { timestamp: 1710000240, open: 1.0812, high: 1.0815, low: 1.0808, close: 1.0810, volume: 140 },
  { timestamp: 1710000300, open: 1.0810, high: 1.0814, low: 1.0809, close: 1.081234, volume: 150 },
]

let forceConflict = false
const sessions = new Map()

function seedSession(id = 'replay-fixture', cursor = 3, revision = 1, parent = null) {
  sessions.set(id, {
    record_id: id,
    revision,
    payload: {
      dataset_id: 'ui-replay-fixture',
      cursor_index: cursor,
      branch_id: `${id}-branch-id`,
      parent_session_id: parent,
      parent_revision: parent ? revision : null,
      status: cursor === rows.length - 1 ? 'completed' : 'paused',
    },
  })
}

function view(id, requestedCursor = null) {
  const session = sessions.get(id)
  if (!session) return null
  const canonicalCursor = session.payload.cursor_index
  const viewCursor = requestedCursor === null ? canonicalCursor : requestedCursor
  const visible = rows.slice(0, viewCursor + 1)
  return {
    ...session,
    dataset_sha256: 'fixture-sha256-no-future-leak',
    cutoff_timestamp: visible.at(-1).timestamp,
    visible_rows: visible,
    visible_row_count: visible.length,
    total_row_count: rows.length,
    has_future_rows: visible.length < rows.length,
    view_cursor_index: viewCursor,
    canonical_cursor_index: canonicalCursor,
    historical_view: viewCursor !== canonicalCursor,
  }
}

async function waitForServer() {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    try {
      const response = await fetch(origin)
      if (response.ok) return
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  throw new Error('Vite server did not start')
}

function fulfillJson(route, status, payload) {
  return route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(payload) })
}

async function main() {
  await mkdir(evidenceDir, { recursive: true })
  seedSession()
  const server = spawn(process.execPath, [viteBin, '--host', '127.0.0.1', '--port', '4173', '--strictPort'], {
    cwd: here,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  const serverErrors = []
  server.stderr.on('data', (chunk) => serverErrors.push(String(chunk)))

  let browser
  try {
    await waitForServer()
    browser = await chromium.launch({ headless: true })
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
    const consoleErrors = []
    page.on('console', (message) => {
      if (message.type() === 'error') consoleErrors.push(message.text())
    })

    await page.route('**/api/v2/replay/sessions/**', async (route) => {
      const request = route.request()
      const url = new URL(request.url())
      const parts = url.pathname.split('/').filter(Boolean)
      const sessionId = decodeURIComponent(parts[4] || '')
      const action = parts[5] || ''
      const current = sessions.get(sessionId)

      if (!current) return fulfillJson(route, 404, { detail: 'replay_not_found' })
      if (request.method() === 'GET') {
        const rawCursor = url.searchParams.get('cursor_index')
        let requestedCursor = null
        if (rawCursor !== null) {
          requestedCursor = Number(rawCursor)
          if (!Number.isInteger(requestedCursor) || requestedCursor < 0 || requestedCursor > current.payload.cursor_index) {
            return fulfillJson(route, 422, { detail: 'invalid historical replay cursor' })
          }
        }
        return fulfillJson(route, 200, view(sessionId, requestedCursor))
      }
      const body = request.postDataJSON()
      if (forceConflict) {
        forceConflict = false
        current.revision += 1
        return fulfillJson(route, 409, { detail: 'revision_conflict' })
      }
      if (body.expected_revision !== current.revision) return fulfillJson(route, 409, { detail: 'revision_conflict' })

      if (action === 'step') {
        current.payload.cursor_index = Math.min(rows.length - 1, current.payload.cursor_index + body.steps)
        current.payload.status = current.payload.cursor_index === rows.length - 1 ? 'completed' : 'paused'
        current.revision += 1
        return fulfillJson(route, 200, view(sessionId))
      }
      if (action === 'branch') {
        const nextId = 'branch-fixture-1'
        seedSession(nextId, body.cursor_index, 1, sessionId)
        sessions.get(nextId).payload.parent_revision = current.revision
        return fulfillJson(route, 201, view(nextId))
      }
      return fulfillJson(route, 404, { detail: 'unknown_action' })
    })

    // Keep the replay acceptance fixture self-contained. The product only
    // needs the catalog to render its dataset context; no real backend or
    // broker service should be required for this browser contract test.
    await page.route('**/api/v2/chart/annotations', route => fulfillJson(route, 200, { items: [] }))
    await page.route('**/api/v2/data/datasets**', async (route) => {
      if (route.request().method() !== 'GET') return fulfillJson(route, 405, { detail: 'method_not_allowed' })
      return fulfillJson(route, 200, {
        items: [{
          dataset_id: 'ui-replay-fixture',
          instrument_id: 'EURUSD',
          timeframe: 'M1',
          quality_status: 'verified',
          holdout_status: 'locked',
          row_count: rows.length,
        }],
      })
    })

    await page.goto(`${origin}/?view=replay&surface=workspace&workspace=tenant-ui&session=replay-fixture&cursor=1&from=prop-report`)
    await page.getByTestId('replay-history-view').waitFor()
    assert.equal(await page.getByTestId('replay-chart').getAttribute('data-visible-row-count'), '2')
    assert.match(await page.getByTestId('replay-history-view').innerText(), /cutoff report ở nến #1/i)
    assert.match(await page.getByTestId('replay-history-view').innerText(), /Replay gốc hiện ở nến #3/i)
    assert.equal(await page.getByTestId('step-1').isDisabled(), true)
    assert.equal(await page.getByTestId('step-10').isDisabled(), true)
    assert.equal(await page.getByTestId('branch-cursor').isDisabled(), true)
    assert.match(await page.getByTestId('branch-replay').innerText(), /Tạo branch từ report #1/)
    await page.screenshot({ path: path.join(evidenceDir, 'replay-report-cutoff-ui.png'), fullPage: true })

    await page.goto(`${origin}/?view=replay&surface=workspace&workspace=tenant-ui&session=replay-fixture`)
    await page.getByTestId('replay-chart').waitFor()
    assert.equal(await page.getByTestId('replay-chart').getAttribute('data-visible-row-count'), '4')
    assert.match(await page.getByTestId('replay-lock').innerText(), /REPLAY \/ SIMULATION/)
    assert.match(await page.getByTestId('replay-lock').innerText(), /Broker locked/)
    assert.equal((await page.locator('body').innerText()).includes('1,081234'), false, 'future price leaked before step')

    await page.getByRole('button', { name: 'Vừa toàn bộ nến đã mở' }).click()
    const chartBox = await page.getByTestId('replay-chart').boundingBox()
    assert.ok(chartBox, 'replay chart should expose a clickable surface')
    await page.getByTestId('replay-chart').click({
      position: { x: Math.round(chartBox.width * 0.45), y: Math.round(chartBox.height * 0.45) },
    })
    await page.waitForFunction(() => document.querySelector('[data-testid="annotation-draft"]')?.classList.contains('is-ready'))
    assert.match(await page.getByTestId('annotation-draft').innerText(), /Draft horizontal line đã chọn/)
    assert.equal((await page.getByTestId('annotation-draft').innerText()).includes('1,081234'), false, 'annotation draft exposed future price')

    forceConflict = true
    await page.getByTestId('step-1').click()
    await page.getByTestId('revision-conflict').waitFor()
    assert.equal(await page.getByTestId('step-10').isDisabled(), true)
    await page.getByRole('button', { name: 'Tải trạng thái mới' }).click()
    await page.getByTestId('revision-conflict').waitFor({ state: 'detached' })

    await page.getByRole('button', { name: 'Chi tiết & nhánh' }).click()
    await page.getByTestId('branch-cursor').focus()
    await page.getByTestId('branch-cursor').press('Home')
    await page.getByTestId('branch-cursor').press('ArrowRight')
    await page.getByTestId('branch-replay').click()
    await page.waitForURL(/session=branch-fixture-1/)
    assert.equal(await page.getByTestId('replay-chart').getAttribute('data-visible-row-count'), '2')
    assert.match(await page.locator('.session-facts').innerText(), /replay-fixture/)

    await page.goto(`${origin}/?view=replay&surface=workspace&workspace=tenant-ui`)
    await page.waitForURL(/session=branch-fixture-1/)
    assert.equal(await page.getByTestId('replay-chart').getAttribute('data-visible-row-count'), '2', 'persisted resume failed')
    assert.match(await page.getByTestId('replay-shortcuts').innerText(), /Shift.*\+10 nến/i)

    // Keyboard stepping is intentionally available only when the page owns focus;
    // the branch range above remains a native range control and is not hijacked.
    await page.getByTestId('replay-chart').click()
    await page.keyboard.press('Shift+ArrowRight')
    await page.getByText('Hoàn tất dataset', { exact: true }).waitFor()
    assert.equal(await page.getByTestId('step-1').isDisabled(), true)
    assert.equal(await page.getByTestId('replay-chart').getAttribute('data-visible-row-count'), String(rows.length))

    for (const width of [1440, 768, 360]) {
      await page.setViewportSize({ width, height: 900 })
      await page.screenshot({ path: path.join(evidenceDir, `replay-ui-${width}.png`), fullPage: true })
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
      assert.ok(overflow <= 2, `horizontal overflow at ${width}px: ${overflow}px`)
    }

    const unexpectedConsoleErrors = consoleErrors.filter((message) => !/status of 409 \(Conflict\)/.test(message))
    assert.deepEqual(unexpectedConsoleErrors, [])
    console.log(JSON.stringify({
      status: 'PASS',
      fixture: 'ui-labeled-controlled-replay',
      checks: ['report_exact_cursor_historical_view', 'historical_view_read_only', 'visible_rows_only', 'broker_locked', '409_reload', 'branch_lineage', 'persisted_resume', 'keyboard_step_shortcuts', 'completed', 'responsive_1440_768_360'],
      screenshots: [1440, 768, 360].map((width) => path.join(evidenceDir, `replay-ui-${width}.png`)),
    }, null, 2))
  } finally {
    if (browser) await browser.close()
    server.kill('SIGTERM')
    if (serverErrors.length) process.stderr.write(serverErrors.join(''))
  }
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
