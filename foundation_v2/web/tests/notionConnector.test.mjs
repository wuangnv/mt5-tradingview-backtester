import assert from 'node:assert/strict'
import test from 'node:test'
import {
  buildNotionExportIntent,
  buildNotionLedgerIntent,
  buildNotionPreview,
  hydrateNotionUiIntent,
  notionAuthorizationUrl,
  NOTION_LEDGER_INTENT_SCHEMA,
  NOTION_FLOW_STATES,
} from '../src/notionConnector.js'

function reportFixture() {
  return {
    schema_version: 'prop-attempt-report-v1',
    mode: 'simulation',
    result_source: 'simulation',
    broker_execution_capability: false,
    session: { session_id: 'session-001', status: 'failed_breach', revision: 4 },
    profile: { profile_id: 'ps03-generic', profile_hash: 'sha256:profile-001' },
    attempt: {
      attempt_id: 'attempt-001', status: 'failed_breach', revision: 7, branch_kind: 'clean',
      data_version: 'dataset:ps03', cost_version: 'cost-v1', engine_version: 'replay-v1',
    },
    phase: {
      phase_index: 1, balance: '100500', floating_pl: '-6000', equity: '94500',
      high_water_mark: '101000', qualifying_days: 2, evaluation_quality: 'full_for_declared_model',
    },
    outcome: {
      status: 'failed_breach', terminal: true, terminal_action: 'breach',
      reason_codes: ['daily_loss_breached'],
      breaches: [{ rule: 'daily_loss', current: null, floor: '95000', reference: null }],
    },
    safety: {
      simulation_only: true, broker_results_included: false,
      broker_credentials_included: false, holdout_content_included: false,
    },
    tutorials: { answer_keys_exposed: false, auto_completion_enabled: false },
  }
}

test('builds an allowlisted preview and keeps owner notes separate', () => {
  const preview = buildNotionPreview(reportFixture())
  assert.equal(preview.status, 'PREP_ONLY')
  assert.equal(preview.generated.properties.equity, '94500')
  assert.equal(preview.generated.owner_notes_policy.user_notes_area, 'owner_notes')
  assert.equal(preview.safety.account_fields_excluded, true)
  assert.equal('objectives' in preview.generated, false)
})

test('accepts only the Notion OAuth authorization endpoint', () => {
  const url = 'https://api.notion.com/v1/oauth/authorize?client_id=public&state=opaque'
  assert.equal(notionAuthorizationUrl(url), url)
  for (const invalid of [
    'http://api.notion.com/v1/oauth/authorize',
    'https://api.notion.com.evil.test/v1/oauth/authorize',
    'https://api.notion.com/v1/oauth/token',
    'https://user@api.notion.com/v1/oauth/authorize',
  ]) assert.throws(() => notionAuthorizationUrl(invalid), /invalid Notion authorization URL/)
})

test('builds a pending local receipt only after explicit destination selection', async () => {
  const preview = buildNotionPreview(reportFixture())
  const intent = await buildNotionExportIntent(preview, {
    request_id: 'mt5-notion-ui-001',
    requested_at_utc: '2026-09-29T10:00:00Z',
    destination_ref: 'user-selected:notion-page-001',
  })
  assert.equal(intent.status, 'PREP_ONLY')
  assert.equal(intent.destination.user_selected, true)
  assert.equal(intent.receipt.status, 'pending')
  assert.equal(intent.receipt.outcome, 'not_dispatched')
  assert.equal(intent.receipt.external_id, null)
  assert.equal(intent.cloud_io, false)
  assert.deepEqual(intent.authorization, { provider: 'notion', account_selected: false })

  const selectedAccount = await buildNotionExportIntent(preview, {
    request_id: 'mt5-notion-ui-002',
    requested_at_utc: '2026-09-29T10:00:00Z',
    destination_ref: 'user-selected:notion-page-001',
    account_ref: 'owner-selected:notion-demo-account',
  })
  assert.deepEqual(selectedAccount.authorization, { provider: 'notion', account_selected: true })
  assert.equal(JSON.stringify(selectedAccount).includes('notion-demo-account'), false)
})

test('fails closed on sensitive fields, malformed metrics and implicit destinations', async () => {
  const accountLeak = reportFixture()
  accountLeak.session.account_id = 'acct-001'
  assert.throws(() => buildNotionPreview(accountLeak), /sensitive field/i)

  const nestedMetric = reportFixture()
  nestedMetric.phase.equity = { nested: '94500' }
  assert.throws(() => buildNotionPreview(nestedMetric), /finite numeric scalar/i)

  const preview = buildNotionPreview(reportFixture())
  await assert.rejects(() => buildNotionExportIntent(preview, {
    request_id: 'mt5-notion-ui-001',
    requested_at_utc: '2026-09-29T10:00:00Z',
    destination_ref: 'guessed-page',
  }), /destination_ref/i)
  await assert.rejects(() => buildNotionExportIntent(preview, {
    request_id: 'mt5-notion-ui-001',
    requested_at_utc: '2026-02-30T10:00:00Z',
    destination_ref: 'user-selected:notion-page-001',
  }), /valid UTC timestamp/i)
})

test('flow state names cover login, OAuth, destination, preview and receipt', () => {
  assert.deepEqual(Object.values(NOTION_FLOW_STATES), [
    'session_ready', 'oauth_pending', 'oauth_callback', 'destination', 'preview', 'intent_ready',
  ])
})

test('translates the UI mirror to the authoritative durable ledger schema', async () => {
  const preview = buildNotionPreview(reportFixture())
  const uiIntent = await buildNotionExportIntent(preview, {
    request_id: 'mt5-notion-ui-ledger-001',
    requested_at_utc: '2026-09-29T10:00:00Z',
    destination_ref: 'user-selected:notion-page-001',
    account_ref: 'owner-selected:notion-demo-account',
  })
  const ledgerIntent = await buildNotionLedgerIntent(uiIntent)
  assert.equal(ledgerIntent.schema_version, NOTION_LEDGER_INTENT_SCHEMA)
  assert.equal(ledgerIntent.status, 'PREP_ONLY')
  assert.equal(ledgerIntent.cloud_io, false)
  assert.equal(ledgerIntent.destination.ref, 'user-selected:notion-page-001')
  assert.match(ledgerIntent.payload.content_sha256, /^sha256:[0-9a-f]{64}$/)
  assert.equal(JSON.stringify(ledgerIntent).includes('notion-demo-account'), false)
  assert.equal('authorization' in ledgerIntent, false)
})

test('rehydrates a persisted ledger row without exposing account identifiers', async () => {
  const preview = buildNotionPreview(reportFixture())
  const uiIntent = await buildNotionExportIntent(preview, {
    request_id: 'mt5-notion-ui-ledger-002',
    requested_at_utc: '2026-09-29T10:00:00Z',
    destination_ref: 'user-selected:notion-page-001',
  })
  const ledgerIntent = await buildNotionLedgerIntent(uiIntent)
  const restored = hydrateNotionUiIntent(ledgerIntent, {
    status: 'unknown',
    external_id: null,
  }, { accountSelected: true })
  assert.equal(restored.schema_version, 'mt5-notion-ui-intent-v1')
  assert.equal(restored.receipt.status, 'unknown')
  assert.deepEqual(restored.authorization, { provider: 'notion', account_selected: true })
  assert.equal(restored.cloud_io, false)
})
