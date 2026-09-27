import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdir } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'

const here = path.dirname(fileURLToPath(import.meta.url))
const viteBin = path.join(here, 'node_modules', 'vite', 'bin', 'vite.js')
const origin = 'http://127.0.0.1:4174'
const evidenceDir = process.env.TW_UI_EVIDENCE_DIR || path.join(os.tmpdir(), 'tw-u3c-learn-ui-fixture')

const overviewFixture = {
  schema_version: 'learn-overview-v2',
  course: {
    version: '1.1',
    title: 'Trading Foundations',
    status: 'active',
    primary_language: 'vi',
    start_lesson: 'M01-L01',
    module_count: 2,
    lesson_count: 4,
    modules: [
      {
        id: 'M01',
        title: 'Cấu trúc thị trường',
        href: '/api/v2/learn/resources/module:M01',
        lessons: [
          { id: 'M01-L01', title: 'Nến và cấu trúc' },
          { id: 'M01-L02', title: 'Hỗ trợ và kháng cự' },
        ],
      },
      {
        id: 'M08',
        title: 'Thực hành có kỷ luật',
        href: '/api/v2/learn/resources/module:M08',
        lessons: [
          { id: 'M08-L02', title: 'Review lệnh' },
          { id: 'M08-L03', title: 'Tổng kết course' },
        ],
      },
    ],
  },
  progress: {
    phase: 'main_course',
    course_version: '1.1',
    updated_on: '2026-09-24',
    status: 'in_progress',
    current_lesson_id: 'M08-L03',
    completed_lessons: ['M01-L01', 'M01-L02', 'M08-L02'],
    completed_modules: ['M01'],
    pending_status: 'pending',
    pending_activity: { id: 'practice-8', objective: 'Review replay', lesson_file: 'practice/m08.md', variant: 'chart' },
  },
  links: {
    course: '/api/v2/learn/resources/course',
    glossary: '/api/v2/learn/glossary',
    workbook: '/api/v2/learn/resources/workbook',
    pending_activity: '/api/v2/learn/resources/pending-activity',
  },
  safety: {
    read_only: true,
    progress_owner: 'education/progress.json',
    answer_keys_exposed: false,
    auto_completion_enabled: false,
  },
}

const glossaryFixture = {
  schema_version: 'learn-glossary-v1',
  primary_language: 'vi',
  english_role: 'trading_terminology_support_only',
  count: 3,
  items: [
    { term: 'Bid / ask', meaning_vi: 'Giá bạn bán / giá bạn mua' },
    { term: 'Long / short', meaning_vi: 'Mua kỳ vọng tăng / bán kỳ vọng giảm' },
    { term: 'Risk / reward', meaning_vi: 'Rủi ro / lợi nhuận kỳ vọng' },
  ],
}

const resources = {
  course: '# Trading Foundations\n\nCourse owner giữ nội dung và tiến độ chính thức.',
  workbook: '# Workbook\n\nBài thực hành an toàn cho replay.',
  'pending-activity': '# Review replay\n\nQuan sát cấu trúc trước khi ghi quyết định.',
  'module:M01': '# M01\n\nNến, cấu trúc, hỗ trợ và kháng cự.',
  'module:M08': '# M08\n\nReview và tổng kết.',
}

let mode = 'happy'
let holdOverview = true
let releaseOverview
const overviewGate = new Promise((resolve) => { releaseOverview = resolve })
const learnRequests = []

function fulfillJson(route, status, payload) {
  return route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(payload) })
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

function emptyOverview() {
  return {
    ...overviewFixture,
    course: { ...overviewFixture.course, module_count: 0, lesson_count: 0, modules: [] },
    progress: { ...overviewFixture.progress, current_lesson_id: null, completed_lessons: [], completed_modules: [] },
  }
}

