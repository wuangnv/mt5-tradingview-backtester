/**
 * charts.js — ChartManager & ChartPanel
 * TradingView widget lifecycle, multi-chart layouts, visible-range sync,
 * live polling and replay plumbing used by datafeed.js.
 *
 * Contract with datafeed.js (do not rename):
 *   window.chartManager.panels[]        — panel objects
 *   window.chartManager.activePanel
 *   window.chartManager.isReplayMode
 *   window.chartManager.syncPanelReplayToTimestamp(panel, ts, opts)
 *   panel.symbol / panel.timeframe / panel.isReplayMode
 *   panel.fullData / panel.replayIndex / panel.activeLoadPromise / panel.updateHeader()
 */

const TF_TO_RESOLUTION = { M1: '1', M5: '5', M15: '15', M30: '30', H1: '60', H4: '240', D1: 'D', W1: 'W' };

function resolutionToTimeframe(res) {
    const map = { '1': 'M1', '5': 'M5', '15': 'M15', '30': 'M30', '60': 'H1', '240': 'H4', 'D': 'D1', '1D': 'D1', 'W': 'W1', '1W': 'W1' };
    return map[res] || 'H1';
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
        this._syncingRange = false;
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
        this.widget = new TradingView.widget({
            symbol: this.symbol,
            interval: TF_TO_RESOLUTION[this.timeframe] || '60',
            container: host,
            library_path: '/static/charting_library/',
            datafeed: df,
            locale: 'en',
            theme: 'Dark',
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
            overrides: {
                'paneProperties.background': '#131722',
                'paneProperties.backgroundType': 'solid',
                'paneProperties.vertGridProperties.color': '#1e222d',
                'paneProperties.horzGridProperties.color': '#1e222d',
                'scalesProperties.textColor': '#787b86',
                'scalesProperties.lineColor': '#2a2e39',
                'mainSeriesProperties.candleStyle.upColor': '#26a69a',
                'mainSeriesProperties.candleStyle.downColor': '#ef5350',
                'mainSeriesProperties.candleStyle.borderUpColor': '#26a69a',
                'mainSeriesProperties.candleStyle.borderDownColor': '#ef5350',
                'mainSeriesProperties.candleStyle.wickUpColor': '#26a69a',
                'mainSeriesProperties.candleStyle.wickDownColor': '#ef5350'
            }
        });

        this.widget.onChartReady(() => {
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

            this.chart.onVisibleRangeChanged().subscribe(null, (range) => {
                if (this._syncingRange || !range) return;
                this.manager.syncTimeScale(this, range);
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
        this.panels = [];
        this.activePanel = null;
        this.gridEl = document.getElementById('charts-grid');
        this.layout = localStorage.getItem('wv_layout') || '1';
        this._liveTimer = null;
        this._defaults = [
            { symbol: 'EURUSD', timeframe: 'H1' },
            { symbol: 'AUDUSD', timeframe: 'H1' },
            { symbol: 'GBPJPY', timeframe: 'H1' },
            { symbol: 'XAUUSD', timeframe: 'H1' }
        ];
    }

    get isReplayMode() {
        return this.panels.some(p => p.isReplayMode);
    }

    init() {
        this.setLayout(this.layout);
        this._startLivePolling();
    }

    /* ── Layout ─────────────────────────────────────────────────────────── */

    _panelCount(layout) {
        return { '1': 1, '2v': 2, '2h': 2, '4': 4 }[layout] || 1;
    }

    setLayout(layout) {
        this.layout = layout;
        localStorage.setItem('wv_layout', layout);
        const target = this._panelCount(layout);

        this.gridEl.className = `layout-${layout}`;
        document.querySelectorAll('#layout-dropdown .dropdown-item').forEach(item => {
            item.classList.toggle('active', item.dataset.layout === layout);
        });

        // Destroy extra panels (replay must be exited first)
        while (this.panels.length > target) {
            const panel = this.panels.pop();
            if (panel.isReplayMode) window.replayManager?.stop();
            panel.destroy();
        }

        // Create missing panels
        while (this.panels.length < target) {
            const i = this.panels.length;
            const cfg = this._defaults[i] || this._defaults[0];
            const panel = new ChartPanel(this, i, cfg.symbol, cfg.timeframe);
            this.panels.push(panel);
            panel.mount(this.gridEl);
        }

        // Re-index after changes
        this.panels.forEach((p, i) => { p.index = i; });

        if (!this.activePanel || !this.panels.includes(this.activePanel)) {
            this.setActivePanel(this.panels[0]);
        } else {
            this.setActivePanel(this.activePanel);
        }
    }

    setActivePanel(panel) {
        if (!panel) return;
        this.activePanel = panel;
        this.panels.forEach(p => p.el && p.el.classList.toggle('active', p === panel));

        // In replay, make the replay manager track the newly active panel
        const rm = window.replayManager;
        if (panel.isReplayMode && rm && rm.active && Array.isArray(panel.fullData)) {
            rm.fullData = panel.fullData;
            rm.currentIndex = panel.replayIndex;
            rm.symbol = panel.symbol;
            rm.timeframe = panel.timeframe;
            rm._updateUI();
        }
    }

    onPanelChanged(panel) {
        if (panel === this.activePanel) window.tradeManager?.syncOrderSymbol();
    }

    /** Symbol/timeframe changed on a panel — resync replay data if needed. */
    onPanelConfigChanged(panel) {
        this.onPanelChanged(panel);
        const rm = window.replayManager;
        if (!panel.isReplayMode || !rm?.active || !rm.cursorTimestamp) return;

        // Invalidate stale data so datafeed falls back to the replay manager
        panel.fullData = null;
        panel.replayIndex = -1;

        this.syncPanelReplayToTimestamp(panel, rm.cursorTimestamp).then(() => {
            if (panel === this.activePanel && Array.isArray(panel.fullData)) {
                rm.fullData = panel.fullData;
                rm.currentIndex = panel.replayIndex;
                rm.symbol = panel.symbol;
                rm.timeframe = panel.timeframe;
                rm._lastDisplayedIndex = -1;
                rm._updateUI();
            }
        });
    }

    /* ── Visible-range sync across panels ───────────────────────────────── */

    syncTimeScale(sourcePanel, range) {
        for (const panel of this.panels) {
            if (panel === sourcePanel || !panel.chart) continue;
            try {
                panel._syncingRange = true;
                panel.chart.setVisibleRange(range);
            } catch (err) { /* range may be out of bounds for this symbol */ }
            finally {
                setTimeout(() => { panel._syncingRange = false; }, 50);
            }
        }
    }

    /* ── Replay plumbing (used by datafeed.js + replay.js) ──────────────── */

    /** Put every panel into replay mode synced to the cursor timestamp. */
    async enterReplayMode(cursorTs) {
        for (const panel of this.panels) {
            panel.isReplayMode = true;
            if (panel !== this.activePanel) {
                await this.syncPanelReplayToTimestamp(panel, cursorTs, { focus: false });
            }
        }
    }

    exitReplayMode() {
        for (const panel of this.panels) {
            panel.isReplayMode = false;
            panel.fullData = null;
            panel.replayIndex = -1;
            panel.resetData();
        }
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

    /** Re-apply all non-active replay panels to the shared cursor. */
    syncReplayPanelsToCursor(ts) {
        for (const panel of this.panels) {
            if (!panel.isReplayMode || panel === this.activePanel) continue;
            if (!Array.isArray(panel.fullData) || !panel.fullData.length) continue;
            const idx = window.MT5Datafeed.findIndexAtOrBefore(panel.fullData, ts);
            if (idx >= 0 && idx !== panel.replayIndex) {
                panel.replayIndex = idx;
                panel.resetData();
            }
        }
    }

    /* ── Live polling (live mode only) ──────────────────────────────────── */

    _startLivePolling() {
        this._liveTimer = setInterval(async () => {
            if (window.appMode !== 'live' || this.isReplayMode) return;
            for (const panel of this.panels) {
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
            }
        }, 10000);
    }
}

window.chartManager = new ChartManager();
