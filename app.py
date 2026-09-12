"""
Flask Backend - API cho Trading Chart Tool
"""
from flask import Flask, render_template, jsonify, request
from mt5_data import mt5_fetcher
from history_store import history_store
from session_store import session_store
from datetime import datetime, timedelta
import json
import threading
import logging
import sqlite3

app = Flask(__name__)
APP_MODE = {'mode': 'backtest'}  # backtest = local-first, live = MT5-first

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
    local_symbols = {item['symbol'] for item in history_store.get_status()}
    symbols = set(local_symbols)
    if APP_MODE['mode'] == 'live':
        symbols.update(mt5_fetcher.get_symbols())
    return jsonify({
        'success': True,
        'symbols': sorted(symbols)
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
    mode = data.get('mode') or APP_MODE['mode']

    print(f"\n{'='*60}")
    print(f"API Request: {symbol} {timeframe} ({bars} bars, mode={mode})")
    print(f"{'='*60}")

    if mode != 'live':
        local = history_store.load(symbol, timeframe, count_back=bars)
        if local:
            print(f"LOCAL HIT: {len(local)} bars returned")
            print(f"{'='*60}\n")
            return jsonify({
                'success': True,
                'data': local,
                'message': f'Loaded {len(local)} bars from local chunk cache',
                'symbol': symbol,
                'timeframe': timeframe,
                'source': 'local_chunked',
                'first_date': local[0]['time'],
                'last_date': local[-1]['time']
            })
        print(f"LOCAL MISS: no {symbol} {timeframe} data in local data mode")
        print(f"{'='*60}\n")
        return jsonify({
            'success': False,
            'data': [],
            'message': f'No local {symbol} {timeframe} data. Import/download data or switch the data source to MT5.',
            'symbol': symbol,
            'timeframe': timeframe,
            'source': 'local_chunked'
        })

    result = mt5_fetcher.get_historical_data(symbol, timeframe, bars)
    if result.get('success') and result.get('data'):
        history_store.save(symbol, timeframe, result['data'])
        result['source'] = 'mt5_bridge'

    if result['success']:
        print(f"SUCCESS: {len(result['data'])} bars returned")
    else:
        print(f"FAILED: {result['message']}")

    print(f"{'='*60}\n")

    return jsonify(result)


@app.route('/api/data/range', methods=['POST'])
def get_data_range():
    """Local-first range query for replay windows."""
    data = request.get_json() or {}
    symbol = data.get('symbol', 'EURUSD')
    timeframe = data.get('timeframe', 'H1')
    from_ts = data.get('from')
    to_ts = data.get('to')
    target_ts = data.get('target') or to_ts
    count_back = data.get('countBack')
    max_chunks = data.get('maxChunks') or 5
    mode = data.get('mode') or APP_MODE['mode']

    try:
        from_int = int(from_ts)
        to_int = int(to_ts)
    except (TypeError, ValueError):
        return jsonify({'success': False, 'data': [], 'message': 'Invalid from/to timestamp'}), 400

    local = history_store.load(
        symbol,
        timeframe,
        from_time=from_int,
        to_time=to_int,
        count_back=count_back,
        anchor_time=target_ts,
        max_chunks=max_chunks,
    )
    if local:
        return jsonify({
            'success': True,
            'data': local,
            'source': 'local_chunked',
            'symbol': symbol,
            'timeframe': timeframe,
            'from': from_int,
            'to': to_int,
            'first_date': local[0]['time'],
            'last_date': local[-1]['time'],
        })

    if mode != 'live' and not history_store.should_try_mt5(timeframe, target_ts or from_int):
        return jsonify({
            'success': False,
            'data': [],
            'need_import': True,
            'source': 'local_chunked',
            'message': f'No local {symbol} {timeframe} data for this range. Import JSON/CSV data or switch the data source to MT5.',
        })

    if mode == 'live':
        result = mt5_fetcher.get_historical_range(symbol, timeframe, from_int, to_int)
        if result.get('success') and result.get('data'):
            history_store.save(symbol, timeframe, result['data'])
            result['source'] = 'mt5_bridge'
        return jsonify(result)

    return jsonify({
        'success': False,
        'data': [],
        'source': 'local_chunked',
        'message': f'No local {symbol} {timeframe} data for requested range.',
    })


@app.route('/api/mode', methods=['GET', 'POST'])
def app_mode():
    if request.method == 'POST':
        data = request.get_json() or {}
        mode = str(data.get('mode', 'backtest')).lower()
        if mode not in ('backtest', 'live'):
            return jsonify({'success': False, 'message': 'mode must be backtest or live'}), 400
        APP_MODE['mode'] = mode
    return jsonify({'success': True, 'mode': APP_MODE['mode']})


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
            'message': 'MT5 connected',
            'mode': APP_MODE['mode']
        })
    else:
        success, msg = mt5_fetcher.initialize()
        return jsonify({
            'success': success,
            'connected': success,
            'message': msg,
            'mode': APP_MODE['mode']
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

# ─── Local History Store APIs ─────────────────────────────────

@app.route('/api/history/status', methods=['GET'])
def history_status():
    """API liệt kê dữ liệu history đã download local"""
    return jsonify({
        'success': True,
        'files': history_store.get_status()
    })

@app.route('/api/history/download', methods=['POST'])
def history_download():
    """API download dữ liệu lịch sử từ MT5 và lưu vào local file.
    Request body: { symbol, timeframe, bars }
    """
    data = request.get_json()
    symbol = data.get('symbol', 'EURUSD')
    timeframe = data.get('timeframe', 'H1')
    bars = data.get('bars', 10000)

    print(f"\n{'='*60}")
    print(f"History Download: {symbol} {timeframe} ({bars} bars)")
    print(f"{'='*60}")

    # Fetch from MT5 via socket
    result = mt5_fetcher.get_historical_data(symbol, timeframe, bars)

    if not result['success']:
        return jsonify({
            'success': False,
            'message': result.get('message', 'Failed to fetch from MT5')
        })

    raw_data = result['data']
    if not raw_data:
        return jsonify({
            'success': False,
            'message': 'No data returned from MT5'
        })

    # Save to local file (merge with existing)
    total_bars = history_store.save(symbol, timeframe, raw_data)

    print(f"SUCCESS: Downloaded {len(raw_data)} bars, total stored: {total_bars}")
    print(f"{'='*60}\n")

    return jsonify({
        'success': True,
        'downloaded': len(raw_data),
        'total_stored': total_bars,
        'message': f'Downloaded {len(raw_data)} bars for {symbol} {timeframe}. Total stored: {total_bars} bars.'
    })

@app.route('/api/history/data', methods=['POST'])
def history_data():
    """API đọc dữ liệu từ local history store (không cần MT5).
    Request body: { symbol, timeframe, from_time?, to_time? }
    """
    data = request.get_json()
    symbol = data.get('symbol', 'EURUSD')
    timeframe = data.get('timeframe', 'H1')
    from_time = data.get('from_time')
    to_time = data.get('to_time')
    count_back = data.get('countBack') or data.get('count_back')
    anchor_time = data.get('target') or data.get('anchor_time') or to_time
    max_chunks = data.get('maxChunks') or data.get('max_chunks')

    bars = history_store.load(
        symbol,
        timeframe,
        from_time=from_time,
        to_time=to_time,
        count_back=count_back,
        anchor_time=anchor_time,
        max_chunks=max_chunks,
    )

    return jsonify({
        'success': True,
        'data': bars,
        'bars_count': len(bars),
        'symbol': symbol,
        'timeframe': timeframe,
        'source': 'local'
    })

@app.route('/api/history/delete', methods=['POST'])
def history_delete():
    """API xóa dữ liệu local history"""
    data = request.get_json()
    symbol = data.get('symbol')
    timeframe = data.get('timeframe')
    if not symbol or not timeframe:
        return jsonify({'success': False, 'message': 'Missing symbol or timeframe'})
    deleted = history_store.delete(symbol, timeframe)
    return jsonify({'success': deleted, 'message': 'Deleted' if deleted else 'File not found'})

@app.route('/api/history/coverage', methods=['GET'])
def history_coverage():
    symbol = request.args.get('symbol', 'EURUSD')
    timeframe = request.args.get('timeframe', 'M1')
    return jsonify({'success': True, 'coverage': history_store.coverage(symbol, timeframe)})

@app.route('/api/history/policy', methods=['GET'])
def history_policy():
    return jsonify({'success': True, 'policy': history_store.policy()})

# ─── Replay Session APIs ───────────────────────────────────────

@app.route('/api/session/save', methods=['POST'])
def save_replay_session():
    """Validate and persist one completed virtual replay session."""
    report = request.get_json(silent=True)
    if not isinstance(report, dict):
        return jsonify({'success': False, 'message': 'Request body must be a JSON object'}), 400
    try:
        saved = session_store.save(report)
    except ValueError as error:
        return jsonify({'success': False, 'message': str(error)}), 400
    except sqlite3.Error:
        app.logger.exception('Failed to save replay session')
        return jsonify({'success': False, 'message': 'Could not save the replay session'}), 500
    return jsonify({'success': True, 'session': saved}), 201


@app.route('/api/sessions', methods=['GET'])
def get_replay_sessions():
    """List recent persisted replay-session summaries."""
    try:
        limit = int(request.args.get('limit', 50))
    except (TypeError, ValueError):
        return jsonify({'success': False, 'message': 'limit must be an integer'}), 400
    if limit < 1 or limit > 100:
        return jsonify({'success': False, 'message': 'limit must be between 1 and 100'}), 400
    try:
        sessions = session_store.list_sessions(limit)
    except sqlite3.Error:
        app.logger.exception('Failed to load replay sessions')
        return jsonify({'success': False, 'message': 'Could not load replay sessions'}), 500
    return jsonify({'success': True, 'sessions': sessions})


@app.route('/api/sessions/<int:session_id>', methods=['GET', 'DELETE'])
def replay_session(session_id):
    """Read a complete report or delete a persisted replay session."""
    try:
        if request.method == 'DELETE':
            deleted = session_store.delete(session_id)
            if not deleted:
                return jsonify({'success': False, 'message': 'Session not found'}), 404
            return jsonify({'success': True})

        saved = session_store.get_session(session_id)
    except (sqlite3.Error, json.JSONDecodeError):
        app.logger.exception('Failed to access replay session')
        return jsonify({'success': False, 'message': 'Could not access the replay session'}), 500
    if saved is None:
        return jsonify({'success': False, 'message': 'Session not found'}), 404
    return jsonify({'success': True, 'session': saved})


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
