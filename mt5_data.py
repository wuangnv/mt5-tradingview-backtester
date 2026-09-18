"""
MT5 Data Fetcher via TCP Socket Gateway - Hỗ trợ chạy Native trên macOS
"""
import socket
import threading
import json
import time


def _protocol_token(value, name):
    token = str(value)
    if not token or any(char in token for char in (";", "\r", "\n")):
        raise ValueError(f"{name} contains an invalid socket-protocol token")
    return token


def _base_symbol(symbol):
    """Normalize broker symbols such as Exness EURUSDm to EURUSD."""
    value = str(symbol or "").strip().upper()
    for suffix in ("C", "M", "R", "Z"):
        if value.endswith(suffix) and len(value) > 3:
            return value[:-1]
    return value

class MT5DataFetcher:
    """Class giao tiếp với MetaTrader 5 thông qua TCP Socket Gateway (máy chủ socket nội bộ)"""
    
    def __init__(self, host='127.0.0.1', port=9000):
        self.host = host
        self.port = port
        self.server_socket = None
        self.client_socket = None
        self.initialized = False
        self.protocol_version = None
        self.last_heartbeat = 0
        self._recv_buffer = bytearray()
        self._symbol_cache = {}
        self.request_lock = threading.Lock()
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
                    self._recv_buffer = bytearray()
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
            
            return False, "No connection from MT5 Expert Advisor. Please open MT5, allow local socket access and drag-and-drop MT5Gateway EA onto a chart."
            
    def shutdown(self):
        """Đóng toàn bộ socket khi tắt server Flask"""
        with self.lock:
            if self.client_socket:
                try:
                    self.client_socket.close()
                except Exception:
                    pass
                self.client_socket = None
            self._recv_buffer = bytearray()
            if self.server_socket:
                try:
                    self.server_socket.close()
                except Exception:
                    pass
                self.server_socket = None
            self.initialized = False

    def drop_client_connection(self):
        """Close only the active EA connection so the EA can reconnect to this server."""
        with self.lock:
            if self.client_socket:
                try:
                    self.client_socket.close()
                except Exception:
                    pass
                self.client_socket = None
            self._recv_buffer = bytearray()
            self.initialized = False

    def wait_for_connection(self, timeout=10.0):
        deadline = time.time() + max(0.0, float(timeout))
        while time.time() < deadline:
            connected, _ = self.initialize()
            if connected:
                return True
            time.sleep(0.25)
        return self.initialize()[0]
            
    def _send_request(self, command_str, timeout=15.0):
        """Gửi lệnh đến MT5 EA qua Socket và nhận phản hồi JSON (Thread-safe)"""
        
        # Tự động chờ kết nối socket từ MT5 EA thiết lập (tối đa 3 giây) khi khởi động ứng dụng
        for _ in range(6):
            if self.client_socket:
                break
            time.sleep(0.5)
            
        if not hasattr(self, "request_lock"):
            self.request_lock = threading.Lock()
        if not hasattr(self, "lock"):
            self.lock = threading.Lock()

        with self.request_lock:
          with self.lock:
            if not self.client_socket:
                return {'success': False, 'message': 'No active connection from MT5 Expert Advisor.'}

            # Older tests/builders can instantiate this class without __init__.
            if not hasattr(self, "_recv_buffer"):
                self._recv_buffer = bytearray()
                
            try:
                # Gửi lệnh với ký tự kết thúc là \n
                payload = (command_str + "\n").encode('utf-8')
                self.client_socket.sendall(payload)
                
                deadline = time.monotonic() + max(0.0, float(timeout))
                while True:
                    # The EA can emit an unsolicited heartbeat before or beside
                    # the response to a request. Consume complete newline-delimited
                    # frames one at a time and retain any later frame for the next
                    # request instead of treating the heartbeat as the response.
                    newline_pos = self._recv_buffer.find(b'\n')
                    if newline_pos >= 0:
                        frame = bytes(self._recv_buffer[:newline_pos])
                        del self._recv_buffer[:newline_pos + 1]
                        if not frame.strip():
                            continue

                        response = json.loads(frame.decode('utf-8').strip())
                        if isinstance(response, dict) and response.get('type') == 'heartbeat':
                            self.last_heartbeat = time.time()
                            continue
                        if isinstance(response, dict) and response.get('protocol_version'):
                            self.protocol_version = response.get('protocol_version')
                        return response

                    remaining = deadline - time.monotonic()
                    if remaining <= 0:
                        raise socket.timeout()
                    self.client_socket.settimeout(remaining)
                    chunk = self.client_socket.recv(8192)
                    if not chunk:
                        # Kết nối bị đóng từ phía client
                        self.client_socket = None
                        self._recv_buffer = bytearray()
                        self.initialized = False
                        return {'success': False, 'message': 'Connection with MT5 Expert Advisor was disconnected abruptly.'}

                    self._recv_buffer.extend(chunk)
                
            except socket.timeout:
                # A timed-out request can still produce a late response. The protocol has no
                # request envelope, so reusing this socket could let the next command consume
                # the previous response. Force a reconnect before any further request.
                if self.client_socket:
                    try:
                        self.client_socket.close()
                    except Exception:
                        pass
                self.client_socket = None
                self._recv_buffer = bytearray()
                self.initialized = False
                return {'success': False, 'message': 'Response timeout from MetaTrader 5.'}
            except Exception as e:
                # Hủy socket bị lỗi để kích hoạt tự động kết nối lại lần sau
                if self.client_socket:
                    try:
                        self.client_socket.close()
                    except Exception:
                        pass
                self.client_socket = None
                self._recv_buffer = bytearray()
                self.initialized = False
                return {'success': False, 'message': f'Socket communication error: {str(e)}'}

    def get_symbols(self):
        """Lấy danh sách các sản phẩm giao dịch từ MT5"""
        res = self._send_request("GET_SYMBOLS")
        if res.get('success'):
            return sorted(res.get('symbols', []))

    def resolve_symbol(self, symbol):
        """Resolve UI symbols to broker symbols (Exness Standard uses suffix m)."""
        requested = str(symbol or "").strip().upper()
        if not requested:
            return requested
        if not hasattr(self, "_symbol_cache"):
            self._symbol_cache = {}
        if requested in self._symbol_cache:
            return self._symbol_cache[requested]
        try:
            available = self.get_symbols()
            if requested in available:
                self._symbol_cache[requested] = requested
                return requested
            base = _base_symbol(requested)
            for item in available:
                if _base_symbol(item) == base:
                    self._symbol_cache[requested] = item
                    return item
        except Exception:
            pass
        return requested
        return []
        
    def get_historical_data(self, symbol, timeframe, bars=5000):
        symbol = self.resolve_symbol(symbol)
        """Lấy dữ liệu lịch sử nến (OHLCV) từ MT5"""
        print(f"  [Socket] Fetching {bars} bars for {symbol} ({timeframe})...")
        
        # Gửi lệnh truy vấn lịch sử
        dynamic_timeout = min(90.0, max(30.0, 12.0 + (int(bars) / 2500.0)))
        res = self._send_request(f"GET_DATA;{symbol};{timeframe};{bars}", timeout=dynamic_timeout)
        
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
        symbol = self.resolve_symbol(symbol)
        """Lấy giá Tick hiện tại (Bid/Ask)"""
        res = self._send_request(f"GET_PRICE;{symbol}", timeout=3.0)
        if res.get('success'):
            return res.get('price')
        return None

    def get_price_result(self, symbol):
        symbol = self.resolve_symbol(symbol)
        """Return the raw tick response so adapters can distinguish offline from missing data."""
        return self._send_request(
            f"GET_PRICE;{_protocol_token(symbol, 'symbol')}", timeout=3.0
        )

    def get_execution_context(self):
        """Return broker/account identity and explicit trade-mode safety fields."""
        return self._send_request("GET_EXECUTION_CONTEXT", timeout=5.0)

    def get_symbol_info(self, symbol):
        symbol = self.resolve_symbol(symbol)
        """Return broker contract limits for one symbol."""
        return self._send_request(
            f"GET_SYMBOL_INFO;{_protocol_token(symbol, 'symbol')}", timeout=5.0
        )

    def check_order(self, symbol, order_type, lots, sl=0.0, tp=0.0):
        symbol = self.resolve_symbol(symbol)
        """Ask MT5 to validate a market request without sending it."""
        side = str(order_type).upper()
        if side not in {"BUY", "SELL"}:
            raise ValueError("order_type must be BUY or SELL")
        safe_symbol = _protocol_token(symbol, "symbol")
        return self._send_request(
            f"CHECK_ORDER;{side};{safe_symbol};{lots};{sl};{tp}", timeout=8.0
        )

    def place_order(self, symbol, order_type, lots, sl=0.0, tp=0.0, request_id=None):
        symbol = self.resolve_symbol(symbol)
        """Đặt lệnh Buy/Sell lên MT5 qua Socket"""
        side = str(order_type).upper()
        if side not in {"BUY", "SELL"}:
            raise ValueError("order_type must be BUY or SELL")
        safe_symbol = _protocol_token(symbol, "symbol")
        cmd = f"TRADE_{side};{safe_symbol};{lots};{sl};{tp}"
        if request_id:
            cmd += f";{_protocol_token(request_id, 'request_id')}"
        print(f"  [Socket] Placing order: {cmd}")
        return self._send_request(cmd, timeout=10.0)
        
    def close_position(self, ticket, request_id=None):
        """Đóng lệnh MT5 theo ticket qua Socket"""
        cmd = f"TRADE_CLOSE;{_protocol_token(ticket, 'ticket')}"
        if request_id:
            cmd += f";{_protocol_token(request_id, 'request_id')}"
        print(f"  [Socket] Closing trade ticket: {ticket}")
        return self._send_request(cmd, timeout=10.0)

    def lookup_request(self, request_id):
        """Reconcile a request by the broker-visible request comment."""
        return self._send_request(
            f"GET_REQUEST;{_protocol_token(request_id, 'request_id')}", timeout=8.0
        )
        
    def get_positions(self):
        """Lấy danh sách các vị thế đang mở từ MT5"""
        res = self._send_request("GET_POSITIONS", timeout=5.0)
        if res.get('success'):
            return res.get('positions', [])
        return []

    def get_positions_result(self):
        """Return the raw positions response so adapters can distinguish empty from offline."""
        return self._send_request("GET_POSITIONS", timeout=5.0)

    def get_trade_history(self, days=365):
        """Lấy lịch sử deal gần đây từ MT5"""
        try:
            days = int(days)
        except (TypeError, ValueError):
            days = 365
        days = max(1, min(days, 365))

        res = self._send_request(f"GET_HISTORY;{days}", timeout=8.0)
        if not res.get('success'):
            return {
                'success': False,
                'history': [],
                'message': res.get('message', 'Failed to fetch MT5 trade history.')
            }

        return {
            'success': True,
            'history': res.get('history', []),
            'message': res.get('message', 'Trade history loaded.'),
            'days': res.get('days', days),
            'total_deals': res.get('total_deals', 0),
            'returned': res.get('returned', len(res.get('history', [])))
        }
        
    def get_account_info(self):
        """Lấy thông tin tài khoản giao dịch từ MT5"""
        res = self._send_request("GET_ACCOUNT", timeout=5.0)
        if res.get('success'):
            return res.get('account', {})
        return {}

    def get_account_result(self):
        """Return the raw account response for strict execution adapters."""
        return self._send_request("GET_ACCOUNT", timeout=5.0)

# Singleton instance
mt5_fetcher = MT5DataFetcher()
