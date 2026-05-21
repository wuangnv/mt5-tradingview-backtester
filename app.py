"""
Flask Backend - API cho Trading Chart Tool
"""
from flask import Flask, render_template, jsonify, request
from mt5_data import mt5_fetcher
from datetime import datetime, timedelta
import json
import threading

app = Flask(__name__)

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


@app.teardown_appcontext
def shutdown_mt5(exception=None):
    """Đóng kết nối MT5 khi tắt app"""
    mt5_fetcher.shutdown()


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
    
    app.run(debug=True, host='0.0.0.0', port=5000)
