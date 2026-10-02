import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

const root = path.resolve(process.cwd(), 'src')
const journalSource = fs.readFileSync(path.join(root, 'JournalWorkspace.jsx'), 'utf8')
const analyticsSource = fs.readFileSync(path.join(root, 'AnalyticsWorkspace.jsx'), 'utf8')
const cssSource = fs.readFileSync(path.join(root, 'journal-analytics.css'), 'utf8')

test('journal UI stays linked to replay/trade context and uses revision endpoint', () => {
  assert.match(journalSource, /\/api\/v2\/journal/)
  assert.match(journalSource, /\/api\/v2\/journal\/\$\{encodeURIComponent\(selected\.record_id\)\}\/revisions/)
  assert.match(journalSource, /sourceIdentity/)
  assert.match(journalSource, /IMMUTABLE SOURCE/i)
  assert.match(journalSource, /data-testid="journal-workspace"/)
  assert.match(journalSource, /DECISION CONTEXT/)
  assert.match(journalSource, /actual_result/)
  assert.match(journalSource, /overlay_ids/)
  assert.match(journalSource, /context\.mode/)
  assert.match(journalSource, /playbook_id/)
})

test('analytics UI preserves unknown values and exposes result provenance', () => {
  assert.match(analyticsSource, /resourceKind = jobId \? 'research\/jobs' : 'replay\/sessions'/)
  assert.match(analyticsSource, /return 'N\/A'/)
  assert.match(analyticsSource, /derived from ledger/)
  assert.match(analyticsSource, /profit_factor_after_cost/)
  assert.match(analyticsSource, /expectancy_net_per_trade/)
  assert.match(analyticsSource, /TRADE LEDGER/)
  assert.match(analyticsSource, /data-testid="analytics-workspace"/)
})

test('journal and analytics responsive rules are scoped to the dedicated stylesheet', () => {
  assert.match(cssSource, /\.ja-journal-grid/)
  assert.match(cssSource, /\.ja-metric-grid/)
  assert.match(cssSource, /@media \(max-width: 680px\)/)
  assert.doesNotMatch(cssSource, /\.card\s*\{/)
})

