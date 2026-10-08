import { useTestingLocale } from './testingLocale.jsx'
import { downloadEtaDuration } from './dataLibraryDownloadMetrics.js'
import TestingIcon from './TestingIcon.jsx'

export default function DataLibraryProgress({ job, onClick, fmt, retrySeconds = 0, now = Date.now() }) {
  const { t } = useTestingLocale()
  const phaseProgress = job.progress_scope === 'phase'
  const unknownProgress = phaseProgress && job.progress_percent == null
  const progress = Math.max(0,Math.min(100,job.progress_percent ?? (phaseProgress ? 0 : 100 * (job.completed_days || 0) / Math.max(1,job.total_days || 1))))
  const percent = unknownProgress ? '—' : `${fmt(progress,'',0)}%`
  const active = ['queued','running','pausing'].includes(job.status)
  const started = Date.parse(job.created_at_utc)
  const seconds = Math.max(0,Math.floor((now-started)/1000))
  const elapsed = Number.isFinite(seconds) ? [Math.floor(seconds/3600),Math.floor(seconds/60)%60,seconds%60].map(value=>String(value).padStart(2,'0')).join(':') : null
  const bytes = Math.max(0,job.transferred_bytes || 0)
  const amount = job.transferred_bytes === null ? '—' : bytes >= 1024 ** 3 ? `${fmt(bytes / 1024 ** 3,'',1)} GiB` : bytes >= 1024 ** 2 ? `${fmt(bytes / 1024 ** 2,'',1)} MiB` : `${fmt(bytes / 1024,'',1)} KiB`
  const speed = job.status === 'running' && job.stage !== 'processing' && job.transferred_bytes !== null && Number.isFinite(job.bytes_per_second) ? `${fmt(job.bytes_per_second / 1024 ** 2,'',2)} MiB/s` : null
  const label = job.status === 'queued' ? 'Đang chờ tải' : job.status === 'pausing' ? 'Đang tạm dừng…' : job.status === 'paused' ? 'Đã tạm dừng' : job.status === 'failed' ? 'Tải thất bại' : job.stage === 'processing' ? 'Đang lưu dữ liệu…' : 'Đang tải'
  const duration = phaseProgress ? null : downloadEtaDuration(job.estimated_seconds_remaining)
  const waiting = retrySeconds > 0
  const countdown = `${String(Math.floor(retrySeconds / 60)).padStart(2,'0')}:${String(retrySeconds % 60).padStart(2,'0')}`
  const eta = waiting ? countdown : duration ? `≈ ${fmt(duration.count,'',0)} ${t(duration.unit)}` : '—'
  const challengeMessage = job.error === 'source_access_challenge' ? t('Dukascopy yêu cầu xác minh truy cập. Bộ tải tự động chưa thể tiếp tục; dữ liệu đã tải được giữ lại.') : null
  const title = phaseProgress ? `${t(label)} · ${percent}. ${t('Tiến độ của bước hiện tại trong QDM; chưa phải tổng tiến độ. Dung lượng, tốc độ và thời gian còn lại chưa xác định.')}` : `${t(label)} · ${job.completed_days || 0} / ${job.total_days || 0} ${t('ngày')}. ${t('Ước tính theo tốc độ tải các ngày gần đây; chưa gồm thời gian lưu dữ liệu.')}`
  return <button type="button" className="data-library-progress" aria-label={`${t('Tiến độ tải {asset}',{asset:job.instrument_id})}: ${t(label)}, ${percent}, ${amount}${speed ? `, ${speed}` : ''}, ${t('Thời gian còn lại')}: ${eta}${challengeMessage ? `, ${challengeMessage}` : ''}`} onClick={onClick} title={challengeMessage || title}>
    <span className="data-library-progress-bar"><span className={`data-library-progress-track${unknownProgress && active ? ' is-indeterminate' : ''}`} role="progressbar" aria-label={t(label)} aria-valuemin={0} aria-valuemax={100} aria-valuenow={unknownProgress ? undefined : progress}><span className="data-library-progress-fill" style={unknownProgress && active ? undefined : {width:`${progress}%`}} /></span>{!unknownProgress && <span className="data-library-progress-percent">{percent}</span>}</span>
    {phaseProgress ? active && elapsed && <span className="data-library-progress-elapsed" title={t('Thời gian từ lúc bắt đầu')}><TestingIcon kind="clock" size={12} /><span>{elapsed}</span></span> : <span className="data-library-progress-meta"><span className="data-library-progress-transfer">{amount}{speed && <span>{speed}</span>}</span><span className="data-library-progress-eta" title={t(waiting ? job.error === 'source_rate_limited' ? 'Dukascopy đang giới hạn yêu cầu. Có thể tiếp tục sau thời gian chờ.' : 'Chưa hết thời gian chờ. Hãy thử lại sau.' : 'Thời gian còn lại')}>{eta}</span></span>}
  </button>
}
