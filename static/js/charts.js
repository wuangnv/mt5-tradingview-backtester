/**
 * charts.js — ChartManager & ChartPanel
 * TradingView widget lifecycle, live polling, and replay plumbing used by
 * datafeed.js. The workspace intentionally keeps one focused chart.
 *
 * Contract with datafeed.js (do not rename):
 *   window.chartManager.activePanel
 *   window.chartManager.isReplayMode
 *   panel.symbol / panel.timeframe / panel.isReplayMode
 *   panel.fullData / panel.replayIndex / panel.activeLoadPromise / panel.updateHeader()
 */

const TF_TO_RESOLUTION = { M1: '1', M5: '5', M15: '15', M30: '30', H1: '60', H4: '240', D1: 'D', W1: 'W' };

function resolutionToTimeframe(res) {
    const map = { '1': 'M1', '5': 'M5', '15': 'M15', '30': 'M30', '60': 'H1', '240': 'H4', 'D': 'D1', '1D': 'D1', 'W': 'W1', '1W': 'W1' };
    return map[res] || 'H1';
}

/** Chart color overrides matching the app theme. */
function chartOverrides(theme) {
    const candle = (up, down) => ({
        'mainSeriesProperties.candleStyle.upColor': up,
        'mainSeriesProperties.candleStyle.downColor': down,
        'mainSeriesProperties.candleStyle.borderUpColor': up,
        'mainSeriesProperties.candleStyle.borderDownColor': down,
        'mainSeriesProperties.candleStyle.wickUpColor': up,
        'mainSeriesProperties.candleStyle.wickDownColor': down
    });
    if (theme === 'Light') {
        return {
            'paneProperties.background': '#ffffff',
            'paneProperties.backgroundType': 'solid',
            'paneProperties.vertGridProperties.color': '#f0f3fa',
            'paneProperties.horzGridProperties.color': '#f0f3fa',
            'scalesProperties.textColor': '#131722',
            'scalesProperties.lineColor': '#e0e3eb',
            ...candle('#089981', '#f23645')
        };
    }
    return {
        'paneProperties.background': '#131722',
        'paneProperties.backgroundType': 'solid',
        'paneProperties.vertGridProperties.color': '#1e222d',
        'paneProperties.horzGridProperties.color': '#1e222d',
        'scalesProperties.textColor': '#787b86',
        'scalesProperties.lineColor': '#2a2e39',
        ...candle('#26a69a', '#ef5350')
    };
}

/* ==========================================================================
   ChartPanel — one TradingView widget instance
   ========================================================================== */

class ChartPanel {
    constructor(manager, index, symbol, timeframe) {
        this.manager = manager;
        this.index = index;
        this.symbol = symbol || 'EURUSD';
        this.timeframe = timeframe || 'H1';

        this.widget = null;
        this.chart = null;
        this.isReplayMode = false;
        this.fullData = null;
        this.replayIndex = -1;
        this.activeLoadPromise = null;

        this.el = null;
        this.tradeMarkers = [];
    }

    mount(gridEl) {
        this.el = document.createElement('div');
        this.el.className = 'chart-panel';
        this.el.id = `panel-${this.index}`;

        const frame = document.createElement('div');
        frame.className = 'panel-frame';
        const host = document.createElement('div');
        host.className = 'chart-widget-container';
        host.id = `tv-chart-${this.index}`;
        frame.appendChild(host);
        this.el.appendChild(frame);
        gridEl.appendChild(this.el);

        this.el.addEventListener('mousedown', () => this.manager.setActivePanel(this));
        this._createWidget(host);
    }

