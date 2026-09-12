/**
 * app.js — bootstrap & global UI services
 * Toolbar actions, modals, drawers, toasts, veil, MT5 status, data mode,
 * history downloads, bottom-panel tabs.
 */

window.appMode = 'backtest';

/* ── Tiny global UI services ────────────────────────────────────────────── */

window.showToast = function (message, type = 'info') {
    const root = document.getElementById('toast-root');
    const el = document.createElement('div');
    el.className = `toast ${type}`;
    el.textContent = message;
    root.appendChild(el);
    setTimeout(() => { el.style.opacity = '0'; el.style.transition = 'opacity .3s'; }, 3600);
    setTimeout(() => el.remove(), 4000);
};

window.showVeil = function (text) {
    document.getElementById('stage-veil-text').textContent = text || 'Loading…';
    document.getElementById('stage-veil').classList.add('open');
};

window.hideVeil = function () {
    document.getElementById('stage-veil').classList.remove('open');
};

window.openModal = function (id) { document.getElementById(id).classList.add('open'); };
window.closeModal = function (id) { document.getElementById(id).classList.remove('open'); };

/* ── App bootstrap ──────────────────────────────────────────────────────── */

class App {
    constructor() {
        this._statusTimer = null;
    }

    init() {
        window.chartManager.init();
        window.tradeManager.startPolling();
        window.tradeManager.refreshModeUI();
        window.tradeManager.updateAccountUI();
        window.tradeManager.renderTables();

        this._wireTopbar();
        this._wireDrawers();
        this._wireModals();
        this._wireBottomPanel();
        this._initMode();
        this._pollStatus();
        this._statusTimer = setInterval(() => this._pollStatus(), 5000);
    }

    /* ── Topbar ─────────────────────────────────────────────────────────── */

    _wireTopbar() {
        document.getElementById('btn-replay').addEventListener('click', () =>
            window.replayManager.promptStart());
        document.getElementById('btn-history').addEventListener('click', () => this._openHistory());
        document.getElementById('btn-quit').addEventListener('click', () => this._quit());
        document.getElementById('btn-mode').addEventListener('click', () => this._toggleMode());

        const layoutBtn = document.getElementById('btn-layout');
        const dropdown = document.getElementById('layout-dropdown');
        layoutBtn.addEventListener('click', (ev) => {
            ev.stopPropagation();
            dropdown.classList.toggle('open');
        });
        document.addEventListener('click', () => dropdown.classList.remove('open'));
        dropdown.querySelectorAll('.dropdown-item').forEach(item => {
            item.addEventListener('click', () => {
                dropdown.classList.remove('open');
                window.chartManager.setLayout(item.dataset.layout);
            });
        });
    }

    _wireDrawers() {
        const order = document.getElementById('order-drawer');
        const playbook = document.getElementById('playbook-drawer');

        document.getElementById('btn-order').addEventListener('click', () => {
            playbook.classList.remove('open');
            order.classList.toggle('open');
            window.tradeManager.syncOrderSymbol();
            window.tradeManager.refreshModeUI();
        });
        document.getElementById('btn-playbook').addEventListener('click', () => {
            order.classList.remove('open');
            playbook.classList.toggle('open');
        });
        document.querySelectorAll('[data-close-drawer]').forEach(btn =>
            btn.addEventListener('click', () =>
                document.getElementById(btn.dataset.closeDrawer).classList.remove('open')));
    }

    _wireModals() {
        document.querySelectorAll('[data-close-modal]').forEach(btn =>
            btn.addEventListener('click', () => window.closeModal(btn.dataset.closeModal)));
        document.querySelectorAll('.modal-overlay').forEach(overlay =>
            overlay.addEventListener('click', (ev) => {
                if (ev.target === overlay) overlay.classList.remove('open');
            }));
    }

    /* ── Bottom panel tabs ──────────────────────────────────────────────── */

    _wireBottomPanel() {
        const panel = document.getElementById('bottom-panel');
        document.getElementById('bp-collapse').addEventListener('click', () =>
            panel.classList.toggle('collapsed'));

        document.querySelectorAll('.bp-tab').forEach(tab => {
            tab.addEventListener('click', () => {
                document.querySelectorAll('.bp-tab').forEach(t => t.classList.remove('active'));
                tab.classList.add('active');
                const name = tab.dataset.bpTab;
                for (const t of ['positions', 'pending', 'history']) {
                    document.getElementById(`tbl-${t}`).style.display = t === name ? 'table' : 'none';
                }
                if (name === 'history' && !window.chartManager.isReplayMode && window.appMode === 'live') {
                    window.tradeManager.loadLiveHistory();
                }
                window.tradeManager.renderTables();
            });
        });
    }

    /* ── Data mode (Local / Live MT5) ───────────────────────────────────── */

    async _initMode() {
        try {
            const res = await fetch('/api/mode').then(r => r.json());
            window.appMode = res.mode || 'backtest';
        } catch (err) { /* keep default */ }
        this._renderMode();
    }

    _renderMode() {
        const btn = document.getElementById('btn-mode');
        btn.textContent = window.appMode === 'live' ? 'MT5' : 'Local';
        btn.classList.toggle('active', window.appMode === 'live');
        window.tradeManager?.refreshModeUI();
    }

