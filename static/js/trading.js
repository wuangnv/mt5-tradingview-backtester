/**
 * trading.js — TradeManager
 * Virtual (replay) account with market/pending orders, SL/TP, P/L,
 * plus live MT5 trading passthrough and the bottom dashboard.
 */

const VIRTUAL_ACCOUNT_KEY = 'virtual_account_v2';

const fmtMoney = (v) => '$' + Number(v || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtTime = (ts) => new Date(ts * 1000).toLocaleString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });

class TradeManager {
    constructor() {
        this.virtualAccount = this._loadVirtualAccount();
        this.liveAccount = null;
        this.livePositions = [];
        this.liveHistory = [];
        this.side = 'buy';
        this._pollTimer = null;
        this._priceTimer = null;

        this._els = {
            drawer: document.getElementById('order-drawer'),
            symbol: document.getElementById('op-symbol'),
            price: document.getElementById('op-price'),
            sell: document.getElementById('op-side-sell'),
            buy: document.getElementById('op-side-buy'),
            orderType: document.getElementById('op-order-type'),
            priceField: document.getElementById('op-price-field'),
            orderPrice: document.getElementById('op-order-price'),
            volume: document.getElementById('op-volume'),
            slOn: document.getElementById('op-sl-on'),
            sl: document.getElementById('op-sl'),
            slUnit: document.getElementById('op-sl-unit'),
            tpOn: document.getElementById('op-tp-on'),
            tp: document.getElementById('op-tp'),
            tpUnit: document.getElementById('op-tp-unit'),
            margin: document.getElementById('op-margin'),
            submit: document.getElementById('op-submit'),
            note: document.getElementById('op-note'),
            badge: document.getElementById('op-mode-badge')
        };

        this._wireForm();
        this._loadSymbols();
    }

    get isReplayMode() {
        return Boolean(window.chartManager?.isReplayMode);
    }

    /* ── Virtual account persistence ────────────────────────────────────── */

    _defaultAccount() {
        return {
            balance: 10000, equity: 10000, margin: 0, free_margin: 10000,
            margin_level: 0, positions: [], pending: [], history: [],
            ticket_counter: 100000
        };
    }

    _loadVirtualAccount() {
        try {
            const raw = localStorage.getItem(VIRTUAL_ACCOUNT_KEY);
            if (raw) return Object.assign(this._defaultAccount(), JSON.parse(raw));
        } catch (err) { /* corrupted — reset */ }
        return this._defaultAccount();
    }

    _saveVirtualAccount() {
        localStorage.setItem(VIRTUAL_ACCOUNT_KEY, JSON.stringify(this.virtualAccount));
    }

    /* ── Symbol helpers ─────────────────────────────────────────────────── */

    getPrecision(symbol) {
        if (/JPY|XAU|GOLD|USOIL|BTC/.test(symbol)) return 2;
        if (/XAG|SILVER/.test(symbol)) return 3;
        return 5;
    }

    getPipSize(symbol) {
        if (symbol.includes('JPY')) return 0.01;
        if (/XAU|GOLD/.test(symbol)) return 0.1;
        if (/XAG|SILVER/.test(symbol)) return 0.01;
        return 0.0001;
    }

    getContractSize(symbol) {
        if (/XAU|GOLD/.test(symbol)) return 100;
        if (/XAG|SILVER/.test(symbol)) return 5000;
        if (/BTC/.test(symbol)) return 1;
        if (/USOIL|UKOIL/.test(symbol)) return 1000;
        return 100000;
    }

    /** Profit in account currency (USD approximation). */
    calcProfit(symbol, type, volume, openPrice, closePrice) {
        const dir = type === 'BUY' ? 1 : -1;
        let profit = dir * (closePrice - openPrice) * volume * this.getContractSize(symbol);
        if (!symbol.endsWith('USD')) {
            // Quote currency is not USD — approximate conversion through price
            if (symbol.startsWith('USD') && closePrice > 0) profit = profit / closePrice;
            else if (closePrice > 0) profit = profit / closePrice; // crosses: rough estimate
        }
        return profit;
    }

    calcMargin(symbol, volume, price) {
        const notional = symbol.startsWith('USD')
            ? volume * this.getContractSize(symbol)
            : price * volume * this.getContractSize(symbol);
        return notional / 100; // 1:100 leverage
    }

    fmt(symbol, price) {
        return Number(price || 0).toFixed(this.getPrecision(symbol));
    }

