/**
 * Offline UI boundary for the future Notion connector.
 *
 * The MT5 report remains the source of truth.  This module only accepts a
 * simulation report, builds an allowlisted preview and creates a local
 * PREP_ONLY intent/receipt.  It never calls Notion, OAuth, a broker or a
 * network endpoint.  The Python projection in trading_workspace_v2 remains
 * the authoritative server-side contract; this mirror keeps the UI fail
 * closed while the real connector is still unavailable.
 */

export const NOTION_UI_PREVIEW_SCHEMA = 'mt5-notion-ui-preview-v1'
export const NOTION_UI_INTENT_SCHEMA = 'mt5-notion-ui-intent-v1'
export const NOTION_UI_RECEIPT_SCHEMA = 'mt5-notion-ui-receipt-v1'

const BLOCKED_MARKERS = ['broker', 'holdout', 'credential', 'password', 'secret', 'token']
const BLOCKED_KEYS = new Set([
  'account_id', 'account_number', 'account_login', 'account_ref', 'account_scope',
  'broker_account', 'broker_order_id', 'broker_position_id', 'broker_result', 'broker_results', 'broker_server',
  'holdout_access', 'holdout_bars', 'holdout_content', 'holdout_data', 'holdout_policy',
  'api_key', 'access_token', 'refresh_token',
])
const SAFE_FALSE_KEYS = new Set([
  'broker_execution_capability',
  'broker_results_included',
  'broker_credentials_included',
  'holdout_content_included',
  'answer_keys_exposed',
  'auto_completion_enabled',
])

function fail(message) {
  const error = new Error(message)
  error.name = 'NotionConnectorError'
  throw error
}

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function record(value, path) {
  if (!isRecord(value)) fail(`${path} must be an object`)
  return value
}

function text(value, path, maxLength = 1024) {
  if (typeof value !== 'string' || value.length === 0 || value.length > maxLength || /[\u0000-\u001f]/u.test(value)) {
    fail(`${path} must be a non-empty string`)
  }
  return value
}

function nonNegativeInteger(value, path) {
  if (!Number.isInteger(value) || value < 0) fail(`${path} must be a non-negative integer`)
  return value
}

function finiteScalar(value, path, optional = false) {
  if (value === null && optional) return null
  if (typeof value === 'boolean') fail(`${path} must be a finite numeric scalar`)
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) fail(`${path} must be finite`)
    return value
  }
  if (typeof value === 'string' && value.length > 0 && Number.isFinite(Number(value))) return value
  fail(`${path} must be a finite numeric scalar`)
}

function optionalText(value, path) {
  return value === null || value === undefined ? null : text(value, path)
}

function keyName(value) {
  return String(value).trim().toLowerCase().replaceAll('-', '_')
}

function assertNoSensitiveKeys(value, path = 'report') {
  if (Array.isArray(value)) {
    value.forEach((child, index) => assertNoSensitiveKeys(child, `${path}[${index}]`))
    return
  }
  if (!isRecord(value)) return
  for (const [rawKey, child] of Object.entries(value)) {
    const key = keyName(rawKey)
    const childPath = `${path}.${key}`
    if (SAFE_FALSE_KEYS.has(key)) {
      if (child !== false) fail(`${childPath} must be false`)
      continue
    }
    if (BLOCKED_KEYS.has(key) || BLOCKED_MARKERS.some((marker) => key.includes(marker))) fail(`sensitive field is not exportable: ${childPath}`)
    assertNoSensitiveKeys(child, childPath)
  }
}

function copyBreaches(outcome) {
  const breaches = outcome.breaches || []
  if (!Array.isArray(breaches)) fail('outcome.breaches must be a list')
  return breaches.map((raw, index) => {
    const item = record(raw, `outcome.breaches[${index}]`)
    if (Object.keys(item).sort().join('|') !== 'current|floor|reference|rule') {
      fail(`outcome.breaches[${index}] contains unsupported fields`)
    }
    return {
      rule: text(item.rule, `outcome.breaches[${index}].rule`),
      current: finiteScalar(item.current, `outcome.breaches[${index}].current`, true),
      floor: finiteScalar(item.floor, `outcome.breaches[${index}].floor`, true),
      reference: finiteScalar(item.reference, `outcome.breaches[${index}].reference`, true),
    }
  })
}

