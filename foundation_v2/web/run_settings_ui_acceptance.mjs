import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdir } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'

const here = path.dirname(fileURLToPath(import.meta.url))
const viteBin = path.join(here, 'node_modules', 'vite', 'bin', 'vite.js')
const origin = 'http://127.0.0.1:4175'
const evidenceDir = process.env.TW_UI_EVIDENCE_DIR || path.join(os.tmpdir(), 'tw-settings-ui-fixture')

const sessionFixture = {
  schema_version: 'project-session-v1',
  auth_mode: 'local-trusted-demo',
  production_auth: false,
  credentials_present: false,
  workspace: { id: 'tenant-settings' },
  identity: { marker: 'local-owner', source: 'local-process' },
  session: {
    session_id: 'local-demo-session:fixture',
    workspace_id: 'tenant-settings',
    identity_id: 'local-owner',
    status: 'signed_in',
    issued_at_utc: '2026-09-29T00:00:00Z',
    expires_at_utc: null,
    credentials_present: false,
  },
}

const notionFixture = {
  provider: 'notion',
  oauth_available: false,
  status: 'disconnected',
  connection_id: null,
  token_persistence: 'process_memory_only',
  provider_identity_verified: false,
  provider_permission_verified: false,
  export_mode: 'PREP_ONLY',
  cloud_write: false,
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
  const server = spawn(process.execPath, [viteBin, '--host', '127.0.0.1', '--port', '4175', '--strictPort'], {
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
    page.on('console', (message) => { if (message.type() === 'error') consoleErrors.push(message.text()) })
    await page.route('**/api/v2/session/status', (route) => fulfillJson(route, 200, sessionFixture))
    await page.route('**/api/v2/connectors/notion/oauth/status', (route) => fulfillJson(route, 200, notionFixture))

    await page.goto(`${origin}/?view=settings&workspace=tenant-settings`)
    await page.getByTestId('settings-workspace').waitFor()
    await page.getByTestId('settings-session-facts').waitFor()
    await page.getByTestId('settings-notion-facts').waitFor()
    assert.match(await page.getByTestId('settings-session-facts').innerText(), /local-trusted-demo/)
    assert.match(await page.getByTestId('settings-permissions').innerText(), /Gửi lệnh broker[\s\S]*Đã khóa/)
    assert.match(await page.getByTestId('settings-notion-facts').innerText(), /PREP_ONLY/)
    assert.match(await page.getByTestId('settings-notion-facts').innerText(), /Chưa cấu hình/)

    for (const width of [1440, 768, 360]) {
      await page.setViewportSize({ width, height: 900 })
      const screenshot = path.join(evidenceDir, `settings-ui-fixture-${width}.png`)
      await page.screenshot({ path: screenshot, fullPage: true })
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
      assert.ok(overflow <= 2, `horizontal overflow at ${width}px: ${overflow}px`)
    }

    assert.deepEqual(consoleErrors, [])
    console.log(JSON.stringify({
      status: 'PASS',
      fixture: 'settings-local-read-only-boundary',
      checks: ['session_status', 'permissions_fail_closed', 'notion_prep_only', 'responsive_1440_768_360'],
      screenshots: [1440, 768, 360].map((width) => path.join(evidenceDir, `settings-ui-fixture-${width}.png`)),
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
