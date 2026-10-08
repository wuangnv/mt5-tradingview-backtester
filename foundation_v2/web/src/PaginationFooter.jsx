import { useTestingLocale } from './testingLocale.jsx'
import FxSelect from './FxSelect.jsx'
import TestingIcon from './TestingIcon.jsx'
import { paginationWindow } from './paginationModel.js'
import './pagination-footer.css'

export default function PaginationFooter({ label, page, pages, onPageChange, pageSize, onPageSizeChange, sizes = [10, 25, 50, 100], pending = false, unknown = false, meta, className = '', ...navProps }) {
  const { t } = useTestingLocale()
  const current = Math.max(1, Math.min(page, pages))
  const blocked = pending || unknown
  const changePage = next => { if (!blocked && next !== current && next >= 1 && next <= pages) onPageChange(next) }
  return <nav {...navProps} className={`wm-pagination ${className}`} aria-label={t(label)} aria-busy={pending || undefined}>
    {meta && <span className="wm-pagination-meta">{meta}</span>}
    <div className="wm-pagination-controls">
      <div className="wm-pagination-pages">
        <button type="button" className="wm-pagination-button wm-pagination-boundary" aria-label={t('Trang đầu')} disabled={blocked || current === 1} onClick={() => changePage(1)}><TestingIcon kind="chevrons-left" size={16} /></button>
        <button type="button" className="wm-pagination-button" aria-label={t('Trang trước')} disabled={blocked || current === 1} onClick={() => changePage(current - 1)}><TestingIcon kind="chevron-left" size={16} /></button>
        {paginationWindow(current, pages).map((value, index) => typeof value === 'number'
          ? <button key={value} type="button" className={`wm-pagination-button wm-pagination-number ${value === current ? 'is-current' : ''}`} aria-label={t('Trang {page}', { page: value })} aria-current={value === current ? 'page' : undefined} disabled={blocked} onClick={() => changePage(value)}>{value}</button>
          : <span key={`gap-${index}`} className="wm-pagination-gap" aria-hidden="true">…</span>)}
        <button type="button" className="wm-pagination-button" aria-label={t('Trang sau')} disabled={blocked || current === pages} onClick={() => changePage(current + 1)}><TestingIcon kind="chevron-right" size={16} /></button>
        <button type="button" className="wm-pagination-button wm-pagination-boundary" aria-label={t('Trang cuối')} disabled={blocked || current === pages} onClick={() => changePage(pages)}><TestingIcon kind="chevrons-right" size={16} /></button>
      </div>
      {onPageSizeChange && <FxSelect className="wm-pagination-size" disabled={pending} label="Số dòng mỗi trang" value={pageSize} triggerContent={String(pageSize)} onChange={value => onPageSizeChange(Number(value))} options={sizes.map(value => ({ value, label: String(value) }))} />}
    </div>
  </nav>
}
