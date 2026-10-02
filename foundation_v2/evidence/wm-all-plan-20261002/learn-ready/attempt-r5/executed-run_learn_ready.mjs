import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { readdirSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const foundation = path.resolve(here, '../../..')
const repo = path.dirname(foundation)
const workspace = path.resolve(repo, '../..')
const web = path.join(foundation, 'web')
const require = createRequire(path.join(workspace, 'tooling/ui-qa/package.json'))
const { chromium } = require('playwright')
const origin = 'http://127.0.0.1:5180'
const api = 'http://127.0.0.1:8030'
const out = path.join(here, process.argv[2] || 'attempt-r1')
assert.match(path.basename(out), /^attempt-r\d+$/)
const seedPath = path.join(workspace, '.artifacts/wm-integration-20261001/seed.json')
const seed = JSON.parse(await readFile(seedPath, 'utf8'))
assert.equal(seed.database, 'trading_workspace_v2_ui_20261001')
assert.equal(seed.ui, origin)
const axePath = path.join(workspace, '.artifacts/wm-integration-quality-tools/node_modules/axe-core/axe.min.js')
const sha = bytes => createHash('sha256').update(bytes).digest('hex')
const fileHash = async file => sha(await readFile(file))
const fingerprint = () => {
  const root = path.join(web, 'src'), hash = createHash('sha256')
  for (const name of readdirSync(root, { recursive: true }).filter(name => /\.(jsx?|css)$/.test(name)).sort()) hash.update(name).update(readFileSync(path.join(root, name)))
  return hash.digest('hex')
}
const educationHashes = async () => Object.fromEntries(await Promise.all(['course.json', 'progress.json'].map(async name => [name, await fileHash(path.join(workspace, 'education', name))])))
await mkdir(out, { recursive: true })
const report = {
  schema: 'learn-ready-real-api-browser-v1', status: 'IN_PROGRESS',
  scope: 'Real Learn API/PostgreSQL initialization and existing education source through GET-only browser forwarding; current UI source unchanged',
  uiOrigin: origin, learnApiOrigin: api, replayApiOrigin: seed.api,
  sourceBefore: fingerprint(), educationBefore: await educationHashes(),
  harnessSha256: await fileHash(fileURLToPath(import.meta.url)),
  seedSha256: await fileHash(seedPath), backendSourceHashes: {},
  forwarding: 'Only /api/v2/learn/** GET requests are forwarded to real isolated API8030; no fixture payloads. Other local GETs use existing5180/8020.',
  apiChecks: [], browserChecks: [], matrix: [], roundTrips: [], pageErrors: [], consoleErrors: [],
  learnRequests: [], unexpectedRequests: [], mutationRequests: [], failures: [],
}
for (const name of ['api.py', 'learn.py', 'auth.py']) report.backendSourceHashes[name] = await fileHash(path.join(foundation, 'trading_workspace_v2', name))
let browser
let context
let page
let currentStep = 'API preflight'
const check = async (pathname, tenant, expected) => {
  assert.ok(pathname.startsWith('/api/v2/learn/'))
  const response = await fetch(`${api}${pathname}`, { headers: { 'X-Workspace-Id': tenant }, redirect: 'error' })
  const payload = await response.json()
  assert.equal(response.status, expected)
  report.apiChecks.push({ pathname, tenant, status: response.status, detail: payload.detail || null })
  return payload
}
try {
  const overview = await check('/api/v2/learn/overview', 'tenant-a', 200)
  assert.equal(overview.course.module_count, 8)
  assert.equal(overview.course.lesson_count, 24)
  assert.equal(overview.progress.current_lesson_id, 'M08-L03')
  assert.deepEqual(overview.safety, { read_only: true, progress_owner: 'education/progress.json', answer_keys_exposed: false, auto_completion_enabled: false })
  assert.equal(overview.progress.status, 'in_progress')
  assert.equal(overview.progress.pending_status, 'br01_v0_authored_pending_learner_application_and_execution_spec_checks')
  assert.ok(overview.course.modules.every(module => !/assessments|TUTOR|checks\.json/i.test(module.href)))
  const glossary = await check('/api/v2/learn/glossary', 'tenant-a', 200)
  assert.ok(glossary.count > 0)
  const moduleResource = await check('/api/v2/learn/resources/module%3AM08', 'tenant-a', 200)
  assert.equal(moduleResource.resource_id, 'module:M08')
  assert.match(moduleResource.content, /M08-L03/)
  const courseResource = await check('/api/v2/learn/resources/course', 'tenant-a', 200)
  assert.ok(courseResource.content.length > 0)
  for (const endpoint of ['overview', 'glossary', 'resources/module%3AM08']) assert.equal((await check(`/api/v2/learn/${endpoint}`, 'tenant-b', 404)).detail, 'learn_not_configured')
  assert.equal((await check('/api/v2/learn/overview', 'tenant-denied', 403)).detail, 'workspace_access_denied')
  assert.equal((await check('/api/v2/learn/resources/TUTOR.md', 'tenant-a', 404)).detail, 'learn_resource_not_found')
  assert.equal((await check('/api/v2/learn/resources/assessment%3Acourse-checks', 'tenant-a', 404)).detail, 'learn_resource_not_found')
  report.realCourse = { version: overview.course.version, modules: 8, lessons: 24, currentLesson: 'M08-L03', glossaryCount: glossary.count, safety: overview.safety, pendingStatus: overview.progress.pending_status }
  report.resources = { module: { resourceId: moduleResource.resource_id, contentSha256: sha(Buffer.from(moduleResource.content)) }, course: { contentSha256: sha(Buffer.from(courseResource.content)) } }
  currentStep = 'Browser setup'
  browser = await chromium.launch({ headless: true, executablePath: 'C:/Users/MIIKEY/AppData/Local/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-win64/chrome-headless-shell.exe' })
  report.browserVersion = browser.version()
  report.axeVersion = JSON.parse(await readFile(path.join(path.dirname(axePath), 'package.json'), 'utf8')).version
  context = await browser.newContext({ viewport: { width: 1440, height: 900 }, serviceWorkers: 'block' })
  await context.addInitScript(() => {
    if (!localStorage.getItem('tw-theme')) localStorage.setItem('tw-theme', 'dark')
    if (!localStorage.getItem('tw-language')) localStorage.setItem('tw-language', 'vi')
  })
  await context.route('**/*', async route => {
    const request = route.request(), url = new URL(request.url())
    if (request.method() !== 'GET') { report.mutationRequests.push({ method: request.method(), pathname: url.pathname }); return route.abort() }
    if (url.origin !== origin) { report.unexpectedRequests.push({ origin: url.origin, pathname: url.pathname }); return route.abort() }
    if (url.pathname.startsWith('/api/v2/learn/')) {
      const entry = { pathname: url.pathname, method: request.method(), tenant: request.headers()['x-workspace-id'], forwardedOrigin: api }
      const response = await route.fetch({ url: `${api}${url.pathname}${url.search}`, method: 'GET', maxRedirects: 0, timeout: 8000 })
      entry.status = response.status(); report.learnRequests.push(entry)
      return route.fulfill({ response })
    }
    return route.continue()
  })
  page = await context.newPage()
  page.on('pageerror', error => report.pageErrors.push(String(error)))
  page.on('console', message => { if (message.type() === 'error') report.consoleErrors.push(message.text()) })
  const learnUrl = `${origin}/?workspace=tenant-a&view=learn&from=replay&session=${encodeURIComponent(seed.session_id)}&cursor=20`
  currentStep = 'Real ready course and glossary'
  await page.goto(learnUrl)
  await page.getByTestId('learn-readonly').waitFor()
  await page.getByTestId('learn-glossary-list').waitFor()
  assert.equal(await page.locator('.learn-module').count(), 8)
  assert.equal(await page.locator('.learn-module li').count(), 24)
  assert.match(await page.locator('.learn-progress').innerText(), /M08-L03/)
  assert.match(await page.locator('.learn-context-strip').innerText(), /education\/progress\.json/)
  assert.equal(await page.getByTestId('learn-course-empty').count(), 0)
  report.browserChecks.push('real8modules24lessons/currentM08-L03/readOnly/progressOwner')
  await page.getByRole('button', { name: 'Tổng quan course', exact: true }).click()
  await page.getByTestId('learn-resource-content').waitFor()
  assert.equal(await page.getByTestId('learn-resource-content').textContent(), courseResource.content)
  await page.locator('.learn-module.is-current').getByRole('button', { name: 'Mở', exact: true }).click()
  await page.getByTestId('learn-resource-content').waitFor()
  await page.waitForFunction(expected => document.querySelector('[data-testid="learn-resource-content"]')?.textContent === expected, moduleResource.content)
  await page.getByTestId('learn-resource-content').focus()
  assert.equal(await page.getByTestId('learn-resource-content').evaluate(node => node === document.activeElement), true)
  const search = page.getByRole('searchbox', { name: 'Tìm thuật ngữ' })
  const firstTerm = glossary.items[0].term
  await search.fill(firstTerm)
  assert.ok((await page.getByTestId('learn-glossary-list').innerText()).includes(firstTerm))
  await search.fill('__learn_qa_term_not_present__')
  await page.getByTestId('learn-glossary-empty').waitFor()
  await search.fill('')
  await page.getByTestId('learn-glossary-list').focus()
  assert.equal(await page.getByTestId('learn-glossary-list').evaluate(node => node === document.activeElement), true)
  assert.equal(/course-checks|entry-check|"answer"|"expected"/i.test(await page.locator('.learn-shell').innerText()), false)
  report.browserChecks.push('realCourse/currentModuleReaderExactContent/glossarySearchAndEmpty/focusableReaderAndGlossary/answerKeysAbsent')

  const loadedChartRoundTrip = async (theme, width) => {
    currentStep = `Loaded chart roundtrip ${theme}/${width}`
    const replayHref = await page.getByRole('link', { name: 'Về Replay', exact: true }).getAttribute('href')
    const target = new URL(replayHref, origin)
    assert.equal(target.searchParams.get('session'), seed.session_id)
    assert.equal(target.searchParams.get('cursor'), '20')
    const responsePromise = page.waitForResponse(response => new URL(response.url()).pathname === `/api/v2/replay/sessions/${seed.session_id}` && response.request().method() === 'GET' && response.status() === 200, { timeout: 10000 })
    await page.getByRole('link', { name: 'Về Replay', exact: true }).click()
    const response = await responsePromise
    const actual = await response.json()
    assert.equal(actual.view_cursor_index, 20)
    assert.equal(actual.canonical_cursor_index, 60)
    assert.equal(actual.payload.cursor_index, actual.canonical_cursor_index)
    assert.equal(actual.historical_view, true)
    assert.equal(actual.visible_rows.length, 21)
    assert.equal(actual.visible_row_count, 21)
    assert.equal(actual.cutoff_timestamp, actual.visible_rows.at(-1).timestamp)
    await page.getByTestId('replay-chart').waitFor()
    await page.locator('.replay-context-primary small').waitFor()
    assert.match(await page.locator('.replay-context-primary small').innerText(), /broker locked/)
    assert.equal(await page.getByTestId('fxreplay-shell').getAttribute('data-theme'), theme)
    const chartLearn = page.locator('.chart-bottom-range').getByRole('link', { name: 'Học & thuật ngữ', exact: true })
    await chartLearn.waitFor()
    const learnHref = new URL(await chartLearn.getAttribute('href'), origin)
    assert.equal(learnHref.searchParams.get('session'), seed.session_id)
    assert.equal(learnHref.searchParams.get('from'), 'replay')
    assert.equal(learnHref.searchParams.get('cursor'), '20')
    await chartLearn.focus()
    assert.equal(await chartLearn.evaluate(node => node === document.activeElement), true)
    const rect = await chartLearn.boundingBox()
    assert.ok(rect?.width > 0 && rect.height > 0)
    const screenshot = `loaded-chart-learn-${theme}-${width}.png`
    await page.screenshot({ path: path.join(out, screenshot) })
    await chartLearn.click()
    await page.getByTestId('learn-readonly').waitFor()
    await page.reload()
    await page.getByTestId('learn-readonly').waitFor()
    await page.getByTestId('learn-glossary-list').waitFor()
    assert.match(await page.locator('.learn-progress').innerText(), /M08-L03/)
    assert.equal(await page.getByTestId('fxreplay-shell').getAttribute('data-theme'), theme)
    const returnLink = new URL(await page.getByRole('link', { name: 'Về Replay', exact: true }).getAttribute('href'), origin)
    assert.equal(returnLink.searchParams.get('session'), seed.session_id)
    assert.equal(returnLink.searchParams.get('cursor'), '20')
    report.roundTrips.push({ theme, width, replayGetStatus: response.status(), viewCursor: actual.view_cursor_index, canonicalCursor: actual.canonical_cursor_index, persistedCursor: actual.payload.cursor_index, historicalView: actual.historical_view, cutoffTimestamp: actual.cutoff_timestamp, visibleRows: actual.visible_rows.length, session: seed.session_id, chartLearnRect: rect, screenshot, pass: true })
  }

  currentStep = 'Responsive dark/light real ready matrix'
  for (const theme of ['dark', 'light']) {
    if (await page.getByTestId('fxreplay-shell').getAttribute('data-theme') !== theme) await page.getByTestId('theme-toggle').filter({ visible: true }).click()
    for (const width of [1440, 768, 390]) {
      currentStep = `Responsive Learn ${theme}/${width}`
      await page.setViewportSize({ width, height: 900 })
      await page.locator('.learn-module.is-current').getByRole('button', { name: 'Mở', exact: true }).click()
      await page.waitForFunction(expected => document.querySelector('[data-testid="learn-resource-content"]')?.textContent === expected, moduleResource.content)
      await page.evaluate(() => {
        document.querySelector('.fx-content')?.scrollTo(0, 0)
        window.scrollTo(0, 0)
      })
      await page.waitForFunction(() => !document.getAnimations().some(animation => animation instanceof CSSTransition && animation.playState === 'running'))
      await page.addScriptTag({ path: axePath })
      const audit = await page.evaluate(async () => {
        const result = await axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] } })
        const detail = items => items.map(({ id, impact, help, nodes }) => ({ id, impact, help, nodes: nodes.map(({ target, failureSummary }) => ({ target, failureSummary })) }))
        return { violations: detail(result.violations), incomplete: detail(result.incomplete), passes: result.passes.length }
      })
      const layout = await page.evaluate(() => ({
        viewport: innerWidth, overflowX: document.documentElement.scrollWidth - innerWidth,
        contentOverflowX: (() => { const content = document.querySelector('.fx-content'); return content ? content.scrollWidth - content.clientWidth : 0 })(),
        readerWidth: document.querySelector('.learn-reader').getBoundingClientRect().width,
        progressColumns: getComputedStyle(document.querySelector('.learn-progress')).gridTemplateColumns,
        workspaceColumns: getComputedStyle(document.querySelector('.learn-workspace')).gridTemplateColumns,
        colors: Object.fromEntries(['.fx-language-toggle', '.is-active > .fx-rail-section-label', '.learn-module li span', '.learn-module li strong'].map(selector => {
          const node = document.querySelector(selector), style = node && getComputedStyle(node)
          return [selector, style ? { color: style.color, background: style.backgroundColor } : null]
        })),
        overflowNodes: (() => {
          const content = document.querySelector('.fx-content'), boundary = content.getBoundingClientRect()
          return Array.from(content.querySelectorAll('*')).map(node => {
            const rect = node.getBoundingClientRect(), style = getComputedStyle(node)
            return { tag: node.tagName, class: node.className, right: rect.right, width: rect.width, minWidth: style.minWidth, gridColumns: style.gridTemplateColumns }
          }).filter(node => node.right > boundary.right + 2).slice(0, 20)
        })(),
      }))
      const screenshot = `learn-ready-${theme}-${width}.png`
      await page.screenshot({ path: path.join(out, screenshot), fullPage: true })
      const pass = !audit.violations.length && !audit.incomplete.some(rule => rule.id.startsWith('aria-')) && layout.overflowX <= 2 && layout.contentOverflowX <= 2
      report.matrix.push({ theme, width, layout, audit, screenshot, pass })
      if (!pass) report.failures.push({ step: currentStep, theme, width, violations: audit.violations.map(item => item.id), overflowX: layout.overflowX, contentOverflowX: layout.contentOverflowX })
      await loadedChartRoundTrip(theme, width)
    }
  }
  assert.equal(report.roundTrips.length, 6)
  report.browserChecks.push('loadedRealChartLearnReplayRoundtrip6cases/sessionCursor20/persistentTheme/reloadProgressContext/visibleKeyboardLearnLink')

  currentStep = 'Unconfigured and denied tenant states'
  await page.goto(`${origin}/?workspace=tenant-b&view=learn&from=replay&session=${encodeURIComponent(seed.session_id)}&cursor=20`)
  await page.getByTestId('learn-unavailable').waitFor()
  assert.equal(await page.getByTestId('learn-resource-content').count(), 0)
  assert.match(await page.getByTestId('learn-unavailable').innerText(), /chưa được cấu hình/)
  assert.equal(await page.getByTestId('learn-course-empty').count(), 0)
  await page.goto(`${origin}/?workspace=tenant-denied&view=learn`)
  await page.getByTestId('learn-denied').waitFor()
  assert.equal(await page.getByTestId('learn-resource-content').count(), 0)
  report.browserChecks.push('realTenantB404Unavailable/notEmpty/noReaderLeak/realUnauthorized403Denied')
  assert.equal(report.learnRequests.every(request => request.method === 'GET'), true)
  assert.deepEqual(report.mutationRequests, [])
  assert.deepEqual(report.unexpectedRequests, [])
  assert.deepEqual(report.pageErrors, [])
  report.unexpectedConsoleErrors = report.consoleErrors.filter(message => !/Failed to load resource: the server responded with a status of (403|404)/.test(message))
  assert.deepEqual(report.unexpectedConsoleErrors, [])
  report.status = report.failures.length ? 'FAIL_READY_UI_MATRIX' : 'PASS_REAL_READY_SCOPED'
} catch (error) {
  report.status = 'FAIL_REAL_READY_SCOPED'
  report.failures.push({ step: currentStep, error: String(error), stack: error.stack })
  if (page) {
    try {
      report.failureDom = await page.evaluate(() => ({
        url: location.href, shellClass: document.querySelector('.fx-app')?.className,
        headings: Array.from(document.querySelectorAll('main h1')).map(node => node.textContent),
        learnLinks: Array.from(document.querySelectorAll('a')).filter(node => node.href.includes('view=learn')).map(node => ({ text: node.textContent, href: node.getAttribute('href'), display: getComputedStyle(node).display, visibility: getComputedStyle(node).visibility, rect: node.getBoundingClientRect().toJSON() })),
      }))
      await page.screenshot({ path: path.join(out, 'failure.png'), timeout: 5000 })
    } catch (diagnosticError) { report.failureDiagnosticError = String(diagnosticError) }
  }
  process.exitCode = 1
} finally {
  if (browser) await browser.close()
  report.sourceAfter = fingerprint()
  report.educationAfter = await educationHashes()
  if (report.sourceBefore !== report.sourceAfter || JSON.stringify(report.educationBefore) !== JSON.stringify(report.educationAfter)) {
    report.status = 'FAIL_SOURCE_OR_LEARNER_OWNER_CHANGED'
    report.failures.push({ step: 'finalHashGuard', sourceUnchanged: report.sourceBefore === report.sourceAfter, educationUnchanged: JSON.stringify(report.educationBefore) === JSON.stringify(report.educationAfter) })
  }
  if (report.failures.length) process.exitCode = 1
  await writeFile(path.join(out, 'report.json'), JSON.stringify(report, null, 2) + '\n')
  console.log(JSON.stringify({ status: report.status, checks: report.browserChecks, apiChecks: report.apiChecks.length, matrixCases: report.matrix.length, failures: report.failures, report: path.join(out, 'report.json') }))
}
