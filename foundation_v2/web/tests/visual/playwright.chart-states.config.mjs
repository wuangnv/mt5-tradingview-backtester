import path from 'node:path'
import { fileURLToPath } from 'node:url'
import config from './playwright.config.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const workspace = path.resolve(here, '../../../../../..')
const output = path.resolve(process.env.TW_CHART_STATES_OUTPUT || path.join(workspace, '.artifacts/wm-all-plan-20261002/chart-states-r1'))
export default {
  ...config,
  testMatch: 'wmreplay.chart-states.spec.mjs',
  timeout: 90000,
  outputDir: path.join(output, 'results'),
  reporter: [['list'], ['json', { outputFile: path.join(output, 'report.json') }]],
}
