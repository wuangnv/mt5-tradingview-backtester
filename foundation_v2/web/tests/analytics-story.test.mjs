import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

const root = path.resolve(process.cwd(), 'src')
const source = fs.readFileSync(path.join(root, 'AnalyticsWorkspace.jsx'), 'utf8')
const css = fs.readFileSync(path.join(root, 'analytics-story.css'), 'utf8')
const renderedStory = source.slice(source.indexOf('return <main className=\"as-page\"'))

test('analytics follows context to takeaway, evidence, drilldown and next action', () => {
  const markers = [
    'as-context-bar',
    'TAKEAWAY / ONE CLEAR READ',
    'EVIDENCE / BALANCE PATH',
    'ProvenanceInspector model',
    'TradeLedger model',
    'NEXT ACTION',
  ]
  let previous = -1
  for (const marker of markers) {
    const index = renderedStory.indexOf(marker)
    assert.notEqual(index, -1, 'missing story marker: ' + marker)
    assert.ok(index > previous, marker + ' must follow the previous story step')
    previous = index
  }
})

test('analytics preserves source truth and closed-balance semantics', () => {
  assert.match(source, /\/api\/v2\/research\/jobs\//)
  assert.match(source, /return 'N\/A'/)
  assert.match(source, /derived from ledger/)
  assert.match(source, /closed_trade_balance_curve/)
  assert.match(source, /closed_trade_balance_drawdown_curve/)
  assert.match(source, /not floating equity|Không phải floating equity/i)
  assert.match(source, /broker locked/i)
  assert.match(source, /TRADE LEDGER/)
  assert.doesNotMatch(source, /Number\(point\.drawdown\) \|\| 0/)
  assert.match(source, /as-drawdown-bar is-unknown/)
})

test('analytics keeps provenance and trade drilldown linked', () => {
  assert.match(source, /result: result \|\| null/)
  assert.match(source, /dataset_sha256/)
  assert.match(source, /metrics_schema_version/)
  assert.match(source, /selectedTradeId/)
  assert.match(source, /onSelect=\{setSelectedTradeId\}/)
  assert.match(source, /Mở Journal/)
})

test('analytics does not add broker execution controls', () => {
  assert.doesNotMatch(source, /OrderSend|sendOrder|submitLive|\/api\/trade\/send/i)
  assert.match(source, /Research \/ local · broker locked/)
})

test('analytics reads the bounded U6 read model, filters by ledger fields, and exports through the workspace header', () => {
  assert.match(source, /\/api\/v2\/research\/jobs\/\$\{encodeURIComponent\(jobId\)\}\/analytics/)
  assert.match(source, /analytics\.csv/)
  assert.match(source, /X-Workspace-Id/)
  assert.match(source, /side.*buy.*sell/s)
  assert.match(source, /outcome.*win.*loss.*breakeven/s)
  assert.match(source, /from_close_utc/)
  assert.match(source, /to_close_utc/)
  assert.match(source, /blocked_by_data/)
  assert.match(source, /data-testid="analytics-filters"/)
  assert.match(source, /data-testid="analytics-empty"/)
  assert.match(source, /data-testid="analytics-blocked"/)
  assert.match(source, /freshness === 'stale'/)
})

test('analytics story CSS has desktop, tablet, mobile and reduced-motion contracts', () => {
  assert.match(css, /\.as-evidence-grid/)
  assert.match(css, /\.as-metric-strip/)
  assert.match(css, /\.fx-app\[data-theme='light'\] \.as-page \.as-large-empty h2/, 'light empty-state heading uses the readable content token')
  assert.match(css, /@media \(max-width: 768px\)/)
  assert.match(css, /@media \(max-width: 380px\)/)
  assert.match(css, /prefers-reduced-motion/)
  assert.doesNotMatch(css, /donut|glassmorphism|gradient\(/i)
})

test('analytics bounds large result rendering while preserving drilldown semantics', () => {
  assert.match(source, /MAX_CHART_POINTS = 240/)
  assert.match(source, /LEDGER_PAGE_SIZE = 50/)
  assert.match(source, /sampleSeries\(points, MAX_CHART_POINTS/)
  assert.match(source, /data-testid="analytics-ledger-pagination"/)
  assert.match(source, /aria-label=\{`Chọn trade/)
  assert.match(css, /\.as-ledger-pagination/)
})

test('analytics reuses date formatters for large ledgers', () => {
  assert.match(source, /const DATE_FORMATTER_VI_UTC = new Intl\.DateTimeFormat/)
  assert.match(source, /const SHORT_DATE_FORMATTER_VI_UTC = new Intl\.DateTimeFormat/)
  assert.doesNotMatch(source, /ledger\.map\([\s\S]*new Intl\.DateTimeFormat/)
})
