import { useTestingLocale } from './testingLocale.jsx'

export default function DataLibraryProgress({ job, onClick, fmt }) {
  const { t } = useTestingLocale()
  const progress = Math.max(0,Math.min(100,100 * (job.completed_days || 0) / Math.max(1,job.total_days || 1)))
  const bytes = Math.max(0,job.transferred_bytes || 0)
  const amount = bytes >= 1024 ** 2 ? `${fmt(bytes / 1024 ** 2,'',1)} MiB` : `${fmt(bytes / 1024,'',1)} KiB`
  const speed = job.status === 'running' && job.stage !== 'processing' && Number.isFinite(job.bytes_per_second) ? `${fmt(job.bytes_per_second / 1024 ** 2,'',2)} MiB/s` : '—'
  const label = job.status === 'queued' ? 'Đang chờ tải' : job.status === 'paused' ? 'Tạm dừng' : job.status === 'failed' ? 'Tải thất bại' : job.stage === 'processing' ? 'Đang lưu dữ liệu…' : 'Đang tải'
  return <button type="button" className="data-library-progress" aria-label={t('Tiến độ tải {asset}',{asset:job.instrument_id})} onClick={onClick} title={`${t(label)} · ${job.completed_days || 0} / ${job.total_days || 0} ${t('ngày')}`}>
    <span className="data-library-progress-fill" style={{width:`${progress}%`}} aria-hidden="true" />
    <span className="data-library-progress-label">{['queued','paused','failed'].includes(job.status) || job.stage === 'processing' ? t(label) : `${amount} / —`}</span>
    <span className="data-library-progress-rate">{speed} · {fmt(progress,'',0)}%</span>
  </button>
}
