import { useTestingLocale } from './testingLocale.jsx'
import { downloadEtaDuration } from './dataLibraryDownloadMetrics.js'

export default function DataLibraryProgress({ job, onClick, fmt, retrySeconds = 0 }) {
  const { t } = useTestingLocale()
  const progress = Math.max(0,Math.min(100,100 * (job.completed_days || 0) / Math.max(1,job.total_days || 1)))
  const bytes = Math.max(0,job.transferred_bytes || 0)
  const amount = bytes >= 1024 ** 3 ? `${fmt(bytes / 1024 ** 3,'',1)} GiB` : bytes >= 1024 ** 2 ? `${fmt(bytes / 1024 ** 2,'',1)} MiB` : `${fmt(bytes / 1024,'',1)} KiB`
  const speed = job.status === 'running' && job.stage !== 'processing' && Number.isFinite(job.bytes_per_second) ? `${fmt(job.bytes_per_second / 1024 ** 2,'',2)} MiB/s` : null
  const label = job.status === 'queued' ? 'Đang chờ tải' : job.status === 'pausing' ? 'Đang tạm dừng…' : job.status === 'paused' ? 'Đã tạm dừng' : job.status === 'failed' ? 'Tải thất bại' : job.stage === 'processing' ? 'Đang lưu dữ liệu…' : 'Đang tải'
  const duration = downloadEtaDuration(job.estimated_seconds_remaining)
  const waiting = retrySeconds > 0
  const countdown = `${String(Math.floor(retrySeconds / 60)).padStart(2,'0')}:${String(retrySeconds % 60).padStart(2,'0')}`
  const eta = waiting ? t('Chờ {time}', {time:countdown}) : duration ? `≈ ${fmt(duration.count,'',0)} ${t(duration.unit)}` : '—'
  return <button type="button" className="data-library-progress" aria-label={`${t('Tiến độ tải {asset}',{asset:job.instrument_id})}: ${t(label)}, ${fmt(progress,'',0)}%, ${amount}${speed ? `, ${speed}` : ''}, ${t('Thời gian còn lại')}: ${eta}`} onClick={onClick} title={`${t(label)} · ${job.completed_days || 0} / ${job.total_days || 0} ${t('ngày')}. ${t('Ước tính theo tốc độ tải các ngày gần đây; chưa gồm thời gian lưu dữ liệu.')}`}>
    {!['Đang tải','Đã tạm dừng'].includes(label) && <span className="data-library-progress-label">{t(label)}</span>}
    <span className="data-library-progress-bar"><span className="data-library-progress-track" aria-hidden="true"><span className="data-library-progress-fill" style={{width:`${progress}%`}} /></span><span className="data-library-progress-percent">{fmt(progress,'',0)}%</span></span>
    <span className="data-library-progress-meta"><span className="data-library-progress-transfer">{amount}{speed && <span>{speed}</span>}</span><span className="data-library-progress-eta" title={t(waiting ? job.error === 'source_rate_limited' ? 'Dukascopy đang giới hạn yêu cầu. Có thể tiếp tục sau thời gian chờ.' : 'Chưa hết thời gian chờ. Hãy thử lại sau.' : 'Thời gian còn lại')}>{eta}</span></span>
  </button>
}
