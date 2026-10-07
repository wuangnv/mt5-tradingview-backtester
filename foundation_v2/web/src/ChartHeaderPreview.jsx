import { useState } from 'react'
import { useTestingLocale } from './testingLocale.jsx'

export default function ChartHeaderPreview({ tool, symbol, price }) {
  const { t, language } = useTestingLocale()
  const [panes, setPanes] = useState(1)
  return <section className="chart-header-preview" data-testid={`chart-preview-${tool}`}>
    <p className="chart-preview-status">{t('Giao diện mẫu · chưa kích hoạt chức năng')}</p>
    {tool === 'compare' && <>
      <label>{t('Tìm mã giao dịch')}<input type="search" placeholder={t('Nhập mã giao dịch')} /></label>
      <p>{t('Chart hiện tại')}: <strong>{symbol}</strong></p>
      <button type="button" disabled>{t('Thêm mã so sánh')}</button>
    </>}
    {tool === 'layout' && <>
      <label>{t('Tên layout')}<input defaultValue="New Layout" /></label>
      <fieldset><legend>{t('Bố cục chart')}</legend><div className="chart-layout-choices">{[1, 2, 4].map(count => <button key={count} type="button" aria-pressed={panes === count} onClick={() => setPanes(count)}><span className={`chart-layout-mini panes-${count}`} aria-hidden="true">{Array.from({ length: count }, (_, i) => <i key={i} />)}</span>{count} {language === 'en' && count > 1 ? 'charts' : 'chart'}</button>)}</div></fieldset>
      <button type="button" disabled>{t('Tạo layout')}</button>
      <p>{t('Lưu chart vẫn lưu bố cục hiện tại trên trình duyệt này.')}</p>
    </>}
    {tool === 'alerts' && <>
      <p>{t('Mã giao dịch')}: <strong>{symbol}</strong></p>
      <label>{t('Điều kiện')}<select defaultValue="cross"><option value="cross">{t('Giá cắt qua')}</option><option value="above">{t('Giá lớn hơn')}</option><option value="below">{t('Giá nhỏ hơn')}</option></select></label>
      <label>{t('Mức giá')}<input type="number" step="any" defaultValue={price ?? ''} /></label>
      <label>{t('Thông báo')}<input placeholder={t('Nội dung cảnh báo')} /></label>
      <button type="button" disabled>{t('Tạo cảnh báo')}</button>
    </>}
    {tool === 'editor' && <>
      <div className="chart-editor-heading"><span>Pine Script</span><button type="button" disabled>{t('Thêm vào chart')}</button></div>
      <textarea aria-label={t('Mã Pine Script')} spellCheck="false" placeholder="// Pine Script" />
      <p>{t('Chưa hỗ trợ biên dịch hoặc chạy Pine Script.')}</p>
    </>}
  </section>
}
