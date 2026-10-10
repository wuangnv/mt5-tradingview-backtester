export const DATA_STATES = [
  ['loading', 'Đang tải', 'Chưa có kết quả; giữ bố cục bằng skeleton.'],
  ['ready', 'Có dữ liệu', 'Hiện dữ liệu đã xác minh.'],
  ['empty', 'Chưa có dữ liệu', 'Đọc thành công nhưng chưa có bản ghi; gợi ý bước đầu tiên.'],
  ['error', 'Không tải được dữ liệu', 'Lỗi của nguồn này; thử lại tại nơi lỗi.'],
  ['unavailable', 'Nguồn chưa khả dụng', 'Chưa có nguồn hoặc tính năng; không giả vờ là dữ liệu trống.'],
  ['denied', 'Không có quyền xem', 'Giải thích quyền cần có; không lặp nút thử lại vô ích.'],
  ['filtered', 'Không có kết quả khớp bộ lọc', 'Có dữ liệu gốc; cho xoá hoặc sửa bộ lọc.'],
  ['refreshing', 'Đang cập nhật', 'Giữ dữ liệu cùng phạm vi; báo làm mới nhỏ ở tiêu đề.'],
  ['stale', 'Dữ liệu chưa cập nhật', 'Giữ dữ liệu cũ, ghi rõ cũ và cho làm mới.'],
  ['partial', 'Dữ liệu chưa đầy đủ', 'Hiện phần đã biết; đánh dấu phần thiếu.'],
  ['unknown', 'Chưa đủ dữ liệu để tính', 'Hiện — cho số chưa biết; không đổi thành 0.'],
]
