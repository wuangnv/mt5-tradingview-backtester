import React, { useEffect, useState } from 'react'
import { DRAWING_LABELS } from './useReplayDrawings.js'

function DrawingRow({ record, drawings }) {
  const [label, setLabel] = useState(record.payload.label || '')
  const typeLabel = DRAWING_LABELS[record.payload.annotation_type] || record.payload.annotation_type
  const busy = Boolean(drawings.busy)
  return <li className="replay-object" data-testid="replay-object" data-record-id={record.record_id} data-type={record.payload.annotation_type}>
    <div className="replay-object-heading"><strong>{typeLabel}</strong><span>{record.local ? 'Nháp local' : `Đã lưu · r${record.revision}`}</span></div>
    <label>Nhãn<input aria-label={`Nhãn ${typeLabel}`} maxLength={256} value={label} disabled={record.locked || busy} onChange={event => setLabel(event.target.value)} /></label>
    <small>{record.payload.anchors.map(anchor => `${new Date(anchor.timestamp * 1000).toISOString().slice(11, 19)} UTC · ${Number(anchor.price).toFixed(5)}`).join(' → ')}</small>
    <div className="replay-object-actions">
      <button type="button" onClick={() => drawings.toggleHidden(record.record_id)} aria-pressed={!record.hidden}>Hiển thị</button>
      <button type="button" onClick={() => drawings.toggleLocked(record.record_id)} aria-pressed={record.locked}>Khóa</button>
      {label !== (record.payload.label || '') && <button type="button" disabled={record.locked || busy} onClick={() => drawings.rename(record, label)}>Đổi nhãn</button>}
      {record.local && record.payload.annotation_type !== 'measure' && <button type="button" disabled={record.locked || busy} onClick={() => drawings.save(record)}>Lưu đối tượng</button>}
      <button type="button" disabled={record.locked || busy} onClick={() => drawings.remove(record)}>{record.local ? 'Bỏ nháp' : 'Xóa đối tượng'}</button>
    </div>
  </li>
}

export default function ReplayObjects({ drawings }) {
  useEffect(() => {
    const controller = new AbortController()
    const refresh = () => { if (!drawings.busy) drawings.reload(controller.signal) }
    window.addEventListener('focus', refresh)
    window.addEventListener('online', refresh)
    return () => { controller.abort(); window.removeEventListener('focus', refresh); window.removeEventListener('online', refresh) }
  }, [drawings.reload, drawings.busy])
  return <section className="replay-objects" aria-label="Đối tượng chart">
    <h2>Đối tượng chart</h2>
    <p>Nháp có nét đứt; đối tượng đã lưu dùng nét liền. Ẩn/khóa lưu trên máy này. Khóa ngăn đổi nhãn và xóa.</p>
    {drawings.saved.status === 'loading' && <p role="status">Đang tải đối tượng…</p>}
    {(drawings.error || drawings.saved.error) && <p role="alert">{drawings.error || drawings.saved.error}</p>}
    {!drawings.objects.length && drawings.saved.status !== 'loading' && <p>Chưa có đối tượng thuộc phiên và cutoff này.</p>}
    <ul>{drawings.objects.map(record => <DrawingRow key={`${record.record_id}:${record.revision || 0}`} record={record} drawings={drawings} />)}</ul>
  </section>
}
