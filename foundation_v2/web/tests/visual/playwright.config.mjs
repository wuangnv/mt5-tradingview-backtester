import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

const here = path.dirname(fileURLToPath(import.meta.url))
const workspace = path.resolve(here, '../../../../../..')
const { defineConfig } = createRequire(path.join(workspace, 'tooling/ui-qa/package.json'))('@playwright/test')
if (process.argv.some(arg => arg.startsWith('--update-snapshots'))) throw new Error('Snapshot update is disabled. Review candidate images and explicitly copy approved images into baselines; preserve the review receipt.')
export default defineConfig({
  testDir: here,
  testMatch: 'wmreplay.visual.spec.mjs',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 30000,
  updateSnapshots: 'none',
  outputDir: path.join(workspace, '.artifacts/wm-visual-comparison/results'),
  reporter: [['list'], ['json', { outputFile: path.join(workspace, '.artifacts/wm-visual-comparison/report.json') }]],
  snapshotPathTemplate: path.join(here, 'baselines', '{projectName}', '{arg}{ext}'),
  use: { browserName: 'chromium', headless: true, locale: 'vi-VN', timezoneId: 'UTC', deviceScaleFactor: 1, reducedMotion: 'reduce', trace: 'retain-on-failure', screenshot: 'only-on-failure', launchOptions: { executablePath: process.env.TW_UI_QA_CHROMIUM || 'C:/Users/MIIKEY/AppData/Local/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-win64/chrome-headless-shell.exe' } },
  expect: { timeout: 10000, toHaveScreenshot: { animations: 'disabled', caret: 'hide', scale: 'css', maxDiffPixels: 0 } },
  projects: ['dark', 'light'].flatMap(theme => [[1440,900],[1280,800],[768,1024],[390,844]].map(([width,height]) => ({ name: `${theme}-${width}x${height}`, metadata: { theme }, use: { viewport: { width, height } } }))),
})