    async _toggleMode() {
        if (window.chartManager.isReplayMode) {
            window.showToast('Exit replay before switching data source.', 'error');
            return;
        }
        const next = window.appMode === 'live' ? 'backtest' : 'live';
        if (next === 'live' && !this._mt5Connected) {
            window.showToast('MT5 is not connected. Attach the MacGateway EA first.', 'error');
            return;
        }
        try {
            await fetch('/api/mode', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ mode: next })
            });
            window.appMode = next;
            this._renderMode();
            // Hard reset chart caches so data comes from the new source
            window.MT5Datafeed.historyCache.clear();
            for (const panel of window.chartManager.panels) panel.resetData();
            window.showToast(`Data source: ${next === 'live' ? 'Live MT5' : 'Local cache'}`, 'success');
        } catch (err) {
            window.showToast('Mode switch failed: ' + err.message, 'error');
        }
    }

    /* ── MT5 status ─────────────────────────────────────────────────────── */

    async _pollStatus() {
        const pill = document.getElementById('mt5-status');
        const text = document.getElementById('mt5-status-text');
        try {
            const res = await fetch('/api/status').then(r => r.json());
            this._mt5Connected = Boolean(res.connected);
            pill.classList.toggle('connected', this._mt5Connected);
            text.textContent = this._mt5Connected ? 'MT5' : 'MT5 offline';
            pill.title = res.message || '';
        } catch (err) {
            this._mt5Connected = false;
            pill.classList.remove('connected');
            text.textContent = 'MT5 offline';
        }
    }

    /* ── Quit ───────────────────────────────────────────────────────────── */

    async _quit() {
        if (!confirm('Shut down the trading app?')) return;
        try { await fetch('/api/shutdown', { method: 'POST' }); } catch (err) { /* already gone */ }
        document.body.innerHTML =
            '<div style="display:flex;height:100vh;align-items:center;justify-content:center;color:#787b86;font-family:sans-serif">App stopped. You can close this tab.</div>';
    }

    /* ── History modal ──────────────────────────────────────────────────── */

    async _openHistory() {
        window.openModal('modal-history');
        this._refreshHistoryFiles();
        const sel = document.getElementById('dl-symbols');
        if (!sel.options.length) {
            try {
                const res = await fetch('/api/symbols').then(r => r.json());
                const symbols = res.symbols?.length ? res.symbols : ['EURUSD', 'GBPUSD', 'USDJPY', 'XAUUSD'];
                sel.innerHTML = symbols.map(s => `<option value="${s}">${s}</option>`).join('');
                sel.options[0].selected = true;
            } catch (err) { /* ignore */ }
        }
    }

    async _refreshHistoryFiles() {
        const list = document.getElementById('dl-files');
        try {
            const res = await fetch('/api/history/status').then(r => r.json());
            const files = res.files || [];
            list.innerHTML = files.length ? files.map(f => `
                <div class="hist-row">
                    <span class="sym">${f.symbol}</span>
                    <span class="tf">${f.timeframe}</span>
                    <span class="bars">${Number(f.bars || 0).toLocaleString()} bars</span>
                    <button class="pb-mini-btn danger" data-del-history="${f.symbol}|${f.timeframe}">Delete</button>
                </div>`).join('')
                : '<p style="color:var(--text-dim);font-size:12px;font-style:italic">No local data yet.</p>';
            list.querySelectorAll('[data-del-history]').forEach(btn =>
                btn.addEventListener('click', async () => {
                    const [symbol, timeframe] = btn.dataset.delHistory.split('|');
                    await fetch('/api/history/delete', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ symbol, timeframe })
                    });
                    window.MT5Datafeed._localStatusCache = null;
                    this._refreshHistoryFiles();
                }));
        } catch (err) {
            list.innerHTML = '<p style="color:var(--down);font-size:12px">Failed to load status.</p>';
        }
    }

    async _startDownload() {
        const symbols = [...document.getElementById('dl-symbols').selectedOptions].map(o => o.value);
        const timeframes = [...document.getElementById('dl-timeframes').selectedOptions].map(o => o.value);
        const bars = Math.max(1000, parseInt(document.getElementById('dl-bars').value) || 50000);
        const progress = document.getElementById('dl-progress');

        if (!symbols.length || !timeframes.length) {
            window.showToast('Select at least one symbol and one timeframe.', 'error');
            return;
        }
        if (!this._mt5Connected) {
            window.showToast('MT5 must be connected to download history.', 'error');
            return;
        }

        const btn = document.getElementById('dl-start');
        btn.disabled = true;
        progress.classList.add('active');
        let done = 0;
        const total = symbols.length * timeframes.length;

        for (const symbol of symbols) {
            for (const timeframe of timeframes) {
                progress.textContent = `Downloading ${symbol} ${timeframe}… (${done}/${total})`;
                const result = await window.MT5Datafeed.downloadHistory(symbol, timeframe, bars);
                done += 1;
                if (!result.success) {
                    progress.textContent = `Failed ${symbol} ${timeframe}: ${result.message || 'unknown error'}`;
                    await new Promise(r => setTimeout(r, 1200));
                }
            }
        }

        progress.textContent = `Done — ${done}/${total} downloads finished.`;
        progress.classList.remove('active');
        btn.disabled = false;
        this._refreshHistoryFiles();
        window.showToast('History download complete.', 'success');
    }
}

document.addEventListener('DOMContentLoaded', () => {
    const app = new App();
    app.init();
    document.getElementById('dl-start').addEventListener('click', () => app._startDownload());
    window.app = app;
});
