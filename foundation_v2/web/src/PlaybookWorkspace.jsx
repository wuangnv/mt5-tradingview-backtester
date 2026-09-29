import { useEffect, useMemo, useState } from 'react'
import { buildWorkspaceHref } from './workspaceContext.js'
import { diffPayloads, fetchPlaybookRevisions, fetchPlaybooks } from './playbookApi.js'
import './playbook-story.css'

const CAPABILITY_LABELS = {
  'manual-only': 'Manual only',
  'engine-supported': 'Engine supported',
  'needs-definition': 'Needs definition',
}

function statusLabel(status) {
  return status === 'frozen' ? 'Frozen' : status === 'draft' ? 'Draft' : 'Unknown'
}

function recordName(record) {
  return String(record?.payload?.name || 'Unnamed playbook')
}

function revisionPayload(revision) {
  return revision?.payload && typeof revision.payload === 'object' ? revision.payload : {}
}

function formatUtc(value) {
  if (!value) return 'Chưa xác định'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? String(value) : date.toISOString().replace('T', ' ').replace('.000Z', ' UTC')
}

function capabilityLabel(value) {
  return CAPABILITY_LABELS[value] || 'Unknown capability'
}

function PlaybookList({ items, selectedId, onSelect }) {
  if (items.length === 0) {
    return <div className="pb-empty" data-testid="playbook-empty"><strong>Chưa có playbook</strong><span>Backend chưa có record để đọc. UI này không tự tạo bản ghi.</span></div>
  }
  return (
    <div className="pb-list" aria-label="Playbook list" data-testid="playbook-list">
      {items.map((record) => {
        const payload = record.payload || {}
        return (
          <button
            className={`pb-list-row ${selectedId === record.record_id ? 'is-selected' : ''}`}
            key={record.record_id}
            type="button"
            onClick={() => onSelect(record.record_id)}
            data-testid={`playbook-row-${record.record_id}`}
          >
            <span className="pb-list-main"><strong>{recordName(record)}</strong><small>{record.record_id}</small></span>
            <span className="pb-list-meta"><b className={`pb-status is-${payload.status || 'unknown'}`}>{statusLabel(payload.status)}</b><small>r{record.revision}</small></span>
          </button>
        )
      })}
    </div>
  )
}

function PlaybookSummary({ record }) {
  const payload = record?.payload || {}
  const ruleKeys = Object.keys(payload.rules || {}).sort()
  return (
    <section className="pb-summary" aria-label="Selected playbook summary" data-testid="playbook-summary">
      <div className="pb-section-heading"><div><span className="pb-eyebrow">SELECTED PLAYBOOK</span><h2>{recordName(record)}</h2></div><span className={`pb-status is-${payload.status || 'unknown'}`}>{statusLabel(payload.status)}</span></div>
      <p className="pb-summary-copy">Đây là read-only projection của record backend. Muốn đổi setup, workflow sẽ tạo fork mới sau khi contract UI được duyệt.</p>
      <dl className="pb-facts">
        <div><dt>Record</dt><dd><code>{record.record_id}</code></dd></div>
        <div><dt>Current revision</dt><dd>r{record.revision}</dd></div>
        <div><dt>Capability</dt><dd>{capabilityLabel(payload.execution_capability)}</dd></div>
        <div><dt>Created</dt><dd>{formatUtc(record.created_at_utc)}</dd></div>
        <div><dt>Updated</dt><dd>{formatUtc(record.updated_at_utc)}</dd></div>
        <div><dt>Parent</dt><dd>{payload.parent_playbook_id ? <code>{payload.parent_playbook_id} · r{payload.parent_revision || '?'}</code> : 'Root record'}</dd></div>
      </dl>
      <div className="pb-rules"><span className="pb-eyebrow">RULE SURFACE</span>{ruleKeys.length ? <div className="pb-rule-chips">{ruleKeys.map((key) => <span key={key}>{key}</span>)}</div> : <span className="pb-muted">Chưa có rule key</span>}</div>
    </section>
  )
}

