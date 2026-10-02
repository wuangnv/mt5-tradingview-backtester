import path from 'node:path'
import { fileURLToPath } from 'node:url'
import config from './playwright.config.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const workspace = path.resolve(here, '../../../../../..')
const output = path.resolve(process.env.TW_CHART_OUTPUT_ROOT || path.join(workspace, '.artifacts/wm-all-plan-20261002/chart-capture'))
export default {
  ...config,
  testMatch: 'wmreplay.chart.visual.spec.mjs',
  timeout: 45000,
  outputDir: path.join(output, 'results'),
  reporter: [['list'], ['json', { outputFile: path.join(output, 'report.json') }]],
  snapshotPathTemplate: path.join(here, 'chart-baselines', '{projectName}', '{arg}{ext}'),
}
