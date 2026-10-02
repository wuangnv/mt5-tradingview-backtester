import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'

const origin = process.env.TW_QA_ORIGIN || 'http://127.0.0.1:5173'
const out = path.resolve(process.env.TW_QA_OUT || path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../../.artifacts/wm-integration-quality-w6-regression'))
await mkdir(out, { recursive: true })
const browser = await chromium.launch({ headless: true })
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
const page = await context.newPage()
const errors = []
const checks = []
const accessibility = []
let scenario = 'ready'
let delayedWorkspace = ''
let releaseSession
let sessionGate
let releaseResource
let resourceGate
const writes = []
page.on('pageerror', (error) => errors.push(String(error)))
const session = (workspace) => ({ auth_mode: 'local-trusted-demo', production_auth: false, identity: { marker: `owner-${workspace}`, source: 'fixture' }, session: { status: 'signed_in', workspace_id: workspace, session_id: `session-${workspace}` } })
const overview = { course: { title: 'QA course', lesson_count: 1, modules: [{ id: 'M01', title: 'QA module', lessons: [{ id: 'M01-L01', title: 'QA lesson' }] }] }, progress: { completed_lessons: [], current_lesson_id: 'M01-L01' }, links: { course: '/api/v2/learn/resources/course', workbook: '/api/v2/learn/resources/workbook' } }
overview.safety = { read_only: true, answer_keys_exposed: false, auto_completion_enabled: false }
const json = (route, body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) })
await page.route('**/api/**', async (route) => {
  const request = route.request()
  const pathname = new URL(request.url()).pathname
  const workspace = request.headers()['x-workspace-id']
  if (request.method() !== 'GET') { writes.push(request.url()); return route.abort() }
  if (scenario === 'denied') return json(route, { detail: 'workspace_denied' }, 403)
  if (scenario === 'learn-error' && pathname === '/api/v2/learn/overview') return json(route, { detail: 'learn_service_unavailable' }, 500)
  if (pathname === '/api/v2/session/status') {
    if (workspace === delayedWorkspace) await sessionGate
    return json(route, session(workspace)).catch(() => {})
  }
  if (pathname === '/api/v2/execution/capabilities') return json(route, { mode: 'locked', broker_execution_capability: false, place: false, modify: false, cancel: false, close: false })
  if (pathname === '/api/v2/connectors/notion/oauth/status') return json(route, { status: 'disconnected', oauth_available: false, export_mode: 'PREP_ONLY', cloud_write: false })
  if (pathname === '/api/v2/learn/overview') return json(route, scenario === 'learn-unknown' ? { ...overview, course: { ...overview.course, lesson_count: undefined }, progress: {} } : overview)
  if (pathname === '/api/v2/learn/glossary') return json(route, { items: [] })
  if (pathname === '/api/v2/learn/resources/course') {
    if (resourceGate) await resourceGate
    return json(route, { content: 'Stale course content' }).catch(() => {})
  }
  if (pathname === '/api/v2/learn/resources/workbook') return json(route, { content: 'Current workbook content' })
  return json(route, { items: [], counts: {} })
})
await page.route(`${origin}/__wm-integration-quality`, (route) => route.fulfill({ contentType: 'text/html', body: '<!doctype html><html lang="vi"><head><title>Component lifecycle fixture</title></head><body><div id="test-root"></div><script type="module">import RefreshRuntime from "/@react-refresh";RefreshRuntime.injectIntoGlobalHook(window);window.$RefreshReg$=()=>{};window.$RefreshSig$=()=>type=>type;const React=(await import("/node_modules/.vite/deps/react.js")).default;const {createRoot}=(await import("/node_modules/.vite/deps/react-dom_client.js")).default;const {default:Settings}=await import("/src/SettingsWorkspace.jsx");const {default:Learn}=await import("/src/LearnWorkspace.jsx");const root=createRoot(document.getElementById("test-root"));window.renderQuality=(name,workspace,query)=>root.render(React.createElement(name==="settings"?Settings:Learn,{workspace,query:new URLSearchParams(query)}));</script></body></html>' }))

