import { displayTime } from './dateFormat.js'
import { useTestingLocale } from './testingLocale.jsx'
import { useEffect, useState } from 'react'
import { DRAWING_LABELS } from './useReplayDrawings.js'

function DrawingRow({ record, drawings }) {
  const { t } = useTestingLocale()

  const [label, setLabel] = useState(record.payload.label || '')
  const typeLabel = DRAWING_LABELS[record.payload.annotation_type] || record.payload.annotation_type
  const busy = Boolean(drawings.busy)
  return <li className="replay-object" data-testid="replay-object" data-record-id={record.record_id} data-type={record.payload.annotation_type}>
    <div className="replay-object-heading"><strong>{t(typeLabel)}</strong><span>{record.local ? t("Nháp local") : `Đã lưu · r${record.revision}`}</span></div>
    <label>{t("Nhãn")}<input aria-label={`Nhãn ${typeLabel}`} maxLength={256} value={label} disabled={record.locked || busy} onChange={event => setLabel(event.target.value)} /></label>
    <small>{record.payload.anchors.map(anchor => `${displayTime(anchor.timestamp, { seconds: true })} UTC · ${Number(anchor.price).toFixed(5)}`).join(' → ')}</small>
    <div className="replay-object-actions">
      <button type="button" onClick={() => drawings.toggleHidden(record.record_id)} aria-pressed={!record.hidden}>{t("Hiển thị")}</button>
      <button type="button" onClick={() => drawings.toggleLocked(record.record_id)} aria-pressed={record.locked}>{t("Khóa")}</button>
      {label !== (record.payload.label || '') && <button type="button" disabled={record.locked || busy} onClick={() => drawings.rename(record, label)}>{t("Đổi nhãn")}</button>}
      {record.local && record.payload.annotation_type !== 'measure' && <button type="button" disabled={record.locked || busy} onClick={() => drawings.save(record)}>{t("Lưu đối tượng")}</button>}
      <button type="button" disabled={record.locked || busy} onClick={() => drawings.remove(record)}>{record.local ? t("Bỏ nháp") : t("Xóa đối tượng")}</button>
    </div>
  </li>
}

export default function ReplayObjects({ drawings }) {
  const { t } = useTestingLocale()

  useEffect(() => {
    const controller = new AbortController()
    const refresh = () => { if (!drawings.busy) drawings.reload(controller.signal) }
    window.addEventListener('focus', refresh)
    window.addEventListener('online', refresh)
    return () => { controller.abort(); window.removeEventListener('focus', refresh); window.removeEventListener('online', refresh) }
  }, [drawings.reload, drawings.busy])
  return <section className="replay-objects" aria-label={t("Đối tượng chart")}>
    <h2>{t("Đối tượng chart")}</h2>
    <p>{t("Nháp có nét đứt; đối tượng đã lưu dùng nét liền. Ẩn/khóa lưu trên máy này. Khóa ngăn đổi nhãn và xóa.")}</p>
    {drawings.saved.status === 'loading' && <p role="status">{t("Đang tải đối tượng…")}</p>}
    {(drawings.error || drawings.saved.error) && <p role="alert">{drawings.error || drawings.saved.error}</p>}
    {!drawings.objects.length && drawings.saved.status !== 'loading' && <p>{t("Chưa có đối tượng thuộc phiên và cutoff này.")}</p>}
    <ul>{drawings.objects.map(record => <DrawingRow key={`${record.record_id}:${record.revision || 0}`} record={record} drawings={drawings} />)}</ul>
  </section>
}
