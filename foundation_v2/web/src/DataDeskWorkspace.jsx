import React, { useEffect, useMemo, useState } from 'react'
import {
  datasetRange,
  fetchDatasets,
  fetchProviders,
  formatNumber,
  formatUtc,
  holdoutLabel,
  qualityLabel,
  datasetWarnings,
} from './researchDataApi.js'
import './research-data.css'

function queryHref(view, workspace, params = {}) {
  const next = new URLSearchParams({ view, workspace })
  Object.entries(params).forEach(([key, value]) => {
    if (value !== null && value !== undefined && value !== '') next.set(key, String(value))
  })
  return `/?${next.toString()}`
}

function QualityBadge({ dataset }) {
  const quality = qualityLabel(dataset)
  const tone = quality === 'Đã xác minh' ? 'is-good' : quality === 'Fixture / QA only' ? 'is-muted' : 'is-warn'
  return <span className={`rd-badge ${tone}`}>{quality}</span>
}

function DatasetDetails({ dataset, workspace }) {
  if (!dataset) {
    return (
      <div className="rd-empty-callout" data-testid="data-desk-empty-selection">
        Chọn một dataset để xem provenance, range và các cảnh báo trước khi mở Research.
      </div>
    )
  }
  const range = datasetRange(dataset)
  const warnings = datasetWarnings(dataset)
  const source = dataset.source || {}
  return (
    <section className="rd-detail" aria-label="Chi tiết dataset" data-testid="dataset-details">
      <div className="rd-panel-head">
        <div>
          <h2>Provenance và QA</h2>
          <p>Đây là bằng chứng metadata hiện có; không suy ra dữ liệu thiếu thành số 0.</p>
        </div>
        <a className="rd-context-link" href={queryHref('research', workspace, { dataset: dataset.dataset_id })}>Mở trong Research →</a>
      </div>
      <dl className="rd-detail-grid">
        <div><dt>Dataset</dt><dd><strong>{dataset.dataset_id}</strong></dd></div>
        <div><dt>Provider</dt><dd>{dataset.provider_id || source.provider || 'Chưa xác định'}</dd></div>
        <div><dt>Instrument / TF</dt><dd>{dataset.instrument_id || 'N/A'} · {dataset.timeframe || 'N/A'}</dd></div>
        <div><dt>Số nến</dt><dd>{formatNumber(dataset.row_count, 0)}</dd></div>
        <div><dt>Range UTC</dt><dd>{formatUtc(range.start)} → {formatUtc(range.end)}</dd></div>
        <div><dt>License</dt><dd>{source.license_use || 'Chưa xác minh'}</dd></div>
        <div><dt>Quality</dt><dd><QualityBadge dataset={dataset} /></dd></div>
        <div><dt>Holdout</dt><dd><span className={`rd-badge ${dataset.holdout_access ? 'is-good' : 'is-warn'}`}>{holdoutLabel(dataset)}</span></dd></div>
        <div><dt>Artifact hash</dt><dd><code>{dataset.artifact_sha256 || 'Chưa có hash'}</code></dd></div>
        <div><dt>Retrieved</dt><dd>{formatUtc(source.retrieved_at_utc)}</dd></div>
        <div><dt>Transform</dt><dd>{dataset.transform_version || 'Chưa xác định'}</dd></div>
        <div><dt>Instrument spec</dt><dd>{dataset.instrument_spec ? 'Có' : 'Chưa có'}</dd></div>
      </dl>
      {warnings.length > 0 && (
        <div className="rd-warning-block" role="note" data-testid="dataset-warnings">
          <strong>Cần biết trước khi chạy</strong>
          <ul>{warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul>
        </div>
      )}
    </section>
  )
}

export default function DataDeskWorkspace({ workspace = 'tenant-a', query = new URLSearchParams(window.location.search) }) {
  const requestedDataset = query.get('dataset') || ''
  const [state, setState] = useState({ status: 'loading', datasets: [], providers: [], error: null })
  const [selectedId, setSelectedId] = useState(requestedDataset)
  const [providerFilter, setProviderFilter] = useState('all')

  useEffect(() => {
    const controller = new AbortController()
    setState((current) => ({ ...current, status: 'loading', error: null }))
    Promise.all([fetchDatasets(workspace, controller.signal), fetchProviders(workspace, controller.signal)])
      .then(([datasets, providers]) => {
        setState({ status: 'ready', datasets, providers, error: null })
        setSelectedId((current) => current || datasets[0]?.dataset_id || '')
      })
      .catch((error) => {
        if (error.name !== 'AbortError') setState({ status: 'error', datasets: [], providers: [], error: String(error.message || error) })
      })
    return () => controller.abort()
  }, [workspace])

  const providers = state.providers
  const filteredDatasets = useMemo(() => state.datasets.filter((item) => providerFilter === 'all' || item.provider_id === providerFilter), [providerFilter, state.datasets])
  const selected = state.datasets.find((item) => item.dataset_id === selectedId) || filteredDatasets[0] || null
  const holdoutAccess = state.datasets.some((item) => item.holdout_access === true)

  return (
    <main className="rd-shell" data-testid="data-desk-root">
      <header className="rd-topbar">
        <div>
          <div className="eyebrow">MT5 TRADING WORKSPACE / DATA DESK</div>
          <h1>Data Desk</h1>
          <p>Chọn dữ liệu có provenance rõ ràng trước khi replay hoặc chạy research.</p>
        </div>
        <div className="rd-actions">
          <a className="rd-context-link" href={queryHref('research', workspace, selected ? { dataset: selected.dataset_id } : {})}>Research</a>
          <a className="rd-context-link" href={queryHref('replay', workspace, selected ? { dataset: selected.dataset_id } : {})}>Replay</a>
          <div className="rd-safety"><strong>RESEARCH / SIMULATION</strong><span>Broker locked · holdout không mở</span></div>
        </div>
      </header>
      <div className="rd-statusbar" aria-label="Trạng thái Data Desk">
        <span>Workspace <strong>{workspace}</strong></span>
        <span>Datasets <strong>{state.datasets.length}</strong></span>
        <span>Providers <strong>{providers.length}</strong></span>
        <span className={holdoutAccess ? 'rd-status is-ready' : 'rd-status'}>{holdoutAccess ? 'Holdout được cấp' : 'Holdout khóa'}</span>
      </div>

      {state.status === 'loading' && <div className="rd-message" role="status">Đang đọc catalog và capability provider…</div>}
      {state.status === 'error' && <div className="rd-message is-error" role="alert">Không đọc được Data Desk: {state.error}</div>}

      {state.status === 'ready' && (
        <div className="rd-main-grid">
          <section className="rd-panel" aria-label="Dataset catalog">
            <div className="rd-panel-head">
              <div><h2>Dataset catalog</h2><p>Chỉ hiển thị dữ liệu thuộc workspace hiện tại.</p></div>
              <label className="rd-field" style={{ minWidth: 150 }}>
                <span>Provider</span>
                <select aria-label="Lọc provider" value={providerFilter} onChange={(event) => setProviderFilter(event.target.value)}>
                  <option value="all">Tất cả</option>
                  {providers.map((provider) => <option key={provider.provider_id} value={provider.provider_id}>{provider.provider_id}</option>)}
                </select>
              </label>
            </div>
            {filteredDatasets.length === 0 ? (
              <div className="rd-message is-empty" data-testid="data-desk-empty">Workspace chưa có dataset nào phù hợp. Không thể bắt đầu research từ dữ liệu trống.</div>
            ) : (
              <div className="rd-table-wrap">
                <table className="rd-table" data-testid="data-desk-dataset-table">
                  <thead><tr><th>Dataset</th><th>Instrument</th><th>Range</th><th>QA</th><th>Holdout</th><th>Rows</th></tr></thead>
                  <tbody>
                    {filteredDatasets.map((dataset) => {
                      const range = datasetRange(dataset)
                      const active = dataset.dataset_id === selected?.dataset_id
                      return (
                        <tr key={dataset.dataset_id} className={active ? 'is-selected' : ''}>
                          <td><button type="button" data-testid={`dataset-row-${dataset.dataset_id}`} onClick={() => setSelectedId(dataset.dataset_id)}><strong>{dataset.dataset_id}</strong><small>{dataset.provider_id || dataset.source?.provider || 'provider unknown'}</small></button></td>
                          <td>{dataset.instrument_id || 'N/A'}<small>{dataset.timeframe || 'TF unknown'}</small></td>
                          <td>{formatUtc(range.start)}<small>→ {formatUtc(range.end)}</small></td>
                          <td><QualityBadge dataset={dataset} /></td>
                          <td><span className={`rd-badge ${dataset.holdout_access ? 'is-good' : 'is-warn'}`}>{dataset.holdout_access ? 'Mở' : 'Khóa'}</span></td>
                          <td>{formatNumber(dataset.row_count, 0)}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
            <DatasetDetails dataset={selected} workspace={workspace} />
          </section>

          <aside className="rd-panel" aria-label="Provider capabilities">
            <div className="rd-panel-head"><div><h2>Provider capabilities</h2><p>Capability khai báo không đồng nghĩa đã có quyền đọc history hoặc holdout.</p></div></div>
            {providers.length === 0 ? <div className="rd-message is-empty">Chưa có provider capability nào.</div> : (
              <div className="rd-provider-list">
                {providers.map((provider) => {
                  const capabilities = provider.capabilities || {}
                  const available = Object.entries(capabilities).filter(([, value]) => value === true).map(([key]) => key)
                  const blocked = Object.entries(capabilities).filter(([, value]) => value !== true).map(([key]) => key)
                  return (
                    <div className="rd-provider-row" key={provider.provider_id}>
                      <div><strong>{provider.provider_id}</strong><small>{available.length ? `Có: ${available.join(', ')}` : 'Không có capability đọc được khai báo'}</small></div>
                      <div className={`rd-capability ${blocked.length ? 'is-blocked' : ''}`}>{blocked.length ? `Khóa: ${blocked.join(', ')}` : 'Đã khai báo'}</div>
                    </div>
                  )
                })}
              </div>
            )}
            <div className="rd-warning-block"><strong>Quy tắc an toàn</strong><ul><li>Data Desk chỉ đọc metadata trong slice này.</li><li>Không tự import dữ liệu mới hoặc mở holdout.</li><li>Dataset chưa verified vẫn phải gắn nhãn trước khi dùng.</li></ul></div>
          </aside>
        </div>
      )}
    </main>
  )
}