function RevisionDiff({ revisions, leftRevision, rightRevision, setLeftRevision, setRightRevision }) {
  const left = revisions.find((item) => item.revision === Number(leftRevision)) || revisions[0]
  const right = revisions.find((item) => item.revision === Number(rightRevision)) || revisions[revisions.length - 1]
  const diff = useMemo(() => (left && right ? diffPayloads(revisionPayload(left), revisionPayload(right)) : []), [left, right])
  if (!revisions.length) return <div className="pb-empty" data-testid="playbook-revisions-empty"><strong>Chưa có revision history</strong><span>Record này chưa trả về lịch sử revision.</span></div>
  return (
    <section className="pb-diff-section" aria-label="Playbook revision diff" data-testid="playbook-diff">
      <div className="pb-section-heading"><div><span className="pb-eyebrow">VERSION LINEAGE</span><h2>So sánh revision</h2></div><span className="pb-readonly">READ ONLY</span></div>
      <div className="pb-diff-controls">
        <label>Base<select aria-label="Base revision" value={left?.revision || ''} onChange={(event) => setLeftRevision(Number(event.target.value))}>{revisions.map((item) => <option key={item.revision} value={item.revision}>r{item.revision}</option>)}</select></label>
        <span aria-hidden="true">→</span>
        <label>Compare<select aria-label="Compare revision" value={right?.revision || ''} onChange={(event) => setRightRevision(Number(event.target.value))}>{revisions.map((item) => <option key={item.revision} value={item.revision}>r{item.revision}</option>)}</select></label>
      </div>
      {!diff.length ? <div className="pb-no-diff" data-testid="playbook-no-diff">Hai revision có cùng payload.</div> : <div className="pb-diff-table" role="table" aria-label="Changed playbook fields"><div className="pb-diff-head" role="row"><span>Field</span><span>Base r{left.revision}</span><span>Compare r{right.revision}</span></div>{diff.map((item) => <div className="pb-diff-row" key={item.path} role="row"><code>{item.path}</code><span className="is-old">{item.leftDisplay}</span><span className="is-new">{item.rightDisplay}</span></div>)}</div>}
      <p className="pb-diff-note">Diff chỉ hiển thị các field thay đổi; payload gốc vẫn thuộc backend record và không bị sửa từ màn này.</p>
    </section>
  )
}

export default function PlaybookWorkspace({ workspace = 'tenant-a', query = new URLSearchParams(window.location.search) }) {
  const requestedId = query.get('playbook') || ''
  const [catalog, setCatalog] = useState({ status: 'loading', items: [], error: null })
  const [selectedId, setSelectedId] = useState(requestedId)
  const [history, setHistory] = useState({ status: 'idle', items: [], error: null })
  const [leftRevision, setLeftRevision] = useState(1)
  const [rightRevision, setRightRevision] = useState(1)

  useEffect(() => {
    const controller = new AbortController()
    setCatalog({ status: 'loading', items: [], error: null })
    fetchPlaybooks(workspace, controller.signal)
      .then((items) => { setCatalog({ status: 'ready', items, error: null }); setSelectedId((current) => current || items[0]?.record_id || '') })
      .catch((error) => { if (error.name !== 'AbortError') setCatalog({ status: 'error', items: [], error: String(error.message || error) }) })
    return () => controller.abort()
  }, [workspace])

  useEffect(() => {
    if (!selectedId) { setHistory({ status: 'idle', items: [], error: null }); return undefined }
    const controller = new AbortController()
    setHistory({ status: 'loading', items: [], error: null })
    fetchPlaybookRevisions(workspace, selectedId, controller.signal)
      .then((items) => { setHistory({ status: 'ready', items, error: null }); setLeftRevision(items[0]?.revision || 1); setRightRevision(items[items.length - 1]?.revision || 1) })
      .catch((error) => { if (error.name !== 'AbortError') setHistory({ status: 'error', items: [], error: String(error.message || error) }) })
    return () => controller.abort()
  }, [selectedId, workspace])

  const selected = catalog.items.find((item) => item.record_id === selectedId) || null
  const selectPlaybook = (recordId) => {
    setSelectedId(recordId)
    const href = buildWorkspaceHref('playbook', workspace, query, { playbook: recordId })
    window.history.replaceState({}, '', href)
  }

  return (
    <main className="pb-page" data-testid="playbook-root">
      <header className="pb-topbar"><div><span className="pb-eyebrow">TRADING WORKSPACE / PLAYBOOK</span><h1>Playbook versions</h1><p>Đọc lineage và diff của setup mà không làm thay đổi record backend.</p></div><span className="pb-safety"><strong>READ ONLY</strong><small>Broker locked · không freeze / fork</small></span></header>
      {catalog.status === 'loading' && <div className="pb-message" role="status">Đang đọc playbook catalog…</div>}
      {catalog.status === 'error' && <div className="pb-message is-error" role="alert">Không đọc được playbook: {catalog.error}</div>}
      <div className="pb-layout">
        <aside className="pb-sidebar"><div className="pb-section-heading"><div><span className="pb-eyebrow">CATALOG</span><h2>Setups</h2></div><span className="pb-count">{catalog.items.length}</span></div><PlaybookList items={catalog.items} selectedId={selectedId} onSelect={selectPlaybook} /></aside>
        <div className="pb-content">{selected ? <PlaybookSummary record={selected} /> : catalog.status === 'ready' ? <div className="pb-empty"><strong>Chọn một playbook</strong><span>Chọn record bên trái để đọc metadata và version history.</span></div> : null}{history.status === 'loading' && <div className="pb-message" role="status">Đang đọc revision history…</div>}{history.status === 'error' && <div className="pb-message is-error" role="alert">Không đọc được revision history: {history.error}</div>}{history.status === 'ready' && <RevisionDiff revisions={history.items} leftRevision={leftRevision} rightRevision={rightRevision} setLeftRevision={setLeftRevision} setRightRevision={setRightRevision} />}</div>
      </div>
    </main>
  )
}

export { capabilityLabel, diffPayloads, statusLabel }

