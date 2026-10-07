import { useTestingLocale } from './testingLocale.jsx'

const rows = [
  ['s'], ['2h','2v'], ['3h','3v','3s','3r','2-1','1-2'],
  ['4','4v','4h','4s','4s-l','1-3','3-1','2-2-l','2-2-r','2-2'],
  ['1-4','5h','5v','5s','5s-l','2-3','3-2','4-1','2-3-l','2-3-r'],
  ['6','6h','6v','6c','2-4','4-2'], ['4-3','7h','7s'], ['8','8c','8h','8v'],
]
function LayoutGlyph({ count, type }) {
  const cols = count === 1 ? 1 : type.endsWith('v') ? count : type.endsWith('h') ? 1 : count <= 3 ? 2 : 3
  const lines = []
  for (let i = 1; i < cols; i++) lines.push(<path key={`v${i}`} d={`M${2+20*i/cols} 3V21`} />)
  const nrows = Math.ceil(count / cols)
  for (let i = 1; i < nrows; i++) lines.push(<path key={`h${i}`} d={`M2 ${3+18*i/nrows}H22`} />)
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden="true"><path d="M2 3H22V21H2Z" />{lines}</svg>
}
export default function LegacyLayoutMenu({ onClose }) {
  const { t } = useTestingLocale()
  return <><div className="legacy-layout-grid" role="menu" aria-label={t('Bố cục chart')}>
    {rows.map((types, index) => <div className="legacy-layout-row" key={index}><span>{index+1}</span><div>{types.map(type => <button key={type} type="button" role="menuitemradio" aria-label={`${index+1} ${t('biểu đồ')} · ${type}`} aria-checked={type === 's'} disabled={type !== 's'} title={type === 's' ? t('Một biểu đồ') : t('Chưa hỗ trợ nhiều chart trong một layout')} onClick={onClose}><LayoutGlyph count={index+1} type={type} /></button>)}</div></div>)}
    </div><div className="legacy-layout-sync"><strong>{t('Đồng bộ trong layout')}</strong>{['Mã giao dịch','Khung thời gian','Crosshair','Thời gian','Khoảng ngày'].map(label => <label key={label}><span>{t(label)}</span><input type="checkbox" role="switch" aria-label={t(label)} checked={label === 'Crosshair'} disabled readOnly /></label>)}</div><p className="legacy-menu-note">{t('Hiện hỗ trợ một chart; bố cục nhiều chart chưa khả dụng.')}</p></>
}
