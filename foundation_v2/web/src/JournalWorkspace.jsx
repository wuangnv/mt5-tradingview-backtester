import React, { useCallback, useEffect, useMemo, useState } from 'react'
import './journal-analytics.css'

const ENTRY_TYPES = [
  ['observation', 'Quan sát'],
  ['hypothesis', 'Giả thuyết'],
  ['decision', 'Quyết định'],
  ['no-trade', 'Không giao dịch'],
  ['missed-trade', 'Bỏ lỡ giao dịch'],
]

function contextFromQuery(query) {
  const sessionId = query?.get('session') || query?.get('replay_session') || ''
  const tradeId = query?.get('trade') || query?.get('trade_id') || ''
  const cursorValue = query?.get('cursor') ?? query?.get('cursor_index')
  const cursor = cursorValue !== null && cursorValue !== '' && Number.isInteger(Number(cursorValue))
    ? Number(cursorValue)
    : null
  return { sessionId, tradeId, cursor }
}

function isFiniteNumber(value) {
  return value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value))
}

function formatDate(value) {
  if (!value) return 'Chưa có thời gian'
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return 'Chưa có thời gian'
  return new Intl.DateTimeFormat('vi-VN', { dateStyle: 'medium', timeStyle: 'short' }).format(parsed)
}

function labelForType(value) {
  return ENTRY_TYPES.find(([key]) => key === value)?.[1] || value || 'Chưa phân loại'
}

function sourceForRecord(record) {
  return record?.payload?.source || record?.source || {}
}

export function recordMatchesContext(record, context) {
  const source = sourceForRecord(record)
  if (!context.sessionId && !context.tradeId) return true
  const sessionMatches = !context.sessionId || [source.session_id, source.replay_session_id, source.sessionId, source.id]
    .some((value) => String(value || '') === context.sessionId)
  const tradeMatches = !context.tradeId || [source.trade_id, source.tradeId, source.id]
    .some((value) => String(value || '') === context.tradeId)
  return sessionMatches && tradeMatches
}

function sourceIdentity(context) {
  if (context.tradeId) {
    return { kind: 'replay-trade', id: context.tradeId, session_id: context.sessionId || undefined, trade_id: context.tradeId }
  }
  if (context.sessionId) {
    const suffix = isFiniteNumber(context.cursor) ? `:cursor:${context.cursor}` : ''
    return {
      kind: 'replay-decision',
      id: `${context.sessionId}${suffix}`,
      session_id: context.sessionId,
      ...(isFiniteNumber(context.cursor) ? { cursor_index: context.cursor } : {}),
    }
  }
  return null
}

async function readJson(response) {
  const payload = await response.json().catch(() => ({}))
  if (!response.ok) {
    const detail = payload?.detail || `HTTP ${response.status}`
    throw new Error(String(detail))
  }
  return payload
}

