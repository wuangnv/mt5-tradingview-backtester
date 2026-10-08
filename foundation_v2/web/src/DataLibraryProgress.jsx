import { useTestingLocale } from './testingLocale.jsx'
import { downloadEtaDuration } from './dataLibraryDownloadMetrics.js'
import { formatDataSize } from './dataDisplay.js'

export default function DataLibraryProgress({ job, onClick, fmt, retrySeconds = 0 }) {
  const { t } = useTestingLocale()
  const phaseProgress = job.progress_scope === 'phase'
  const unknownProgress = phaseProgress && job.progress_percent == null
  const progress = Math.max(0,Math.min(100,job.progress_percent ?? (phaseProgress ? 0 : 100 * (job.completed_days || 0) / Math.max(1,job.total_days || 1))))
  const percent = unknownProgress ? '—' : `${fmt(progress,'',0)}%`
  const active = ['queued','running','pausing'].includes(job.status)
  const hasBytes = Number.isFinite(job.transferred_bytes) && job.transferred_bytes >= 0
  const hasTotal = Number.isFinite(job.total_bytes) && job.total_bytes > 0 && (!hasBytes || job.total_bytes >= job.transferred_bytes)
  const basis = hasTotal ? job.total_bytes : hasBytes ? job.transferred_bytes : 0
  const unit = basis >= 1000 ** 4 ? 'TB' : basis >= 1000 ** 3 ? 'GB' : 'MB'
  const scale = {TB:1000 ** 4,GB:1000 ** 3,MB:1000 ** 2}[unit]
  const downloaded = hasBytes ? formatDataSize(job.transferred_bytes,fmt,unit) : `— ${unit}`
  const amount = hasTotal ? `${hasBytes ? fmt(job.transferred_bytes/scale,'',1) : '—'}/${formatDataSize(job.total_bytes,fmt,unit)}` : downloaded
  const speed = job.status === 'running' && job.stage !== 'processing' && hasBytes && Number.isFinite(job.bytes_per_second) && job.bytes_per_second >= 0 ? `${fmt(job.bytes_per_second / 1000 ** 2,'',1)} MB/s` : '— MB/s'
  const label = job.status === 'queued' ? 'Đang chờ tải' : job.status === 'pausing' ? 'Đang tạm dừng…' : job.status === 'paused' ? 'Đã tạm dừng' : job.status === 'failed' ? 'Tải thất bại' : job.stage === 'processing' ? 'Đang lưu dữ liệu…' : 'Đang tải'
  const duration = job.stage === 'processing' ? null : downloadEtaDuration(job.estimated_seconds_remaining)
  const waiting = retrySeconds > 0
  const countdown = `${String(Math.floor(retrySeconds / 60)).padStart(2,'0')}:${String(retrySeconds % 60).padStart(2,'0')}`
  const eta = waiting ? countdown : duration ? `≈ ${fmt(duration.count,'',0)} ${t(duration.unit)}` : '—'
  const challengeMessage = job.error === 'source_access_challenge' ? t('Dukascopy yêu cầu xác minh truy cập. Bộ tải tự động chưa thể tiếp tục; dữ liệu đã tải được giữ lại.') : null
  const title = phaseProgress ? `${t(label)} · ${percent}. ${t('Tiến độ của bước hiện tại trong QDM; chưa phải tổng tiến độ. Dung lượng, tốc độ và thời gian còn lại chưa xác định.')}` : `${t(label)} · ${job.completed_days || 0} / ${job.total_days || 0} ${t('ngày')}. ${t('Ước tính theo tốc độ tải các ngày gần đây; chưa gồm thời gian lưu dữ liệu.')}`
  return <button type="button" className="data-library-progress" aria-label={`${t('Tiến độ tải {asset}',{asset:job.instrument_id})}: ${t(label)}, ${percent}, ${amount}, ${speed}, ${t('Thời gian còn lại')}: ${eta}${challengeMessage ? `, ${challengeMessage}` : ''}`} onClick={onClick} title={challengeMessage || title}>
    <span className="data-library-progress-bar"><span className={`data-library-progress-track${unknownProgress && active ? ' is-indeterminate' : ''}`} role="progressbar" aria-label={t(label)} aria-valuemin={0} aria-valuemax={100} aria-valuenow={unknownProgress ? undefined : progress}><span className="data-library-progress-fill" style={unknownProgress && active ? undefined : {width:`${progress}%`}} /></span></span>
    <span className="data-library-progress-meta"><span className="data-library-progress-transfer">{amount} @ {speed}</span><span className="data-library-progress-eta" title={t(waiting ? job.error === 'source_rate_limited' ? 'Dukascopy đang giới hạn yêu cầu. Có thể tiếp tục sau thời gian chờ.' : 'Chưa hết thời gian chờ. Hãy thử lại sau.' : 'Thời gian còn lại')}>{eta}</span></span>
  </button>
}