    /* ── Current price source ───────────────────────────────────────────── */

    currentPrice(symbol) {
        if (this.isReplayMode) {
            const rm = window.replayManager;
            const bar = rm?.fullData?.[rm.currentIndex];
            return bar ? bar.close : null;
        }
        return null; // live uses async /api/price
    }

    /* ── Order form ─────────────────────────────────────────────────────── */

    _wireForm() {
        const e = this._els;
        e.buy.addEventListener('click', () => this._setSide('buy'));
        e.sell.addEventListener('click', () => this._setSide('sell'));
        e.orderType.addEventListener('change', () => {
            e.priceField.style.display = e.orderType.value === 'market' ? 'none' : 'block';
            this._updateSubmitLabel();
        });
        e.slOn.addEventListener('change', () => {
            e.sl.disabled = e.slUnit.disabled = !e.slOn.checked;
        });
        e.tpOn.addEventListener('change', () => {
            e.tp.disabled = e.tpUnit.disabled = !e.tpOn.checked;
        });
        e.symbol.addEventListener('change', () => this._updateSubmitLabel());
        e.volume.addEventListener('input', () => this._updateSubmitLabel());
        e.submit.addEventListener('click', () => this.executeOrder());
    }

    _setSide(side) {
        this.side = side;
        this._els.buy.classList.toggle('active', side === 'buy');
        this._els.sell.classList.toggle('active', side === 'sell');
        this._updateSubmitLabel();
    }

    _updateSubmitLabel() {
        const e = this._els;
        const side = this.side === 'buy' ? 'Buy' : 'Sell';
        e.submit.textContent = `${side} ${e.symbol.value || ''} ${parseFloat(e.volume.value || 0).toFixed(2)}`;
        e.submit.className = `op-submit ${this.side}`;
    }

    syncOrderSymbol() {
        const panel = window.chartManager?.activePanel;
        if (!panel || !this._els.symbol) return;
        if ([...this._els.symbol.options].some(o => o.value === panel.symbol)) {
            this._els.symbol.value = panel.symbol;
        }
        this._updateSubmitLabel();
    }

    async _loadSymbols() {
        try {
            const res = await fetch('/api/symbols');
            const result = await res.json();
            if (result.success && result.symbols?.length) {
                this._els.symbol.innerHTML = result.symbols
                    .map(s => `<option value="${s}">${s}</option>`).join('');
                this.syncOrderSymbol();
            }
        } catch (err) { /* keep defaults */ }
    }

    _resolveProtection(symbol, entryPrice, side, on, value, unit) {
        if (!on || !value || value <= 0) return 0;
        if (unit === 'price') return value;
        const dist = value * this.getPipSize(symbol);
        return side === 'BUY' ? entryPrice - dist : entryPrice + dist;
    }

