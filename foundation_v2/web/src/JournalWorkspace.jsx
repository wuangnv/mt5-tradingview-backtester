import React, { useCallback, useEffect, useMemo, useState } from 'react'
import './journal-analytics.css'
import './journal-story.css'

const ENTRY_TYPES = [
  ['observation', 'Quan sát'],
  ['hypothesis', 'Giả thuyết'],
  ['decision', 'Quyết định'],
  ['no-trade', 'Không giao dịch'],
  ['missed-trade', 'Bỏ lỡ giao dịch'],
]

const STORY_STEPS = [
  ['context', 'Context', 'Phiên / cutoff'],
  ['observation', 'Quan sát', 'Điều thấy trên chart'],
  ['hypothesis', 'Giả thuyết', 'Điều cần kiểm chứng'],
  ['decision', 'Quyết định', 'Vào / bỏ qua / chờ'],
  ['outcome', 'Kết quả', 'Chưa ghi hoặc đã cập nhật'],
  ['next', 'Bước tiếp', 'Việc cần làm sau đó'],
]

const STORY_COPY = {
  observation: {
    takeaway: 'Bạn đang lưu bằng chứng quan sát trước khi kết luận.',
    result: 'Chưa có kết quả thực tế trong journal contract.',
    next: 'Chạy tiếp replay để kiểm tra giả thuyết rồi ghi lại kết quả.',
  },
  hypothesis: {
    takeaway: 'Bạn đang lưu một giả thuyết để kiểm chứng tại cutoff này.',
    result: 'Chưa có kết quả thực tế trong journal contract.',
    next: 'Replay qua vùng quyết định, sau đó ghi lại điều thực sự xảy ra.',
  },
  decision: {
    takeaway: 'Bạn đã lưu quyết định giao dịch cùng replay context.',
    result: 'Chưa có kết quả thực tế trong journal contract.',
    next: 'Giữ nguyên cutoff và cập nhật kết quả sau khi replay đủ dữ liệu.',
  },
  'no-trade': {
    takeaway: 'Bạn đã ghi rõ lý do không giao dịch tại cutoff.',
    result: 'Chưa có kết quả thực tế trong journal contract.',
    next: 'Mở lại replay để xem quyết định này còn đúng khi có thêm nến hay không.',
  },
  'missed-trade': {
    takeaway: 'Bạn đang ghi lại một cơ hội đã bỏ lỡ để review kỷ luật.',
    result: 'Chưa có kết quả thực tế trong journal contract.',
    next: 'Đối chiếu lại trigger và risk trước khi tạo một playbook mới.',
  },
}

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

function typeMeta(value) {
  return STORY_COPY[value] || {
    takeaway: 'Ghi chú này chưa có loại được nhận diện.',
    result: 'Chưa có kết quả thực tế trong journal contract.',
    next: 'Mở replay context để tiếp tục kiểm chứng.',
  }
}

function sourceForRecord(record) {
  return record?.payload?.source || record?.source || {}
}

function recordOutcome(record) {
  const payload = record?.payload || record || {}
  const value = payload.actual_result || payload.outcome || payload.result
  return typeof value === 'string' && value.trim() ? value.trim() : ''
}

function sourceLabel(source) {
  if (!source?.kind && !source?.id) return 'Chưa có source'
  return `${source.kind || 'source'} · ${source.id || 'N/A'}`
}

function storyForRecord(record, context) {
  const payload = record?.payload || record || {}
  const type = payload.entry_type || 'observation'
  const outcome = recordOutcome(record)
  const copy = typeMeta(type)
  return {
    type,
    label: labelForType(type),
    takeaway: copy.takeaway,
    outcome: outcome || copy.result,
    next: payload.next_action || copy.next,
    activeStep: outcome ? 'outcome' : (type === 'observation' || type === 'hypothesis' ? type : 'decision'),
    contextLabel: context.sessionId ? `Replay ${context.sessionId}` : 'Chưa chọn replay session',
  }
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
        <strong>{context.sessionId ? `Replay ${context.sessionId}` : context.tradeId ? `Trade ${context.tradeId}` : 'Chưa chọn replay session'}</strong>
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
        <small>{formatDate(record.updated_at_utc || record.created_at_utc)} · r{record.revision ?? 'N/A'} · {sourceLabel(source)}</small>
      </span>
      <span className="ja-row-meta">
        <code>{source.id || 'N/A'}</code>
        <span>{Array.isArray(payload.tags) && payload.tags.length ? payload.tags.join(' · ') : 'Không có tag'}</span>
      </span>
    </button>
  )
}

function StoryRail({ record, context }) {
  const story = storyForRecord(record, context)
  return (
    <section className="ja-story-rail" aria-label="Decision story">
      <div className="ja-story-rail-head">
        <div>
          <span className="ja-eyebrow">DECISION STORY</span>
          <strong>{story.takeaway}</strong>
        </div>
        <span className="ja-story-status">{story.label}</span>
      </div>
      <ol className="ja-story-steps">
        {STORY_STEPS.map(([id, label, hint]) => {
          const active = id === story.activeStep
          const complete = id === 'context' || (id === 'observation' && story.type !== 'observation') || (id === 'hypothesis' && ['decision', 'no-trade', 'missed-trade'].includes(story.type)) || (id === 'decision' && ['decision', 'no-trade', 'missed-trade'].includes(story.type)) || (id === 'outcome' && Boolean(recordOutcome(record)))
          return (
            <li className={`${active ? 'is-active' : ''} ${complete ? 'is-complete' : ''}`} key={id}>
              <span className="ja-story-step-mark" aria-hidden="true">{complete ? '✓' : '·'}</span>
              <span><strong>{label}</strong><small>{hint}</small></span>
            </li>
          )
        })}
      </ol>
      <div className="ja-story-facts">
        <div><span>Kết quả thực tế</span><strong className={recordOutcome(record) ? 'is-known' : 'is-unknown'}>{story.outcome}</strong></div>
        <div><span>Bước tiếp</span><strong>{story.next}</strong></div>
      </div>
    </section>
  )
}

