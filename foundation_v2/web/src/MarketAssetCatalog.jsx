import React, { useEffect, useState } from 'react'
import { readJson, workspaceHeaders, formatUtc } from './researchDataApi.js'
import { buildWorkspaceHref } from './workspaceContext.js'
import './market-sync.css'

const labels = { ready: 'Đã tải', queued: 'Đang chờ', syncing: 'Đang tải', error: 'Cập nhật lỗi', not_downloaded: 'Chưa tải' }

export default function MarketAssetCatalog({ workspace, query, showHeading = true }) {
  const [catalog, setState] = useState({ workspace, status: 'loading', items: [] })
  const state = catalog.workspace === workspace ? catalog : { status: 'loading', items: [] }
  const [search, setSearch] = useState(''), [group, setGroup] = useState('all')
  const [all, setAll] = useState(false), [pending, setPending] = useState(false), [error, setError] = useState('')
  const [fromDate, setFromDate] = useState('')
  useEffect(() => {
    const controller = new AbortController()
    setState({ workspace, status: 'loading', items: [] }); setError('')
    let refreshing = false
    const refresh = async () => {
      if (refreshing) return
      refreshing = true
      try {
        const response = await fetch('/api/v2/data/market-assets', { headers: workspaceHeaders(workspace), signal: controller.signal })
        const payload = await readJson(response)
        if (!controller.signal.aborted) { setState({ ...payload, workspace }); setError('') }
      } catch (error) {
        if (!controller.signal.aborted) {
          setError('Không đọc được kho assets; trạng thái tải có thể đã cũ.')
          if (error.status === 403) setState({ workspace, status: 'unavailable', items: [] })
        }
      } finally { refreshing = false }
    }
    refresh()
    const timer = setInterval(refresh, 5000)
    return () => { controller.abort(); clearInterval(timer) }
  }, [workspace])
  const update = async symbol => {
    setPending(true); setError('')
    try {
      const response = await fetch('/api/v2/data/market-assets/update', {
        method: 'POST', headers: workspaceHeaders(workspace, { 'Content-Type': 'application/json' }),
        body: JSON.stringify({ symbol, from_date: fromDate || null }),
      })
      setState({ ...await readJson(response), workspace })
    } catch (error) { setError(`Không cập nhật được: ${error.message}`) }
    finally { setPending(false) }
  }
  const items = state.items || []
  const visible = items.filter(item => (all || item.enabled) && (group === 'all' || item.metadata.group === group)
    && `${item.symbol} ${item.metadata.description}`.toLowerCase().includes(search.toLowerCase()))
  const groups = [...new Set(items.map(item => item.metadata.group))].sort()
  return <section className="market-assets" aria-label="Kho dữ liệu Testing" data-testid="market-assets">
    <div className="market-sync-heading"><div>{showHeading && <h2>Kho Testing</h2>}<p>{state.source || 'Nguồn chưa kết nối'} · M1 · Tự tải bù mỗi ngày khi MT5 kết nối. Replay dùng dữ liệu đã lưu.</p></div>
      <button type="button" className="fxr-button fxr-button-secondary" onClick={() => update(null)} disabled={pending || !items.length || Boolean(state.queued) || Boolean(state.running)}>Cập nhật dữ liệu</button></div>
    <div className="market-sync-facts"><span>{items.filter(item => item.dataset_id).length} assets đã tải</span><span>{state.queued || 0} đang chờ</span>{state.running && <span role="status">Đang tải {state.running}</span>}</div>
    {state.connection_error && <p role="status">MT5 chưa sẵn sàng ({state.connection_error}). Kho đã tải vẫn dùng được.</p>}
    {state.tick_sync_error && <p role="status">Tick đang chờ tải bù: {state.tick_sync_error}.</p>}
    {state.status === 'loading' && <p role="status">Đang đọc kho Testing…</p>}
    {state.status === 'unavailable' && <p>Chưa cấu hình nguồn lịch sử tự cập nhật.</p>}
    {error && <p role="alert">{error}</p>}
    <div className="market-sync-filters">
      <input type="search" aria-label="Tìm asset" placeholder="Tìm asset…" value={search} onChange={event => setSearch(event.target.value)} />
      <select aria-label="Nhóm asset" value={group} onChange={event => setGroup(event.target.value)}><option value="all">Tất cả nhóm</option>{groups.map(item => <option key={item}>{item}</option>)}</select>
      <label>Tải từ ngày<input type="date" aria-label="Ngày bắt đầu tải lịch sử" value={fromDate} onChange={event => setFromDate(event.target.value)} /></label>
      <label><input type="checkbox" checked={all} onChange={event => setAll(event.target.checked)} />Hiện toàn bộ danh mục broker</label>
    </div>
    {items.length > 0 && <div className="market-sync-table" tabIndex={0} role="region" aria-label="Danh mục lịch sử broker"><table><thead><tr><th>Asset / sản phẩm</th><th>Nguồn</th><th>Lịch sử UTC</th><th>Trạng thái</th><th><span className="sr-only">Thao tác</span></th></tr></thead><tbody>{visible.map(item => <tr key={item.symbol}>
      <td><strong>{item.symbol}</strong><small>{item.metadata.group}</small></td><td>{state.source}</td>
      <td>{item.dataset_id ? <>{formatUtc(item.first_timestamp)}<small>đến {formatUtc(item.last_timestamp)} · {item.row_count?.toLocaleString('vi-VN')} nến</small></> : 'Chưa có dữ liệu'}{item.ticks && <small>Tick Bid/Ask: {item.ticks.row_count.toLocaleString('vi-VN')} · {(item.ticks.bytes / 1048576).toFixed(1)} MiB nén · {item.ticks.unavailable_days} ngày broker trả rỗng</small>}</td>
      <td>{labels[item.status] || item.status}{item.dataset_id && <small>{item.quality === 'review' ? 'Có khoảng gián đoạn cần kiểm tra' : 'Kiểm tra cơ bản; phí lịch sử chưa xác minh'}</small>}{item.error && <small>{item.error}</small>}</td>
      <td>{item.dataset_id && <a className="fxr-button fxr-button-secondary" href={buildWorkspaceHref('replay', workspace, query, { area: 'testing', section: 'sessions', session: null, cursor: null, cutoff: null, dataset: item.dataset_id, select: null, fresh: '1', surface: 'workspace' })}>Luyện tập</a>}
        {item.ticks?.start_index != null && <a className="fxr-button fxr-button-secondary" href={buildWorkspaceHref('replay', workspace, query, { area: 'testing', section: 'sessions', session: null, cursor: null, cutoff: null, dataset: item.dataset_id, start: item.ticks.start_index, select: null, fresh: '1', surface: 'workspace' })}>Luyện tick</a>}
        <button type="button" className="fxr-button fxr-button-secondary" disabled={pending || ['queued', 'syncing'].includes(item.status)} onClick={() => update(item.symbol)}>{item.dataset_id ? 'Tải bổ sung' : 'Tải lịch sử'}</button></td>
    </tr>)}</tbody></table>{!visible.length && <p>Không có asset phù hợp bộ lọc.</p>}</div>}
    <p className="market-sync-note">Mặc định tải {state.seed_days || 90} ngày; có thể chọn ngày xa hơn trong 5 năm, tùy lịch sử broker. Chỉ số, cổ phiếu và crypto ở nguồn này là CFD. Session cũ giữ nguyên dataset. Dukascopy chưa bật do quyền lưu kho chưa rõ; futures CME chưa cấu hình.</p>
  </section>
}
