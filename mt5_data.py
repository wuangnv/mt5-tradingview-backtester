"""
MT5 Data Fetcher via TCP Socket Gateway - Hỗ trợ chạy Native trên macOS
"""
import socket
import threading
import json
import time

class MT5DataFetcher:
    """Class giao tiếp với MetaTrader 5 thông qua TCP Socket Gateway (máy chủ socket nội bộ)"""
    
    def __init__(self, host='127.0.0.1', port=9000):
        self.host = host
        self.port = port
        self.server_socket = None
        self.client_socket = None
        self.initialized = False
        self.lock = threading.Lock()
        
        # Khởi động Socket Server trong background thread để không chặn Flask
        self.server_thread = threading.Thread(target=self._run_server, daemon=True)
        self.server_thread.start()
        
    def _run_server(self):
        """Khởi chạy TCP Socket Server lắng nghe kết nối từ MT5 EA"""
        self.server_socket = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        # Cho phép reuse address để tránh lỗi port in use khi restart server nhanh
        self.server_socket.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        
        try:
            self.server_socket.bind((self.host, self.port))
            self.server_socket.listen(1)
            print(f"\n[SocketServer] Listening on {self.host}:{self.port}...")
        except Exception as e:
            print(f"\n[SocketServer] Error starting socket server: {str(e)}")
            return
            
        while True:
            try:
                client_sock, addr = self.server_socket.accept()
                with self.lock:
                    self.client_socket = client_sock
                    self.initialized = True
                print(f"\n[SocketServer] MT5 EA connected successfully from {addr}!")
            except Exception as e:
                # Nếu server socket đóng khi shutdown, thoát khỏi vòng lặp
                if not self.server_socket:
                    break
                print(f"\n[SocketServer] Error accepting connection: {str(e)}")
                time.sleep(1)
                
    def initialize(self):
        """Kiểm tra và khởi tạo trạng thái kết nối"""
        with self.lock:
            if self.client_socket is not None:
                try:
                    # Gửi gói tin trống dạng kiểm tra kết nối (non-blocking test)
                    return True, "MetaTrader 5 Expert Advisor connected via Socket Gateway (Port 9000)"
                except socket.error:
                    self.client_socket = None
                    self.initialized = False
            
            return False, "No connection from MT5 Expert Advisor. Please open MT5 on Mac, allow WebRequest for 127.0.0.1 and drag-and-drop MacGateway EA onto a chart."
            
    def shutdown(self):
        """Đóng toàn bộ socket khi tắt server Flask"""
        with self.lock:
            if self.client_socket:
                try:
                    self.client_socket.close()
                except Exception:
                    pass
                self.client_socket = None
            if self.server_socket:
                try:
                    self.server_socket.close()
                except Exception:
                    pass
                self.server_socket = None
            self.initialized = False
            
    def _send_request(self, command_str, timeout=15.0):
        """Gửi lệnh đến MT5 EA qua Socket và nhận phản hồi JSON (Thread-safe)"""
        
        # Tự động chờ kết nối socket từ MT5 EA thiết lập (tối đa 3 giây) khi khởi động ứng dụng
        for _ in range(6):
            if self.client_socket:
                break
            time.sleep(0.5)
            
        with self.lock:
            if not self.client_socket:
                return {'success': False, 'message': 'No active connection from MT5 Expert Advisor.'}
                
            try:
                # Gửi lệnh với ký tự kết thúc là \n
                payload = (command_str + "\n").encode('utf-8')
                self.client_socket.sendall(payload)
                
                # Thiết lập thời gian timeout cho socket để tránh treo luồng nếu EA đứng
                self.client_socket.settimeout(timeout)
                
                # Tích lũy phản hồi cho đến khi đọc được ký tự \n phân tách
                buffer = bytearray()
                while True:
                    chunk = self.client_socket.recv(8192)
                    if not chunk:
                        # Kết nối bị đóng từ phía client
                        self.client_socket = None
                        self.initialized = False
                        return {'success': False, 'message': 'Connection with MT5 Expert Advisor was disconnected abruptly.'}
                    
                    buffer.extend(chunk)
                    if b'\n' in chunk:
                        if buffer.endswith(b'\n'):
                            break
                            
                # Giải mã dữ liệu và loại bỏ khoảng trắng dư thừa
                response_str = buffer.decode('utf-8').strip()
                return json.loads(response_str)
                
            except socket.timeout:
                return {'success': False, 'message': 'Response timeout from MetaTrader 5.'}
            except Exception as e:
                # Hủy socket bị lỗi để kích hoạt tự động kết nối lại lần sau
                self.client_socket = None
                self.initialized = False
                return {'success': False, 'message': f'Socket communication error: {str(e)}'}

    def get_symbols(self):
        """Lấy danh sách các sản phẩm giao dịch từ MT5"""
        res = self._send_request("GET_SYMBOLS")
        if res.get('success'):
            return sorted(res.get('symbols', []))
        return []
        
    def get_historical_data(self, symbol, timeframe, bars=5000):
        """Lấy dữ liệu lịch sử nến (OHLCV) từ MT5"""
        print(f"  [Socket] Fetching {bars} bars for {symbol} ({timeframe})...")
        
        # Gửi lệnh truy vấn lịch sử
        res = self._send_request(f"GET_DATA;{symbol};{timeframe};{bars}", timeout=30.0)
        
        if not res.get('success'):
            return {
                'success': False,
                'data': [],
                'message': res.get('message', 'Failed to fetch historical data from MT5.')
            }
            
        data = res.get('data', [])
        print(f"  [Socket] Successfully fetched {len(data)} bars.")
        
        return {
            'success': True,
            'data': data,
            'message': f"Successfully loaded {len(data)} bars for {symbol} {timeframe} via Socket",
            'symbol': symbol,
            'timeframe': timeframe,
            'first_date': data[0]['time'] if data else None,
            'last_date': data[-1]['time'] if data else None
        }
        
    def get_current_price(self, symbol):
        """Lấy giá Tick hiện tại (Bid/Ask)"""
        res = self._send_request(f"GET_PRICE;{symbol}", timeout=3.0)
        if res.get('success'):
            return res.get('price')
        return None

    def place_order(self, symbol, order_type, lots, sl=0.0, tp=0.0):
        """Đặt lệnh Buy/Sell lên MT5 qua Socket"""
        cmd = f"TRADE_{order_type.upper()};{symbol};{lots};{sl};{tp}"
        print(f"  [Socket] Placing order: {cmd}")
        return self._send_request(cmd, timeout=10.0)
        
    def close_position(self, ticket):
        """Đóng lệnh MT5 theo ticket qua Socket"""
        cmd = f"TRADE_CLOSE;{ticket}"
        print(f"  [Socket] Closing trade ticket: {ticket}")
        return self._send_request(cmd, timeout=10.0)
        
    def get_positions(self):
        """Lấy danh sách các vị thế đang mở từ MT5"""
        res = self._send_request("GET_POSITIONS", timeout=5.0)
        if res.get('success'):
            return res.get('positions', [])
        return []
        
    def get_account_info(self):
        """Lấy thông tin tài khoản giao dịch từ MT5"""
        res = self._send_request("GET_ACCOUNT", timeout=5.0)
        if res.get('success'):
            return res.get('account', {})
        return {}

# Singleton instance
mt5_fetcher = MT5DataFetcher()