/** Build a sanitized local preview from one prop-attempt-report-v1 report. */
export function buildNotionPreview(report) {
  record(report, 'report')
  assertNoSensitiveKeys(report)
  if (report.schema_version !== 'prop-attempt-report-v1') fail('unsupported report schema')
  if (report.mode !== 'simulation') fail('only simulation reports may be projected')
  if (report.broker_execution_capability !== false) fail('broker execution capability must be false')

  const safety = record(report.safety, 'safety')
  if (safety.simulation_only !== true) fail('source report is not simulation-only')
  for (const key of ['broker_results_included', 'broker_credentials_included', 'holdout_content_included']) {
    if (safety[key] !== false) fail(`safety.${key} must be false`)
  }
  const tutorials = record(report.tutorials, 'tutorials')
  if (tutorials.answer_keys_exposed !== false || tutorials.auto_completion_enabled !== false) {
    fail('tutorial answer-key/auto-completion gate failed')
  }

  const session = record(report.session, 'session')
  const profile = record(report.profile, 'profile')
  const attempt = record(report.attempt, 'attempt')
  const phase = record(report.phase, 'phase')
  const outcome = record(report.outcome, 'outcome')
  const sessionId = text(session.session_id, 'session.session_id')
  const attemptId = text(attempt.attempt_id, 'attempt.attempt_id')
  const source = {
    kind: 'mt5_prop_report',
    report_schema_version: report.schema_version,
    session_id: sessionId,
    attempt_id: attemptId,
    session_revision: nonNegativeInteger(session.revision, 'session.revision'),
    attempt_revision: nonNegativeInteger(attempt.revision, 'attempt.revision'),
    profile_id: text(profile.profile_id, 'profile.profile_id'),
    profile_hash: text(profile.profile_hash, 'profile.profile_hash'),
    data_version: text(attempt.data_version, 'attempt.data_version'),
    cost_version: text(attempt.cost_version, 'attempt.cost_version'),
    engine_version: text(attempt.engine_version, 'attempt.engine_version'),
  }
  const reasonCodes = outcome.reason_codes || []
  if (!Array.isArray(reasonCodes) || reasonCodes.some((item) => typeof item !== 'string' || !item)) {
    fail('outcome.reason_codes must contain non-empty strings')
  }
  const properties = {
    mode: report.mode,
    result_source: text(report.result_source, 'result_source'),
    session_status: text(session.status, 'session.status'),
    attempt_status: text(attempt.status, 'attempt.status'),
    branch_kind: text(attempt.branch_kind, 'attempt.branch_kind'),
    phase_index: nonNegativeInteger(phase.phase_index, 'phase.phase_index'),
    balance: finiteScalar(phase.balance, 'phase.balance'),
    floating_pl: finiteScalar(phase.floating_pl, 'phase.floating_pl'),
    equity: finiteScalar(phase.equity, 'phase.equity'),
    high_water_mark: finiteScalar(phase.high_water_mark, 'phase.high_water_mark'),
    qualifying_days: nonNegativeInteger(phase.qualifying_days, 'phase.qualifying_days'),
    evaluation_quality: text(phase.evaluation_quality, 'phase.evaluation_quality'),
    outcome_status: text(outcome.status, 'outcome.status'),
    terminal: outcome.terminal,
    terminal_action: optionalText(outcome.terminal_action, 'outcome.terminal_action'),
    reason_codes: [...reasonCodes],
  }
  if (typeof properties.terminal !== 'boolean') fail('outcome.terminal must be a boolean')

  return {
    schema_version: NOTION_UI_PREVIEW_SCHEMA,
    status: 'PREP_ONLY',
    source,
    generated: {
      title: `MT5 prop report — ${attemptId}`,
      properties,
      breaches: copyBreaches(outcome),
      owner_notes_policy: {
        preserve_existing: true,
        managed_area: 'generated.mt5_report',
        user_notes_area: 'owner_notes',
        overwrite_scope: 'managed_area_only',
      },
    },
    safety: {
      simulation_only: true,
      broker_execution_capability: false,
      broker_fields_excluded: true,
      account_fields_excluded: true,
      holdout_fields_excluded: true,
      answer_keys_excluded: true,
    },
    redaction: {
      excluded_fields: ['broker', 'account', 'holdout', 'credentials', 'answer_keys'],
      source_payload_policy: 'allowlisted_fields_only',
    },
  }
}

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map((item) => canonical(item)).join(',')}]`
  if (isRecord(value)) {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`
  }
  return JSON.stringify(value)
}