const render = (name, workspace, query) => page.evaluate(({ name, workspace, query }) => window.renderQuality(name, workspace, query), { name, workspace, query })
const replayQuery = 'from=replay&session=replay-42&dataset=eurusd&cursor=7&cutoff=bar-7&mode=LIVE&data=Verified&start=2024-01-01'
try {
  await page.goto(`${origin}/__wm-integration-quality`)
  await page.waitForFunction(() => typeof window.renderQuality === 'function')
  await render('settings', 'tenant-a', replayQuery)
  await page.getByTestId('settings-execution-facts').waitFor()
  await page.getByTestId('settings-session-facts').waitFor()
  assert.match(await page.getByTestId('settings-session-facts').innerText(), /owner-tenant-a/)
  assert.doesNotMatch(await page.locator('.settings-context').innerText(), /LIVE|Verified/)
  assert.doesNotMatch(await page.getByTestId('settings-permissions').innerText(), /Cho phép/)
  assert.match(await page.getByTestId('settings-execution-facts').innerText(), /Đã khóa/)
  const replayHref = new URL(await page.getByRole('link', { name: 'Về Replay', exact: true }).getAttribute('href'), origin)
  for (const [key, value] of Object.entries({ view: 'replay', workspace: 'tenant-a', session: 'replay-42', dataset: 'eurusd', cursor: '7', cutoff: 'bar-7', start: '2024-01-01' })) assert.equal(replayHref.searchParams.get(key), value)
  checks.push('Settings uses verified API state and preserves replay context')

  delayedWorkspace = 'tenant-delayed'
  sessionGate = new Promise((resolve) => { releaseSession = resolve })
  await render('settings', delayedWorkspace, replayQuery)
  await page.getByTestId('settings-session-loading').waitFor()
  await render('settings', 'tenant-next', replayQuery)
  await page.getByTestId('settings-session-facts').filter({ hasText: 'owner-tenant-next' }).waitFor()
  releaseSession()
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))))
  assert.doesNotMatch(await page.getByTestId('settings-session-facts').innerText(), /owner-tenant-delayed/)
  checks.push('Delayed prior workspace response cannot replace current identity')
  scenario = 'denied'
  await page.getByRole('button', { name: 'Làm mới', exact: true }).click()
  await page.getByTestId('settings-session-denied').waitFor()
  assert.equal(await page.getByTestId('settings-session-facts').count(), 0)
  assert.doesNotMatch(await page.getByTestId('settings-permissions').innerText(), /Đã xác minh local|Cho phép/)
  checks.push('Refresh denied clears prior identity and does not claim local permission')

  scenario = 'ready'
  await render('learn', 'tenant-a', 'from=research&job=job-9&session=replay-42&dataset=eurusd&cursor=7&cutoff=bar-7')
  await page.getByRole('button', { name: 'Tổng quan course', exact: true }).waitFor()
  const researchHref = new URL(await page.getByRole('link', { name: 'Về Research', exact: true }).getAttribute('href'), origin)
  assert.equal(researchHref.searchParams.get('view'), 'research')
  assert.equal(researchHref.searchParams.get('job'), 'job-9')
  const settingsHref = new URL(await page.getByRole('link', { name: 'Settings', exact: true }).getAttribute('href'), origin)
  await render('settings', 'tenant-a', settingsHref.search)
  const learnHref = new URL(await page.getByRole('link', { name: 'Về Learn', exact: true }).getAttribute('href'), origin)
  assert.equal(learnHref.searchParams.get('from'), 'research')
  assert.equal(learnHref.searchParams.get('job'), 'job-9')
  assert.equal(learnHref.searchParams.get('session'), 'replay-42')
  const learnUtilityHref = new URL(await page.getByRole('link', { name: 'Learn', exact: true }).getAttribute('href'), origin)
  assert.equal(learnUtilityHref.searchParams.get('from'), 'research')
  assert.equal(learnUtilityHref.searchParams.get('job'), 'job-9')
  checks.push('Learn Research return and Learn Settings roundtrip preserve source context')

  await render('learn', 'tenant-a', replayQuery)
  await page.getByRole('button', { name: 'Tổng quan course', exact: true }).waitFor()
  resourceGate = new Promise((resolve) => { releaseResource = resolve })
  await page.getByRole('button', { name: 'Tổng quan course', exact: true }).click()
  await page.getByRole('button', { name: 'Workbook', exact: true }).click()
  await page.getByText('Current workbook content', { exact: true }).waitFor()
  releaseResource()
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))))
  assert.equal(await page.getByText('Stale course content', { exact: true }).count(), 0)
  checks.push('Learn newer resource remains selected after old resource resolves')
  scenario = 'learn-error'
  await render('learn', 'tenant-retry', replayQuery)
  await page.getByTestId('learn-error').waitFor()
  scenario = 'ready'
  await page.getByRole('button', { name: 'Thử lại', exact: true }).press('Enter')
  await page.getByRole('button', { name: 'Tổng quan course', exact: true }).waitFor()
  assert.equal(await page.getByTestId('learn-error').count(), 0)
  checks.push('Learn service error retries from keyboard and restores real response')
  scenario = 'learn-unknown'
  await render('learn', 'tenant-unknown', replayQuery)
  await page.getByRole('progressbar', { name: 'Chưa có số liệu tiến độ course' }).waitFor()
  assert.match(await page.locator('.learn-summary').innerText(), /—\/— bài/)
  assert.match(await page.locator('.learn-course .learn-pane-heading').innerText(), /1 module/)
  checks.push('Learn keeps unknown progress separate from zero and uses observed module count')
  scenario = 'ready'
  if (process.env.TW_QA_AXE) {
    await page.goto(`${origin}/?view=learn&workspace=tenant-a`)
    await page.getByRole('button', { name: 'Workbook', exact: true }).click()
    await page.getByTestId('learn-resource-content').waitFor()
    for (const theme of ['dark', 'light']) {
      if (await page.getByTestId('fxreplay-shell').getAttribute('data-theme') !== theme) await page.getByTestId('theme-toggle').click()
      for (const width of [1440, 768, 360]) {
        await page.setViewportSize({ width, height: 900 })
        await page.addScriptTag({ path: process.env.TW_QA_AXE })
        const audit = await page.evaluate(async () => {
          const result = await axe.run('.learn-shell', { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] } })
          return { violations: result.violations.map(({ id, nodes }) => ({ id, nodes: nodes.map(({ target, failureSummary }) => ({ target, failureSummary })) })), incomplete: result.incomplete.map(({ id }) => id) }
        })
        accessibility.push({ theme, width, ...audit })
        await page.screenshot({ path: path.join(out, `learn-ready-${theme}-${width}.png`), fullPage: true })
      }
    }
    await writeFile(path.join(out, 'learn-ready-axe.json'), JSON.stringify(accessibility, null, 2))
    assert.ok(accessibility.every(({ violations }) => violations.length === 0), 'Learn ready fixture has axe violations')
    checks.push('Learn ready fixture passes scoped axe at both themes and three widths')
  }
  assert.deepEqual(errors, [])
  assert.deepEqual(writes, [])
  await page.screenshot({ path: path.join(out, 'learn-resource.png'), fullPage: true })
  await writeFile(path.join(out, 'report.json'), JSON.stringify({ status: 'SCOPED_PASS', scope: 'intercepted API component regression; not product integration acceptance', checks, accessibility, errors, writes }, null, 2))
  console.log(JSON.stringify({ status: 'SCOPED_PASS', checks, out }, null, 2))
} catch (error) {
  await writeFile(path.join(out, 'report.json'), JSON.stringify({ status: 'FAIL', checks, error: String(error), errors, writes }, null, 2))
  throw error
} finally { releaseSession?.(); releaseResource?.(); await browser.close() }