    _createWidget(host) {
        const df = window.MT5Datafeed;
        const theme = window.I18N ? window.I18N.tvTheme() : 'Dark';
        this.widget = new TradingView.widget({
            symbol: this.symbol,
            interval: TF_TO_RESOLUTION[this.timeframe] || '60',
            container: host,
            library_path: '/static/charting_library/',
            datafeed: df,
            locale: window.I18N ? window.I18N.tvLocale() : 'en',
            theme: theme,
            style: '1',
            autosize: true,
            fullscreen: false,
            timezone: 'Asia/Ho_Chi_Minh',
            time_scale: { time_visible: true, seconds_visible: false },
            disabled_features: [
                'volume_force_overlay',
                'trading_account_manager',
                'pine_editor',
                'header_compare',
                'popup_hints'
            ],
            enabled_features: [
                'study_templates',
                'drawing_templates',
                'left_toolbar',
                'use_localstorage_for_settings_save',
                'save_chart_properties_to_local_storage',
                'timeframes_toolbar',
                'create_volume_indicator_by_default',
                'countdown_to_bar_close',
                'items_favoriting'
            ],
            overrides: chartOverrides(theme)
        });

        this.widget.onChartReady(() => {
            if (!this.widget) return; // panel destroyed before chart became ready
            this.chart = this.widget.chart();

            this.chart.onSymbolChanged().subscribe(null, () => {
                const sym = this.chart.symbol();
                this.symbol = sym.includes(':') ? sym.split(':').pop() : sym;
                this.manager.onPanelConfigChanged(this);
            });

            this.chart.onIntervalChanged().subscribe(null, (interval) => {
                this.timeframe = resolutionToTimeframe(interval);
                this.manager.onPanelConfigChanged(this);
            });

            this.widget.subscribe('crossHairMoved', (e) => {
                if (e && e.time) window.lastCrosshairTime = e.time;
            });

            // Jump-mode seek: click on chart while replay jump mode is armed
            this.el.addEventListener('click', () => {
                const rm = window.replayManager;
                if (rm && rm.active && rm.isJumpMode && window.lastCrosshairTime) {
                    rm.seekToTime(window.lastCrosshairTime);
                }
            });

            this.manager.onPanelChanged(this);
        });
    }

    /** Kept for datafeed.js compatibility — the TV widget renders its own header. */
    updateHeader() {}

    /** Reset chart data through the datafeed cache-reset path. */
    resetData() {
        window.MT5Datafeed.resetReplayCache(this.symbol, this.timeframe);
    }

    destroy() {
        this.tradeMarkers.length = 0;
        try {
            if (this.widget && typeof this.widget.remove === 'function') this.widget.remove();
        } catch (err) {
            console.warn('[Charts] widget remove failed:', err);
        }
        if (this.el) this.el.remove();
        this.widget = null;
        this.chart = null;
    }
}

/* ==========================================================================
   ChartManager
   ========================================================================== */

class ChartManager {
    constructor() {
        this.activePanel = null;
        this.gridEl = document.getElementById('charts-grid');
        this._liveTimer = null;
    }

    get isReplayMode() {
        return Boolean(this.activePanel?.isReplayMode);
    }

    init() {
        this._mountPanel({ symbol: 'EURUSD', timeframe: 'H1' });
        this._startLivePolling();
    }

    _mountPanel(config) {
        const panel = new ChartPanel(this, 0, config.symbol, config.timeframe);
        this.activePanel = panel;
        panel.mount(this.gridEl);
        this.setActivePanel(panel);
        return panel;
    }

    /** Recreate the focused widget to apply a language or theme update. */
    rebuild() {
        if (this.isReplayMode) return false;
        const panel = this.activePanel;
        const config = {
            symbol: panel?.symbol || 'EURUSD',
            timeframe: panel?.timeframe || 'H1'
        };
        panel?.destroy();
        this.activePanel = null;
        this._mountPanel(config);
        return true;
    }

    setActivePanel(panel) {
        if (!panel) return;
        this.activePanel = panel;
    }

    onPanelChanged(panel) {
        if (panel === this.activePanel) window.tradeManager?.syncOrderSymbol();
    }

