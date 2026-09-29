import React, { useEffect, useMemo, useState } from 'react'
import {
  buildNotionExportIntent,
  buildNotionLedgerIntent,
  buildNotionPreview,
  hydrateNotionUiIntent,
  NOTION_FLOW_STATES,
} from './notionConnector.js'

const NOTION_LEDGER_BASE = '/api/v2/connectors/notion'

function connectorApiError(response, payload) {
  const detail = String(payload?.detail || `HTTP ${response.status}`)
  const error = new Error(detail)
  error.status = response.status
  error.kind = response.status === 409 ? 'conflict' : response.status >= 500 ? 'unavailable' : 'error'
  return error
}

async function connectorJson(path, workspace, options = {}) {
  if (!path.startsWith(NOTION_LEDGER_BASE)) throw new Error('unsafe_connector_target')
  const response = await fetch(path, {
    ...options,
    headers: {
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      'X-Workspace-Id': workspace,
      ...(options.headers || {}),
    },
  })
  const payload = await response.json().catch(() => ({}))
  if (!response.ok) throw connectorApiError(response, payload)
  return payload
}

function StateMessage({ kind = 'empty', children, testId }) {
  const role = kind === 'error' ? 'alert' : 'status'
  return <div className={`prop-message prop-message-${kind}`} role={role} data-testid={testId}>{children}</div>
}

function reportLabel(report) {
  return `${report?.attempt?.attempt_id || 'unknown attempt'} · ${report?.outcome?.status || 'unknown'}`
}

function nowUtcWithoutMillis() {
  return new Date().toISOString().replace('.000Z', 'Z')
}

function createRequestId(attemptId) {
  const suffix = Math.floor(Date.now() / 1000).toString(36)
  return `mt5-notion-ui-${String(attemptId || 'report').replace(/[^A-Za-z0-9._:-]/g, '-')}-${suffix}`.slice(0, 128)
}

function opaquePart(value, fallback = 'workspace') {
  const part = String(value || fallback).replace(/[^A-Za-z0-9._:-]/g, '-').replace(/^-+|-+$/g, '')
  return part || fallback
}

function createLedgerIds(workspace, requestId) {
  const workspacePart = opaquePart(workspace)
  const requestPart = opaquePart(requestId, 'request')
  return {
    connectionId: `mt5-notion-ui-connection-${workspacePart}`.slice(0, 128),
    intentId: `mt5-notion-ui-intent-${requestPart}`.slice(0, 128),
    idempotencyKey: `mt5-notion-ui-idempotency-${requestPart}`.slice(0, 128),
  }
}

