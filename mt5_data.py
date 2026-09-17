"""
MT5 Data Fetcher - Cross-Platform (Windows & macOS)
- Hỗ trợ TCP Socket Gateway EA (MT5Gateway.mq5 / MacGateway.mq5) trên cả macOS và Windows
- Hỗ trợ Native MetaTrader5 Python API (tự động phát hiện khi chạy trên Windows có package MetaTrader5)
"""
import sys
import os
import socket
import threading
import json
import time
from datetime import datetime, timedelta

IS_WINDOWS = sys.platform.startswith('win')
IS_MACOS = sys.platform == 'darwin'

# Thử import native MetaTrader5 nếu đang chạy trên Windows
native_mt5 = None
if IS_WINDOWS:
    try:
        import MetaTrader5 as native_mt5
    except ImportError:
        native_mt5 = None


class MT5DataFetcher:
    """Class giao tiếp với MetaTrader 5 đa nền tảng (Socket Gateway & Native Windows API)"""
    
    def __init__(self, host='127.0.0.1', port=9000):
        self.host = host
        self.port = port
        self.server_socket = None
        self.client_socket = None
        self.initialized = False
        self._native_initialized = False
        self.lock = threading.Lock()
        
        # Khởi động Socket Server trong background thread để không chặn Flask
        self.server_thread = threading.Thread(target=self._run_server, daemon=True)
        self.server_thread.start()
        
    def _run_server(self):
        """Khởi chạy TCP Socket Server lắng nghe kết nối từ MT5 EA (Windows & macOS)"""
        self.server_socket = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        self.server_socket.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        
        try:
            self.server_socket.bind((self.host, self.port))
            self.server_socket.listen(1)
            print(f"[SocketServer] Listening on {self.host}:{self.port} (Ready for MT5Gateway EA)...")
        except Exception as e:
            print(f"[SocketServer] Error starting socket server: {str(e)}")
            return
            
        while True:
            try:
                client_sock, addr = self.server_socket.accept()
                with self.lock:
                    self.client_socket = client_sock
                    self.initialized = True
                print(f"[SocketServer] MT5 EA connected successfully from {addr}!")
            except Exception as e:
                if not self.server_socket:
                    break
                print(f"[SocketServer] Error accepting connection: {str(e)}")
                time.sleep(1)
                
    def initialize(self):
        """Kiểm tra và khởi tạo trạng thái kết nối phù hợp với từng hệ điều hành"""
        with self.lock:
            # 1. Ưu tiên kiểm tra kết nối từ MT5 EA Socket (hoạt động xuất sắc trên cả Mac và Windows)
            if self.client_socket is not None:
                self.initialized = True
                return True, "MetaTrader 5 Expert Advisor connected via Socket Gateway (Port 9000)"
            
            # 2. Nếu trên Windows và có native MetaTrader5 package
            if IS_WINDOWS and native_mt5 is not None:
                if not self._native_initialized:
                    try:
                        if native_mt5.initialize():
                            self._native_initialized = True
                            self.initialized = True
                            account = native_mt5.account_info()
                            acc_id = account.login if account else 'Active'
                            return True, f"MetaTrader 5 connected via Native Windows API (Account #{acc_id})"
                        else:
                            err = native_mt5.last_error()
                            print(f"[MT5 Native] Initialize returned {err}, waiting for Socket EA...")
                    except Exception as e:
                        print(f"[MT5 Native] Exception during initialize: {e}")
                elif self._native_initialized:
                    self.initialized = True
                    return True, "MetaTrader 5 connected via Native Windows API"

            # 3. Thông báo hướng dẫn kết nối rõ ràng theo hệ điều hành
            if IS_MACOS:
                return False, "No connection from MT5 EA. On macOS: Open MT5, allow WebRequest for 127.0.0.1 and attach MT5Gateway.mq5 (or MacGateway.mq5) onto any chart."
            elif IS_WINDOWS:
                return False, "No connection from MT5. On Windows: Open MT5 and attach MT5Gateway.mq5 onto any chart (or install: pip install MetaTrader5)."
            else:
                return False, "No connection from MT5. Please attach MT5Gateway.mq5 onto any chart in MT5."
            
    def shutdown(self):
        """Đóng toàn bộ socket và kết nối khi tắt server Flask"""
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

        if IS_WINDOWS and native_mt5 is not None and self._native_initialized:
            try:
                native_mt5.shutdown()
                self._native_initialized = False
            except Exception:
                pass
            
    def _send_request(self, command_str, timeout=15.0):
        """Gửi lệnh đến MT5 EA qua Socket và nhận phản hồi JSON (Thread-safe)"""
        for _ in range(6):
            if self.client_socket:
                break
            time.sleep(0.5)
            
        with self.lock:
            if not self.client_socket:
                return {'success': False, 'message': 'No active connection from MT5 Expert Advisor.'}
                
            try:
                payload = (command_str + "\n").encode('utf-8')
                self.client_socket.sendall(payload)
                self.client_socket.settimeout(timeout)
                
                buffer = bytearray()
                while True:
                    chunk = self.client_socket.recv(8192)
                    if not chunk:
                        self.client_socket = None
                        self.initialized = False
                        return {'success': False, 'message': 'Connection with MT5 Expert Advisor was disconnected abruptly.'}
                    
                    buffer.extend(chunk)
                    if b'\n' in chunk:
                        if buffer.endswith(b'\n'):
                            break
                            
                response_str = buffer.decode('utf-8').strip()
                return json.loads(response_str)
                
            except socket.timeout:
                return {'success': False, 'message': 'Response timeout from MetaTrader 5.'}
            except Exception as e:
                self.client_socket = None
                self.initialized = False
                return {'success': False, 'message': f'Socket communication error: {str(e)}'}

    def get_symbols(self):
        """Lấy danh sách các sản phẩm giao dịch từ MT5"""
        # 1. Thử Socket EA
        if self.client_socket:
            res = self._send_request("GET_SYMBOLS")
            if res.get('success'):
                return sorted(res.get('symbols', []))

        # 2. Thử Native MT5 trên Windows
        if IS_WINDOWS and native_mt5 is not None and self._native_initialized:
            try:
                syms = native_mt5.symbols_get()
                if syms:
                    return sorted([s.name for s in syms])
            except Exception as e:
                print(f"[MT5 Native] Error get_symbols: {e}")

        return []
        
    def get_historical_data(self, symbol, timeframe, bars=5000):
        """Lấy dữ liệu lịch sử nến (OHLCV) từ MT5"""
        print(f"  [MT5] Fetching {bars} bars for {symbol} ({timeframe})...")
        
        # 1. Thử Socket EA
        if self.client_socket:
            dynamic_timeout = min(90.0, max(30.0, 12.0 + (int(bars) / 2500.0)))
            res = self._send_request(f"GET_DATA;{symbol};{timeframe};{bars}", timeout=dynamic_timeout)
            if res.get('success'):
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

        # 2. Thử Native MT5 trên Windows
        if IS_WINDOWS and native_mt5 is not None and self._native_initialized:
            try:
                tf_map = {
                    'M1': native_mt5.TIMEFRAME_M1,
                    'M5': native_mt5.TIMEFRAME_M5,
                    'M15': native_mt5.TIMEFRAME_M15,
                    'M30': native_mt5.TIMEFRAME_M30,
                    'H1': native_mt5.TIMEFRAME_H1,
                    'H4': native_mt5.TIMEFRAME_H4,
                    'D1': native_mt5.TIMEFRAME_D1,
                    'W1': native_mt5.TIMEFRAME_W1,
                    'MN1': native_mt5.TIMEFRAME_MN1,
                }
                tf_code = tf_map.get(timeframe.upper(), native_mt5.TIMEFRAME_H1)
                rates = native_mt5.copy_rates_from_pos(symbol, tf_code, 0, int(bars))
                if rates is not None and len(rates) > 0:
                    data = []
                    for r in rates:
                        data.append({
                            'time': int(r['time']),
                            'open': float(r['open']),
                            'high': float(r['high']),
                            'low': float(r['low']),
                            'close': float(r['close']),
                            'volume': float(r['tick_volume'])
                        })
                    print(f"  [Native] Successfully fetched {len(data)} bars.")
                    return {
                        'success': True,
                        'data': data,
                        'message': f"Successfully loaded {len(data)} bars for {symbol} {timeframe} via Native Windows API",
                        'symbol': symbol,
                        'timeframe': timeframe,
                        'first_date': data[0]['time'] if data else None,
                        'last_date': data[-1]['time'] if data else None
                    }
            except Exception as e:
                print(f"[MT5 Native] Error copy_rates: {e}")

        return {
            'success': False,
            'data': [],
            'message': 'Failed to fetch historical data from MT5. Please check MT5 connection.'
        }
        
    def get_historical_range(self, symbol, timeframe, from_ts, to_ts):
        """Lấy dữ liệu lịch sử nến theo khoảng thời gian từ MT5"""
        if self.client_socket:
            res = self._send_request(f"GET_RANGE;{symbol};{timeframe};{from_ts};{to_ts}", timeout=30.0)
            if res.get('success'):
                return res

        if IS_WINDOWS and native_mt5 is not None and self._native_initialized:
            try:
                tf_map = {
                    'M1': native_mt5.TIMEFRAME_M1,
                    'M5': native_mt5.TIMEFRAME_M5,
                    'M15': native_mt5.TIMEFRAME_M15,
                    'M30': native_mt5.TIMEFRAME_M30,
                    'H1': native_mt5.TIMEFRAME_H1,
                    'H4': native_mt5.TIMEFRAME_H4,
                    'D1': native_mt5.TIMEFRAME_D1,
                    'W1': native_mt5.TIMEFRAME_W1,
                    'MN1': native_mt5.TIMEFRAME_MN1,
                }
                tf_code = tf_map.get(timeframe.upper(), native_mt5.TIMEFRAME_H1)
                rates = native_mt5.copy_rates_range(symbol, tf_code, int(from_ts), int(to_ts))
                if rates is not None and len(rates) > 0:
                    data = []
                    for r in rates:
                        data.append({
                            'time': int(r['time']),
                            'open': float(r['open']),
                            'high': float(r['high']),
                            'low': float(r['low']),
                            'close': float(r['close']),
                            'volume': float(r['tick_volume'])
                        })
                    return {
                        'success': True,
                        'data': data,
                        'symbol': symbol,
                        'timeframe': timeframe,
                        'first_date': data[0]['time'],
                        'last_date': data[-1]['time']
                    }
            except Exception as e:
                print(f"[MT5 Native] Error copy_rates_range: {e}")

        # Fallback to count_back fetch
        return self.get_historical_data(symbol, timeframe, bars=5000)
        
    def get_current_price(self, symbol):
        """Lấy giá Tick hiện tại (Bid/Ask)"""
        if self.client_socket:
            res = self._send_request(f"GET_PRICE;{symbol}", timeout=3.0)
            if res.get('success'):
                return res.get('price')

        if IS_WINDOWS and native_mt5 is not None and self._native_initialized:
            try:
                tick = native_mt5.symbol_info_tick(symbol)
                if tick:
                    return {'bid': float(tick.bid), 'ask': float(tick.ask)}
            except Exception:
                pass
        return None

    def place_order(self, symbol, order_type, lots, sl=0.0, tp=0.0):
        """Đặt lệnh Buy/Sell lên MT5"""
        if self.client_socket:
            cmd = f"TRADE_{order_type.upper()};{symbol};{lots};{sl};{tp}"
            print(f"  [Socket] Placing order: {cmd}")
            return self._send_request(cmd, timeout=10.0)

        if IS_WINDOWS and native_mt5 is not None and self._native_initialized:
            try:
                action = native_mt5.TRADE_ACTION_DEAL
                type_code = native_mt5.ORDER_TYPE_BUY if order_type.lower() == 'buy' else native_mt5.ORDER_TYPE_SELL
                tick = native_mt5.symbol_info_tick(symbol)
                price = tick.ask if order_type.lower() == 'buy' else tick.bid
                request = {
                    'action': action,
                    'symbol': symbol,
                    'volume': float(lots),
                    'type': type_code,
                    'price': price,
                    'sl': float(sl) if sl else 0.0,
                    'tp': float(tp) if tp else 0.0,
                    'magic': 123456,
                    'comment': 'WuangVibeTrading Order',
                    'type_time': native_mt5.ORDER_TIME_GTC,
                    'type_filling': native_mt5.ORDER_FILLING_IOC,
                }
                result = native_mt5.order_send(request)
                if result and result.retcode == native_mt5.TRADE_RETCODE_DONE:
                    return {'success': True, 'ticket': result.order, 'message': 'Order placed successfully'}
                return {'success': False, 'message': f'Native order error: {result.comment if result else "Unknown"}'}
            except Exception as e:
                return {'success': False, 'message': f'Order exception: {str(e)}'}

        return {'success': False, 'message': 'No MT5 connection available to execute order.'}
        
    def close_position(self, ticket):
        """Đóng lệnh MT5 theo ticket"""
        if self.client_socket:
            cmd = f"TRADE_CLOSE;{ticket}"
            print(f"  [Socket] Closing trade ticket: {ticket}")
            return self._send_request(cmd, timeout=10.0)

        if IS_WINDOWS and native_mt5 is not None and self._native_initialized:
            try:
                positions = native_mt5.positions_get(ticket=int(ticket))
                if positions and len(positions) > 0:
                    pos = positions[0]
                    close_type = native_mt5.ORDER_TYPE_SELL if pos.type == native_mt5.ORDER_TYPE_BUY else native_mt5.ORDER_TYPE_BUY
                    tick = native_mt5.symbol_info_tick(pos.symbol)
                    price = tick.bid if pos.type == native_mt5.ORDER_TYPE_BUY else tick.ask
                    request = {
                        'action': native_mt5.TRADE_ACTION_DEAL,
                        'position': pos.ticket,
                        'symbol': pos.symbol,
                        'volume': pos.volume,
                        'type': close_type,
                        'price': price,
                        'magic': 123456,
                        'comment': 'Close via WuangVibeTrading',
                        'type_time': native_mt5.ORDER_TIME_GTC,
                        'type_filling': native_mt5.ORDER_FILLING_IOC,
                    }
                    result = native_mt5.order_send(request)
                    if result and result.retcode == native_mt5.TRADE_RETCODE_DONE:
                        return {'success': True, 'message': f'Position #{ticket} closed'}
                    return {'success': False, 'message': f'Close failed: {result.comment if result else "Unknown"}'}
            except Exception as e:
                return {'success': False, 'message': f'Close exception: {str(e)}'}

        return {'success': False, 'message': 'No MT5 connection available to close position.'}
        
    def get_positions(self):
        """Lấy danh sách các vị thế đang mở từ MT5"""
        if self.client_socket:
            res = self._send_request("GET_POSITIONS", timeout=5.0)
            if res.get('success'):
                return res.get('positions', [])

        if IS_WINDOWS and native_mt5 is not None and self._native_initialized:
            try:
                positions = native_mt5.positions_get()
                if positions:
                    result = []
                    for p in positions:
                        result.append({
                            'ticket': p.ticket,
                            'symbol': p.symbol,
                            'type': 'buy' if p.type == native_mt5.ORDER_TYPE_BUY else 'sell',
                            'lots': float(p.volume),
                            'open_price': float(p.price_open),
                            'sl': float(p.sl),
                            'tp': float(p.tp),
                            'current_price': float(p.price_current),
                            'profit': float(p.profit)
                        })
                    return result
            except Exception as e:
                print(f"[MT5 Native] Error get_positions: {e}")
        return []

    def get_trade_history(self, days=365):
        """Lấy lịch sử deal gần đây từ MT5"""
        try:
            days = int(days)
        except (TypeError, ValueError):
            days = 365
        days = max(1, min(days, 365))

        if self.client_socket:
            res = self._send_request(f"GET_HISTORY;{days}", timeout=8.0)
            if res.get('success'):
                return res

        if IS_WINDOWS and native_mt5 is not None and self._native_initialized:
            try:
                from_date = datetime.now() - timedelta(days=days)
                deals = native_mt5.history_deals_get(from_date, datetime.now())
                if deals:
                    history = []
                    for d in deals:
                        if d.entry == native_mt5.DEAL_ENTRY_OUT:
                            history.append({
                                'ticket': d.ticket,
                                'order': d.order,
                                'time': int(d.time),
                                'symbol': d.symbol,
                                'type': 'buy' if d.type == native_mt5.DEAL_TYPE_BUY else 'sell',
                                'lots': float(d.volume),
                                'price': float(d.price),
                                'profit': float(d.profit),
                                'commission': float(d.commission),
                                'swap': float(d.swap)
                            })
                    return {'success': True, 'history': history}
                return {'success': True, 'history': []}
            except Exception as e:
                print(f"[MT5 Native] Error get_trade_history: {e}")

        return {
            'success': False,
            'history': [],
            'message': 'No connection from MT5 to fetch history.'
        }
        
    def get_account_info(self):
        """Lấy thông tin tài khoản giao dịch từ MT5"""
        if self.client_socket:
            res = self._send_request("GET_ACCOUNT", timeout=5.0)
            if res.get('success'):
                return res.get('account', {})

        if IS_WINDOWS and native_mt5 is not None and self._native_initialized:
            try:
                acc = native_mt5.account_info()
                if acc:
                    return {
                        'login': acc.login,
                        'name': acc.name,
                        'server': acc.server,
                        'currency': acc.currency,
                        'leverage': acc.leverage,
                        'balance': float(acc.balance),
                        'equity': float(acc.equity),
                        'margin': float(acc.margin),
                        'free_margin': float(acc.margin_free),
                    }
            except Exception as e:
                print(f"[MT5 Native] Error get_account_info: {e}")
        return {}

# Singleton instance
mt5_fetcher = MT5DataFetcher()