    /** Symbol/timeframe changed on the focused chart during replay. */
    async onPanelConfigChanged(panel) {
        this.onPanelChanged(panel);
        const rm = window.replayManager;
        if (!panel.isReplayMode || !rm?.active || !rm.cursorTimestamp) return;

        panel.fullData = null;
        panel.replayIndex = -1;
        await this.syncPanelReplayToTimestamp(panel, rm.cursorTimestamp);
        if (!Array.isArray(panel.fullData)) return;
        rm.fullData = panel.fullData;
        rm.currentIndex = panel.replayIndex;
        rm.symbol = panel.symbol;
        rm.timeframe = panel.timeframe;
        rm._lastDisplayedIndex = -1;
        rm._updateUI();
    }

    /* ── Replay plumbing (used by datafeed.js + replay.js) ──────────────── */

    /** Put the focused chart into replay mode. */
    async enterReplayMode() {
        if (this.activePanel) this.activePanel.isReplayMode = true;
    }

    exitReplayMode() {
        const panel = this.activePanel;
        if (!panel) return;
        panel.isReplayMode = false;
        panel.fullData = null;
        panel.replayIndex = -1;
        this._clearPanelMarkers(panel);
        panel.resetData();
    }

    /* ── Trade markers (execution arrows on chart) ──────────────────────── */

    /**
     * Draw an execution marker on the panel showing `symbol`.
     * marker: { time, price, direction: 'buy'|'sell', text, color? }
     */
    drawTradeMarker(symbol, marker) {
         const panel = this.activePanel;
         if (!panel?.chart || panel.symbol !== symbol) return;
        try {
            if (typeof panel.chart.createExecutionShape !== 'function') return;
            const shape = panel.chart.createExecutionShape({ font: '10px sans-serif' });
            shape.setDirection(marker.direction);
            if (marker.text) shape.setText(marker.text);
            if (marker.color) shape.setArrowColor(marker.color);
            shape.setTime(marker.time);
            shape.setPrice(marker.price);
            panel.tradeMarkers.push(shape);
        } catch (err) { /* bar outside loaded range — skip silently */ }
    }

    _clearPanelMarkers(panel) {
        for (const shape of panel.tradeMarkers.splice(0)) {
            try { shape.remove(); } catch (err) { /* already gone */ }
        }
    }

    clearTradeMarkers() {
        if (this.activePanel) this._clearPanelMarkers(this.activePanel);
    }

    /** Load data around ts into a panel and point its replay index at it. */
    async syncPanelReplayToTimestamp(panel, ts, opts = {}) {
        const df = window.MT5Datafeed;
        const task = (async () => {
            const data = await df.loadSyncedReplayWindow(panel.symbol, panel.timeframe, ts);
            if (data.length) {
                panel.fullData = data;
                let idx = df.findIndexAtOrBefore(data, ts);
                panel.replayIndex = Math.max(0, idx);
                panel.resetData();
            }
            return panel;
        })();
        panel.activeLoadPromise = task;
        try { await task; } finally {
            if (panel.activeLoadPromise === task) panel.activeLoadPromise = null;
        }
        return panel;
    }

    /* ── Live polling (live mode only) ──────────────────────────────────── */

    _startLivePolling() {
        this._liveTimer = setInterval(async () => {
            if (window.appMode !== 'live' || this.isReplayMode) return;
            const panel = this.activePanel;
            if (!panel) return;
            try {
                const res = await fetch('/api/data', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ symbol: panel.symbol, timeframe: panel.timeframe, bars: 2, mode: 'live' })
                });
                const result = await res.json();
                if (result.success && Array.isArray(result.data)) {
                    for (const bar of result.data.slice(-2)) {
                        window.MT5Datafeed.updateRealtime(panel.symbol, panel.timeframe, bar);
                    }
                }
            } catch (err) { /* transient — next poll retries */ }
        }, 10000);
    }
}

window.chartManager = new ChartManager();
