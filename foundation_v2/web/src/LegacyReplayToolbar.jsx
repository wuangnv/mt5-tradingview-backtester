import { useState } from 'react'
import { useTestingLocale } from './testingLocale.jsx'
import ChartFloatingToolbar from './ChartFloatingToolbar.jsx'
import LegacyPopover from './LegacyPopover.jsx'
import { intervalLabel } from './LegacyChartHeader.jsx'
import { REPLAY_INTERVALS, replayIntervalSteps } from './legacyReplayModel.js'
import './LegacyReplayToolbar.css'

const playbackLabel = value => String(value).endsWith('S') ? String(value).toLowerCase() : intervalLabel(value)

function PlaybackIcon({ kind }) {
  return <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" fill="currentColor">
    {kind === 'select' ? <><rect x="5" y="4" width="2" height="16" rx="1" /><path d="m16 5-7 7 7 7v-5h5v-4h-5z" /></> : kind === 'back' ? <><rect x="5" y="5" width="2" height="14" rx="1" /><path d="m18 5-10 7 10 7z" /></> : kind === 'pause' ? <><rect x="6" y="5" width="4" height="14" rx="1" /><rect x="14" y="5" width="4" height="14" rx="1" /></> : kind === 'play' ? <path d="M7 4v16l13-8z" /> : <><path d="m6 5 10 7-10 7z" /><rect x="17" y="5" width="2" height="14" rx="1" /></>}
  </svg>
}

export default function LegacyReplayToolbar({ workspace, theme, speed, onSpeed, interval, onInterval, datasetSeconds, sync, onSync, syncAvailable, busy, available, canBack, canForward, playing, onPlay, onBack, onForward, selecting, onSelect }) {
  const { t } = useTestingLocale(), [menu, setMenu] = useState(null)
  const intervals = REPLAY_INTERVALS.includes(interval) ? REPLAY_INTERVALS : [...REPLAY_INTERVALS, interval]
  const unsupported = replayIntervalSteps(interval, datasetSeconds) === null
  const unavailable = t('Khung replay này không phù hợp với dữ liệu hiện có.')
  return <ChartFloatingToolbar name="Replay" minimal className="legacy-replay-toolbar legacy-fx-playback" compactMinimumY={100} insetLeft={54} storageKey={`tw:chart:replay-toolbar:native-refined:${workspace}`} initialPosition={{ x: 850, y: 140 }}>
    <button type="button" className="legacy-replay-reset" aria-label={t('Chọn nến bắt đầu replay')} title={t('Chọn nến bắt đầu replay')} aria-pressed={selecting} onClick={onSelect} disabled={!available || busy || !canBack}><PlaybackIcon kind="select" /></button>
    <label className="legacy-speed-control"><span>{t('{speed}× mỗi giây', { speed })}</span><input type="range" className="legacy-speed-slider" aria-label={t('Điều chỉnh tốc độ replay')} aria-valuetext={`${speed}× / s`} min="0" max="15" step="1" value={Math.max(0, Math.min(15, Number(speed) - 1))} onChange={event => onSpeed(String(Number(event.target.value) + 1))} /></label>
    <button type="button" className="legacy-replay-previous" aria-label={t('Lùi một nến')} title={unsupported ? unavailable : `${t('Lùi một nến')} · ${playbackLabel(interval)}`} onClick={onBack} disabled={!available || busy || !canBack || unsupported}><PlaybackIcon kind="back" /></button>
    <button type="button" className="chart-play" data-testid="play-toggle" aria-label={playing ? t('Tạm dừng') : t('Phát replay')} title={unsupported ? unavailable : t('Phát / tạm dừng replay')} onClick={onPlay} disabled={!available || (!playing && (busy || !canForward || unsupported))}><PlaybackIcon kind={playing ? 'pause' : 'play'} /></button>
    <button type="button" className="legacy-replay-interval" aria-label={t('Khung thời gian replay')} title={unsupported ? unavailable : t('Khung thời gian replay')} aria-expanded={Boolean(menu)} onClick={event => setMenu(menu ? null : event.currentTarget)} disabled={busy || !available}>{playbackLabel(interval)}<svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><path d="m3 4.5 3 3 3-3" fill="none" stroke="currentColor" strokeWidth="1.5" /></svg></button>
    <button type="button" data-testid="step-1" aria-label={t('Tiến một nến')} title={unsupported ? unavailable : `${t('Tiến một nến')} · ${playbackLabel(interval)}`} aria-keyshortcuts="ArrowRight" onClick={onForward} disabled={!available || busy || !canForward || unsupported}><PlaybackIcon kind="next" /></button>
    <label className="legacy-sync-toggle" title={t('Đồng bộ khung replay với khung chart')}><input type="checkbox" role="switch" aria-label={t('Đồng bộ khung replay với khung chart')} checked={sync} disabled={busy || !syncAvailable} onChange={event => onSync(event.target.checked)} /><span /></label>
    {menu && <LegacyPopover anchor={menu} theme={theme} label={t('Khung thời gian replay')} onClose={() => setMenu(null)}><div className="legacy-replay-intervals">{intervals.map(value => { const disabled = replayIntervalSteps(value, datasetSeconds) === null; return <button key={value} type="button" aria-pressed={value === interval} disabled={disabled} title={disabled ? unavailable : undefined} onClick={() => { onInterval(value); setMenu(null); menu.focus() }}>{playbackLabel(value)}{value === interval && <span aria-hidden="true">✓</span>}</button> })}</div></LegacyPopover>}
  </ChartFloatingToolbar>
}