async function fingerprint(value) {
  if (!globalThis.crypto?.subtle || typeof TextEncoder === 'undefined') fail('crypto_unavailable_for_intent_fingerprint')
  const bytes = new TextEncoder().encode(canonical(value))
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes)
  return `sha256:${Array.from(new Uint8Array(digest), (item) => item.toString(16).padStart(2, '0')).join('')}`
}

function requestId(value) {
  return text(value, 'request_id', 128).match(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u)
    ? value
    : fail('request_id must be a bounded opaque identifier')
}

function destinationRef(value) {
  const ref = text(value, 'destination_ref', 256)
  if (!/^user-selected:[A-Za-z0-9][A-Za-z0-9._-]*$/u.test(ref)) fail('destination_ref must be user-selected: opaque identifier')
  return ref
}

function accountRef(value) {
  const ref = text(value, 'account_ref', 128)
  if (!/^owner-selected:[A-Za-z0-9][A-Za-z0-9._-]*$/u.test(ref)) fail('account_ref must be owner-selected: opaque identifier')
  return ref
}

/** Build a local intent and pending receipt. No dispatch is possible here. */
export async function buildNotionExportIntent(preview, { request_id, requested_at_utc, destination_ref, account_ref } = {}) {
  record(preview, 'preview')
  if (preview.schema_version !== NOTION_UI_PREVIEW_SCHEMA || preview.status !== 'PREP_ONLY') fail('preview must be PREP_ONLY')
  const requestIdValue = requestId(request_id)
  const timestamp = text(requested_at_utc, 'requested_at_utc', 64)
  const timestampShape = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/u.test(timestamp)
  const parsedTimestamp = timestampShape ? new Date(timestamp) : null
  const calendarMatches = parsedTimestamp && !Number.isNaN(parsedTimestamp.getTime())
    && parsedTimestamp.toISOString().slice(0, 19) === timestamp.slice(0, 19)
  if (!calendarMatches) {
    fail('requested_at_utc must be a valid UTC timestamp')
  }
  const selected = destination_ref !== undefined && destination_ref !== null
  const destination = selected ? destinationRef(destination_ref) : null
  const account = account_ref !== undefined && account_ref !== null ? accountRef(account_ref) : null
  const body = {
    provider: 'notion',
    // Keep the selected account as an authorization gate only; never copy its
    // external identifier into the generated Notion payload or receipt.
    authorization: { provider: 'notion', account_selected: account !== null },
    source: preview.source,
    destination: { kind: 'page_or_database', ref: destination, user_selected: selected },
    payload: { generated: preview.generated },
    write_policy: {
      preserve_existing_owner_notes: true,
      managed_area: 'generated.mt5_report',
      external_id_required_before_dispatch: true,
    },
  }
  const intentFingerprint = await fingerprint(body)
  return {
    schema_version: NOTION_UI_INTENT_SCHEMA,
    status: 'PREP_ONLY',
    request_id: requestIdValue,
    requested_at_utc: timestamp,
    ...body,
    receipt: {
      schema_version: NOTION_UI_RECEIPT_SCHEMA,
      status: 'pending',
      outcome: 'not_dispatched',
      external_id: null,
      intent_fingerprint: intentFingerprint,
      reconcile: 'manual_on_unknown',
    },
    intent_fingerprint: intentFingerprint,
    cloud_io: false,
  }
}

export const NOTION_FLOW_STATES = Object.freeze({
  SESSION_READY: 'session_ready',
  OAUTH_PENDING: 'oauth_pending',
  OAUTH_CALLBACK: 'oauth_callback',
  DESTINATION: 'destination',
  PREVIEW: 'preview',
  INTENT_READY: 'intent_ready',
})