    async executeOrder() {
        const e = this._els;
        const symbol = e.symbol.value;
        const volume = Math.max(0.01, parseFloat(e.volume.value) || 0.01);
        const orderType = e.orderType.value;

        if (this.isReplayMode) {
            const isBuy = orderType === 'market' ? this.side === 'buy' : orderType.startsWith('buy');
            let entryPrice = this.currentPrice(symbol);
            if (orderType !== 'market') {
                entryPrice = parseFloat(e.orderPrice.value);
                if (!entryPrice) { window.showToast('Enter an order price for pending orders.', 'error'); return; }
            }
            if (!entryPrice) { window.showToast('No replay price available yet.', 'error'); return; }

            const type = isBuy ? 'BUY' : 'SELL';
            const sl = this._resolveProtection(symbol, entryPrice, type, e.slOn.checked, parseFloat(e.sl.value), e.slUnit.value);
            const tp = this._resolveProtection(symbol, entryPrice, type, e.tpOn.checked, parseFloat(e.tp.value), e.tpUnit.value);

            if (orderType === 'market') this._openVirtualPosition(symbol, type, volume, entryPrice, sl, tp);
            else this._placeVirtualPending(symbol, orderType, volume, entryPrice, sl, tp);
            return;
        }

        // Live MT5 — market orders only
        if (orderType !== 'market') {
            window.showToast('Pending orders are only supported in replay mode.', 'error');
            return;
        }
        try {
            const res = await fetch('/api/trade/place', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ symbol, type: this.side.toUpperCase(), lots: volume, sl: 0, tp: 0 })
            });
            const result = await res.json();
            if (result.success) {
                window.showToast(`Order placed: ${this.side.toUpperCase()} ${volume} ${symbol}`, 'success');
                this.pollMT5TradeState();
            } else {
                window.showToast(result.message || 'Order rejected by MT5.', 'error');
            }
        } catch (err) {
            window.showToast('Order failed: ' + err.message, 'error');
        }
    }

    /* ── Virtual order management ───────────────────────────────────────── */

    _nextTicket() {
        return ++this.virtualAccount.ticket_counter;
    }

    _openVirtualPosition(symbol, type, volume, price, sl, tp, time = null) {
        const acc = this.virtualAccount;
        const rm = window.replayManager;
        acc.positions.push({
            ticket: this._nextTicket(),
            symbol, type, volume,
            price_open: price,
            price_current: price,
            sl, tp,
            margin: this.calcMargin(symbol, volume, price),
            profit: 0,
            time: time || rm?.cursorTimestamp || Math.floor(Date.now() / 1000)
        });
        this._saveVirtualAccount();
        this.updateAccountUI();
        this.renderTables();
        window.showToast(`Opened ${type} ${volume} ${symbol} @ ${this.fmt(symbol, price)}`, 'success');
    }

    _placeVirtualPending(symbol, orderType, volume, price, sl, tp) {
        const acc = this.virtualAccount;
        const rm = window.replayManager;
        acc.pending.push({
            ticket: this._nextTicket(),
            symbol,
            type: orderType.toUpperCase(),
            volume,
            price_order: price,
            sl, tp,
            time: rm?.cursorTimestamp || Math.floor(Date.now() / 1000)
        });
        this._saveVirtualAccount();
        this.updateAccountUI();
        this.renderTables();
        window.showToast(`Pending ${orderType.replace('_', ' ')} ${volume} ${symbol} @ ${this.fmt(symbol, price)}`, 'success');
    }

    closePosition(ticket) {
        if (this.isReplayMode) {
            const acc = this.virtualAccount;
            const idx = acc.positions.findIndex(p => p.ticket === ticket);
            if (idx < 0) return;
            const pos = acc.positions[idx];
            this._closeVirtualPosition(pos, pos.price_current, 'Closed');
            return;
        }
        fetch('/api/trade/close', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ticket })
        }).then(r => r.json()).then(result => {
            if (result.success) {
                window.showToast(`Closed #${ticket}`, 'success');
                this.pollMT5TradeState();
            } else {
                window.showToast(result.message || 'Close failed.', 'error');
            }
        }).catch(err => window.showToast('Close failed: ' + err.message, 'error'));
    }

    cancelPending(ticket) {
        const acc = this.virtualAccount;
        acc.pending = acc.pending.filter(p => p.ticket !== ticket);
        this._saveVirtualAccount();
        this.updateAccountUI();
        this.renderTables();
    }

    _closeVirtualPosition(pos, closePrice, result) {
        const acc = this.virtualAccount;
        const profit = this.calcProfit(pos.symbol, pos.type, pos.volume, pos.price_open, closePrice);
        acc.positions = acc.positions.filter(p => p.ticket !== pos.ticket);
        acc.balance += profit;
        acc.history.unshift({
            time: window.replayManager?.cursorTimestamp || Math.floor(Date.now() / 1000),
            ticket: pos.ticket, symbol: pos.symbol, type: pos.type, volume: pos.volume,
            price_open: pos.price_open, price_close: closePrice, profit, result
        });
        this._saveVirtualAccount();
        this.updateAccountUI();
        this.renderTables();
    }

    /* ── Replay tick: update P/L, fire SL/TP, activate pending ─────────── */

    onReplayTick(bar, symbol) {
        if (!this.isReplayMode || !bar || !symbol) return;
        const acc = this.virtualAccount;

        // Activate pending orders
        const remaining = [];
        for (const order of acc.pending) {
            if (order.symbol !== symbol) { remaining.push(order); continue; }
            const p = order.price_order;
            let triggered = false;
            let side = 'BUY';
            switch (order.type) {
                case 'BUY_LIMIT':  triggered = bar.low <= p;  side = 'BUY';  break;
                case 'BUY_STOP':   triggered = bar.high >= p; side = 'BUY';  break;
                case 'SELL_LIMIT': triggered = bar.high >= p; side = 'SELL'; break;
                case 'SELL_STOP':  triggered = bar.low <= p;  side = 'SELL'; break;
            }
            if (triggered) {
                this._openVirtualPosition(order.symbol, side, order.volume, p, order.sl, order.tp, bar.time);
                window.showToast(`Pending ${order.type} filled @ ${this.fmt(symbol, p)}`, 'success');
            } else {
                remaining.push(order);
            }
        }
        acc.pending = remaining;

        // Update open positions of this symbol
        for (const pos of [...acc.positions]) {
            if (pos.symbol !== symbol) continue;
            const dir = pos.type === 'BUY' ? 1 : -1;
            // Conservative: if SL and TP both inside one bar, SL first
            if (pos.sl > 0 && (dir === 1 ? bar.low <= pos.sl : bar.high >= pos.sl)) {
                this._closeVirtualPosition(pos, pos.sl, 'Stop Loss');
                continue;
            }
            if (pos.tp > 0 && (dir === 1 ? bar.high >= pos.tp : bar.low <= pos.tp)) {
                this._closeVirtualPosition(pos, pos.tp, 'Take Profit');
                continue;
            }
            pos.price_current = bar.close;
            pos.profit = this.calcProfit(pos.symbol, pos.type, pos.volume, pos.price_open, bar.close);
        }

        this._saveVirtualAccount();
        this.updateAccountUI();
        this.renderTables();
    }

    /* ── Account stats + dashboard rendering ────────────────────────────── */

    updateAccountUI() {
        let stats;
        if (this.isReplayMode) {
            const acc = this.virtualAccount;
            const floating = acc.positions.reduce((s, p) => s + (p.profit || 0), 0);
            const margin = acc.positions.reduce((s, p) => s + (p.margin || 0), 0);
            acc.margin = margin;
            acc.equity = acc.balance + floating;
            acc.free_margin = acc.equity - margin;
            acc.margin_level = margin > 0 ? (acc.equity / margin) * 100 : 0;
            stats = acc;
        } else {
            stats = this.liveAccount || {};
        }

        const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
        set('st-balance', fmtMoney(stats.balance));
        set('st-equity', fmtMoney(stats.equity));
        set('st-margin', fmtMoney(stats.margin));
        set('st-free', fmtMoney(stats.free_margin));
        set('st-level', Number(stats.margin_level || 0).toFixed(2) + '%');
    }

    renderTables() {
        const isReplay = this.isReplayMode;
        const positions = isReplay ? this.virtualAccount.positions : this.livePositions;
        const pending = isReplay ? this.virtualAccount.pending : [];
        const history = isReplay ? this.virtualAccount.history : this.liveHistory;

        document.getElementById('cnt-positions').textContent = positions.length;
        document.getElementById('cnt-pending').textContent = pending.length;

        // Positions
        const pr = document.getElementById('rows-positions');
        pr.innerHTML = positions.map(p => {
            const cls = p.profit >= 0 ? 'cell-pos' : 'cell-neg';
            return `<tr>
                <td>${p.ticket}</td><td>${p.symbol}</td>
                <td class="${p.type === 'BUY' ? 'cell-pos' : 'cell-neg'}">${p.type}</td>
                <td>${Number(p.volume).toFixed(2)}</td>
                <td>${this.fmt(p.symbol, p.price_open)}</td>
                <td>${this.fmt(p.symbol, p.price_current)}</td>
                <td>${p.sl > 0 ? this.fmt(p.symbol, p.sl) : '—'}</td>
                <td>${p.tp > 0 ? this.fmt(p.symbol, p.tp) : '—'}</td>
                <td class="${cls}">${fmtMoney(p.profit)}</td>
                <td><button class="row-close-btn" data-close-ticket="${p.ticket}">Close</button></td>
            </tr>`;
        }).join('');

        // Pending
        const pp = document.getElementById('rows-pending');
        pp.innerHTML = pending.map(o => `<tr>
            <td>${o.ticket}</td><td>${o.symbol}</td><td>${o.type.replace('_', ' ')}</td>
            <td>${Number(o.volume).toFixed(2)}</td>
            <td>${this.fmt(o.symbol, o.price_order)}</td>
            <td>${o.sl > 0 ? this.fmt(o.symbol, o.sl) : '—'}</td>
            <td>${o.tp > 0 ? this.fmt(o.symbol, o.tp) : '—'}</td>
            <td><button class="row-close-btn" data-cancel-ticket="${o.ticket}">Cancel</button></td>
        </tr>`).join('');

        // History
        const hr = document.getElementById('rows-history');
        hr.innerHTML = history.map(h => {
            const pl = h.profit ?? h.profit_total ?? 0;
            const cls = pl >= 0 ? 'cell-pos' : 'cell-neg';
            return `<tr>
                <td>${fmtTime(h.time)}</td><td>${h.ticket}</td><td>${h.symbol}</td>
                <td class="${h.type === 'BUY' ? 'cell-pos' : 'cell-neg'}">${h.type}</td>
                <td>${Number(h.volume).toFixed(2)}</td>
                <td>${this.fmt(h.symbol, h.price_open)}</td>
                <td>${h.price_close ? this.fmt(h.symbol, h.price_close) : '—'}</td>
                <td class="${cls}">${fmtMoney(pl)}</td>
                <td>${h.result || ''}</td>
            </tr>`;
        }).join('');

        // Row actions
        pr.querySelectorAll('[data-close-ticket]').forEach(btn =>
            btn.addEventListener('click', () => this.closePosition(Number(btn.dataset.closeTicket))));
        pp.querySelectorAll('[data-cancel-ticket]').forEach(btn =>
            btn.addEventListener('click', () => this.cancelPending(Number(btn.dataset.cancelTicket))));

        // Empty state
        const activeTab = document.querySelector('.bp-tab.active')?.dataset.bpTab || 'positions';
        const counts = { positions: positions.length, pending: pending.length, history: history.length };
        const emptyEl = document.getElementById('bp-empty');
        const messages = { positions: 'No open positions.', pending: 'No pending orders.', history: 'No trading history.' };
        emptyEl.textContent = messages[activeTab];
        emptyEl.style.display = counts[activeTab] === 0 ? 'block' : 'none';
    }

    /* ── Live mode polling ──────────────────────────────────────────────── */

    startPolling() {
        this._pollTimer = setInterval(() => {
            if (!this.isReplayMode) this.pollMT5TradeState();
        }, 2000);
        this._priceTimer = setInterval(() => this._updateOrderPrice(), 1500);
    }

    async pollMT5TradeState() {
        try {
            const [accRes, posRes] = await Promise.all([
                fetch('/api/trade/account').then(r => r.json()),
                fetch('/api/trade/positions').then(r => r.json())
            ]);
            if (accRes.success && accRes.account && Object.keys(accRes.account).length) {
                this.liveAccount = accRes.account;
            }
            if (posRes.success) this.livePositions = posRes.positions || [];
            this.updateAccountUI();
            this.renderTables();
        } catch (err) { /* MT5 offline — keep last state */ }
    }

    async loadLiveHistory() {
        try {
            const res = await fetch('/api/trade/history?days=365').then(r => r.json());
            if (res.success) this.liveHistory = res.history || [];
            this.renderTables();
        } catch (err) { /* ignore */ }
    }

    async _updateOrderPrice() {
        const el = this._els.price;
        if (!el) return;
        const symbol = this._els.symbol.value;
        if (!symbol) return;

        if (this.isReplayMode) {
            const price = this.currentPrice(symbol);
            el.textContent = price ? this.fmt(symbol, price) : '—';
            this._updateEstMargin(price);
            return;
        }
        try {
            const res = await fetch(`/api/price/${symbol}`).then(r => r.json());
            if (res.success && res.price) {
                const bid = res.price.bid ?? res.price;
                const ask = res.price.ask ?? res.price;
                el.textContent = `${this.fmt(symbol, bid)} / ${this.fmt(symbol, ask)}`;
                this._updateEstMargin(ask);
            }
        } catch (err) { /* offline */ }
    }

    _updateEstMargin(price) {
        if (!price) return;
        const symbol = this._els.symbol.value;
        const volume = Math.max(0.01, parseFloat(this._els.volume.value) || 0.01);
        this._els.margin.textContent = fmtMoney(this.calcMargin(symbol, volume, price));
    }

    /* ── Mode badge ─────────────────────────────────────────────────────── */

    refreshModeUI() {
        const replay = this.isReplayMode;
        this._els.badge.textContent = replay ? 'Replay' : (window.appMode === 'live' ? 'Live MT5' : 'Idle');
        this._els.note.textContent = replay
            ? 'Replay mode: orders execute against simulated prices at the replay cursor.'
            : window.appMode === 'live'
                ? 'Live mode: market orders are sent to your MT5 account. SL/TP must be set inside MT5.'
                : 'Start a replay or switch to MT5 data to trade.';
        this._updateSubmitLabel();
    }
}

window.tradeManager = new TradeManager();
