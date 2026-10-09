import { useEffect, useRef, useState } from 'react'
import FxSelect from './FxSelect.jsx'
import TestingIcon from './TestingIcon.jsx'
import { Metric } from './FxAnalytics.jsx'
import TestingReadState, { TestingSkeleton } from './TestingReadState.jsx'
import { useTestingLocale } from './testingLocale.jsx'
import { useFxReplayContext } from './FxReplayShell.jsx'
import './component-reference.css'

const sizes = [
  ['Nút / ô nhập thường','control','Thon gọn trên máy tính'], ['Nút icon','icon-button','Icon nằm giữa vùng bấm'],
  ['Vùng bấm cảm ứng','touch','Dễ chạm, không thu nhỏ để ép vừa màn hình'], ['Tab trong cụm','tab','Chọn loại, không phải nút gửi'],
  ['Thanh điều hướng','nav','Gạch dưới cho trang đang mở'], ['Icon nhỏ','icon-small','Trong bảng, mũi tên, nút icon'],
  ['Icon thường','icon','Bên cạnh chữ'], ['Icon điều hướng','icon-nav','Sidebar / navigation'], ['Icon minh hoạ','icon-large','Lối tắt lớn'],
  ['Chữ phụ','font-meta','Nội dung cần đọc không nhỏ hơn 12px'], ['Chữ nút / bảng','font-control','Dòng chữ cao 20px'],
  ['Nội dung','font-body','Dòng cao khoảng 21px'], ['Tiêu đề cụm','font-section','Đậm vừa'], ['Tiêu đề dialog','font-dialog','Không lấn át nội dung'],
  ['Tiêu đề trang','font-page','Một tiêu đề chính'], ['Số tổng quan','font-value','Số và đơn vị cùng hàng'],
  ['Bo ô nhập','radius-field','Rõ hình ô'], ['Bo menu / dialog','radius-menu','Một lớp nổi'], ['Thanh tiến độ','progress','Chỉ hiện số thật'],
  ['Hàng bảng tối thiểu','row','Nhiều nội dung được cao hơn'], ['Lề trang máy tính','page-gutter','Tablet 24px, điện thoại 16px'],
  ['Lề dialog','dialog-gutter','Điện thoại 16px'], ['Khoảng icon và chữ','space-2','Cũng là khoảng giữa nút cùng nhóm'],
  ['Khoảng giữa cụm','space-6','Phân nhóm bằng khoảng trống'], ['Khoảng giữa khu vực','space-8','Không cần thêm card'],
  ['Dialog nhỏ','dialog-small','Xác nhận ngắn'], ['Dialog vừa','dialog-medium','Biểu mẫu đơn giản'], ['Dialog lớn','dialog-large','Tạo phiên'], ['Drawer','drawer','Chi tiết cạnh phải'],
]
const motions = [['Hover','hover','Đổi màu, không đổi kích thước'], ['Nhấn','press','Phản hồi ngay, không nảy'], ['Menu','menu','Mờ dần + dịch 4px'], ['Dialog','dialog','Mờ dần + dịch 4px'], ['Drawer','drawer','Trượt 4px từ bên phải'], ['Tiến độ','progress','Nối nhẹ hai số đo'], ['Loading','loading','Nhịp nhẹ, giữ bố cục']]
const colors = [['action','Cam','Tạo phiên, áp dụng'], ['primary','Xanh biển','Focus, tiến độ, thông tin'], ['positive','Xanh lá','Thành công, lãi'], ['negative','Đỏ chữ','Lỗi, lỗ'], ['danger-action','Đỏ nền','Xoá: chữ trắng'], ['warning','Vàng','Cảnh báo'], ['hover','Hover control','Khác nền dòng'], ['row-hover','Hover dòng','Nhẹ để đọc dữ liệu'], ['row-selected','Dòng đã chọn','Khác hover nút'], ['text','Chữ chính','Nội dung'], ['muted','Chữ phụ','Vẫn đủ tương phản'], ['border','Viền','Phân tách cấu trúc'], ['report-violet','Tím','Chuỗi biểu đồ bổ sung'], ['report-gold','Vàng biểu đồ','Chuỗi so sánh bổ sung']]
function SpecTable({ rows, tokens, prefix='--ds-' }) {
  return <div className="wm-reference-table-scroll"><table className="wm-reference-table"><thead><tr><th>Thành phần</th><th>Thông số</th><th>Cách dùng</th></tr></thead><tbody>{rows.map(([label,key,note]) => <tr key={key+label}><td>{label}</td><td>{tokens[prefix+key] || '—'}</td><td>{note}</td></tr>)}</tbody></table></div>
}
export default function TestingComponentReference() {
  const { t, fmt } = useTestingLocale(), { appearance } = useFxReplayContext()
  const root=useRef(null), dialog=useRef(null)
  const [value,setValue]=useState('buy'), [values,setValues]=useState(['buy']), [state,setState]=useState('ready')
  const [tokens,setTokens]=useState({}), [enabled,setEnabled]=useState(true)
  const options=[{value:'buy',label:'Buy'},{value:'sell',label:'Sell'},{value:'unknown',label:'Chưa rõ',disabled:true,detail:'Chưa đủ dữ liệu'}]
  useEffect(() => {
    const frame=requestAnimationFrame(() => {
      const style=getComputedStyle(root.current), result={}
      for (const [,key] of sizes) result['--ds-'+key]=style.getPropertyValue('--ds-'+key).trim()
      for (const [,key] of motions) result['--ds-motion-'+key]=style.getPropertyValue('--ds-motion-'+key).trim()
      for (const [key] of colors) {
        const probe=document.createElement('span'); probe.style.color=`var(--${key.startsWith('report-') ? '' : 'project-'}${key})`
        root.current.appendChild(probe)
        const rgb=getComputedStyle(probe).color.match(/[\d.]+/g)
        result[key]=`#${rgb.slice(0,3).map(v => Math.round(Number(v)).toString(16).padStart(2,'0')).join('').toUpperCase()}`
        probe.remove()
      }
      setTokens(result)
    })
    return () => cancelAnimationFrame(frame)
  }, [appearance.theme])
  return <section ref={root} className="wm-page wm-component-reference" aria-label={t('Bộ chuẩn Testing')}>
    <header className="wm-reference-heading"><div><h1>Bộ chuẩn giao diện</h1><p>Gọn · rõ · chuyển động nhẹ. Mẫu dùng dữ liệu minh hoạ, không gửi lệnh hay tạo phiên.</p></div><span className="wm-reference-version">Compact 0.1</span></header>
    <nav className="wm-reference-jumps" aria-label="Các phần bộ chuẩn">{[['controls','Nút và trạng thái'],['sizes','Kích thước và chữ'],['colors','Màu'],['motion','Chuyển động'],['layout','Bố cục'],['audit','Rà soát']].map(([id,name]) => <a key={id} href={'#'+id}>{name}</a>)}</nav>
    <section id="controls"><h2>Nút, ô nhập và trạng thái</h2><p>Rê chuột, bấm và dùng phím Tab. Hover không làm nút nhảy hay thêm viền; focus bàn phím có dấu riêng.</p>
      <div className="wm-reference-controls"><FxSelect label="Side" value={value} options={options} onChange={setValue} /><FxSelect label="Side" value={values} options={options} onChange={setValues} multiple searchable /><FxSelect label="Side" value={value} options={options} onChange={setValue} disabled /></div>
      <div className="wm-reference-controls"><button type="button" className="wm-button is-primary" onClick={() => dialog.current.showModal()}><TestingIcon kind="plus" />Mở dialog mẫu</button><button type="button" className="wm-button" onClick={() => setEnabled(!enabled)}>Nút phụ</button><button type="button" className="wm-button is-info" onClick={() => setState('ready')}>Thông tin</button><button type="button" className="wm-button is-success" onClick={() => setState('ready')}>Hoàn tất</button><button type="button" className="wm-button is-danger" onClick={() => dialog.current.showModal()}><TestingIcon kind="delete" />Xoá mẫu</button><button type="button" className="wm-button" disabled>Không khả dụng</button><button type="button" className="wm-button is-icon" aria-label="Tạm dừng mẫu" title="Tạm dừng mẫu" onClick={() => setEnabled(!enabled)}><TestingIcon kind={enabled ? 'pause' : 'play'} /></button><button type="button" className="wm-button is-text" onClick={() => setState('empty')}>Liên kết thao tác</button></div>
      <div className="wm-reference-form-grid"><label>Tên phiên <b aria-hidden="true">*</b><input className="wm-field" placeholder="Nhập tên phiên…" /></label><label>Số dư<input className="wm-field" type="number" defaultValue="100000" /></label><label>Mô tả<textarea className="wm-field" rows="2" placeholder="Nội dung nhiều dòng" /></label><div className="wm-reference-choices"><label><input type="checkbox" defaultChecked />Checkbox: đã chọn</label><label><input type="radio" name="reference-mode" defaultChecked />Lựa chọn A</label><label><input type="radio" name="reference-mode" />Lựa chọn B</label><label><input type="checkbox" role="switch" className="wm-reference-switch" checked={enabled} onChange={e => setEnabled(e.target.checked)} />Bật / tắt</label></div></div>
      <div className="wm-reference-table-scroll"><table className="wm-reference-table wm-reference-row-sample"><thead><tr><th>Tài sản</th><th>Dữ liệu mẫu</th><th>Thao tác</th></tr></thead><tbody>{['EUR/USD','XAU/USD'].map((asset,i) => <tr key={asset} className={i ? 'is-selected' : ''}><td>{asset}</td><td>{i ? 'Dòng đã chọn' : 'Rê chuột lên dòng và nút'}</td><td><button type="button" className="wm-button is-icon" aria-label={`Thao tác mẫu ${asset}`} onClick={() => setValue(i ? 'sell' : 'buy')}><TestingIcon kind="settings" /></button></td></tr>)}</tbody></table></div>
    </section>
    <section id="sizes"><h2>Kích thước và chữ</h2><p>Thông số đọc trực tiếp từ bộ chuẩn đang chạy. Nút dài theo chữ; kích thước vùng bấm khác kích thước nét icon.</p><SpecTable rows={sizes} tokens={tokens} /><div className="wm-reference-types"><span className="is-page">Tiêu đề trang</span><span className="is-section">Tiêu đề cụm</span><span>Nội dung dễ đọc 14px</span><small>Chú thích 12px · 09/10/2026 · 14:30:00</small></div><div className="fxa-metrics"><Metric label="Net P/L" value={fmt(1234.5,' USD')} /><Metric label="Net P/L" value={fmt(null,' USD')} note="Chưa đủ dữ liệu" /><Metric label="Win rate" value={fmt(0,'%')} /><Metric label="Net P/L" value={fmt(-125,' USD')} tone="is-negative" /></div></section>
    <section id="colors"><h2>Màu theo ý nghĩa</h2><p>Đổi theme trên header để xem sáng/tối. Màu luôn đi cùng chữ hoặc icon.</p><div className="wm-reference-colors">{colors.map(([key,label,note]) => <div key={key}><i style={{background:`var(--${key.startsWith('report-') ? '' : 'project-'}${key})`}} /><span><strong>{label}</strong><small>{note}</small></span><code>{tokens[key]}</code></div>)}</div></section>
    <section id="motion"><h2>Chuyển động</h2><p>Khởi động nhanh, giảm tốc dịu. Mở lớp chỉ mờ/dịch nhẹ; hover không đổi layout. Đóng lớp và phản hồi dữ liệu không bị trì hoãn vì animation.</p><SpecTable rows={motions} tokens={tokens} prefix="--ds-motion-" /><p>Giảm chuyển động của hệ điều hành: tắt hiệu ứng. Không biết tổng dung lượng: thanh chờ, không tạo % hay ETA giả.</p><FxSelect label="Trạng thái dữ liệu" value={state} onChange={setState} options={[['ready','Sẵn sàng'],['loading','Đang tải'],['empty','Chưa có dữ liệu.'],['filtered','Không có kết quả khớp bộ lọc.'],['error','Không tải được dữ liệu.'],['stale','Dữ liệu chưa cập nhật.'],['partial','Dữ liệu một phần.']].map(([value,label]) => ({value,label}))} />{state === 'loading' ? <TestingSkeleton /> : <TestingReadState message={{ready:'Sẵn sàng',empty:'Chưa có dữ liệu.',filtered:'Không có kết quả khớp bộ lọc.',error:'Không tải được dữ liệu.',stale:'Dữ liệu chưa cập nhật.',partial:'Dữ liệu một phần.'}[state]} error={state === 'error'} onRetry={state === 'error' ? () => setState('ready') : undefined} />}</section>
    <section id="layout"><h2>Vị trí, nhóm và grid</h2><div className="wm-reference-layout-grid"><div><h3>Trang dữ liệu</h3><p>Tìm kiếm trái → filter / sort → hành động phải. Desktop một hàng; hẹp thì cuộn nhóm filter, không đổi vị trí khi thay nhãn.</p><p>Header và dữ liệu chung mép cột. Chữ trái; số tiền/số lượng phải; icon giữa vùng bấm. Ngày dd/mm/yyyy, giờ HH:mm:ss; giữ rõ múi giờ.</p></div><div><h3>Form và dialog</h3><p>Label trên ô, mô tả/lỗi dưới ô. Hai cột khi đủ rộng, một cột trên điện thoại. Header/footer cố định, chỉ giữa cuộn.</p><p>Huỷ bên trái nút chính ở footer phải. X trên phải, hover chỉ đổi màu icon. Không lồng card hay thêm viền để lấp khoảng trống.</p></div><div><h3>KPI và báo cáo</h3><p>Grid 4 → 2 → 1 theo chỗ trống. Gap 24px giữa cụm, 32px giữa khu vực. Biểu đồ giữ trục/đơn vị; bảng rộng cuộn trong vùng riêng.</p></div><div><h3>Lớp nổi</h3><p>Menu bám control, tránh mép màn hình; dialog giữa, drawer phải, tooltip cạnh mục đang chỉ. Escape đóng lớp hiện tại, trả focus về nút mở.</p></div></div></section>
    <section id="audit"><h2>Những điểm đã phát hiện</h2><ul><li>Dashboard áp 44px cho control con, ảnh hưởng dialog: bỏ luật ép.</li><li>Ô nhập/nút Settings, Research, Risk, Prop, Learn khác chiều cao: dùng thang control chung.</li><li>Hover control gần màu hover dòng: tách hai độ sáng trung tính, không phủ nền xanh lên nút.</li><li>Thời gian chuyển màu 140–180ms: gom 120ms; progress 200ms.</li><li>Focus tạo phiên trắng, phần khác xanh: đổi về xanh biển.</li><li>Chuẩn chỉ áp Testing/Live: mở nền tảng cho các khu vực app.</li></ul><p>Toolbar chart có kích thước đặc thù 30–38px; nến và Buy/Sell giữ nghĩa thị trường. Các workflow phụ thuộc dữ liệu thật cần kiểm chứng riêng; đây không phải nghiệm thu toàn sản phẩm.</p></section>
    <dialog ref={dialog} className="wm-reference-dialog" aria-labelledby="reference-dialog-title"><header><h2 id="reference-dialog-title">Dialog mẫu</h2><button type="button" className="wm-dialog-close" aria-label="Đóng dialog mẫu" onClick={() => dialog.current.close()}><TestingIcon kind="close" size={18} /></button></header><p>Chỉ kiểm tra bố cục và hiệu ứng; không xoá dữ liệu hay tạo phiên.</p><footer><button type="button" className="wm-button" onClick={() => dialog.current.close()}>Huỷ</button><button type="button" className="wm-button is-primary" onClick={() => dialog.current.close()}>Hoàn tất</button></footer></dialog>
  </section>
}