function ProvenancePanel({ record, context }) {
  const source = sourceForRecord(record)
  const payload = record?.payload || record || {}
  return (
    <section className="ja-provenance-card" aria-label="Provenance ghi chú">
      <div className="ja-provenance-card-head">
        <div><span className="ja-eyebrow">PROVENANCE</span><strong>Evidence scope</strong></div>
        <span className="ja-readonly-badge">read-only source</span>
      </div>
      <dl>
        <div><dt>Replay session</dt><dd>{source.session_id || source.replay_session_id || context.sessionId || 'N/A'}</dd></div>
        <div><dt>Trade</dt><dd>{source.trade_id || context.tradeId || 'N/A'}</dd></div>
        <div><dt>Cutoff</dt><dd>{source.cursor_index ?? context.cursor ?? 'N/A'}</dd></div>
        <div><dt>Source ID</dt><dd><code>{source.id || 'N/A'}</code></dd></div>
        <div><dt>Revision</dt><dd>r{record?.revision ?? 'N/A'}</dd></div>
        <div><dt>Tags</dt><dd>{Array.isArray(payload.tags) && payload.tags.length ? payload.tags.join(' · ') : 'Không có tag'}</dd></div>
      </dl>
      <p>Source được giữ nguyên qua các revision để bạn luôn biết ghi chú này dựa trên snapshot nào.</p>
    </section>
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
  const selectedStory = selected ? storyForRecord(selected, context) : null
  const replayHref = context.sessionId
    ? `/?${new URLSearchParams({ workspace, view: 'replay', session: context.sessionId, ...(isFiniteNumber(context.cursor) ? { cursor: String(context.cursor) } : {}) }).toString()}`
    : `/?${new URLSearchParams({ workspace, view: 'replay' }).toString()}`
  const analyticsHref = `/?${new URLSearchParams({ workspace, view: 'analytics', ...(context.sessionId ? { session: context.sessionId } : {}), ...(context.tradeId ? { trade: context.tradeId } : {}) }).toString()}`
  return (
    <main className="ja-page journal-page ja-story-page" data-testid="journal-workspace" aria-busy={state.status === 'loading'}>
      <header className="ja-page-header">
        <div>
          <span className="ja-eyebrow">FXREPLAY / DECISION JOURNAL</span>
          <h1>Journal</h1>
          <p>Biến một replay cutoff thành câu chuyện có bằng chứng: điều thấy → quyết định → kết quả → bước tiếp theo.</p>
        </div>
        <div className="ja-header-status"><span className="ja-status-dot" />Local workspace · broker locked</div>
      </header>

      <ContextBar context={context} workspace={workspace} filtered={filtered} onFilterChange={setFiltered} />

      <section className="ja-story-intro" aria-label="Cách dùng Journal">
        <div className="ja-story-intro-copy">
          <span className="ja-eyebrow">WORKFLOW</span>
          <strong>{context.sessionId || context.tradeId ? 'Đang ghi quanh một replay context' : 'Journal chỉ tạo được từ replay context'}</strong>
          <span>{context.sessionId || context.tradeId ? 'Mỗi entry giữ lại cutoff, source và revision để review sau này.' : 'Mở Practice từ một dataset local trước khi ghi để không mất nguồn bằng chứng.'}</span>
        </div>
        <div className="ja-story-intro-actions">
          <a className="ja-button ja-button-quiet" href={replayHref}>Mở replay</a>
          <a className="ja-button ja-button-quiet" href={analyticsHref}>Xem analytics</a>
        </div>
      </section>

      {state.status === 'loading' && <div className="ja-message" role="status">Đang tải journal…</div>}
      {state.status === 'error' && (
        <div className="ja-message ja-message-error" role="alert">
          Không đọc được journal: {state.error} <button className="ja-inline-button" type="button" onClick={load}>Thử lại</button>
        </div>
      )}

      <section className="ja-journal-grid ja-story-grid">
        <div className="ja-list-panel">
          <div className="ja-section-head">
            <div><span className="ja-eyebrow">ENTRIES</span><strong>{visibleItems.length} ghi chú</strong><small className="ja-section-subtitle">{filtered ? 'Đang lọc theo context hiện tại' : 'Toàn bộ workspace'}</small></div>
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

        <div className="ja-editor-column">
          {selected && <StoryRail record={selected} context={context} />}
          {!selected && (
            <section className="ja-story-placeholder" aria-label="Decision story preview">
              <span className="ja-eyebrow">DECISION STORY</span>
              <strong>Chọn một entry để xem điều gì đã được biết tại cutoff.</strong>
              <span>Journal tách phần tóm tắt khỏi note gốc để bạn đọc nhanh trước khi mở provenance.</span>
            </section>
          )}
          {selected && <ProvenancePanel record={selected} context={context} />}
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
          {selectedStory && (
            <div className="ja-next-action">
              <div><span className="ja-eyebrow">NEXT ACTION</span><strong>{selectedStory.next}</strong></div>
              <a className="ja-text-link" href={replayHref}>Tiếp tục replay →</a>
            </div>
          )}
        </div>
      </section>
    </main>
  )
}