function ContextBar({ context, workspace, filtered, onFilterChange }) {
  const replayParams = new URLSearchParams({ workspace, view: 'replay' })
  if (context.sessionId) replayParams.set('session', context.sessionId)
  return (
    <section className="ja-context-bar" aria-label="Ngữ cảnh journal">
      <div className="ja-context-copy">
        <span className="ja-eyebrow">LINKED CONTEXT</span>
        <strong>{context.sessionId ? `Replay ${context.sessionId}` : 'Chưa chọn replay session'}</strong>
        {context.tradeId && <span>Trade <code>{context.tradeId}</code></span>}
        {isFiniteNumber(context.cursor) && <span>Cutoff nến <strong>#{context.cursor}</strong></span>}
      </div>
      <div className="ja-context-actions">
        {(context.sessionId || context.tradeId) && (
          <label className="ja-filter-toggle">
            <input type="checkbox" checked={filtered} onChange={(event) => onFilterChange(event.target.checked)} />
            Chỉ ngữ cảnh này
          </label>
        )}
        {context.sessionId && <a className="ja-text-link" href={`/?${replayParams.toString()}`}>Mở lại replay</a>}
      </div>
    </section>
  )
}

function JournalRow({ record, selected, onSelect }) {
  const payload = record.payload || record
  const source = sourceForRecord(record)
  return (
    <button
      className={`ja-journal-row ${selected ? 'is-selected' : ''}`}
      type="button"
      onClick={() => onSelect(record)}
      aria-pressed={selected}
    >
      <span className="ja-row-main">
        <span className="ja-row-kicker">{labelForType(payload.entry_type)}</span>
        <strong>{payload.note}</strong>
        <small>{formatDate(record.updated_at_utc || record.created_at_utc)} · r{record.revision ?? 'N/A'}</small>
      </span>
      <span className="ja-row-meta">
        <code>{source.id || 'N/A'}</code>
        <span>{Array.isArray(payload.tags) && payload.tags.length ? payload.tags.join(' · ') : 'Không có tag'}</span>
      </span>
    </button>
  )
}

export default function JournalWorkspace({ workspace = 'tenant-a', query = new URLSearchParams() }) {
  const context = useMemo(() => contextFromQuery(query), [query])
  const [state, setState] = useState({ status: 'loading', items: [], error: null })
  const [filtered, setFiltered] = useState(Boolean(context.sessionId || context.tradeId))
  const [selected, setSelected] = useState(null)
  const [entryType, setEntryType] = useState('observation')
  const [note, setNote] = useState('')
  const [tags, setTags] = useState('')
  const [editing, setEditing] = useState(false)
  const [pending, setPending] = useState(false)
  const [formError, setFormError] = useState('')

  const load = useCallback(async () => {
    setState((current) => ({ ...current, status: 'loading', error: null }))
    try {
      const response = await fetch('/api/v2/journal', { headers: { 'X-Workspace-Id': workspace } })
      const payload = await readJson(response)
      const items = Array.isArray(payload.items) ? payload.items : []
      setState({ status: 'ready', items, error: null })
    } catch (error) {
      setState({ status: 'error', items: [], error: String(error.message || error) })
    }
  }, [workspace])

  useEffect(() => { load() }, [load])

  const visibleItems = useMemo(
    () => filtered ? state.items.filter((record) => recordMatchesContext(record, context)) : state.items,
    [context, filtered, state.items],
  )
  const source = useMemo(() => sourceIdentity(context), [context])

  const selectRecord = (record) => {
    setSelected(record)
    const payload = record.payload || record
    setEntryType(payload.entry_type || 'observation')
    setNote(payload.note || '')
    setTags(Array.isArray(payload.tags) ? payload.tags.join(', ') : '')
    setEditing(false)
    setFormError('')
  }

  const resetForm = () => {
    setSelected(null)
    setEditing(false)
    setEntryType('observation')
    setNote('')
    setTags('')
    setFormError('')
  }

  const submit = async (event) => {
    event.preventDefault()
    const cleanNote = note.trim()
    if (!cleanNote) { setFormError('Ghi chú không được để trống.'); return }
    if (!source && !selected) { setFormError('Hãy mở Journal từ một replay session hoặc trade để giữ đúng source.'); return }
    const payload = {
      entry_type: entryType,
      note: cleanNote,
      tags: tags.split(',').map((tag) => tag.trim()).filter(Boolean).slice(0, 32),
      source: selected ? sourceForRecord(selected) : source,
    }
    setPending(true)
    setFormError('')
    try {
      const endpoint = selected && editing
        ? `/api/v2/journal/${encodeURIComponent(selected.record_id)}/revisions`
        : '/api/v2/journal'
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Workspace-Id': workspace },
        body: JSON.stringify(selected && editing ? { expected_revision: selected.revision, payload } : payload),
      })
      const updated = await readJson(response)
      await load()
      setSelected(updated)
      setEditing(false)
      setEntryType(updated.payload?.entry_type || payload.entry_type)
      setNote(updated.payload?.note || payload.note)
      setTags(Array.isArray(updated.payload?.tags) ? updated.payload.tags.join(', ') : payload.tags.join(', '))
    } catch (error) {
      setFormError(String(error.message || error))
    } finally {
      setPending(false)
    }
  }

  const title = selected && !editing ? 'Chi tiết ghi chú' : selected ? 'Sửa ghi chú' : 'Ghi chú mới'
  const selectedSource = sourceForRecord(selected)
  return (
    <main className="ja-page journal-page" data-testid="journal-workspace">
      <header className="ja-page-header">
        <div>
          <span className="ja-eyebrow">FXREPLAY / DECISION JOURNAL</span>
          <h1>Journal</h1>
          <p>Ghi lại điều bạn thấy, quyết định và lý do ngay tại replay cutoff.</p>
        </div>
        <div className="ja-header-status"><span className="ja-status-dot" />Local workspace · broker locked</div>
      </header>

      <ContextBar context={context} workspace={workspace} filtered={filtered} onFilterChange={setFiltered} />

      {state.status === 'loading' && <div className="ja-message" role="status">Đang tải journal…</div>}
      {state.status === 'error' && (
        <div className="ja-message ja-message-error" role="alert">
          Không đọc được journal: {state.error} <button className="ja-inline-button" type="button" onClick={load}>Thử lại</button>
        </div>
      )}

      <section className="ja-journal-grid">
        <div className="ja-list-panel">
          <div className="ja-section-head">
            <div><span className="ja-eyebrow">ENTRIES</span><strong>{visibleItems.length} ghi chú</strong></div>
            <button type="button" className="ja-button ja-button-primary" onClick={resetForm} disabled={!source}>+ Ghi chú</button>
          </div>
          {!visibleItems.length && state.status === 'ready' && (
            <div className="ja-empty-state">
              <strong>{filtered ? 'Chưa có ghi chú cho context này' : 'Journal đang trống'}</strong>
              <span>{source ? 'Tạo ghi chú đầu tiên để lưu decision cùng replay.' : 'Mở Journal từ replay để tạo ghi chú có source rõ ràng.'}</span>
            </div>
          )}
          <div className="ja-journal-list">
            {visibleItems.map((record) => (
              <JournalRow key={record.record_id} record={record} selected={record.record_id === selected?.record_id} onSelect={selectRecord} />
            ))}
          </div>
        </div>

        <form className="ja-editor-panel" onSubmit={submit}>
          <div className="ja-section-head">
            <div><span className="ja-eyebrow">{selected ? `REVISION ${selected.revision ?? 'N/A'}` : 'NEW ENTRY'}</span><strong>{title}</strong></div>
            {selected && !editing && <button type="button" className="ja-button" onClick={() => setEditing(true)}>Sửa</button>}
            {selected && editing && <button type="button" className="ja-button" onClick={() => selectRecord(selected)}>Hủy</button>}
          </div>
          <label className="ja-field">Loại ghi chú
            <select value={entryType} onChange={(event) => setEntryType(event.target.value)} disabled={Boolean(selected && !editing)}>
              {ENTRY_TYPES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </label>
          <label className="ja-field">Nội dung
            <textarea value={note} onChange={(event) => setNote(event.target.value)} placeholder="Ví dụ: giá phá range nhưng chưa đóng trên vùng…" rows={8} disabled={Boolean(selected && !editing)} maxLength={10000} />
          </label>
          <label className="ja-field">Tags <span className="ja-field-hint">phân tách bằng dấu phẩy</span>
            <input value={tags} onChange={(event) => setTags(event.target.value)} placeholder="discipline, breakout" disabled={Boolean(selected && !editing)} />
          </label>
          <div className="ja-source-box">
            <span className="ja-eyebrow">IMMUTABLE SOURCE</span>
            <code>{selectedSource.kind || source?.kind || 'N/A'}:{selectedSource.id || source?.id || 'N/A'}</code>
            <small>Source gắn với session/trade và không đổi khi sửa revision.</small>
          </div>
          {formError && <div className="ja-form-error" role="alert">{formError}</div>}
          {(!selected || editing) && (
            <button className="ja-button ja-button-primary ja-submit" type="submit" disabled={pending || !source}>
              {pending ? 'Đang lưu…' : selected ? 'Lưu revision' : 'Lưu ghi chú'}
            </button>
          )}
        </form>
      </section>
    </main>
  )
}