export default function NotionConnector({ workspace, reports, onRefresh }) {
  const [flow, setFlow] = useState(NOTION_FLOW_STATES.SESSION_READY)
  const [selectedIndex, setSelectedIndex] = useState(0)
  const [oauth, setOauth] = useState({ provider: 'notion', state: null, status: 'idle', error: null })
  const [account, setAccount] = useState('')
  const [destination, setDestination] = useState('')
  const [destinationOption, setDestinationOption] = useState('')
  const [preview, setPreview] = useState(null)
  const [intent, setIntent] = useState(null)
  const [receiptState, setReceiptState] = useState('pending')
  const [error, setError] = useState(null)
  const [ledger, setLedger] = useState({
    status: 'idle',
    intentId: null,
    connectionId: null,
    connectionRevision: null,
    receiptRevision: null,
  })
  const [ledgerMessage, setLedgerMessage] = useState(null)
  const items = reports?.items || []
  const selectedReport = items[selectedIndex] || null
  const isLoading = reports?.status === 'loading'
  const selectedSummary = useMemo(() => {
    if (!selectedReport) return null
    return {
      attempt: selectedReport.attempt?.attempt_id,
      status: selectedReport.outcome?.status,
      equity: selectedReport.phase?.equity,
      source: selectedReport.result_source,
    }
  }, [selectedReport])

  useEffect(() => {
    let cancelled = false
    async function restoreLedger() {
      setLedger((current) => ({ ...current, status: 'loading' }))
      setLedgerMessage(null)
      try {
        const [intentList, connectionList] = await Promise.all([
          connectorJson(`${NOTION_LEDGER_BASE}/intents`, workspace),
          connectorJson(`${NOTION_LEDGER_BASE}/connections`, workspace),
        ])
        if (cancelled) return
        const persistedRow = (intentList.items || [])[0]
        if (!persistedRow) {
          setLedger({ status: 'ready', intentId: null, connectionId: null, connectionRevision: null, receiptRevision: null })
          return
        }
        const receipt = await connectorJson(
          `${NOTION_LEDGER_BASE}/intents/${encodeURIComponent(persistedRow.intent_id)}/receipt`,
          workspace,
        )
        if (cancelled) return
        const persistedIntent = persistedRow.intent_json
        const connection = (connectionList.items || []).find(
          (item) => item.connection_id === persistedRow.connection_id,
        )
        const restored = hydrateNotionUiIntent(persistedIntent, receipt, {
          accountSelected: Boolean(connection?.account_ref)
            && !['revoked', 'cancelled'].includes(connection?.status),
        })
        setIntent(restored)
        setReceiptState(receipt.status)
        setLedger({
          status: 'ready',
          intentId: persistedRow.intent_id,
          connectionId: persistedRow.connection_id || null,
          connectionRevision: connection?.revision || null,
          receiptRevision: receipt.revision || null,
        })
        setFlow(NOTION_FLOW_STATES.INTENT_READY)
      } catch (nextError) {
        if (cancelled) return
        // The UI remains usable as an offline preparation surface when the
        // optional local API is absent; this state never implies persistence.
        const reason = nextError.kind === 'conflict'
          ? 'local ledger bị conflict; không tự ghi đè'
          : nextError.status === 401 || nextError.status === 403
            ? 'workspace chưa được cấp quyền local ledger'
            : 'local ledger chưa kết nối'
        setLedger((current) => ({ ...current, status: nextError.kind === 'conflict' ? 'conflict' : 'unavailable' }))
        setLedgerMessage(`${reason}; intent chỉ còn trong phiên hiện tại.`)
      }
    }
    restoreLedger()
    return () => { cancelled = true }
  }, [workspace])

  useEffect(() => {
    const attemptId = intent?.source?.attempt_id
    if (!attemptId || !items.length) return
    const index = items.findIndex((item) => item.attempt?.attempt_id === attemptId)
    if (index >= 0) setSelectedIndex(index)
  }, [intent?.source?.attempt_id, items])

  const resetFlow = () => {
    setFlow(NOTION_FLOW_STATES.SESSION_READY)
    setOauth({ provider: 'notion', state: null, status: 'idle', error: null })
    setAccount('')
    setDestination('')
    setDestinationOption('')
    setPreview(null)
    setIntent(null)
    setReceiptState('pending')
    setError(null)
    setLedgerMessage(null)
  }

  const beginConnect = () => {
    setError(null)
    const state = `notion-ui-state-${String(workspace).replace(/[^A-Za-z0-9._-]/g, '-')}`
    setOauth({ provider: 'notion', state, status: 'pending', error: null })
    setFlow(NOTION_FLOW_STATES.OAUTH_PENDING)
  }

  const continueOAuth = () => {
    setError(null)
    if (oauth.provider !== 'notion' || oauth.status !== 'pending' || !oauth.state) {
      const callbackError = 'OAuth callback không khớp provider/state.'
      setOauth((current) => ({ ...current, status: 'error', error: callbackError }))
      setError(callbackError)
      return
    }
    setOauth((current) => ({ ...current, status: 'verified', error: null }))
    setFlow(NOTION_FLOW_STATES.OAUTH_CALLBACK)
  }

  const cancelOAuth = () => resetFlow()

  const openDestinationPicker = () => {
    setError(null)
    setFlow(NOTION_FLOW_STATES.DESTINATION)
  }

  const buildPreview = () => {
    setError(null)
    try {
      if (!selectedReport) throw new Error('Chưa có report mô phỏng để preview.')
      if (oauth.status !== 'verified') throw new Error('OAuth callback chưa được xác minh.')
      if (!account) throw new Error('Chưa chọn Notion account.')
      if (!destination) throw new Error('Chưa chọn destination.')
      const nextPreview = buildNotionPreview(selectedReport)
      setPreview(nextPreview)
      setIntent(null)
      setFlow(NOTION_FLOW_STATES.PREVIEW)
    } catch (nextError) {
      setError(nextError.message)
    }
  }

  const buildIntent = async () => {
    setError(null)
    setLedgerMessage(null)
    try {
      if (!preview || !selectedReport) throw new Error('Preview chưa sẵn sàng.')
      const nextIntent = await buildNotionExportIntent(preview, {
        request_id: createRequestId(selectedReport.attempt?.attempt_id),
        requested_at_utc: nowUtcWithoutMillis(),
        destination_ref: destination,
        account_ref: account,
      })
      const ledgerIntent = await buildNotionLedgerIntent(nextIntent)
      const ids = createLedgerIds(workspace, nextIntent.request_id)
      let displayedIntent = nextIntent
      let nextLedger = {
        status: 'unavailable',
        intentId: ids.intentId,
        connectionId: ids.connectionId,
        connectionRevision: null,
        receiptRevision: null,
      }
      try {
        const connectionResponse = await connectorJson(`${NOTION_LEDGER_BASE}/connections`, workspace, {
          method: 'POST',
          body: JSON.stringify({
            connection_id: ids.connectionId,
            request_id: `${nextIntent.request_id}-connection`.slice(0, 128),
            idempotency_key: `${ids.idempotencyKey}-connection`,
            account_ref: account,
            scopes: ['write'],
            metadata: { source: 'mt5-notion-ui', mode: 'PREP_ONLY' },
          }),
        })
        const intentResponse = await connectorJson(`${NOTION_LEDGER_BASE}/intents`, workspace, {
          method: 'POST',
          body: JSON.stringify({
            intent_id: ids.intentId,
            request_id: nextIntent.request_id,
            idempotency_key: ids.idempotencyKey,
            connection_id: ids.connectionId,
            intent: ledgerIntent,
          }),
        })
        displayedIntent = hydrateNotionUiIntent(
          intentResponse.intent.intent_json,
          intentResponse.receipt,
          { accountSelected: Boolean(connectionResponse.connection.account_ref) },
        )
        nextLedger = {
          status: 'ready',
          intentId: intentResponse.intent.intent_id,
          connectionId: intentResponse.intent.connection_id,
          connectionRevision: connectionResponse.connection.revision,
          receiptRevision: intentResponse.receipt.revision,
        }
        setLedgerMessage('Đã lưu local ledger PREP_ONLY; chưa có cloud I/O.')
      } catch (ledgerError) {
        const reason = ledgerError.kind === 'conflict'
          ? 'local ledger bị conflict; không tự ghi đè'
          : ledgerError.status === 401 || ledgerError.status === 403
            ? 'workspace chưa được cấp quyền local ledger'
            : 'local ledger chưa kết nối'
        setLedgerMessage(`${reason}; intent chỉ còn trong phiên hiện tại.`)
      }
      setLedger(nextLedger)
      setIntent(displayedIntent)
      setReceiptState(displayedIntent.receipt?.status || 'pending')
      setFlow(NOTION_FLOW_STATES.INTENT_READY)
    } catch (nextError) {
      setError(nextError.message)
    }
  }

  const persistReceiptState = async (status) => {
    if (!ledger.intentId || !ledger.receiptRevision) return
    try {
      const response = await connectorJson(
        `${NOTION_LEDGER_BASE}/intents/${encodeURIComponent(ledger.intentId)}/receipt`,
        workspace,
        {
          method: 'PATCH',
          body: JSON.stringify({
            status,
            expected_revision: ledger.receiptRevision,
            response: { outcome: `${status}_before_dispatch`, mode: 'PREP_ONLY' },
          }),
        },
      )
      setLedger((current) => ({
        ...current,
        status: 'ready',
        receiptRevision: response.receipt.revision,
      }))
      setLedgerMessage('Đã cập nhật local ledger; chưa có cloud I/O.')
    } catch (ledgerError) {
      setLedger((current) => ({ ...current, status: ledgerError.kind === 'conflict' ? 'conflict' : 'unavailable' }))
      setLedgerMessage(ledgerError.kind === 'conflict'
        ? 'Local ledger bị conflict; state hiện tại chỉ là hiển thị phiên này.'
        : 'Không cập nhật được local ledger; state hiện tại chỉ là hiển thị phiên này.')
    }
  }

  const revokePreparedConnection = () => {
    setOauth((current) => ({ ...current, status: 'revoked', error: null }))
    setReceiptState('revoked')
    setIntent((current) => current ? {
      ...current,
      authorization: { ...current.authorization, account_selected: false },
      receipt: { ...current.receipt, status: 'revoked', outcome: 'revoked_before_dispatch', external_id: null },
    } : current)
    if (ledger.connectionId && ledger.connectionRevision) {
      connectorJson(`${NOTION_LEDGER_BASE}/connections/${encodeURIComponent(ledger.connectionId)}`, workspace, {
        method: 'PATCH',
        body: JSON.stringify({ status: 'revoked', expected_revision: ledger.connectionRevision }),
      }).then((response) => {
        setLedger((current) => ({ ...current, connectionRevision: response.connection.revision }))
      }).catch(() => {
        setLedger((current) => ({ ...current, status: 'unavailable' }))
        setLedgerMessage('Không cập nhật được connection ledger; state hiện tại chỉ là hiển thị phiên này.')
      })
    }
    void persistReceiptState('revoked')
  }

  const markUnknownForLookup = () => {
    setReceiptState('unknown')
    setIntent((current) => current ? {
      ...current,
      receipt: { ...current.receipt, status: 'unknown', outcome: 'unknown_requires_lookup', external_id: null },
    } : current)
    void persistReceiptState('unknown')
  }

  return (
    <section className="notion-connector" data-testid="notion-connector">
      <div className="prop-section-head">
        <div><span>M6 / Notion connector</span><strong>Chuẩn bị export report mô phỏng</strong></div>
        <small data-testid="notion-flow-state">{flow}</small>
      </div>

      <div className="notion-flow" aria-label="Notion connector flow">
        <div className={flow === NOTION_FLOW_STATES.SESSION_READY ? 'is-current' : ''}><span>1</span><strong>App session</strong><small>{workspace}</small></div>
        <div className={flow === NOTION_FLOW_STATES.OAUTH_PENDING || flow === NOTION_FLOW_STATES.OAUTH_CALLBACK ? 'is-current' : ''}><span>2</span><strong>Connect</strong><small>OAuth state</small></div>
        <div className={flow === NOTION_FLOW_STATES.DESTINATION ? 'is-current' : ''}><span>3</span><strong>Destination</strong><small>Owner chọn</small></div>
        <div className={flow === NOTION_FLOW_STATES.PREVIEW ? 'is-current' : ''}><span>4</span><strong>Preview</strong><small>Allowlist</small></div>
        <div className={flow === NOTION_FLOW_STATES.INTENT_READY ? 'is-current' : ''}><span>5</span><strong>Receipt</strong><small>PREP_ONLY</small></div>
      </div>

      <div className="notion-safety" data-testid="notion-safety">
        <strong>OFFLINE PREP_ONLY</strong>
        <span>Không mở OAuth thật, không gọi Notion, không gửi broker. Đây là state để nối connector sau khi có account và quyền rõ ràng.</span>
        <span data-testid="notion-ledger-status">
          Local ledger: {ledger.status === 'ready' ? 'đã khôi phục/lưu' : ledger.status === 'loading' ? 'đang khôi phục' : ledger.status === 'unavailable' ? 'chưa kết nối' : ledger.status === 'conflict' ? 'conflict — không tự ghi đè' : 'chưa có intent'}.
        </span>
      </div>
      {ledgerMessage && <StateMessage kind="status" testId="notion-ledger-message">{ledgerMessage}</StateMessage>}

      {error && <StateMessage kind="error" testId="notion-error">Không tạo được bước tiếp theo: {error}</StateMessage>}

      {flow === NOTION_FLOW_STATES.SESSION_READY && (
        <div className="notion-step" data-testid="notion-session-step">
          <div><strong>Đã có phiên đăng nhập của sản phẩm</strong><p>Workspace hiện tại là <code>{workspace}</code>. Login này chỉ là login vào app; Notion sẽ có bước cấp quyền riêng.</p></div>
          <button type="button" className="ui-button ui-button--neutral prop-refresh" onClick={beginConnect}>Kết nối Notion</button>
        </div>
      )}

      {flow === NOTION_FLOW_STATES.OAUTH_PENDING && (
        <div className="notion-step" data-testid="notion-oauth-pending">
          <div><strong>OAuth đang chờ callback</strong><p>Provider: <code>{oauth.provider}</code> · state: <code>{oauth.state}</code>. UI chỉ mô phỏng trạng thái chuyển sang trang Notion; chưa mở popup và chưa lưu token.</p></div>
          <div className="notion-destination-actions"><button type="button" className="ui-button ui-button--neutral prop-refresh" onClick={continueOAuth}>Mô phỏng callback</button><button type="button" className="prop-refresh" onClick={cancelOAuth}>Hủy</button></div>
        </div>
      )}

      {flow === NOTION_FLOW_STATES.OAUTH_CALLBACK && (
        <div className="notion-step" data-testid="notion-oauth-callback">
          <div><strong>Callback hợp lệ ở mức UI</strong><p>Provider: <code>{oauth.provider}</code> · state đã đối chiếu. Connector thật chưa được expose trong runtime, nên bước này chỉ giữ state và không biến callback thành quyền ghi.</p></div>
          <div className="notion-destination-actions"><button type="button" className="ui-button ui-button--neutral prop-refresh" onClick={openDestinationPicker}>Chọn account & destination</button><button type="button" className="prop-refresh" onClick={cancelOAuth}>Hủy</button></div>
        </div>
      )}

      {(flow === NOTION_FLOW_STATES.DESTINATION || flow === NOTION_FLOW_STATES.PREVIEW || flow === NOTION_FLOW_STATES.INTENT_READY) && (
        <div className="notion-destination" data-testid="notion-destination-step">
          <label className="prop-field">
            <span>Notion account (owner chọn)</span>
            <select aria-label="Notion account" value={account} onChange={(event) => { setAccount(event.target.value); setPreview(null); setIntent(null) }}>
              <option value="">Chưa chọn account</option>
              <option value="owner-selected:notion-demo-account">Demo account (local placeholder)</option>
            </select>
          </label>
          <label className="prop-field">
            <span>Report source</span>
            <select aria-label="Notion report source" value={selectedIndex} onChange={(event) => { setSelectedIndex(Number(event.target.value)); setPreview(null); setIntent(null) }}>
              {items.map((item, index) => <option key={`${item.attempt?.attempt_id || index}`} value={index}>{reportLabel(item)}</option>)}
            </select>
          </label>
          <label className="prop-field">
            <span>Destination picker (offline)</span>
            <select aria-label="Notion destination picker" value={destinationOption} onChange={(event) => {
              const value = event.target.value
              setDestinationOption(value)
              setDestination(value === 'custom' ? '' : value)
              setPreview(null)
              setIntent(null)
            }}>
              <option value="">Chưa chọn destination</option>
              <option value="user-selected:notion-page-demo">Demo page (local placeholder)</option>
              <option value="custom">Nhập ref do owner chọn</option>
            </select>
          </label>
          <label className="prop-field">
            <span>{destinationOption === 'custom' ? 'Destination ref (owner chọn)' : 'Destination ref'}</span>
            <input
              aria-label="Notion destination ref"
              value={destination}
              disabled={destinationOption !== 'custom'}
              onChange={(event) => { setDestination(event.target.value); setPreview(null); setIntent(null) }}
              placeholder="user-selected:notion-page-001"
            />
          </label>
          <div className="notion-destination-actions">
            <button type="button" className="ui-button ui-button--neutral prop-refresh" onClick={buildPreview} disabled={!destination || !account || !selectedReport}>Xem preview an toàn</button>
            <button type="button" className="prop-refresh" onClick={resetFlow}>Đặt lại flow</button>
          </div>
          {selectedSummary && <small className="notion-selection-summary">Selected: {selectedSummary.attempt} · {selectedSummary.status} · equity {selectedSummary.equity}</small>}
        </div>
      )}

      {flow === NOTION_FLOW_STATES.PREVIEW && preview && (
        <div className="notion-preview" data-testid="notion-preview">
          <div className="prop-section-head"><div><span>Sanitized report</span><strong>{preview.generated.title}</strong></div><small>{preview.status}</small></div>
          <div className="notion-preview-grid">
            <div><span>Status</span><strong>{preview.generated.properties.outcome_status}</strong></div>
            <div><span>Equity</span><strong>{preview.generated.properties.equity}</strong></div>
            <div><span>Data</span><strong>{preview.source.data_version}</strong></div>
            <div><span>Source revision</span><strong>{preview.source.attempt_revision}</strong></div>
          </div>
          <p className="notion-preview-note">Chỉ vùng <code>generated.mt5_report</code> được quản lý. <code>owner_notes</code> hiện có sẽ được giữ nguyên; broker/account/holdout/credential không nằm trong payload.</p>
          <button type="button" className="ui-button ui-button--neutral prop-refresh" onClick={buildIntent}>Tạo export intent offline</button>
        </div>
      )}

      {flow === NOTION_FLOW_STATES.INTENT_READY && intent && (
        <div className="notion-receipt" data-testid="notion-receipt">
          <div className="prop-section-head"><div><span>Export intent / receipt</span><strong>{intent.receipt.outcome}</strong></div><small>{intent.status}</small></div>
          <dl className="notion-receipt-facts">
            <div><dt>Request</dt><dd>{intent.request_id}</dd></div>
            <div><dt>Account</dt><dd>{intent.authorization.account_selected ? 'Đã owner chọn' : 'Chưa chọn'}</dd></div>
            <div><dt>Destination</dt><dd>{intent.destination.ref}</dd></div>
            <div><dt>Receipt state</dt><dd>{receiptState}</dd></div>
            <div><dt>External ID</dt><dd>{intent.receipt.external_id || 'Chưa có — chưa dispatch'}</dd></div>
            <div><dt>Cloud I/O</dt><dd>{intent.cloud_io ? 'Có' : 'Không'}</dd></div>
          </dl>
          <p className="notion-preview-note">
            {receiptState === 'pending' && <>Receipt đang <strong>pending / not_dispatched</strong>. Cần connector Notion thật, account và destination đã chọn trước khi có thể dispatch.</>}
            {receiptState === 'revoked' && <>State kết nối đã bị <strong>thu hồi trước dispatch</strong>; không có token hoặc external ID để dùng lại.</>}
            {receiptState === 'unknown' && <>Receipt ở trạng thái <strong>unknown</strong>. Phải tra cứu destination bằng connector thật trước khi retry; UI này không tự retry.</>}
          </p>
          <div className="notion-destination-actions">
            {receiptState === 'pending' && <>
              <button type="button" className="prop-refresh" onClick={revokePreparedConnection}>Thu hồi state kết nối</button>
              <button type="button" className="prop-refresh" onClick={markUnknownForLookup}>Đánh dấu unknown cần lookup</button>
            </>}
            <button type="button" className="prop-refresh" onClick={resetFlow}>Chuẩn bị report khác</button>
          </div>
        </div>
      )}

      {!items.length && !isLoading && <StateMessage kind="empty" testId="notion-empty">Chưa có report để preview. Hãy tạo hoặc tải một Prop report ở tab Reports trước.</StateMessage>}
      {isLoading && <StateMessage kind="loading" testId="notion-loading">Đang đọc report từ backend local…</StateMessage>}
      {reports?.status === 'error' && <StateMessage kind="error" testId="notion-reports-error">Không đọc được report: {reports.error}</StateMessage>}
      <div className="notion-footer-actions">
        <button type="button" className="prop-refresh" onClick={onRefresh} disabled={isLoading}>Tải lại reports</button>
      </div>
    </section>
  )
}
