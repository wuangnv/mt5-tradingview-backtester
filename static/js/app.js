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
    document.getElementById('stage-veil-text').textContent = text || window.I18N?.t('misc.loading') || 'Loading…';
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
        this._initTheme();
        window.I18N.apply();

        window.chartManager.init();
        window.tradeManager.startPolling();
        window.tradeManager.refreshModeUI();
        window.tradeManager.updateAccountUI();
        window.tradeManager.renderTables();

        this._wireTopbar();
        this._wireDrawers();
        this._wireModals();
        this._wireBottomPanel();
        this._wireSettings();
        window.analytics.loadSessions();
        this._initMode();
        this._pollStatus();
        this._statusTimer = setInterval(() => this._pollStatus(), 5000);
    }

    /* ── Topbar ─────────────────────────────────────────────────────────── */

    _wireTopbar() {
        document.getElementById('btn-replay').addEventListener('click', () =>
            window.replayManager.promptStart());
        document.getElementById('btn-history').addEventListener('click', () => this._openHistory());
        document.getElementById('btn-mode').addEventListener('click', () => this._toggleMode());
    }

    /* ── Settings popover (language, theme, account reset, quit) ────────── */

    _initTheme() {
        document.documentElement.dataset.theme =
            localStorage.getItem('wv_theme') === 'light' ? 'light' : 'dark';
    }

    _wireSettings() {
        const btn = document.getElementById('btn-settings');
        const pop = document.getElementById('settings-dropdown');
        btn.addEventListener('click', (ev) => {
            ev.stopPropagation();
            pop.classList.toggle('open');
        });
        document.addEventListener('click', () => pop.classList.remove('open'));
        pop.addEventListener('click', (ev) => ev.stopPropagation());

        const syncSeg = () => {
            document.querySelectorAll('#set-lang .seg-btn').forEach(b =>
                b.classList.toggle('active', b.dataset.lang === window.I18N.lang));
            document.querySelectorAll('#set-theme .seg-btn').forEach(b =>
                b.classList.toggle('active', b.dataset.themeVal === (localStorage.getItem('wv_theme') === 'light' ? 'light' : 'dark')));
        };
        syncSeg();

        document.querySelectorAll('#set-lang .seg-btn').forEach(b =>
            b.addEventListener('click', () => {
                if (b.dataset.lang === window.I18N.lang) return;
                if (window.chartManager.isReplayMode) {
                    window.showToast(window.I18N.t('toast.exitReplayFirst'), 'error');
                    return;
                }
                window.I18N.setLang(b.dataset.lang);
                window.tradeManager.refreshModeUI();
                window.tradeManager.renderTables();
                window.tradingPlaybook.render();
                window.analytics.render();
                window.chartManager.rebuild();
                syncSeg();
            }));

        document.querySelectorAll('#set-theme .seg-btn').forEach(b =>
            b.addEventListener('click', () => {
                const theme = b.dataset.themeVal;
                if (theme === (localStorage.getItem('wv_theme') === 'light' ? 'light' : 'dark')) return;
                if (window.chartManager.isReplayMode) {
                    window.showToast(window.I18N.t('toast.exitReplayFirst'), 'error');
                    return;
                }
                localStorage.setItem('wv_theme', theme);
                document.documentElement.dataset.theme = theme;
                window.chartManager.rebuild();
                window.analytics.render();
                syncSeg();
            }));

        document.getElementById('set-reset').addEventListener('click', () => {
            pop.classList.remove('open');
            if (!confirm(window.I18N.t('set.resetConfirm'))) return;
            if (window.tradeManager.resetVirtualAccount()) {
                window.showToast(window.I18N.t('toast.accountReset'), 'success');
            }
        });
        document.getElementById('set-quit').addEventListener('click', () => {
            pop.classList.remove('open');
            this._quit();
        });
        document.getElementById('report-save').addEventListener('click', () =>
            window.analytics.savePendingReport());
        document.getElementById('report-export-csv').addEventListener('click', () =>
            window.analytics.exportPendingReportCsv());
        document.getElementById('report-export-png').addEventListener('click', () =>
            window.analytics.exportReportPng());
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
                document.getElementById('analytics-view').style.display = name === 'analytics' ? 'flex' : 'none';
                if (name === 'history' && !window.chartManager.isReplayMode && window.appMode === 'live') {
                    window.tradeManager.loadLiveHistory();
                }
                if (name === 'analytics') window.analytics.render();
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
        btn.textContent = window.appMode === 'live' ? window.I18N.t('mode.mt5') : window.I18N.t('mode.local');
        btn.classList.toggle('active', window.appMode === 'live');
        window.tradeManager?.refreshModeUI();
    }

    async _toggleMode() {
        if (window.chartManager.isReplayMode) {
            window.showToast(window.I18N.t('toast.modeSwitchBlock'), 'error');
            return;
        }
        const next = window.appMode === 'live' ? 'backtest' : 'live';
        if (next === 'live' && !this._mt5Connected) {
            window.showToast(window.I18N.t('toast.mt5Required'), 'error');
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
            window.chartManager.activePanel?.resetData();
            window.showToast(window.I18N.t(next === 'live' ? 'toast.modeLive' : 'toast.modeLocal'), 'success');
        } catch (err) {
            window.showToast(window.I18N.t('toast.modeFail', { msg: err.message }), 'error');
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
            text.textContent = this._mt5Connected ? 'MT5' : window.I18N.t('mt5.offline');
            pill.title = res.message || '';
        } catch (err) {
            this._mt5Connected = false;
            pill.classList.remove('connected');
            text.textContent = window.I18N.t('mt5.offline');
        }
    }

    /* ── Quit ───────────────────────────────────────────────────────────── */

    async _quit() {
        if (!confirm(window.I18N.t('toast.quitConfirm'))) return;
        try { await fetch('/api/shutdown', { method: 'POST' }); } catch (err) { /* already gone */ }
        document.body.innerHTML =
            `<div style="display:flex;height:100vh;align-items:center;justify-content:center;color:var(--text-dim);font-family:sans-serif">${window.I18N.t('misc.appStopped')}</div>`;
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
        const t = window.I18N;
        try {
            const res = await fetch('/api/history/status').then(r => r.json());
            const files = res.files || [];
            list.innerHTML = files.length ? files.map(f => `
                <div class="hist-row">
                    <span class="sym">${f.symbol}</span>
                    <span class="tf">${f.timeframe}</span>
                    <span class="bars">${t.t('misc.bars', { n: Number(f.bars || 0).toLocaleString() })}</span>
                    <button class="pb-mini-btn danger" data-del-history="${f.symbol}|${f.timeframe}">${t.t('misc.delete')}</button>
                </div>`).join('')
                : `<p style="color:var(--text-dim);font-size:12px;font-style:italic">${t.t('misc.noLocalData')}</p>`;
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
            list.innerHTML = `<p style="color:var(--down);font-size:12px">${t.t('misc.histLoadFail')}</p>`;
        }
    }

    async _startDownload() {
        const symbols = [...document.getElementById('dl-symbols').selectedOptions].map(o => o.value);
        const timeframes = [...document.getElementById('dl-timeframes').selectedOptions].map(o => o.value);
        const bars = Math.max(1000, parseInt(document.getElementById('dl-bars').value) || 50000);
        const progress = document.getElementById('dl-progress');

        if (!symbols.length || !timeframes.length) {
            window.showToast(window.I18N.t('toast.selectSymTf'), 'error');
            return;
        }
        if (!this._mt5Connected) {
            window.showToast(window.I18N.t('toast.mt5Download'), 'error');
            return;
        }

        const btn = document.getElementById('dl-start');
        const t = window.I18N;
        btn.disabled = true;
        progress.classList.add('active');
        let done = 0;
        const total = symbols.length * timeframes.length;

        for (const symbol of symbols) {
            for (const timeframe of timeframes) {
                progress.textContent = t.t('dl.progress', { symbol, timeframe, done, total });
                const result = await window.MT5Datafeed.downloadHistory(symbol, timeframe, bars);
                done += 1;
                if (!result.success) {
                    progress.textContent = t.t('dl.failed', { symbol, timeframe, msg: result.message || 'unknown error' });
                    await new Promise(r => setTimeout(r, 1200));
                }
            }
        }

        progress.textContent = t.t('dl.done', { done, total });
        progress.classList.remove('active');
        btn.disabled = false;
        this._refreshHistoryFiles();
        window.showToast(t.t('toast.dlDone'), 'success');
    }
}

document.addEventListener('DOMContentLoaded', () => {
    const app = new App();
    app.init();
    document.getElementById('dl-start').addEventListener('click', () => app._startDownload());
    window.app = app;
});