async function main() {
  await mkdir(evidenceDir, { recursive: true })
  const server = spawn(process.execPath, [viteBin, '--host', '127.0.0.1', '--port', '4174', '--strictPort'], {
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
    page.on('request', (request) => {
      if (request.url().includes('/api/v2/learn/')) {
        learnRequests.push({ method: request.method(), url: request.url() })
      }
    })

    await page.route('**/api/v2/learn/**', async (route) => {
      const request = route.request()
      const url = new URL(request.url())
      if (request.method() !== 'GET') return fulfillJson(route, 405, { detail: 'read_only_fixture' })

      if (mode === 'denied') return fulfillJson(route, 403, { detail: 'workspace_access_denied' })
      if (mode === 'unavailable') return fulfillJson(route, 404, { detail: 'learn_not_configured' })
      if (mode === 'error') return fulfillJson(route, 503, { detail: 'course progress is unavailable' })

      if (url.pathname === '/api/v2/learn/overview') {
        if (holdOverview) await overviewGate
        const payload = mode === 'empty'
          ? emptyOverview()
          : mode === 'unsafe'
            ? { ...overviewFixture, safety: { ...overviewFixture.safety, answer_keys_exposed: true } }
            : overviewFixture
        return fulfillJson(route, 200, payload)
      }
      if (url.pathname === '/api/v2/learn/glossary') {
        return fulfillJson(route, 200, mode === 'empty' ? { ...glossaryFixture, count: 0, items: [] } : glossaryFixture)
      }
      const prefix = '/api/v2/learn/resources/'
      if (url.pathname.startsWith(prefix)) {
        const resourceId = decodeURIComponent(url.pathname.slice(prefix.length))
        if (!(resourceId in resources)) return fulfillJson(route, 404, { detail: 'learn_resource_not_found' })
        return fulfillJson(route, 200, { resource_id: resourceId, format: 'markdown', content: resources[resourceId] })
      }
      return fulfillJson(route, 404, { detail: 'unknown_fixture_route' })
    })

    await page.goto(`${origin}/?view=learn&workspace=tenant-ui`)
    await page.getByTestId('learn-loading').waitFor()
    holdOverview = false
    releaseOverview()
    await page.getByTestId('learn-readonly').waitFor()

    assert.match(await page.getByTestId('learn-readonly').innerText(), /READ ONLY/)
    assert.match(await page.getByTestId('learn-readonly').innerText(), /không lộ answer key/i)
    assert.match(await page.locator('.learn-summary').innerText(), /Trading Foundations/)
    assert.match(await page.locator('.learn-progress').innerText(), /M08-L03/)
    assert.match(await page.getByTestId('learn-glossary-list').innerText(), /Bid \/ ask/)

    await page.getByRole('button', { name: 'Tổng quan course' }).click()
    await page.getByTestId('learn-resource-content').waitFor()
    assert.match(await page.getByTestId('learn-resource-content').innerText(), /Course owner giữ nội dung/)

    const bodyText = await page.locator('body').innerText()
    assert.equal(/course-checks|entry-check|"answer"|"expected"/i.test(bodyText), false, 'answer-key material leaked into UI')

    await page.getByRole('searchbox', { name: 'Tìm thuật ngữ' }).fill('Risk')
    assert.match(await page.getByTestId('learn-glossary-list').innerText(), /Risk \/ reward/)
    assert.equal((await page.getByTestId('learn-glossary-list').innerText()).includes('Bid / ask'), false)
    await page.getByRole('searchbox', { name: 'Tìm thuật ngữ' }).fill('không tồn tại')
    await page.getByTestId('learn-glossary-empty').waitFor()
    await page.getByRole('searchbox', { name: 'Tìm thuật ngữ' }).fill('')

    const screenshots = []
    for (const width of [1440, 768, 360]) {
      await page.setViewportSize({ width, height: 900 })
      const screenshot = path.join(evidenceDir, `learn-ui-fixture-${width}.png`)
      await page.screenshot({ path: screenshot, fullPage: true })
      screenshots.push(screenshot)
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
      assert.ok(overflow <= 2, `horizontal overflow at ${width}px: ${overflow}px`)
    }

    mode = 'empty'
    await page.goto(`${origin}/?view=learn&workspace=tenant-ui-empty`)
    await page.getByTestId('learn-course-empty').waitFor()
    await page.getByTestId('learn-glossary-empty').waitFor()

    mode = 'denied'
    await page.goto(`${origin}/?view=learn&workspace=tenant-denied`)
    await page.getByTestId('learn-denied').waitFor()

    mode = 'unavailable'
    await page.goto(`${origin}/?view=learn&workspace=tenant-unconfigured`)
    const unavailableState = page.getByTestId('learn-unavailable')
    await unavailableState.waitFor()
    assert.match(await unavailableState.getAttribute('class'), /learn-message-unavailable/)
    assert.doesNotMatch(await unavailableState.getAttribute('class'), /learn-message-empty/)

    mode = 'error'
    await page.goto(`${origin}/?view=learn&workspace=tenant-error`)
    await page.getByTestId('learn-error').waitFor()

    mode = 'unsafe'
    await page.goto(`${origin}/?view=learn&workspace=tenant-unsafe`)
    await page.getByTestId('learn-safety-error').waitFor()

    mode = 'happy'
    await page.route('**/api/v2/replay/sessions/replay-context-1', (route) => fulfillJson(route, 404, { detail: 'fixture_not_found' }))
    await page.goto(`${origin}/?view=replay&workspace=tenant-ui&session=replay-context-1`)
    assert.match(await page.getByTestId('replay-lock').innerText(), /REPLAY \/ SIMULATION/)
    const replayLearnHref = await page.getByRole('link', { name: 'Học & thuật ngữ' }).getAttribute('href')
    assert.match(replayLearnHref || '', /view=learn/)
    assert.match(replayLearnHref || '', /from=replay/)
    assert.match(replayLearnHref || '', /session=replay-context-1/)

    await page.goto(`${origin}${replayLearnHref}`)
    await page.getByTestId('learn-readonly').waitFor()
    const replayReturnHref = await page.getByRole('link', { name: 'Về Replay' }).getAttribute('href')
    assert.match(replayReturnHref || '', /view=replay/)
    assert.match(replayReturnHref || '', /session=replay-context-1/)

    mode = 'denied'
    await page.goto(`${origin}/?view=learn&workspace=tenant-denied&from=replay&dataset=dataset-context-1&start=7`)
    await page.getByTestId('learn-denied').waitFor()
    const deniedReplayReturnHref = await page.getByRole('link', { name: 'Về Replay' }).getAttribute('href')
    assert.match(deniedReplayReturnHref || '', /dataset=dataset-context-1/)
    assert.match(deniedReplayReturnHref || '', /start=7/)
    mode = 'happy'

    await page.route('**/api/v2/research/jobs/job-context-1', (route) => fulfillJson(route, 404, { detail: 'fixture_not_found' }))
    await page.goto(`${origin}/?workspace=tenant-ui&job=job-context-1`)
    const researchLearnHref = await page.getByRole('link', { name: 'Học & thuật ngữ' }).getAttribute('href')
    assert.match(researchLearnHref || '', /view=learn/)
    assert.match(researchLearnHref || '', /from=research/)
    assert.match(researchLearnHref || '', /job=job-context-1/)

    await page.goto(`${origin}${researchLearnHref}`)
    await page.getByTestId('learn-readonly').waitFor()
    const researchReturnHref = await page.getByRole('link', { name: 'Về Research' }).getAttribute('href')
    assert.match(researchReturnHref || '', /job=job-context-1/)

    assert.equal(learnRequests.every((request) => request.method === 'GET'), true, 'Learn UI attempted a mutation request')
    assert.equal(learnRequests.some((request) => request.url.includes('/resources/course')), true, 'resource endpoint was not exercised')
    const unexpectedConsoleErrors = consoleErrors.filter((message) => !/Failed to load resource: the server responded with a status of (403|404|503)/.test(message))
    assert.deepEqual(unexpectedConsoleErrors, [])

    console.log(JSON.stringify({
      status: 'PASS',
      fixture: 'ui-labeled-read-only-learn',
      checks: [
        'loading',
        'course_progress',
        'glossary_search_and_empty',
        'resource_reader',
        'denied',
        'unavailable',
        'error',
        'unsafe_contract_fail_closed',
        'answer_keys_absent',
        'learn_requests_get_only',
        'replay_context_round_trip_preserves_session',
        'replay_error_state_preserves_dataset_start_fallback',
        'research_context_link_preserves_job',
        'responsive_1440_768_360',
      ],
      screenshots,
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
