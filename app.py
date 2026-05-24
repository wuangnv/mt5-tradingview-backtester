"""
Flask Backend - API cho Trading Chart Tool
"""
from flask import Flask, render_template, jsonify, request
from mt5_data import mt5_fetcher
from datetime import datetime, timedelta
import json
import threading
import logging

app = Flask(__name__)

# Tắt log spam của Werkzeug/Flask
logging.getLogger('werkzeug').setLevel(logging.ERROR)


# Đảm bảo MT5 chỉ init một lần duy nhất (thread-safe)
_mt5_init_lock = threading.Lock()
_mt5_init_done = False

@app.before_request
def ensure_mt5_initialized():
    global _mt5_init_done
    if _mt5_init_done:
        return  # Thoát ngay nếu đã init
    with _mt5_init_lock:
        if not _mt5_init_done:
            success, msg = mt5_fetcher.initialize()
            _mt5_init_done = True
            if not success:
                print(f"Warning: {msg}")


@app.route('/')
def index():
    """Trang chủ"""
    return render_template('index.html')


@app.route('/api/symbols', methods=['GET'])
def get_symbols():
    """API lấy danh sách symbols"""
    symbols = mt5_fetcher.get_symbols()
    return jsonify({
        'success': True,
        'symbols': symbols
    })


@app.route('/api/data', methods=['POST'])
def get_data():
    """
    API lấy dữ liệu lịch sử
    
    Request body:
    {
        "symbol": "EURUSD",
        "timeframe": "H1",
        "bars": 5000
    }
    """
    data = request.get_json()
    
    symbol = data.get('symbol', 'EURUSD')
    timeframe = data.get('timeframe', 'H1')
    bars = data.get('bars', 5000)
    
    print(f"\n{'='*60}")
    print(f"API Request: {symbol} {timeframe} ({bars} bars)")
    print(f"{'='*60}")
    
    result = mt5_fetcher.get_historical_data(symbol, timeframe, bars)
    
    if result['success']:
        print(f"SUCCESS: {len(result['data'])} bars returned")
    else:
        print(f"FAILED: {result['message']}")
    
    print(f"{'='*60}\n")
    
    return jsonify(result)


@app.route('/api/price/<symbol>', methods=['GET'])
def get_current_price(symbol):
    """API lấy giá hiện tại"""
    price = mt5_fetcher.get_current_price(symbol)
    if price:
        return jsonify({
            'success': True,
            'price': price
        })
    else:
        return jsonify({
            'success': False,
            'message': 'Failed to get price'
        }), 400


@app.route('/api/status', methods=['GET'])
def get_status():
    """API kiểm tra trạng thái kết nối MT5"""
    if mt5_fetcher.initialized:
        return jsonify({
            'success': True,
            'connected': True,
            'message': 'MT5 connected'
        })
    else:
        success, msg = mt5_fetcher.initialize()
        return jsonify({
            'success': success,
            'connected': success,
            'message': msg
        })

@app.route('/api/trade/place', methods=['POST'])
def place_trade():
    """API đặt lệnh mua/bán lên MT5"""
    data = request.get_json()
    symbol = data.get('symbol')
    order_type = data.get('type')
    lots = data.get('lots', 0.01)
    sl = data.get('sl', 0.0)
    tp = data.get('tp', 0.0)
    
    if not symbol or not order_type:
        return jsonify({'success': False, 'message': 'Missing symbol or order type'}), 400
        
    res = mt5_fetcher.place_order(symbol, order_type, lots, sl, tp)
    return jsonify(res)

@app.route('/api/trade/close', methods=['POST'])
def close_trade():
    """API đóng vị thế theo ticket"""
    data = request.get_json()
    ticket = data.get('ticket')
    
    if not ticket:
        return jsonify({'success': False, 'message': 'Missing ticket ID'}), 400
        
    res = mt5_fetcher.close_position(ticket)
    return jsonify(res)

@app.route('/api/trade/positions', methods=['GET'])
def get_positions():
    """API lấy danh sách các vị thế đang chạy"""
    positions = mt5_fetcher.get_positions()
    return jsonify({'success': True, 'positions': positions})

@app.route('/api/trade/history', methods=['GET'])
def get_trade_history():
    """API lấy lịch sử deal gần đây từ MT5"""
    days = request.args.get('days', 365)
    return jsonify(mt5_fetcher.get_trade_history(days))

@app.route('/api/trade/account', methods=['GET'])
def get_account():
    """API lấy thông tin số dư tài khoản"""
    account = mt5_fetcher.get_account_info()
    return jsonify({'success': True, 'account': account})

@app.route('/api/shutdown', methods=['POST'])
def shutdown():
    """API tắt server Flask và đóng kết nối an toàn"""
    import os
    import threading
    import time
    
    print("\n" + "="*60)
    print("SHUTDOWN REQUEST: Terminating background server gracefully...")
    print("="*60 + "\n")
    
    def kill_process():
        time.sleep(0.2)  # Delay to ensure response is fully sent
        try:
            mt5_fetcher.shutdown()
            print("MT5 socket gateway shutdown complete.")
        except Exception as e:
            print(f"Error during MT5 shutdown: {e}")
        print("Halting process via os._exit(0)...")
        os._exit(0)
        
    threading.Thread(target=kill_process).start()
    return jsonify({'success': True, 'message': 'Server is shutting down.'})

import atexit
atexit.register(mt5_fetcher.shutdown)

if __name__ == '__main__':
    print("=" * 60)
    print("Trading Chart Tool - Bar Replay & Manual Backtest")
    print("=" * 60)
    print("\nInitializing MT5 connection...")
    
    success, msg = mt5_fetcher.initialize()
    if success:
        print(f"SUCCESS: {msg}")
    else:
        print(f"WARNING: {msg}")
        print("   Please make sure MT5 is installed and logged in.")
    
    print("\nStarting web server...")
    print("   Open browser at: http://localhost:5000")
    print("\n" + "=" * 60 + "\n")
    
    app.run(debug=False, host='0.0.0.0', port=5000)
