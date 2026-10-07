import { useState } from 'react'
import { useTestingLocale } from './testingLocale.jsx'

export default function ChartHeaderPreview({ tool, symbol, onOpenTool }) {
  const { t, language } = useTestingLocale()
  const [panes, setPanes] = useState(1)
  const [query, setQuery] = useState('')
  return <section className="chart-header-preview" data-testid={`chart-preview-${tool}`}>
    {tool !== 'search' && <p className="chart-preview-status">{t('Giao diện mẫu · chưa kích hoạt chức năng')}</p>}
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
    {tool === 'mentor' && <>
      <h2>AI Mentor</h2>
      <p>{t('Trao đổi về kế hoạch giao dịch, tâm lý và phiên replay hiện tại.')}</p>
      <textarea aria-label={t('Tin nhắn cho AI Mentor')} placeholder={t('Bạn muốn hỏi điều gì?')} />
      <button type="button" disabled>{t('Gửi tin nhắn')}</button>
      <p>{t('Chưa kết nối dịch vụ AI. Nội dung nhập tại đây không được gửi đi.')}</p>
    </>}
    {tool === 'scalper' && <>
      <h2>Scalper mode</h2>
      <p>{t('Giao diện đặt lệnh nhanh. Chưa kích hoạt chế độ giao dịch một chạm.')}</p>
      <button type="button" disabled>{t('Bật Scalper mode')}</button>
    </>}
    {tool === 'search' && <>
      <label>{t('Tìm công cụ chart')}<input type="search" value={query} onChange={event => setQuery(event.target.value)} /></label>
      {['New Layout', 'Editor', 'AI Mentor'].filter(label => label.toLowerCase().includes(query.toLowerCase())).map(label => <button key={label} type="button" onClick={() => onOpenTool(({ 'New Layout': 'layout', Editor: 'editor', 'AI Mentor': 'mentor' })[label])}>{label}</button>)}
    </>}
    {tool === 'editor' && <>
      <div className="chart-editor-heading"><span>Pine Script</span><button type="button" disabled>{t('Thêm vào chart')}</button></div>
      <textarea aria-label={t('Mã Pine Script')} spellCheck="false" placeholder="// Pine Script" />
      <p>{t('Chưa hỗ trợ biên dịch hoặc chạy Pine Script.')}</p>
    </>}
  </section>
}
