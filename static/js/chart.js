// Main Chart Manager - TradingView Style (Multi-Chart Grid Layout)

// ─── ChartPanel Class (Independent Panel) ──────────────────────────────────
class ChartPanel {
    constructor(id, containerEl, symbol, timeframe, manager) {
        this.id = id;
        this.containerEl = containerEl; // wrapper element
        this.wrapperEl = containerEl; // alias
        this.symbol = symbol;
        this.timeframe = timeframe;
        this.manager = manager;

        this.fullData = [];
        this.isReplayMode = false;
        this.replayIndex = null;
        this.replayPlaying = false;

        this.chart = null;
        this.candlestickSeries = null;

        this.init();
    }

    init() {
        this.createElements();
        this.createChart();
    }

    createElements() {
        // Create the header overlay
        this.headerEl = document.createElement('div');
        this.headerEl.className = 'chart-panel-header';
        this.containerEl.appendChild(this.headerEl);
        this.updateHeader();

        // Create the crosshair sync line (for sync-crosshair)
        this.syncLineEl = document.createElement('div');
        this.syncLineEl.className = 'crosshair-sync-line';
        this.containerEl.appendChild(this.syncLineEl);

        // Create actual chart container inside wrapper
        this.chartContainerEl = document.createElement('div');
        this.chartContainerEl.className = 'chart-panel-container';
        this.containerEl.appendChild(this.chartContainerEl);

        // Click wrapper to make this panel active
        this.containerEl.addEventListener('mousedown', () => {
            this.manager.setActivePanel(this);
        });
    }

    updateHeader() {
        if (this.headerEl) {
            this.headerEl.innerHTML = `
                <span class="panel-symbol">${this.symbol}</span>
                <span class="panel-timeframe">${this.timeframe}</span>
            `;
        }
    }

    async fetchHistory(bars = 2000, options = {}) {
        if (!window.MT5Datafeed?.fetchHistory) return [];
        const data = await window.MT5Datafeed.fetchHistory(this.symbol, this.timeframe, bars, options);
        if (data && data.length > 0) {
            this.fullData = data;
            this.updateTradeSnapshot(data[data.length - 1]);
        }
        return data || [];
    }

    updateTradeSnapshot(lastBar) {
        if (!lastBar || !window.tradeManager) return;
        const spread = window.tradeManager.getSpread(this.symbol);
        window.tradeManager.currentBid = lastBar.close;
        window.tradeManager.currentAsk = lastBar.close + spread;

        const precision = window.tradeManager.getPrecision(this.symbol);
        const quickSellEl = document.getElementById('quick-sell-price');
        const quickBuyEl = document.getElementById('quick-buy-price');
        if (quickSellEl) quickSellEl.textContent = window.tradeManager.currentBid.toFixed(precision);
        if (quickBuyEl) quickBuyEl.textContent = window.tradeManager.currentAsk.toFixed(precision);

        window.tradeManager.updateSLTPDefaultValues();
        window.tradeManager.updateRiskRewardCalcs();
        window.tradeManager.updateExecutionButton();
    }

    prewarmReplayTimeframes(targetTimestamp) {
        if (!window.MT5Datafeed?.fetchHistory || !targetTimestamp) return;

        const tfSeconds = {
            'M1': 60,
            'M5': 300,
            'M15': 900,
            'M30': 1800,
            'H1': 3600,
            'H4': 14400,
            'D1': 86400,
            'W1': 604800
        };
        const preferred = ['M5', 'M15', 'M30', 'H1', 'H4', 'D1'];
        const symbol = this.symbol;
        const currentTf = this.timeframe;
        const queue = preferred.filter(tf =>
            tf !== currentTf &&
            !window.MT5Datafeed.hasHistoryCoverage(symbol, tf, targetTimestamp)
        );

        let chain = Promise.resolve();
        queue.forEach((tf, idx) => {
            chain = chain.then(() => new Promise(resolve => {
                setTimeout(async () => {
                    try {
                        if (!this.isReplayMode) {
                            resolve();
                            return;
                        }
                        const secondsDiff = Math.max(0, Math.floor(Date.now() / 1000) - targetTimestamp);
                        const estimatedBars = Math.ceil((secondsDiff / (tfSeconds[tf] || 3600)) * 1.15);
                        const bars = Math.max(2000, Math.min(estimatedBars, 12000));
                        console.log(`[ChartPanel ${this.id}] Background replay cache warm-up: ${symbol} ${tf} ${bars} bars`);
                        await window.MT5Datafeed.fetchHistory(symbol, tf, bars);
                    } catch (err) {
                        console.warn(`[ChartPanel ${this.id}] Replay cache warm-up skipped for ${tf}:`, err);
                    }
                    resolve();
                }, idx === 0 ? 800 : 350);
            }));
        });
    }

    createChart() {
        this.chartContainerEl.id = 'chart_container_' + this.id;

        const resMap = {
            'M1': '1',
            'M5': '5',
            'M15': '15',
            'M30': '30',
            'H1': '60',
            'H4': '240',
            'D1': 'D',
            'W1': 'W'
        };
        const res = resMap[this.timeframe] || '60';
        const pad = value => String(value).padStart(2, '0');
        const formatChartDate = date =>
            `${pad(date.getUTCDate())}/${pad(date.getUTCMonth() + 1)}/${date.getUTCFullYear()}`;
        const formatChartDateTime = date =>
            `${formatChartDate(date)} ${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}`;

        this.tvWidget = new TradingView.widget({
            symbol: this.symbol,
            interval: res,
            container: this.chartContainerEl,
            library_path: '/static/charting_library/',
            datafeed: window.MT5Datafeed,
            locale: 'en',
            theme: 'Dark',
            style: '1', // Candlestick
            autosize: true,
            fullscreen: false,
            time_scale: {
                time_visible: true,
                seconds_visible: false
            },
            custom_formatters: {
                timeFormatter: {
                    format: formatChartDateTime,
                    formatLocal: formatChartDateTime
                },
                dateFormatter: {
                    format: formatChartDate,
                    formatLocal: formatChartDate
                },
                tickMarkFormatter: (date, tickMarkType) => {
                    if (['Time', 'TimeWithSeconds'].includes(tickMarkType)) {
                        return `${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}`;
                    }
                    if (tickMarkType === 'DayOfMonth') {
                        return `${pad(date.getUTCDate())}/${pad(date.getUTCMonth() + 1)}`;
                    }
                    return formatChartDate(date);
                }
            },
            disabled_features: [
                'volume_force_overlay',
                'bottom_widget_bar',
                'trading_account_manager',
                'pine_editor'
            ],
            enabled_features: [
                'study_templates',
                'side_toolbar_in_fullscreen_mode',
                'drawing_templates',
                'left_toolbar',
                'use_localstorage_for_settings_save',
                'save_chart_properties_to_local_storage',
                'timeframes_toolbar',
                'create_volume_indicator_by_default',
                'countdown_to_bar_close',
                'bid_ask_labels',
                'show_interval_dialog_on_key_press',
                'items_favoriting'
            ],
            overrides: {
                'paneProperties.background': '#0b0714',
                'paneProperties.vertGridProperties.color': 'rgba(43, 33, 65, 0.15)',
                'paneProperties.horzGridProperties.color': 'rgba(43, 33, 65, 0.15)',
                'symbolWatermarkProperties.transparency': 90,
                'scalesProperties.textColor': '#eee5ff',
                'mainSeriesProperties.candleStyle.upColor': '#089981',
                'mainSeriesProperties.candleStyle.downColor': '#f23645',
                'mainSeriesProperties.candleStyle.drawWick': true,
                'mainSeriesProperties.candleStyle.drawBorder': true,
                'mainSeriesProperties.candleStyle.borderColor': '#089981',
                'mainSeriesProperties.candleStyle.borderUpColor': '#089981',
                'mainSeriesProperties.candleStyle.borderDownColor': '#f23645',
                'mainSeriesProperties.candleStyle.wickUpColor': '#089981',
                'mainSeriesProperties.candleStyle.wickDownColor': '#f23645'
            }
        });

        this.tvWidget.onChartReady(() => {
            this.chartReady = true;
            this.chart = this.tvWidget.chart();

            // Set scale margins
            try {
                this.chart.priceScale('right').setMode(1);
            } catch (_) {}

            // Set drawing tool if any is active in sidebar
            const activeTool = this.manager.activeTool || 'cursor';
            this.manager.selectTool(activeTool);

            // Draw visual lines for active positions
            if (window.tradeManager) {
                window.tradeManager.drawAllChartLines();
            }

            // Subscribe to visible range changed for Scroll/Zoom sync with feedback loop protection
            try {
                this.chart.onVisibleRangeChanged().subscribe(null, (range) => {
                    if (this._ignoreRangeChanged) return;
                    if (this.manager.activePanel === this && this.manager.syncScroll) {
                        this.manager.syncTimeScale(this.id, range);
                    }
                });
            } catch (e) {
                console.error("Error subscribing to onVisibleRangeChanged:", e);
            }

            // Subscribe to crosshair moved
            try {
                this.chart.crossHairMoved().subscribe(null, (params) => {
                    if (params && params.time) {
                        window.lastCrosshairTime = params.time;

                        // Dynamically switch active panel to this one when mouse hovers over it
                        if (this.manager.activePanel !== this) {
                            this.manager.setActivePanel(this);
                        }

                        if (this.manager.activePanel === this && this.manager.syncCrosshair) {
                            this.manager.syncCrosshairMove(this.id, params.time);
                        }
                    } else {
                        if (this.manager.activePanel === this && this.manager.syncCrosshair) {
                            this.manager.syncCrosshairMove(this.id, null);
                        }
                    }
                });
            } catch (e) {
                console.error("Error subscribing to crossHairMoved:", e);
            }

            // Add click/mousedown listeners inside the iframe for robust activePanel switching
            try {
                const iframe = this.chartContainerEl.querySelector('iframe');
                if (iframe) {
                    const onIframeInteraction = () => {
                        if (this.manager.activePanel !== this) {
                            this.manager.setActivePanel(this);
                        }
                    };

                    iframe.addEventListener('load', () => {
                        try {
                            const iframeDoc = iframe.contentDocument || iframe.contentWindow.document;
                            if (iframeDoc) {
                                iframeDoc.addEventListener('mousedown', onIframeInteraction);
                                iframeDoc.addEventListener('touchstart', onIframeInteraction);
                            }
                        } catch (e) {
                            console.warn("Could not bind direct iframe DOM listener (same-origin check):", e);
                        }
                    });

                    // In case iframe has already loaded:
                    try {
                        const iframeDoc = iframe.contentDocument || iframe.contentWindow.document;
                        if (iframeDoc) {
                            iframeDoc.addEventListener('mousedown', onIframeInteraction);
                            iframeDoc.addEventListener('touchstart', onIframeInteraction);
                        }
                    } catch (e) {}
                }
            } catch (e) {
                console.error("Error binding iframe interaction listeners:", e);
            }

            // Subscribe to mouse_up for Jump Mode
            try {
                this.tvWidget.subscribe('mouse_up', (event) => {
                    if (window.chartManager && window.chartManager.isReplayMode && window.replayManager && window.replayManager.isJumpMode) {
                        if (window.lastCrosshairTime) {
                            window.replayManager.seekToTime(window.lastCrosshairTime);
                            window.replayManager.toggleJumpMode(); // Toggle off Jump Mode
                        }
                    }
                });
            } catch (e) {
                console.error("Error subscribing to mouse_up:", e);
            }

            // Subscribe to mouse_dblclick to Reset Scale
            try {
                this.tvWidget.subscribe('mouse_dblclick', () => {
                    console.log(`[Chart ${this.id}] Native double click detected! Resetting scale.`);
                    if (this.chartReady && this.chart) {
                        try {
                            this.chart.executeActionById('timeScaleReset');
                        } catch (e) {
                            console.error("Error resetting time scale:", e);
                        }
                    }
                });
            } catch (e) {
                console.error("Error subscribing to mouse_dblclick:", e);
            }

            // Subscribe to native symbol changes to sync dashboard and panel
            try {
                this.chart.onSymbolChanged().subscribe(null, async (symbolInfo) => {
                    console.log(`[Chart ${this.id}] Native symbol changed to: ${symbolInfo.name}`);
                    if (this.symbol !== symbolInfo.name) {
                        // Sync hidden symbol select if this is the active panel
                        if (this.manager.activePanel === this) {
                            const sel = document.getElementById('symbol-select');
                            if (sel) {
                                sel.value = symbolInfo.name;
                            }
                            // Sync new TV navbar active symbol text
                            const activeSymText = document.getElementById('active-symbol-text');
                            if (activeSymText) activeSymText.textContent = symbolInfo.name;
                        }

                        await this.changeSymbolOrTimeframe(symbolInfo.name, this.timeframe, true);
                    }
                });
            } catch (e) {
                console.error("Error subscribing to onSymbolChanged:", e);
            }

            // Subscribe to native timeframe changes to sync dashboard and panel
            try {
                this.chart.onIntervalChanged().subscribe(null, async (interval) => {
                    console.log(`[Chart ${this.id}] Native interval changed to: ${interval}`);
                    const invResMap = {
                        '1': 'M1',
                        '5': 'M5',
                        '15': 'M15',
                        '30': 'M30',
                        '60': 'H1',
                        '240': 'H4',
                        'D': 'D1',
                        '1D': 'D1',
                        'W': 'W1',
                        '1W': 'W1'
                    };
                    const newTf = invResMap[interval] || 'H1';
                    if (this.timeframe !== newTf) {
                        // Sync hidden timeframe buttons if this is the active panel
                        if (this.manager.activePanel === this) {
                            document.querySelectorAll('.tf-btn, .nav-tf-btn').forEach(btn => {
                                btn.classList.toggle('active', btn.dataset.tf === newTf);
                            });
                        }

                        await this.changeSymbolOrTimeframe(this.symbol, newTf, true);
                    }
                });
            } catch (e) {
                console.error("Error subscribing to onIntervalChanged:", e);
            }
        });
    }

    async loadData() {
        const resMap = {
            'M1': '1',
            'M5': '5',
            'M15': '15',
            'M30': '30',
            'H1': '60',
            'H4': '240',
            'D1': 'D',
            'W1': 'W'
        };
        const res = resMap[this.timeframe] || '60';

        // 1. Pre-fetch 2000 bars history and store the promise so getBars() can share it
        this.activeLoadPromise = (async () => {
            try {
                console.log(`[ChartPanel ${this.id}] Loading 2000 bars for ${this.symbol} (${this.timeframe})`);
                const data = await this.fetchHistory(2000);
                if (data.length > 0) {
                    console.log(`[ChartPanel ${this.id}] Loaded ${data.length} bars successfully.`);
                    return data;
                }
            } catch (err) {
                console.error(`[ChartPanel ${this.id}] Error loading data:`, err);
            }
            return [];
        })();

        // 2. Tell TV to update symbol/resolution (this will asynchronously trigger MT5Datafeed.getBars)
        if (this.chartReady && this.tvWidget) {
            try {
                this.tvWidget.setSymbol(this.symbol, res);
            } catch (err) {
                console.error("Error setting symbol and resolution:", err);
            }
        }

        // 3. Await the pre-fetch promise so this.fullData is guaranteed populated when loadData resolves
        await this.activeLoadPromise;
        this.activeLoadPromise = null;
    }

    async loadMoreData(barCount = 10000) {
        try {
            console.log(`[ChartPanel ${this.id}] loadMoreData: requesting ${barCount} bars for ${this.symbol} (${this.timeframe})`);
            const data = await this.fetchHistory(barCount, { force: true });
            if (data.length > 0) {
                this.fullData = data;
                console.log(`[ChartPanel ${this.id}] loadMoreData successfully loaded ${this.fullData.length} bars.`);

                // Clear the cache for datafeed
                window.MT5Datafeed.resetReplayCache(this.symbol, this.timeframe);

                // Force TradingView to request data again
                const resMap = {
                    'M1': '1',
                    'M5': '5',
                    'M15': '15',
                    'M30': '30',
                    'H1': '60',
                    'H4': '240',
                    'D1': 'D',
                    'W1': 'W'
                };
                const res = resMap[this.timeframe] || '60';
                if (this.tvWidget && this.chartReady) {
                    this.tvWidget.setSymbol(this.symbol, res);
                }
                return true;
            }
        } catch (err) {
            console.error(`[ChartPanel ${this.id}] Error in loadMoreData:`, err);
        }
        return false;
    }

    async changeSymbolOrTimeframe(newSymbol, newTf, skipSetSymbol = false) {
        const oldSymbol = this.symbol;
        const oldTf = this.timeframe;

        if (oldSymbol === newSymbol && oldTf === newTf) return;

        console.log(`[ChartPanel ${this.id}] Changing symbol/timeframe from ${oldSymbol} (${oldTf}) to ${newSymbol} (${newTf}), skipSetSymbol: ${skipSetSymbol}`);

        let savedReplayTimestamp = null;
        const wasReplay = this.isReplayMode;

        if (wasReplay && this.replayIndex !== null && this.fullData && this.fullData.length > 0) {
            const currentBar = this.fullData[this.replayIndex];
            if (currentBar) {
                savedReplayTimestamp = currentBar.time;
            }
        }

        this.symbol = newSymbol;
        this.timeframe = newTf;
        this.updateHeader();

        // 1. Calculate dynamic bars to pre-fetch if in Replay Mode
        let barsToFetch = 2000;
        if (wasReplay && savedReplayTimestamp) {
            const timeframeSeconds = {
                'M1': 60,
                'M5': 300,
                'M15': 900,
                'M30': 1800,
                'H1': 3600,
                'H4': 14400,
                'D1': 86400,
                'W1': 604800
            }[newTf] || 3600;

            // Get approximate seconds difference from now/latest possible time
            const nowSeconds = Math.floor(Date.now() / 1000);
            const secondsDiff = nowSeconds - savedReplayTimestamp;
            let estimatedBars = Math.ceil((secondsDiff / timeframeSeconds) * 1.15); // 15% safety buffer

            if (estimatedBars > 2000) {
                barsToFetch = Math.max(2000, Math.min(estimatedBars, 40000)); // Cap at 40k for automatic swapping speed
                console.log(`[ChartPanel ${this.id}] Replay active. Target timestamp is older than 2000 bars. Dynamically pre-fetching ${barsToFetch} bars.`);
            }
        }

        // 2. Pre-fetch bars from backend first. Reuse frontend history cache when
        // it already covers the replay timestamp, so timeframe toggles are instant.
        this.activeLoadPromise = (async () => {
            try {
                const cached = window.MT5Datafeed?.getCachedHistory?.(newSymbol, newTf);
                if (wasReplay && savedReplayTimestamp && window.MT5Datafeed?.hasHistoryCoverage?.(newSymbol, newTf, savedReplayTimestamp)) {
                    this.fullData = cached;
                    this.updateTradeSnapshot(cached[cached.length - 1]);
                    console.log(`[ChartPanel ${this.id}] Reused cached ${newTf} history for replay timestamp.`);
                    return cached;
                }

                console.log(`[ChartPanel ${this.id}] Loading ${barsToFetch} bars for ${newSymbol} (${newTf})`);
                const data = await this.fetchHistory(barsToFetch);
                if (data.length > 0) {
                    console.log(`[ChartPanel ${this.id}] Loaded ${data.length} bars successfully.`);
                    return data;
                }
            } catch (err) {
                console.error(`[ChartPanel ${this.id}] Error loading data:`, err);
            }
            return [];
        })();

        const data = await this.activeLoadPromise;
        this.activeLoadPromise = null;

        // 3. If in replay mode, find bestIndex and update replayManager BEFORE changing TV resolution
        if (wasReplay && savedReplayTimestamp && data.length > 0) {
            let bestIndex = 0;
            let minDiff = Infinity;
            for (let i = 0; i < data.length; i++) {
                const diff = Math.abs(data[i].time - savedReplayTimestamp);
                if (diff < minDiff) {
                    minDiff = diff;
                    bestIndex = i;
                }
            }

            this.replayIndex = bestIndex;
            if (window.replayManager) {
                window.replayManager.fullData = data;
                window.replayManager.currentIndex = bestIndex;
                window.replayManager._lastDisplayedIndex = -1; // Reset display tracking
                window.replayManager._updateUI();
            }
        }

        // 4. Update symbol/resolution in TradingView Widget
        const resMap = {
            'M1': '1',
            'M5': '5',
            'M15': '15',
            'M30': '30',
            'H1': '60',
            'H4': '240',
            'D1': 'D',
            'W1': 'W'
        };
        const res = resMap[newTf] || '60';
        if (this.chartReady && this.tvWidget) {
            try {
                window.MT5Datafeed.resetReplayCache(newSymbol, newTf);
                if (!skipSetSymbol) {
                    this.tvWidget.setSymbol(newSymbol, res);
                }
            } catch (err) {
                console.error("Error setting symbol and resolution:", err);
            }
        }
    }

    enterReplayMode() {
        if (this.fullData.length === 0) {
            alert('Please load data first!');
            return;
        }

        this.isReplayMode = true;
        document.getElementById('tv-replay-toolbar').style.display = 'flex';
        document.querySelector('.chart-area').classList.add('replay-mode');

        let startIndex = Math.floor(this.fullData.length * 0.7);
        this.replayIndex = startIndex;
        this.replayPlaying = false;

        if (window.replayManager) {
            window.replayManager.startFromIndex(this.fullData, startIndex);
        }

        const startBar = this.fullData[startIndex];
        if (startBar) this.prewarmReplayTimeframes(startBar.time);
    }

    exitReplayMode() {
        this.isReplayMode = false;
        this.replayPlaying = false;
        this.replayIndex = null;
        document.getElementById('tv-replay-toolbar').style.display = 'none';
        document.querySelector('.chart-area').classList.remove('replay-mode');

        if (window.replayManager) window.replayManager.stop();

        // Reset datafeed cache to show full live chart data again
        window.MT5Datafeed.resetReplayCache(this.symbol, this.timeframe);
    }

    setJumpMode(enabled) {
        document.querySelector('.chart-area').classList.toggle('jump-mode', enabled);
    }

    cancelCurrentDrawing() {
        try {
            if (this.chartReady && this.chart) {
                this.chart.selectLineTool('cursor');
            }
        } catch (_) {}
    }

    destroy() {
        if (this.tvWidget) {
            try {
                this.tvWidget.remove();
            } catch (_) {}
        }
        this.containerEl.innerHTML = '';
    }
}

// ─── ChartManager Class (Coordinator) ──────────────────────────────────────
class ChartManager {
    constructor() {
        this.panels = [];
        this.activePanel = null;
        this.activeLayout = '1';
        this.syncScroll = false;
        this.syncCrosshair = false;
        this.allSymbols = [];

        // Drawing tools state
        this.activeTool = 'cursor';

        this.timezoneOffset = 7; // Default UTC+7 (Vietnam)

        // Settings Modal State
        this.activeSettingsDrawing = null;
        this.activeSettingsPanel = null;
        this.isNewSettingsDrawing = false;
        this.originalDrawingState = null;

        // Internal synchronization flags to avoid feedback loops
        this._syncingTimeScale = false;
        this._syncingCrosshair = false;

        // Periodic live chart polling loop (fetches full candle updates from MT5 on a slower loop)
        this.liveChartInterval = setInterval(() => {
            this.pollLiveCharts();
        }, 10000);

        this.init();
    }

    init() {
        const savedLayout = localStorage.getItem('activeLayout') || '1';
        this.activeLayout = savedLayout;

        this.setLayout(this.activeLayout);
        this.setupEventListeners();

        // Load API status and symbols in background asynchronously
        this.checkMT5Status();
        this.loadSymbols();

        // Poll status every 8 seconds to auto-reconnect and refresh UI
        console.log('[ChartManager] Initializing status check polling interval (every 8s)...');
        setInterval(() => {
            this.checkMT5Status();
        }, 8000);
    }

    async pollLiveCharts() {
        this.panels.forEach(async (p) => {
            if (p.chartReady && p.chart && !p.isReplayMode) {
                try {
                    const res = await fetch('/api/data', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            symbol: p.symbol,
                            timeframe: p.timeframe,
                            bars: 2,
                        }),
                    });
                    const result = await res.json();
                    if (result.success && result.data && result.data.length > 0) {
                        // 1. Filter out historical bars in the past to prevent exceptions
                        const lastTimestamp = p.fullData && p.fullData.length > 0 ? p.fullData[p.fullData.length - 1].time : 0;
                        const validBars = result.data.filter(bar => bar.time >= lastTimestamp);

                        validBars.forEach(bar => {
                            try {
                                window.MT5Datafeed.updateRealtime(p.symbol, p.timeframe, bar);
                            } catch (err) {
                                console.error(`Error updating bar for panel ${p.id}:`, err);
                            }
                        });

                        // 2. Keep p.fullData in sync
                        if (!p.fullData) p.fullData = [];
                        result.data.forEach(bar => {
                            const idx = p.fullData.findIndex(d => d.time === bar.time);
                            if (idx >= 0) {
                                p.fullData[idx] = bar;
                            } else {
                                p.fullData.push(bar);
                            }
                        });



                        // 3. Synchronize bid/ask prices with TradeManager
                        if (p === this.activePanel && window.tradeManager && !window.tradeManager.isReplayMode) {
                            const lastBar = result.data[result.data.length - 1];
                            const spread = window.tradeManager.getSpread(p.symbol);

                            window.tradeManager.currentBid = lastBar.close;
                            window.tradeManager.currentAsk = lastBar.close + spread;

                            const precision = window.tradeManager.getPrecision(p.symbol);
                            const quickSellEl = document.getElementById('quick-sell-price');
                            const quickBuyEl = document.getElementById('quick-buy-price');
                            if (quickSellEl) quickSellEl.textContent = window.tradeManager.currentBid.toFixed(precision);
                            if (quickBuyEl) quickBuyEl.textContent = window.tradeManager.currentAsk.toFixed(precision);

                            window.tradeManager.updateRiskRewardCalcs();
                            window.tradeManager.updateExecutionButton();
                        }
                    }
                } catch (e) {
                    console.error(`Failed to poll live ticks for panel ${p.id}:`, e);
                }
            }
        });
    }

    tickActiveChartPrice(symbol, price) {
        this.panels.forEach(p => {
            if (p.symbol === symbol && p.chartReady && p.chart && !p.isReplayMode && p.fullData && p.fullData.length > 0) {
                const lastBar = p.fullData[p.fullData.length - 1];
                if (lastBar) {
                    lastBar.close = price;
                    if (price > lastBar.high) lastBar.high = price;
                    if (price < lastBar.low) lastBar.low = price;
                    try {
                        window.MT5Datafeed.updateRealtime(p.symbol, p.timeframe, lastBar);
                    } catch (e) {
                        console.error("Error ticking live price to datafeed:", e);
                    }
                }
            }
        });
    }

    // Getters / Setters for replay.js compatibility
    get chart() {
        return this.activePanel ? this.activePanel.chart : null;
    }

    get candlestickSeries() {
        return this.activePanel ? this.activePanel.candlestickSeries : null;
    }

    get isReplayMode() {
        return this.activePanel ? this.activePanel.isReplayMode : false;
    }

    set isReplayMode(val) {
        if (this.activePanel) this.activePanel.isReplayMode = val;
    }

    get fullData() {
        return this.activePanel ? this.activePanel.fullData : [];
    }

    set fullData(val) {
        if (this.activePanel) this.activePanel.fullData = val;
    }

    // Delegations for replay.js
    exitReplayMode() {
        if (this.activePanel) this.activePanel.exitReplayMode();
    }

    setJumpMode(enabled) {
        if (this.activePanel) this.activePanel.setJumpMode(enabled);
    }

    updateChart(data) {
        if (this.activePanel) this.activePanel.updateChart(data);
    }

    async loadMoreData(barCount) {
        return this.activePanel ? await this.activePanel.loadMoreData(barCount) : false;
    }

    // Layout configuration and management
    setLayout(layoutType) {
        this.activeLayout = layoutType;
        localStorage.setItem('activeLayout', layoutType);

        // UI active layout select
        document.querySelectorAll('.layout-option').forEach(opt => {
            opt.classList.toggle('active', opt.dataset.layout === layoutType);
        });

        // Hide dropdown
        const dropdown = document.getElementById('layout-dropdown');
        if (dropdown) dropdown.classList.remove('show');

        // Set CSS grid layout
        const gridEl = document.getElementById('charts-grid');
        gridEl.className = `charts-grid layout-${layoutType}`;

        let panelCount = 1;
        if (layoutType === '2v' || layoutType === '2h') panelCount = 2;
        else if (layoutType === '4') panelCount = 4;

        // Save existing symbols/timeframes
        const savedConfigs = [];
        this.panels.forEach(p => {
            savedConfigs.push({ symbol: p.symbol, timeframe: p.timeframe });
        });

        const defaultConfigs = [
            { symbol: 'EURUSD', timeframe: 'H1' },
            { symbol: 'GBPUSD', timeframe: 'H1' },
            { symbol: 'USDJPY', timeframe: 'H1' },
            { symbol: 'XAUUSD', timeframe: 'H1' }
        ];

        // Destroy excessive panels
        while (this.panels.length > panelCount) {
            const p = this.panels.pop();
            p.destroy();
            p.containerEl.remove();
        }

        gridEl.innerHTML = ''; // Clear grid HTML children

        const newPanels = [];
        for (let i = 0; i < panelCount; i++) {
            let panelWrapper = document.getElementById(`panel-wrapper-${i}`);
            if (!panelWrapper) {
                panelWrapper = document.createElement('div');
                panelWrapper.id = `panel-wrapper-${i}`;
            }
            panelWrapper.className = 'chart-panel-wrapper';
            gridEl.appendChild(panelWrapper);

            let panel = this.panels[i];
            if (panel) {
                panel.containerEl = panelWrapper;
                panel.wrapperEl = panelWrapper;
                panelWrapper.appendChild(panel.headerEl);
                panelWrapper.appendChild(panel.syncLineEl);
                panelWrapper.appendChild(panel.chartContainerEl);

                // Re-bind wrapper listener
                panelWrapper.addEventListener('mousedown', () => {
                    this.setActivePanel(panel);
                });

                newPanels.push(panel);
            } else {
                const config = savedConfigs[i] || defaultConfigs[i] || defaultConfigs[0];
                const newPanel = new ChartPanel(`panel-${i}`, panelWrapper, config.symbol, config.timeframe, this);
                newPanels.push(newPanel);
            }
        }

        this.panels = newPanels;

        // Set active panel
        const stillActive = this.panels.find(p => p === this.activePanel);
        if (stillActive) {
            this.setActivePanel(stillActive, true);
        } else {
            this.setActivePanel(this.panels[0], true);
        }

        // Trigger chart resize & load data
        setTimeout(() => {
            this.panels.forEach(p => {
                if (p.chart) {
                    const width = p.chartContainerEl.clientWidth;
                    const height = p.chartContainerEl.clientHeight;
                    p.width = width;
                    p.height = height;
                    p.rect = p.chartContainerEl.getBoundingClientRect();
                    if (p.tvWidget && typeof p.tvWidget.resize === 'function') {
                        try {
                            p.tvWidget.resize(width, height);
                        } catch (e) {
                            console.error("Error resizing widget:", e);
                        }
                    }
                }
            });
            this.panels.forEach(p => {
                if (p.fullData.length === 0) {
                    p.loadData();
                }
            });
        }, 100);
    }

    setActivePanel(panel, force = false) {
        if (this.activePanel === panel && !force) return;

        // Save replay state on previous active panel
        if (this.activePanel && window.replayManager) {
            this.activePanel.replayIndex = window.replayManager.currentIndex;
            this.activePanel.replayPlaying = window.replayManager.isPlaying;
        }

        // Manage highlight border
        this.panels.forEach(p => p.wrapperEl.classList.remove('active'));
        this.activePanel = panel;
        this.activePanel.wrapperEl.classList.add('active');

        // Sync main toolbar
        const symbolSelect = document.getElementById('symbol-select');
        if (symbolSelect) {
            symbolSelect.value = panel.symbol;
            symbolSelect.dispatchEvent(new Event('change'));
        }

        // Sync new TV navbar active symbol text
        const activeSymText = document.getElementById('active-symbol-text');
        if (activeSymText) activeSymText.textContent = panel.symbol;

        document.querySelectorAll('.tf-btn').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.tf === panel.timeframe);
        });

        // Sync new TV navbar timeframe buttons
        document.querySelectorAll('.nav-tf-btn').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.tf === panel.timeframe);
        });

        // Sync Replay controls
        if (panel.isReplayMode) {
            document.getElementById('tv-replay-toolbar').style.display = 'flex';
            document.querySelector('.chart-area').classList.add('replay-mode');

            if (window.replayManager) {
                window.replayManager.fullData = panel.fullData;
                window.replayManager.currentIndex = panel.replayIndex || Math.floor(panel.fullData.length * 0.7);
                window.replayManager._lastDisplayedIndex = -1;
                window.replayManager._applyToChart();
                window.replayManager._updateUI();

                if (panel.replayPlaying) {
                    window.replayManager.play();
                } else {
                    window.replayManager.pause();
                }
            }
        } else {
            document.getElementById('tv-replay-toolbar').style.display = 'none';
            document.querySelector('.chart-area').classList.remove('replay-mode');
            if (window.replayManager) {
                window.replayManager.pause();
            }
        }


        // Sync drawing lines on the chart
        if (window.tradeManager) {
            window.tradeManager.drawAllChartLines();
        }
    }

    // Time Scale scroll & zoom synchronization
    syncTimeScale(sourcePanelId, range) {
        this.panels.forEach(panel => {
            if (panel.id !== sourcePanelId && panel.chartReady && panel.chart) {
                try {
                    panel._ignoreRangeChanged = true;
                    panel.chart.setVisibleRange(range);
                    setTimeout(() => {
                        panel._ignoreRangeChanged = false;
                    }, 500);
                } catch (e) {
                    console.error("Error syncing visible range:", e);
                    panel._ignoreRangeChanged = false;
                }
            }
        });
    }

    // Crosshair tracking synchronization
    syncCrosshairMove(sourcePanelId, time) {
        this._syncingCrosshair = true;

        this.panels.forEach(panel => {
            if (panel.id !== sourcePanelId && panel.chartReady && panel.chart) {
                const syncLine = panel.syncLineEl;
                if (!syncLine) return;

                if (time) {
                    try {
                        const range = panel.chart.getVisibleRange();
                        if (range && range.from && range.to) {
                            const width = panel.chartContainerEl.clientWidth;
                            const chartWidth = width - 55; // deduct right price scale approx width
                            const x = ((time - range.from) / (range.to - range.from)) * chartWidth;

                            if (x >= 0 && x <= chartWidth) {
                                syncLine.style.transform = `translateX(${x}px)`;
                                syncLine.style.display = 'block';
                            } else {
                                syncLine.style.display = 'none';
                            }
                        } else {
                            syncLine.style.display = 'none';
                        }
                    } catch (e) {
                        console.error("Error computing sync crosshair position:", e);
                        syncLine.style.display = 'none';
                    }
                } else {
                    syncLine.style.display = 'none';
                }
            }
        });

        this._syncingCrosshair = false;
    }

    getSymbolCategory(symbol) {
        const sym = symbol.toUpperCase();
        if (sym.includes('BTC') || sym.includes('ETH') || sym.includes('LTC') || sym.includes('SOL') || sym.includes('XRP')) {
            return 'crypto';
        }
        if (sym.includes('XAU') || sym.includes('GOLD') || sym.includes('XAG') || sym.includes('SILVER') || sym.includes('OIL') || sym.includes('NGAS')) {
            return 'commodity';
        }
        if (sym.includes('US30') || sym.includes('USTEC') || sym.includes('SPX') || sym.includes('DE30') || sym.includes('HK50') || sym.includes('JP225')) {
            return 'indices';
        }
        return 'forex';
    }


    // Toolbar Event Bindings
    setupEventListeners() {

        // 1. Centralized Symbol select change (Safeguarded)
        try {
            const symbolSelect = document.getElementById('symbol-select');
            if (symbolSelect) {
                symbolSelect.addEventListener('change', async (e) => {
                    if (!this.activePanel) return;

                    const newSymbol = e.target.value;
                    const activeSymText = document.getElementById('active-symbol-text');
                    if (activeSymText) activeSymText.textContent = newSymbol;

                    await this.activePanel.changeSymbolOrTimeframe(newSymbol, this.activePanel.timeframe);
                });
            }
        } catch (e) {
            console.error('Error binding symbol-select listener:', e);
        }

        // 3. Centralized Timeframe change (Safeguarded)
        try {
            const tfBtns = document.querySelectorAll('.tf-btn, .nav-tf-btn');
            if (tfBtns.length > 0) {
                tfBtns.forEach(btn => {
                    btn.addEventListener('click', async (e) => {
                        if (!this.activePanel) return;

                        const tf = e.currentTarget.dataset.tf;
                        document.querySelectorAll('.tf-btn, .nav-tf-btn').forEach(b => b.classList.remove('active'));
                        document.querySelectorAll(`.tf-btn[data-tf="${tf}"], .nav-tf-btn[data-tf="${tf}"]`).forEach(b => b.classList.add('active'));

                        await this.activePanel.changeSymbolOrTimeframe(this.activePanel.symbol, tf);
                    });
                });
            }
        } catch (e) {
            console.error('Error binding timeframe buttons listener:', e);
        }

        // 4. Replay toggle click (Safeguarded)
        try {
            const replayBtn = document.getElementById('replay-btn');
            if (replayBtn) {
                replayBtn.addEventListener('click', () => {
                    if (this.activePanel) {
                        this.activePanel.isReplayMode ? this.activePanel.exitReplayMode() : this.activePanel.enterReplayMode();
                    }
                });
            }
        } catch (e) {
            console.error('Error binding replay-btn listener:', e);
        }

        // 5. Layout Dropdown toggle (Safeguarded)
        try {
            const layoutBtn = document.getElementById('layout-btn');
            const layoutDropdown = document.getElementById('layout-dropdown');
            if (layoutBtn && layoutDropdown) {
                layoutBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    layoutDropdown.classList.toggle('show');
                });
                document.addEventListener('click', () => {
                    layoutDropdown.classList.remove('show');
                });
            }
        } catch (e) {
            console.error('Error binding layout dropdown listener:', e);
        }

        // 6. Layout choices (Safeguarded)
        try {
            document.querySelectorAll('.layout-option').forEach(option => {
                option.addEventListener('click', (e) => {
                    const layout = option.dataset.layout;
                    this.setLayout(layout);
                });
            });
        } catch (e) {
            console.error('Error binding layout choices listener:', e);
        }

        // 7. Synchronization switches (Removed - disabled scroll/crosshair sync as requested)

        // 8. --- Toggle Trading Panel --- (Safeguarded)
        try {
            const tradePanel = document.getElementById('trading-panel');
            const toggleBtn = document.getElementById('trade-panel-toggle-btn');
            const closeBtn = document.getElementById('close-trading-panel-btn');

            if (toggleBtn && tradePanel) {
                toggleBtn.addEventListener('click', () => {
                    const isCollapsed = tradePanel.classList.toggle('collapsed');
                    toggleBtn.classList.toggle('active', !isCollapsed);

                    // When opened, update values immediately
                    if (!isCollapsed && window.tradeManager) {
                        window.tradeManager.updateSLTPDefaultValues();
                        window.tradeManager.updateRiskRewardCalcs();
                        window.tradeManager.updateExecutionButton();
                    }

                    // Force layout refit for active charts
                    setTimeout(() => {
                        this.panels.forEach(p => {
                            if (p.tvWidget && typeof p.tvWidget.resize === 'function') {
                                try {
                                    const w = p.chartContainerEl.clientWidth;
                                    const h = p.chartContainerEl.clientHeight;
                                    p.tvWidget.resize(w, h);
                                } catch (_) {}
                            }
                        });
                    }, 300);
                });
            }

            if (closeBtn && tradePanel && toggleBtn) {
                closeBtn.addEventListener('click', () => {
                    tradePanel.classList.add('collapsed');
                    toggleBtn.classList.remove('active');

                    // Force layout refit for active charts
                    setTimeout(() => {
                        this.panels.forEach(p => {
                            if (p.tvWidget && typeof p.tvWidget.resize === 'function') {
                                try {
                                    const w = p.chartContainerEl.clientWidth;
                                    const h = p.chartContainerEl.clientHeight;
                                    p.tvWidget.resize(w, h);
                                } catch (_) {}
                            }
                        });
                    }, 300);
                });
            }
        } catch (e) {
            console.error('Error binding trade panel toggles listener:', e);
        }

        // 9. ─── Drawing Sidebar Select ─── (Safeguarded)
        try {
            const toolItems = document.querySelectorAll('.tool-item');
            toolItems.forEach(item => {
                item.addEventListener('click', (e) => {
                    const tool = item.dataset.tool;
                    if (tool === 'clear') {
                        this.clearActivePanelDrawings();
                    } else {
                        this.selectTool(tool);
                    }
                });
            });
        } catch (e) {
            console.error('Error binding tool-items listener:', e);
        }

        // 10. TradingView Style Global Keydown listener (Safeguarded)
        try {
            window.addEventListener('keydown', (e) => {
                // Do NOT intercept keys when user is typing in input fields, textareas, or select dropdowns
                if (['INPUT', 'SELECT', 'TEXTAREA'].includes(e.target.tagName)) return;

                // Escape key resets tool to cursor
                if (e.key === 'Escape') {
                    this.selectTool('cursor');
                    return;
                }

                // 1. Letters A-Z: Open native symbol search or indicators
                if (e.key.length === 1 && e.key.match(/[a-zA-Z]/i) && !e.ctrlKey && !e.metaKey && !e.altKey) {
                    // Check if they pressed 'I' for Indicators
                    if (e.key.toUpperCase() === 'I') {
                        e.preventDefault();
                        if (this.activePanel && this.activePanel.chartReady) {
                            try {
                                this.activePanel.chart.executeActionById('insertIndicator');
                            } catch (err) {
                                console.error("Error executing native insertIndicator:", err);
                            }
                        }
                        return;
                    }

                    e.preventDefault();
                    if (this.activePanel && this.activePanel.chartReady) {
                        try {
                            this.activePanel.chart.executeActionById('symbolSearch');
                        } catch (err) {
                            console.error("Error executing native symbolSearch:", err);
                        }
                    }
                    return;
                }

                // 2. Numbers / Timeframe hotkeys
                if (!e.ctrlKey && !e.metaKey && !e.altKey) {
                    const key = e.key.toUpperCase();
                    const tfMap = {
                        '1': 'M1',
                        '5': 'M5',
                        '3': 'M30',
                        'H': 'H1',
                        '4': 'H4',
                        'D': 'D1',
                        'W': 'W1'
                    };
                    if (tfMap[key]) {
                        e.preventDefault();
                        this.changeActiveTimeframe(tfMap[key]);
                    }
                }

                // 3. Undo / Redo (Ctrl + Z / Ctrl + Y or Cmd + Z / Cmd + Y)
                if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === 'z') {
                    e.preventDefault();
                    if (this.activePanel && this.activePanel.chartReady) {
                        try {
                            this.activePanel.chart.executeActionById('undo');
                        } catch (err) {}
                    }
                }
                if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') {
                    e.preventDefault();
                    if (this.activePanel && this.activePanel.chartReady) {
                        try {
                            this.activePanel.chart.executeActionById('redo');
                        } catch (err) {}
                    }
                }
            });
        } catch (e) {
            console.error('Error binding global hotkeys:', e);
        }

        // 11. --- Graceful Application Shutdown ---
        try {
            const quitBtn = document.getElementById('quit-app-btn');
            if (quitBtn) {
                quitBtn.addEventListener('click', () => {
                    const confirmShutdown = confirm("Are you sure you want to stop WuangVibeTrading and shut down the backend server? This will release all ports and disconnect MT5.");
                    if (!confirmShutdown) return;

                    // 1. Create and inject the stunning fullscreen shutdown overlay
                    const overlay = document.createElement('div');
                    overlay.className = 'shutdown-overlay';
                    overlay.innerHTML = `
                        <div class="shutdown-card">
                            <div class="shutdown-icon-container">
                                <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                                    <path d="M18.36 6.64a9 9 0 1 1-12.73 0"></path>
                                    <line x1="12" y1="2" x2="12" y2="12"></line>
                                </svg>
                            </div>
                            <h1 class="shutdown-title">WuangVibeTrading Stopped</h1>
                            <p class="shutdown-subtitle">The backend service and MetaTrader 5 gateway have been safely terminated.</p>

                            <div class="shutdown-checklist">
                                <div class="checklist-item">
                                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>
                                    <span>Flask Backend Server (Port 5000) released successfully</span>
                                </div>
                                <div class="checklist-item">
                                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>
                                    <span>MetaTrader 5 Expert Advisor Socket (Port 9000) disconnected</span>
                                </div>
                                <div class="checklist-item">
                                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>
                                    <span>Background workers and chart feeds cleaned up</span>
                                </div>
                            </div>

                            <div class="shutdown-footer">
                                You can now safely close this browser window.<br>
                                To restart the application, launch the <strong>WuangVibeTrading</strong> desktop app again.
                            </div>
                        </div>
                    `;
                    document.body.appendChild(overlay);

                    // Force reflow and fade in
                    setTimeout(() => {
                        overlay.classList.add('show');
                    }, 50);

                    // 2. Fire the shutdown POST API request
                    fetch('/api/shutdown', {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json'
                        }
                    })
                    .then(response => response.json())
                    .then(data => {
                        console.log('Shutdown signal acknowledged by server:', data);
                    })
                    .catch(err => {
                        console.warn('Network closed as server is terminating:', err);
                    });
                });
            }
        } catch (e) {
            console.error('Error binding quit-app-btn listener:', e);
        }
    }

    changeActiveTimeframe(tf) {
        const btn = document.querySelector(`.nav-tf-btn[data-tf="${tf}"]`);
        if (btn) {
            btn.click();
        }
    }

    selectTool(tool) {
        this.activeTool = tool;

        // Update active class on toolbar buttons
        const toolItems = document.querySelectorAll('.tool-item');
        toolItems.forEach(btn => {
            if (btn.dataset.tool !== 'clear') {
                btn.classList.toggle('active', btn.dataset.tool === tool);
            }
        });

        // Set tool in TradingView
        const tvToolMap = {
            'cursor': 'cursor',
            'trend-line': 'trend_line',
            'horizontal-line': 'horizontal_line',
            'ray': 'ray',
            'arrow': 'arrow',
            'extended-line': 'extended',
            'horizontal-ray': 'horizontal_ray',
            'rectangle': 'rectangle',
            'text': 'text',
            'long-position': 'long_position',
            'short-position': 'short_position'
        };

        const tvToolName = tvToolMap[tool] || 'cursor';

        this.panels.forEach(p => {
            if (p.chartReady && p.chart) {
                try {
                    p.chart.selectLineTool(tvToolName);
                } catch (e) {
                    console.error(`Failed to select tool ${tvToolName} in panel ${p.id}:`, e);
                }
            }
        });
    }

    clearActivePanelDrawings() {
        if (this.activePanel && this.activePanel.chartReady && this.activePanel.chart) {
            try {
                this.activePanel.chart.removeAllShapes();
            } catch (e) {
                console.error("Failed to remove shapes:", e);
            }
        }
    }

    resetToCursor() {
        this.selectTool('cursor');
    }

    // Timezone utilities
    _makeTickFormatter() {
        return (time, tickMarkType) => {
            const date = new Date(time * 1000);
            date.setUTCHours(date.getUTCHours() + this.timezoneOffset);
            const dd = String(date.getUTCDate()).padStart(2, '0');
            const mm = String(date.getUTCMonth() + 1).padStart(2, '0');
            const yyyy = date.getUTCFullYear();
            const hh = String(date.getUTCHours()).padStart(2, '0');
            const min = String(date.getUTCMinutes()).padStart(2, '0');
            const dayNames = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
            const dn = dayNames[date.getUTCDay()];
            switch (tickMarkType) {
                case 0: return `${yyyy}`;
                case 1: return `${mm}/${yyyy}`;
                case 2: return `${dn} ${dd}/${mm}/${yyyy}`;
                default: return `${hh}:${min}`;
            }
        };
    }

    _makeTimeFormatter() {
        return (time) => {
            const date = new Date(time * 1000);
            date.setUTCHours(date.getUTCHours() + this.timezoneOffset);
            const dd = String(date.getUTCDate()).padStart(2, '0');
            const mm = String(date.getUTCMonth() + 1).padStart(2, '0');
            const yyyy = date.getUTCFullYear();
            const hh = String(date.getUTCHours()).padStart(2, '0');
            const min = String(date.getUTCMinutes()).padStart(2, '0');
            return `${dd}/${mm}/${yyyy} ${hh}:${min}`;
        };
    }


    closeDrawingSettings() {
        const modalOverlay = document.getElementById('drawing-settings-overlay');
        if (modalOverlay) {
            modalOverlay.classList.remove('show');
        }
        this.activeSettingsDrawing = null;
        this.activeSettingsPanel = null;
        this.isNewSettingsDrawing = false;
        this.originalDrawingState = null;
    }

    async checkMT5Status() {
        try {
            const res = await fetch('/api/status');
            const data = await res.json();
            console.log('[checkMT5Status] API Status response:', data);
            const el = document.getElementById('mt5-status');
            if (data.connected) {
                const wasDisconnected = !el.classList.contains('connected');
                el.classList.add('connected');
                el.querySelector('.status-text').textContent = 'MT5 Connected';
                if (wasDisconnected || this.allSymbols.length === 0) {
                    await this.loadSymbols();
                    this.panels.forEach(p => {
                        if (p.chartReady && p.chart) {
                            p.loadData();
                        }
                    });
                }
            } else {
                el.classList.remove('connected');
                el.querySelector('.status-text').textContent = 'MT5 Disconnected';
            }
        } catch (e) { console.error('MT5 status check failed:', e); }
    }

    async loadSymbols() {
        try {
            const res = await fetch('/api/symbols');
            const data = await res.json();
            if (data.success && data.symbols.length > 0) {
                this.allSymbols = data.symbols;
                const select = document.getElementById('symbol-select');
                select.innerHTML = '';
                data.symbols.forEach(sym => {
                    const opt = document.createElement('option');
                    opt.value = sym;
                    opt.textContent = sym;
                    select.appendChild(opt);
                });
            }
        } catch (e) { console.error('Failed to load symbols:', e); }
    }
}

class TradeManager {
    constructor() {
        this.activeTab = 'positions';
        this.activeSide = 'buy'; // 'buy' or 'sell'

        // Default virtual account state
        this.virtualAccount = {
            balance: 10000.0,
            equity: 10000.0,
            margin: 0.0,
            free_margin: 10000.0,
            margin_level: 0.0,
            positions: [],
            pending: [],
            history: [],
            ticket_counter: 100000
        };

        this.currentBid = 0.0;
        this.currentAsk = 0.0;

        this.pollingInterval = null;
        this.priceInterval = null;

        this.loadVirtualAccount();
        this.initEvents();
        this.updateAccountUI();
        this.updateTablesUI();

        // Start polling for MT5 Live connection state
        this.startMT5Polling();
    }

    // ─── LocalStorage Persistence ──────────────────────────────────────────
    loadVirtualAccount() {
        try {
            const data = localStorage.getItem('virtual_account_v2');
            if (data) {
                this.virtualAccount = JSON.parse(data);
                // Backwards compatibility check
                if (!this.virtualAccount.positions) this.virtualAccount.positions = [];
                if (!this.virtualAccount.pending) this.virtualAccount.pending = [];
                if (!this.virtualAccount.history) this.virtualAccount.history = [];
                if (!this.virtualAccount.ticket_counter) this.virtualAccount.ticket_counter = 100000;
            } else {
                this.saveVirtualAccount();
            }
        } catch (e) {
            console.error('Failed to load virtual account state:', e);
        }
    }

    saveVirtualAccount() {
        try {
            localStorage.setItem('virtual_account_v2', JSON.stringify(this.virtualAccount));
        } catch (e) {
            console.error('Failed to save virtual account state:', e);
        }
    }

    // ─── Helpers ──────────────────────────────────────────────────────────
    get currentSymbol() {
        if (window.chartManager && window.chartManager.activePanel) {
            return window.chartManager.activePanel.symbol;
        }
        const sel = document.getElementById('symbol-select');
        return sel ? sel.value : 'EURUSD';
    }

    get isReplayMode() {
        return window.chartManager?.isReplayMode ?? false;
    }

    getContractSize(symbol) {
        const sym = symbol.toUpperCase();
        if (sym.includes('XAU') || sym.includes('GOLD')) return 100;
        if (sym.includes('XAG') || sym.includes('SILVER')) return 5000;
        if (sym.includes('BTC')) return 1;
        return 100000; // Standard forex lot size
    }

    getPipSize(symbol) {
        const sym = symbol.toUpperCase();
        if (sym.includes('JPY')) return 0.01;
        if (sym.includes('XAU') || sym.includes('GOLD')) return 0.10;
        if (sym.includes('XAG') || sym.includes('SILVER')) return 0.01;
        if (sym.includes('BTC')) return 1.00;
        return 0.0001;
    }

    getSpread(symbol) {
        const sym = symbol.toUpperCase();
        if (sym.includes('JPY')) return 0.015; // 1.5 pips
        if (sym.includes('XAU') || sym.includes('GOLD')) return 0.15; // 15 cents
        if (sym.includes('XAG') || sym.includes('SILVER')) return 0.02; // 2 cents
        if (sym.includes('BTC')) return 8.0;
        return 0.00012; // 1.2 pips
    }

    getPrecision(symbol) {
        const sym = symbol.toUpperCase();
        if (sym.includes('JPY')) return 3;
        if (sym.includes('XAU') || sym.includes('GOLD')) return 2;
        if (sym.includes('XAG') || sym.includes('SILVER')) return 3;
        if (sym.includes('BTC')) return 2;
        return 5;
    }

    convertToUSD(symbol, amountQuote, currentPrice) {
        const sym = symbol.toUpperCase();
        if (sym.includes('USD')) {
            if (sym.startsWith('USD')) {
                // e.g. USDJPY, USDCAD -> divide by price
                return amountQuote / currentPrice;
            } else {
                // e.g. EURUSD, GBPUSD, XAUUSD -> already USD
                return amountQuote;
            }
        }
        if (sym.endsWith('JPY')) {
            // cross to JPY -> divide by 150.0 approx
            return amountQuote / 150.0;
        }
        return amountQuote; // Fallback
    }

    convertUSDToQuote(symbol, usdAmount, currentPrice) {
        const sym = symbol.toUpperCase();
        if (sym.includes('USD')) {
            if (sym.startsWith('USD')) {
                // e.g. USDJPY, USDCAD -> usdAmount * currentPrice
                return usdAmount * currentPrice;
            } else {
                // e.g. EURUSD, GBPUSD, XAUUSD -> already USD
                return usdAmount;
            }
        }
        if (sym.endsWith('JPY')) {
            // cross to JPY -> multiply by 150.0 approx
            return usdAmount * 150.0;
        }
        return usdAmount; // Fallback
    }

    getActualSLPrice() {
        const slChecked = document.getElementById('enable-sl').checked;
        if (!slChecked) return 0.0;

        const symbol = this.currentSymbol;
        const side = this.activeSide;
        const vol = parseFloat(document.getElementById('trade-volume').value) || 0.01;
        const contractSize = this.getContractSize(symbol);
        const pipSize = this.getPipSize(symbol);
        const activeUnit = document.getElementById('sl-active-unit').value; // 'price', 'pips', 'usd'
        const inputValue = parseFloat(document.getElementById('trade-sl').value) || 0.0;

        const orderType = document.getElementById('trade-order-type').value;
        let entryPrice = (side === 'buy') ? this.currentAsk : this.currentBid;
        if (orderType === 'limit') {
            entryPrice = parseFloat(document.getElementById('trade-price').value) || entryPrice;
        }

        if (activeUnit === 'price') {
            return inputValue;
        } else if (activeUnit === 'pips') {
            const priceDiff = inputValue * pipSize;
            return (side === 'buy') ? (entryPrice - priceDiff) : (entryPrice + priceDiff);
        } else if (activeUnit === 'usd') {
            const amountQuote = this.convertUSDToQuote(symbol, inputValue, entryPrice);
            const priceDiff = amountQuote / (vol * contractSize);
            return (side === 'buy') ? (entryPrice - priceDiff) : (entryPrice + priceDiff);
        }
        return 0.0;
    }

    getActualTPPrice() {
        const tpChecked = document.getElementById('enable-tp').checked;
        if (!tpChecked) return 0.0;

        const symbol = this.currentSymbol;
        const side = this.activeSide;
        const vol = parseFloat(document.getElementById('trade-volume').value) || 0.01;
        const contractSize = this.getContractSize(symbol);
        const pipSize = this.getPipSize(symbol);
        const activeUnit = document.getElementById('tp-active-unit').value; // 'price', 'pips', 'usd'
        const inputValue = parseFloat(document.getElementById('trade-tp').value) || 0.0;

        const orderType = document.getElementById('trade-order-type').value;
        let entryPrice = (side === 'buy') ? this.currentAsk : this.currentBid;
        if (orderType === 'limit') {
            entryPrice = parseFloat(document.getElementById('trade-price').value) || entryPrice;
        }

        if (activeUnit === 'price') {
            return inputValue;
        } else if (activeUnit === 'pips') {
            const priceDiff = inputValue * pipSize;
            return (side === 'buy') ? (entryPrice + priceDiff) : (entryPrice - priceDiff);
        } else if (activeUnit === 'usd') {
            const amountQuote = this.convertUSDToQuote(symbol, inputValue, entryPrice);
            const priceDiff = amountQuote / (vol * contractSize);
            return (side === 'buy') ? (entryPrice + priceDiff) : (entryPrice - priceDiff);
        }
        return 0.0;
    }

    convertSLPriceToUnit(slPrice, unit) {
        const symbol = this.currentSymbol;
        const side = this.activeSide;
        const vol = parseFloat(document.getElementById('trade-volume').value) || 0.01;
        const contractSize = this.getContractSize(symbol);
        const pipSize = this.getPipSize(symbol);

        const orderType = document.getElementById('trade-order-type').value;
        let entryPrice = (side === 'buy') ? this.currentAsk : this.currentBid;
        if (orderType === 'limit') {
            entryPrice = parseFloat(document.getElementById('trade-price').value) || entryPrice;
        }

        const priceDiff = Math.abs(entryPrice - slPrice);

        if (unit === 'price') {
            return slPrice;
        } else if (unit === 'pips') {
            return priceDiff / pipSize;
        } else if (unit === 'usd') {
            const amountQuote = vol * contractSize * priceDiff;
            return this.convertToUSD(symbol, amountQuote, entryPrice);
        }
        return 0.0;
    }

    convertTPPriceToUnit(tpPrice, unit) {
        const symbol = this.currentSymbol;
        const side = this.activeSide;
        const vol = parseFloat(document.getElementById('trade-volume').value) || 0.01;
        const contractSize = this.getContractSize(symbol);
        const pipSize = this.getPipSize(symbol);

        const orderType = document.getElementById('trade-order-type').value;
        let entryPrice = (side === 'buy') ? this.currentAsk : this.currentBid;
        if (orderType === 'limit') {
            entryPrice = parseFloat(document.getElementById('trade-price').value) || entryPrice;
        }

        const priceDiff = Math.abs(entryPrice - tpPrice);

        if (unit === 'price') {
            return tpPrice;
        } else if (unit === 'pips') {
            return priceDiff / pipSize;
        } else if (unit === 'usd') {
            const amountQuote = vol * contractSize * priceDiff;
            return this.convertToUSD(symbol, amountQuote, entryPrice);
        }
        return 0.0;
    }

    // ─── UI Setup & Handlers ───────────────────────────────────────────────
    initEvents() {
        // Quick BUY/SELL tabs
        const quickSellBtn = document.getElementById('btn-quick-sell');
        const quickBuyBtn = document.getElementById('btn-quick-buy');
        const execBtn = document.getElementById('btn-execute-order');

        quickSellBtn.addEventListener('click', () => {
            quickSellBtn.classList.add('active');
            quickBuyBtn.classList.remove('active');
            this.activeSide = 'sell';

            const panel = document.getElementById('trading-panel');
            if (panel) {
                panel.classList.add('sell-active');
                panel.classList.remove('buy-active');
            }

            this.updateExecutionButton();
            this.updateSLTPDefaultValues();
            this.updateRiskRewardCalcs();
        });

        quickBuyBtn.addEventListener('click', () => {
            quickBuyBtn.classList.add('active');
            quickSellBtn.classList.remove('active');
            this.activeSide = 'buy';

            const panel = document.getElementById('trading-panel');
            if (panel) {
                panel.classList.add('buy-active');
                panel.classList.remove('sell-active');
            }

            this.updateExecutionButton();
            this.updateSLTPDefaultValues();
            this.updateRiskRewardCalcs();
        });

        // Order Type Selection Tabs
        document.querySelectorAll('.exness-order-type-tabs .order-type-tab').forEach(tab => {
            tab.addEventListener('click', () => {
                document.querySelectorAll('.exness-order-type-tabs .order-type-tab').forEach(t => t.classList.remove('active'));
                tab.classList.add('active');

                const type = tab.dataset.type;
                const orderTypeSelect = document.getElementById('trade-order-type');
                if (orderTypeSelect) {
                    orderTypeSelect.value = type;
                    orderTypeSelect.dispatchEvent(new Event('change'));
                }
            });
        });

        const orderTypeSelect = document.getElementById('trade-order-type');
        const pendingPriceGroup = document.getElementById('pending-price-group');

        orderTypeSelect.addEventListener('change', () => {
            const val = orderTypeSelect.value;

            // Sync Exness tabs
            document.querySelectorAll('.exness-order-type-tabs .order-type-tab').forEach(t => {
                t.classList.toggle('active', t.dataset.type === val);
            });

            if (val === 'limit') {
                pendingPriceGroup.style.display = 'flex';
                // Initialize pending price to mid price
                const p = this.getPrecision(this.currentSymbol);
                document.getElementById('trade-price').value = ((this.currentBid + this.currentAsk) / 2).toFixed(p);
            } else {
                pendingPriceGroup.style.display = 'none';
            }
            this.updateExecutionButton();
            this.updateRiskRewardCalcs();
        });

        // Volume increment / decrement
        const volInput = document.getElementById('trade-volume');
        document.getElementById('btn-vol-minus').addEventListener('click', () => {
            let val = parseFloat(volInput.value) || 0.10;
            val = Math.max(0.01, val - 0.01);
            volInput.value = val.toFixed(2);
            this.updateRiskRewardCalcs();
        });

        document.getElementById('btn-vol-plus').addEventListener('click', () => {
            let val = parseFloat(volInput.value) || 0.10;
            val = val + 0.01;
            volInput.value = val.toFixed(2);
            this.updateRiskRewardCalcs();
        });

        volInput.addEventListener('change', () => {
            let val = parseFloat(volInput.value) || 0.10;
            if (val < 0.01) val = 0.01;
            volInput.value = val.toFixed(2);
            this.updateRiskRewardCalcs();
        });

        // Quick Lot Selector
        document.querySelectorAll('.lot-q-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                volInput.value = parseFloat(btn.textContent).toFixed(2);
                this.updateRiskRewardCalcs();
            });
        });

        // Pending Price increment / decrement
        const priceInput = document.getElementById('trade-price');
        document.getElementById('btn-price-minus').addEventListener('click', () => {
            const step = this.getPipSize(this.currentSymbol);
            let val = parseFloat(priceInput.value) || this.currentBid;
            val = val - step;
            priceInput.value = val.toFixed(this.getPrecision(this.currentSymbol));
            this.updateRiskRewardCalcs();
        });

        document.getElementById('btn-price-plus').addEventListener('click', () => {
            const step = this.getPipSize(this.currentSymbol);
            let val = parseFloat(priceInput.value) || this.currentBid;
            val = val + step;
            priceInput.value = val.toFixed(this.getPrecision(this.currentSymbol));
            this.updateRiskRewardCalcs();
        });

        priceInput.addEventListener('change', () => {
            this.updateRiskRewardCalcs();
        });

        // SL panel collapsible
        const enableSL = document.getElementById('enable-sl');
        const slContainer = document.getElementById('sl-control-container');
        enableSL.addEventListener('change', () => {
            if (enableSL.checked) {
                slContainer.style.display = 'flex';
                this.updateSLTPDefaultValues('sl');
            } else {
                slContainer.style.display = 'none';
            }
            this.updateRiskRewardCalcs();
        });

        const slInput = document.getElementById('trade-sl');
        document.getElementById('btn-sl-minus').addEventListener('click', () => {
            const activeUnit = document.getElementById('sl-active-unit').value;
            let step = this.getPipSize(this.currentSymbol);
            let dec = this.getPrecision(this.currentSymbol);

            if (activeUnit === 'pips') {
                step = 1.0;
                dec = 1;
            } else if (activeUnit === 'usd') {
                step = 5.0;
                dec = 2;
            }

            let val = parseFloat(slInput.value) || 0;
            val = Math.max(0, val - step);
            slInput.value = val.toFixed(dec);
            this.updateRiskRewardCalcs();
        });

        document.getElementById('btn-sl-plus').addEventListener('click', () => {
            const activeUnit = document.getElementById('sl-active-unit').value;
            let step = this.getPipSize(this.currentSymbol);
            let dec = this.getPrecision(this.currentSymbol);

            if (activeUnit === 'pips') {
                step = 1.0;
                dec = 1;
            } else if (activeUnit === 'usd') {
                step = 5.0;
                dec = 2;
            }

            let val = parseFloat(slInput.value) || 0;
            val = val + step;
            slInput.value = val.toFixed(dec);
            this.updateRiskRewardCalcs();
        });

        slInput.addEventListener('change', () => {
            this.updateRiskRewardCalcs();
        });

        // SL Unit Switcher
        document.querySelectorAll('#sl-unit-selector .unit-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const oldUnit = document.getElementById('sl-active-unit').value;
                const newUnit = btn.dataset.unit;
                if (oldUnit === newUnit) return;

                // Get current absolute SL price first (using the old unit)
                const slPrice = this.getActualSLPrice();

                // Update active unit in DOM
                document.getElementById('sl-active-unit').value = newUnit;
                document.querySelectorAll('#sl-unit-selector .unit-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');

                // Convert the absolute price to the new unit value
                const newValue = this.convertSLPriceToUnit(slPrice, newUnit);

                // Update step and precision based on unit
                if (newUnit === 'price') {
                    slInput.step = this.getPipSize(this.currentSymbol);
                    slInput.value = newValue.toFixed(this.getPrecision(this.currentSymbol));
                } else if (newUnit === 'pips') {
                    slInput.step = '1';
                    slInput.value = newValue.toFixed(1);
                } else if (newUnit === 'usd') {
                    slInput.step = '5';
                    slInput.value = newValue.toFixed(2);
                }

                this.updateRiskRewardCalcs();
            });
        });

        // TP panel collapsible
        const enableTP = document.getElementById('enable-tp');
        const tpContainer = document.getElementById('tp-control-container');
        enableTP.addEventListener('change', () => {
            if (enableTP.checked) {
                tpContainer.style.display = 'flex';
                this.updateSLTPDefaultValues('tp');
            } else {
                tpContainer.style.display = 'none';
            }
            this.updateRiskRewardCalcs();
        });

        const tpInput = document.getElementById('trade-tp');
        document.getElementById('btn-tp-minus').addEventListener('click', () => {
            const activeUnit = document.getElementById('tp-active-unit').value;
            let step = this.getPipSize(this.currentSymbol);
            let dec = this.getPrecision(this.currentSymbol);

            if (activeUnit === 'pips') {
                step = 1.0;
                dec = 1;
            } else if (activeUnit === 'usd') {
                step = 5.0;
                dec = 2;
            }

            let val = parseFloat(tpInput.value) || 0;
            val = Math.max(0, val - step);
            tpInput.value = val.toFixed(dec);
            this.updateRiskRewardCalcs();
        });

        document.getElementById('btn-tp-plus').addEventListener('click', () => {
            const activeUnit = document.getElementById('tp-active-unit').value;
            let step = this.getPipSize(this.currentSymbol);
            let dec = this.getPrecision(this.currentSymbol);

            if (activeUnit === 'pips') {
                step = 1.0;
                dec = 1;
            } else if (activeUnit === 'usd') {
                step = 5.0;
                dec = 2;
            }

            let val = parseFloat(tpInput.value) || 0;
            val = val + step;
            tpInput.value = val.toFixed(dec);
            this.updateRiskRewardCalcs();
        });

        tpInput.addEventListener('change', () => {
            this.updateRiskRewardCalcs();
        });

        // TP Unit Switcher
        document.querySelectorAll('#tp-unit-selector .unit-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const oldUnit = document.getElementById('tp-active-unit').value;
                const newUnit = btn.dataset.unit;
                if (oldUnit === newUnit) return;

                // Get current absolute TP price first (using the old unit)
                const tpPrice = this.getActualTPPrice();

                // Update active unit in DOM
                document.getElementById('tp-active-unit').value = newUnit;
                document.querySelectorAll('#tp-unit-selector .unit-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');

                // Convert the absolute price to the new unit value
                const newValue = this.convertTPPriceToUnit(tpPrice, newUnit);

                // Update step and precision based on unit
                if (newUnit === 'price') {
                    tpInput.step = this.getPipSize(this.currentSymbol);
                    tpInput.value = newValue.toFixed(this.getPrecision(this.currentSymbol));
                } else if (newUnit === 'pips') {
                    tpInput.step = '1';
                    tpInput.value = newValue.toFixed(1);
                } else if (newUnit === 'usd') {
                    tpInput.step = '5';
                    tpInput.value = newValue.toFixed(2);
                }

                this.updateRiskRewardCalcs();
            });
        });

        // Execute Button click
        execBtn.addEventListener('click', () => {
            this.executeOrder();
        });

        // Dashboard Tab Switch (Collapsible TV-Style)
        document.querySelectorAll('.dashboard-tabs .tab-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const bottomDashboard = document.getElementById('bottom-dashboard');
                const isCollapsed = bottomDashboard.classList.contains('collapsed');
                const isActive = btn.classList.contains('active');

                if (isActive && !isCollapsed) {
                    bottomDashboard.classList.add('collapsed');
                } else {
                    bottomDashboard.classList.remove('collapsed');

                    document.querySelectorAll('.dashboard-tabs .tab-btn').forEach(b => b.classList.remove('active'));
                    document.querySelectorAll('.dashboard-tab-content').forEach(c => c.classList.remove('active'));

                    btn.classList.add('active');
                    const tab = btn.dataset.tab;
                    this.activeTab = tab;
                    document.getElementById(`tab-${tab}`).classList.add('active');
                }

                // Recalculate heights for active charts
                setTimeout(() => {
                    window.dispatchEvent(new Event('resize'));
                }, 350);
            });
        });

        // Dashboard Minimize/Maximize Toggle Button
        const dashToggleBtn = document.getElementById('dashboard-toggle-btn');
        if (dashToggleBtn) {
            dashToggleBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                const bottomDashboard = document.getElementById('bottom-dashboard');
                bottomDashboard.classList.toggle('collapsed');

                // Recalculate heights for active charts
                setTimeout(() => {
                    window.dispatchEvent(new Event('resize'));
                }, 350);
            });
        }

        // Symbol Select listener to update mode and values
        document.getElementById('symbol-select').addEventListener('change', () => {
            this.updateSLTPDefaultValues();
            this.updateRiskRewardCalcs();
        });
    }

    updateExecutionButton() {
        const execBtn = document.getElementById('btn-execute-order');
        const orderType = document.getElementById('trade-order-type').value;
        const side = this.activeSide.toUpperCase();
        const symbol = this.currentSymbol;
        const p = this.getPrecision(symbol);

        if (orderType === 'market') {
            const price = (this.activeSide === 'buy') ? this.currentAsk : this.currentBid;
            const priceText = price ? price.toFixed(p) : '0.00000';
            execBtn.textContent = `CONFIRM ${side} (${side} MARKET @ ${priceText})`;
        } else {
            execBtn.textContent = `CONFIRM ORDER (${side} LIMIT/STOP)`;
        }

        if (this.activeSide === 'buy') {
            execBtn.classList.add('buy-mode');
            execBtn.classList.remove('sell-mode');
        } else {
            execBtn.classList.add('sell-mode');
            execBtn.classList.remove('buy-mode');
        }
    }

    updateSLTPDefaultValues(target = 'all') {
        const symbol = this.currentSymbol;
        const side = this.activeSide;
        const pipSize = this.getPipSize(symbol);
        const precision = this.getPrecision(symbol);
        const vol = parseFloat(document.getElementById('trade-volume').value) || 0.10;
        const contractSize = this.getContractSize(symbol);

        const bid = this.currentBid || 1.00000;
        const ask = this.currentAsk || 1.00000;
        const entry = (side === 'buy') ? ask : bid;

        if (target === 'all' || target === 'sl') {
            const slActiveUnit = document.getElementById('sl-active-unit').value;
            if (slActiveUnit === 'price') {
                const slVal = (side === 'buy') ? (entry - 25 * pipSize) : (entry + 25 * pipSize);
                document.getElementById('trade-sl').value = slVal.toFixed(precision);
            } else if (slActiveUnit === 'pips') {
                document.getElementById('trade-sl').value = "25.0";
            } else if (slActiveUnit === 'usd') {
                const priceDiff = 25 * pipSize;
                const amountQuote = vol * contractSize * priceDiff;
                const usdAmount = this.convertToUSD(symbol, amountQuote, entry);
                document.getElementById('trade-sl').value = usdAmount.toFixed(2);
            }
        }
        if (target === 'all' || target === 'tp') {
            const tpActiveUnit = document.getElementById('tp-active-unit').value;
            if (tpActiveUnit === 'price') {
                const tpVal = (side === 'buy') ? (entry + 50 * pipSize) : (entry - 50 * pipSize);
                document.getElementById('trade-tp').value = tpVal.toFixed(precision);
            } else if (tpActiveUnit === 'pips') {
                document.getElementById('trade-tp').value = "50.0";
            } else if (tpActiveUnit === 'usd') {
                const priceDiff = 50 * pipSize;
                const amountQuote = vol * contractSize * priceDiff;
                const usdAmount = this.convertToUSD(symbol, amountQuote, entry);
                document.getElementById('trade-tp').value = usdAmount.toFixed(2);
            }
        }
    }

    updateRiskRewardCalcs() {
        const symbol = this.currentSymbol;
        const side = this.activeSide;
        const vol = parseFloat(document.getElementById('trade-volume').value) || 0.01;
        const contractSize = this.getContractSize(symbol);
        const pipSize = this.getPipSize(symbol);
        const precision = this.getPrecision(symbol);

        const orderType = document.getElementById('trade-order-type').value;
        let entryPrice = (side === 'buy') ? this.currentAsk : this.currentBid;
        if (orderType === 'limit') {
            entryPrice = parseFloat(document.getElementById('trade-price').value) || entryPrice;
        }

        // Stop Loss Calculator
        const slChecked = document.getElementById('enable-sl').checked;
        if (slChecked) {
            const slActiveUnit = document.getElementById('sl-active-unit').value;
            const slVal = parseFloat(document.getElementById('trade-sl').value) || 0;
            if (slVal >= 0) {
                const slPrice = this.getActualSLPrice();
                const dist = Math.abs(entryPrice - slPrice);
                const pipsDist = (dist / pipSize).toFixed(1);
                const lossQuote = vol * contractSize * dist;
                const lossUSD = this.convertToUSD(symbol, lossQuote, entryPrice);

                if (slActiveUnit === 'price') {
                    document.getElementById('sl-info-pips').innerHTML = `Distance: <strong id="sl-pips-dist">${pipsDist} pips</strong>`;
                    document.getElementById('sl-info-usd').innerHTML = `Risk: <strong id="sl-usd-loss" class="text-danger">-$${lossUSD.toFixed(2)}</strong>`;
                } else if (slActiveUnit === 'pips') {
                    document.getElementById('sl-info-pips').innerHTML = `Corresponding Price: <strong id="sl-pips-dist">${slPrice.toFixed(precision)}</strong>`;
                    document.getElementById('sl-info-usd').innerHTML = `Risk: <strong id="sl-usd-loss" class="text-danger">-$${lossUSD.toFixed(2)}</strong>`;
                } else if (slActiveUnit === 'usd') {
                    document.getElementById('sl-info-pips').innerHTML = `Corresponding Price: <strong id="sl-pips-dist">${slPrice.toFixed(precision)}</strong>`;
                    document.getElementById('sl-info-usd').innerHTML = `Distance: <strong id="sl-usd-loss" class="text-warning">${pipsDist} pips</strong>`;
                }
            }
        }

        // Take Profit Calculator
        const tpChecked = document.getElementById('enable-tp').checked;
        if (tpChecked) {
            const tpActiveUnit = document.getElementById('tp-active-unit').value;
            const tpVal = parseFloat(document.getElementById('trade-tp').value) || 0;
            if (tpVal >= 0) {
                const tpPrice = this.getActualTPPrice();
                const dist = Math.abs(entryPrice - tpPrice);
                const pipsDist = (dist / pipSize).toFixed(1);
                const profitQuote = vol * contractSize * dist;
                const profitUSD = this.convertToUSD(symbol, profitQuote, entryPrice);

                if (tpActiveUnit === 'price') {
                    document.getElementById('tp-info-pips').innerHTML = `Distance: <strong id="tp-pips-dist">${pipsDist} pips</strong>`;
                    document.getElementById('tp-info-usd').innerHTML = `Profit: <strong id="tp-usd-profit" class="text-success">+$${profitUSD.toFixed(2)}</strong>`;
                } else if (tpActiveUnit === 'pips') {
                    document.getElementById('tp-info-pips').innerHTML = `Corresponding Price: <strong id="tp-pips-dist">${tpPrice.toFixed(precision)}</strong>`;
                    document.getElementById('tp-info-usd').innerHTML = `Profit: <strong id="tp-usd-profit" class="text-success">+$${profitUSD.toFixed(2)}</strong>`;
                } else if (tpActiveUnit === 'usd') {
                    document.getElementById('tp-info-pips').innerHTML = `Corresponding Price: <strong id="tp-pips-dist">${tpPrice.toFixed(precision)}</strong>`;
                    document.getElementById('tp-info-usd').innerHTML = `Distance: <strong id="tp-usd-profit" class="text-warning">${pipsDist} pips</strong>`;
                }
            }
        }
    }

    formatTradeTime(value) {
        if (!value) return '-';
        const date = typeof value === 'number' ? new Date(value * 1000) : new Date(value);
        if (Number.isNaN(date.getTime())) return String(value);
        return date.toLocaleString('en-GB', {
            day: '2-digit',
            month: '2-digit',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
            hour12: false
        });
    }

    resultBadgeClass(result) {
        return String(result || 'manual')
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/^-|-$/g, '') || 'manual';
    }

    escapeHtml(value) {
        return String(value ?? '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    // ─── Tick update hook from Replay loop ─────────────────────────────────
    onReplayTick(bar) {
        if (!this.isReplayMode) return;

        const symbol = this.currentSymbol;
        const spread = this.getSpread(symbol);
        const precision = this.getPrecision(symbol);

        this.currentBid = bar.close;
        this.currentAsk = bar.close + spread;

        // Update price buttons UI
        document.getElementById('quick-sell-price').textContent = this.currentBid.toFixed(precision);
        document.getElementById('quick-buy-price').textContent = this.currentAsk.toFixed(precision);

        // Update badge
        const badge = document.getElementById('trade-mode-badge');
        badge.textContent = 'SIMULATOR';
        badge.className = 'trade-mode-badge';

        // Update execute button pricing and risk reward calcs live
        this.updateExecutionButton();
        this.updateRiskRewardCalcs();


        // 1. Process Pending virtual orders
        const pending = this.virtualAccount.pending;
        const active_positions = this.virtualAccount.positions;
        const contractSize = this.getContractSize(symbol);

        for (let i = pending.length - 1; i >= 0; i--) {
            const pOrder = pending[i];
            if (pOrder.symbol !== symbol) continue;

            // Check if triggered (the bar high/low range includes the order price)
            const lowVal = bar.low;
            const highVal = bar.high;
            const triggerPrice = pOrder.price_order;

            let trigger = false;
            if (pOrder.type === 'BUY_LIMIT' && lowVal <= triggerPrice) trigger = true;
            else if (pOrder.type === 'SELL_LIMIT' && highVal >= triggerPrice) trigger = true;
            else if (pOrder.type === 'BUY_STOP' && highVal >= triggerPrice) trigger = true;
            else if (pOrder.type === 'SELL_STOP' && lowVal <= triggerPrice) trigger = true;

            if (trigger) {
                // Fill order!
                pending.splice(i, 1);

                // Calculate required margin
                const margin = (pOrder.volume * contractSize * triggerPrice) / 500.0;

                const newPos = {
                    ticket: pOrder.ticket,
                    symbol: pOrder.symbol,
                    type: (pOrder.type.startsWith('BUY')) ? 'BUY' : 'SELL',
                    volume: pOrder.volume,
                    price_open: triggerPrice,
                    price_current: triggerPrice,
                    sl: pOrder.sl,
                    tp: pOrder.tp,
                    margin: margin,
                    profit: 0.0,
                    time: bar.time
                };

                active_positions.push(newPos);
                console.log(`[Virtual] Pending filled: ${newPos.type} ${newPos.volume} lots at ${triggerPrice}`);
            }
        }

        // 2. Update floating profit/loss & check SL/TP for open positions
        for (let i = active_positions.length - 1; i >= 0; i--) {
            const pos = active_positions[i];
            if (pos.symbol !== symbol) continue;

            const lowVal = bar.low;
            const highVal = bar.high;

            // Floating profit based on replayed candle's close
            pos.price_current = bar.close;
            let profitQuote = 0.0;
            if (pos.type === 'BUY') {
                profitQuote = pos.volume * contractSize * (bar.close - pos.price_open);
            } else {
                profitQuote = pos.volume * contractSize * (pos.price_open - bar.close);
            }
            pos.profit = this.convertToUSD(pos.symbol, profitQuote, bar.close);

            // Check Stop Loss hit
            let isClosed = false;
            let exitPrice = 0.0;
            let closeReason = '';

            if (pos.sl > 0) {
                if (pos.type === 'BUY' && lowVal <= pos.sl) {
                    isClosed = true;
                    exitPrice = pos.sl;
                    closeReason = 'SL';
                } else if (pos.type === 'SELL' && highVal >= pos.sl) {
                    isClosed = true;
                    exitPrice = pos.sl;
                    closeReason = 'SL';
                }
            }

            // Check Take Profit hit
            if (!isClosed && pos.tp > 0) {
                if (pos.type === 'BUY' && highVal >= pos.tp) {
                    isClosed = true;
                    exitPrice = pos.tp;
                    closeReason = 'TP';
                } else if (pos.type === 'SELL' && lowVal <= pos.tp) {
                    isClosed = true;
                    exitPrice = pos.tp;
                    closeReason = 'TP';
                }
            }

            if (isClosed) {
                // Trigger auto closure!
                active_positions.splice(i, 1);

                let closedProfitQuote = 0.0;
                if (pos.type === 'BUY') {
                    closedProfitQuote = pos.volume * contractSize * (exitPrice - pos.price_open);
                } else {
                    closedProfitQuote = pos.volume * contractSize * (pos.price_open - exitPrice);
                }
                const realizedProfitUSD = this.convertToUSD(pos.symbol, closedProfitQuote, exitPrice);

                // Update Balance
                this.virtualAccount.balance += realizedProfitUSD;

                // Add to history
                const date = new Date(bar.time * 1000);
                const timeStr = date.toLocaleTimeString() + ' ' + date.toLocaleDateString();

                this.virtualAccount.history.unshift({
                    time: timeStr,
                    ticket: pos.ticket,
                    symbol: pos.symbol,
                    type: pos.type,
                    volume: pos.volume,
                    price_open: pos.price_open,
                    price_close: exitPrice,
                    profit: realizedProfitUSD,
                    result: closeReason
                });

                console.log(`[Virtual] Auto-Closed position #${pos.ticket} via ${closeReason} at ${exitPrice}. Profit: $${realizedProfitUSD.toFixed(2)}`);
            }
        }

        // 3. Recalculate Equity & Free Margin
        let totalProfit = 0.0;
        let totalMargin = 0.0;
        active_positions.forEach(p => {
            totalProfit += p.profit;
            totalMargin += p.margin;
        });

        this.virtualAccount.equity = this.virtualAccount.balance + totalProfit;
        this.virtualAccount.margin = totalMargin;
        this.virtualAccount.free_margin = this.virtualAccount.equity - totalMargin;
        this.virtualAccount.margin_level = totalMargin > 0 ? (this.virtualAccount.equity / totalMargin) * 100 : 0.0;

        this.saveVirtualAccount();
        this.updateAccountUI();
        this.updateTablesUI();
        this.updateRiskRewardCalcs();
    }

    // ─── Execution Logic ──────────────────────────────────────────────────
    async executeOrder() {
        const symbol = this.currentSymbol;
        const side = this.activeSide;
        const orderType = document.getElementById('trade-order-type').value;
        const vol = parseFloat(document.getElementById('trade-volume').value) || 0.01;

        const sl = this.getActualSLPrice();
        const tp = this.getActualTPPrice();

        if (this.isReplayMode) {
            // VIRTUAL ORDER PLACEMENT
            const contractSize = this.getContractSize(symbol);
            let entryPrice = (side === 'buy') ? this.currentAsk : this.currentBid;

            if (orderType === 'limit') {
                entryPrice = parseFloat(document.getElementById('trade-price').value) || entryPrice;
            }

            const ticket = ++this.virtualAccount.ticket_counter;
            let timeVal = Math.floor(Date.now() / 1000);
            if (window.replayManager && window.replayManager.fullData && window.replayManager.currentIndex !== undefined && window.replayManager.currentIndex !== null) {
                const currentBar = window.replayManager.fullData[window.replayManager.currentIndex];
                if (currentBar) {
                    timeVal = currentBar.time;
                }
            }

            if (orderType === 'market') {
                // Check if margin is sufficient
                const margin = (vol * contractSize * entryPrice) / 500.0;
                if (this.virtualAccount.free_margin < margin) {
                    alert('Insufficient margin to place virtual order!');
                    return;
                }

                this.virtualAccount.positions.push({
                    ticket: ticket,
                    symbol: symbol,
                    type: side.toUpperCase(),
                    volume: vol,
                    price_open: entryPrice,
                    price_current: entryPrice,
                    sl: sl,
                    tp: tp,
                    margin: margin,
                    profit: 0.0,
                    time: timeVal
                });
            } else {
                // Pending Order
                // Determine sub-type: LIMIT vs STOP
                let pType = '';
                const currentMid = (this.currentBid + this.currentAsk) / 2;
                if (side === 'buy') {
                    pType = (entryPrice < currentMid) ? 'BUY_LIMIT' : 'BUY_STOP';
                } else {
                    pType = (entryPrice > currentMid) ? 'SELL_LIMIT' : 'SELL_STOP';
                }

                this.virtualAccount.pending.push({
                    ticket: ticket,
                    symbol: symbol,
                    type: pType,
                    volume: vol,
                    price_order: entryPrice,
                    sl: sl,
                    tp: tp,
                    time: timeVal
                });
            }

            this.saveVirtualAccount();
            this.updateAccountUI();
            this.updateTablesUI();
            alert(`[Virtual] Order placed successfully! Ticket: #${ticket}`);
        } else {
            // LIVE MT5 ORDER PLACEMENT
            const apiType = (side === 'buy') ? 'buy' : 'sell';

            try {
                const response = await fetch('/api/trade/place', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        symbol: symbol,
                        type: apiType,
                        lots: vol,
                        sl: sl,
                        tp: tp
                    })
                });

                const result = await response.json();
                if (result.success) {
                    alert(`[Live MT5] Order placed successfully! Ticket: #${result.ticket}`);
                    this.pollMT5TradeState();
                } else {
                    alert(`[Live MT5] Order placement failed: ${result.message}`);
                }
            } catch (e) {
                console.error('Failed to place live order:', e);
                alert('[Live MT5] Connection error to socket server!');
            }
        }
    }

    async closePosition(ticket) {
        if (this.isReplayMode) {
            // CLOSE VIRTUAL POSITION
            const positions = this.virtualAccount.positions;
            const idx = positions.findIndex(p => p.ticket === ticket);
            if (idx >= 0) {
                const pos = positions[idx];
                positions.splice(idx, 1);

                // Realize profit
                this.virtualAccount.balance += pos.profit;

                // Release margin
                this.virtualAccount.equity = this.virtualAccount.balance;

                // Add to history
                let date = new Date();
                if (window.replayManager && window.replayManager.fullData && window.replayManager.currentIndex !== undefined && window.replayManager.currentIndex !== null) {
                    const currentBar = window.replayManager.fullData[window.replayManager.currentIndex];
                    if (currentBar) {
                        date = new Date(currentBar.time * 1000);
                    }
                }
                const timeStr = date.toLocaleTimeString() + ' ' + date.toLocaleDateString();
                this.virtualAccount.history.unshift({
                    time: timeStr,
                    ticket: pos.ticket,
                    symbol: pos.symbol,
                    type: pos.type,
                    volume: pos.volume,
                    price_open: pos.price_open,
                    price_close: pos.price_current,
                    profit: pos.profit,
                    result: 'Manual Close'
                });

                this.saveVirtualAccount();
                this.updateAccountUI();
                this.updateTablesUI();
                alert(`[Virtual] Position #${ticket} closed successfully.`);
            }
        } else {
            // CLOSE LIVE MT5 POSITION
            try {
                const response = await fetch('/api/trade/close', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ ticket: ticket })
                });

                const result = await response.json();
                if (result.success) {
                    alert(`[Live MT5] Position #${ticket} closed successfully.`);
                    this.pollMT5TradeState();
                } else {
                    alert(`[Live MT5] Closing position failed: ${result.message}`);
                }
            } catch (e) {
                console.error('Failed to close live order:', e);
            }
        }
    }

    cancelPending(ticket) {
        if (this.isReplayMode) {
            const pending = this.virtualAccount.pending;
            const idx = pending.findIndex(p => p.ticket === ticket);
            if (idx >= 0) {
                pending.splice(idx, 1);
                this.saveVirtualAccount();
                this.updateTablesUI();
                alert(`[Virtual] Pending order #${ticket} cancelled.`);
            }
        } else {
            alert('MT5 Live pending order cancellation is under development / being updated.');
        }
    }

    // ─── UI Redraw Methods ────────────────────────────────────────────────
    updateAccountUI() {
        if (this.isReplayMode) {
            document.getElementById('acc-balance').textContent = `$${this.virtualAccount.balance.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
            document.getElementById('acc-equity').textContent = `$${this.virtualAccount.equity.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
            document.getElementById('acc-margin').textContent = `$${this.virtualAccount.margin.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
            document.getElementById('acc-free-margin').textContent = `$${this.virtualAccount.free_margin.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
            document.getElementById('acc-margin-level').textContent = `${this.virtualAccount.margin_level.toFixed(2)}%`;
        }
    }

    updateTablesUI() {
        if (!this.isReplayMode) return; // In Live mode tables are updated by polling data

        // 1. Redraw Open Positions
        const posBody = document.getElementById('positions-list');
        const countOpenEl = document.getElementById('open-positions-count');
        const positions = this.virtualAccount.positions;

        countOpenEl.textContent = positions.length;

        if (positions.length === 0) {
            posBody.innerHTML = `<tr><td colspan="10" class="empty-row">No open trading positions.</td></tr>`;
        } else {
            posBody.innerHTML = '';
            positions.forEach(pos => {
                const tr = document.createElement('tr');
                const p = this.getPrecision(pos.symbol);
                const profColor = pos.profit >= 0 ? 'text-success' : 'text-danger';
                const sign = pos.profit >= 0 ? '+' : '';

                tr.innerHTML = `
                    <td>#${pos.ticket}</td>
                    <td><strong>${pos.symbol}</strong></td>
                    <td><span class="badge ${pos.type.toLowerCase()}">${pos.type}</span></td>
                    <td>${pos.volume.toFixed(2)}</td>
                    <td>${pos.price_open.toFixed(p)}</td>
                    <td>${pos.price_current.toFixed(p)}</td>
                    <td>${pos.sl > 0 ? pos.sl.toFixed(p) : '-'}</td>
                    <td>${pos.tp > 0 ? pos.tp.toFixed(p) : '-'}</td>
                    <td class="${profColor} font-bold">${sign}$${pos.profit.toFixed(2)}</td>
                    <td><button class="btn-close-trade" onclick="window.tradeManager.closePosition(${pos.ticket})">Close</button></td>
                `;
                posBody.appendChild(tr);
            });
        }

        // 2. Redraw Pending Orders
        const pendBody = document.getElementById('pending-list');
        const countPendEl = document.getElementById('pending-positions-count');
        const pending = this.virtualAccount.pending;

        countPendEl.textContent = pending.length;

        if (pending.length === 0) {
            pendBody.innerHTML = `<tr><td colspan="9" class="empty-row">No pending orders.</td></tr>`;
        } else {
            pendBody.innerHTML = '';
            pending.forEach(pOrd => {
                const tr = document.createElement('tr');
                const p = this.getPrecision(pOrd.symbol);

                tr.innerHTML = `
                    <td>#${pOrd.ticket}</td>
                    <td><strong>${pOrd.symbol}</strong></td>
                    <td><span class="badge pending">${pOrd.type}</span></td>
                    <td>${pOrd.volume.toFixed(2)}</td>
                    <td>${pOrd.price_order.toFixed(p)}</td>
                    <td>${this.currentBid > 0 ? this.currentBid.toFixed(p) : '-'}</td>
                    <td>${pOrd.sl > 0 ? pOrd.sl.toFixed(p) : '-'}</td>
                    <td>${pOrd.tp > 0 ? pOrd.tp.toFixed(p) : '-'}</td>
                    <td><button class="btn-close-trade" onclick="window.tradeManager.cancelPending(${pOrd.ticket})">Cancel</button></td>
                `;
                pendBody.appendChild(tr);
            });
        }

        // 3. Redraw History
        const histBody = document.getElementById('history-list');
        const history = this.virtualAccount.history;

        if (history.length === 0) {
            histBody.innerHTML = `<tr><td colspan="9" class="empty-row">No trade history available yet.</td></tr>`;
        } else {
            histBody.innerHTML = '';
            // Display maximum 50 history entries
            history.slice(0, 50).forEach(h => {
                const tr = document.createElement('tr');
                const p = this.getPrecision(h.symbol);
                const profColor = h.profit >= 0 ? 'text-success' : 'text-danger';
                const sign = h.profit >= 0 ? '+' : '';

                tr.innerHTML = `
                    <td>${h.time}</td>
                    <td>#${h.ticket}</td>
                    <td><strong>${h.symbol}</strong></td>
                    <td><span class="badge ${h.type.toLowerCase()}">${h.type}</span></td>
                    <td>${h.volume.toFixed(2)}</td>
                    <td>${h.price_open.toFixed(p)}</td>
                    <td>${h.price_close.toFixed(p)}</td>
                    <td class="${profColor} font-bold">${sign}$${h.profit.toFixed(2)}</td>
                    <td><span class="badge result-${this.resultBadgeClass(h.result)}">${h.result || 'MANUAL'}</span></td>
                `;
                histBody.appendChild(tr);
            });
        }

        // Draw visual lines on the active charts
        this.drawAllChartLines();
    }

    renderLiveHistory(history) {
        const histBody = document.getElementById('history-list');
        if (!histBody) return;

        if (!history || history.length === 0) {
            histBody.innerHTML = `<tr><td colspan="9" class="empty-row">No live MT5 trade history yet.</td></tr>`;
            return;
        }

        histBody.innerHTML = '';
        history.slice(0, 100).forEach(h => {
            const tr = document.createElement('tr');
            const p = this.getPrecision(h.symbol);
            const profit = Number(h.profit_total ?? h.profit ?? 0);
            const profColor = profit >= 0 ? 'text-success' : 'text-danger';
            const sign = profit >= 0 ? '+' : '';
            const closePrice = Number(h.price_close || 0);
            const result = h.result || (h.entry === 'IN' ? 'Opened' : 'Closed');

            tr.innerHTML = `
                <td>${this.formatTradeTime(h.time)}</td>
                <td>#${h.ticket}</td>
                <td><strong>${h.symbol}</strong></td>
                <td><span class="badge ${String(h.type || '').toLowerCase()}">${h.type || '-'}</span></td>
                <td>${Number(h.volume || 0).toFixed(2)}</td>
                <td>${Number(h.price_open || 0).toFixed(p)}</td>
                <td>${closePrice > 0 ? closePrice.toFixed(p) : '-'}</td>
                <td class="${profColor} font-bold">${sign}$${profit.toFixed(2)}</td>
                <td><span class="badge result-${this.resultBadgeClass(result)}">${result}</span></td>
            `;
            histBody.appendChild(tr);
        });
    }

    renderLiveHistoryError(message) {
        const histBody = document.getElementById('history-list');
        if (!histBody) return;

        const cleanMessage = this.escapeHtml(message || 'Failed to load live MT5 trade history.');
        histBody.innerHTML = `<tr><td colspan="9" class="empty-row">${cleanMessage}</td></tr>`;
    }

    // ─── MT5 Polling & Live updates ─────────────────────────────────────────
    startMT5Polling() {
        // Clear any existing intervals
        if (this.pollingInterval) clearInterval(this.pollingInterval);
        if (this.priceInterval) clearInterval(this.priceInterval);

        // Polling loop for Live Account and Positions (every 2.0 seconds)
        this.pollingInterval = setInterval(() => {
            if (!this.isReplayMode) {
                this.pollMT5TradeState();
            }
        }, 2000);

        // Price loop for Live Sell/Buy buttons (every 1.0 second)
        this.priceInterval = setInterval(() => {
            if (!this.isReplayMode) {
                this.pollLivePrice();
            }
        }, 1000);
    }

    async pollMT5TradeState() {
        const statusEl = document.getElementById('mt5-status');
        const isConnected = statusEl && statusEl.classList.contains('connected');
        if (!isConnected) return;

        // Update badge
        const badge = document.getElementById('trade-mode-badge');
        badge.textContent = 'DEMO LIVE';
        badge.className = 'trade-mode-badge live';

        try {
            // 1. Fetch Account Info
            const accRes = await fetch('/api/trade/account');
            const accData = await accRes.json();
            if (accData.success && accData.account) {
                const acc = accData.account;
                document.getElementById('acc-balance').textContent = `$${acc.balance.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
                document.getElementById('acc-equity').textContent = `$${acc.equity.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
                document.getElementById('acc-margin').textContent = `$${acc.margin.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
                document.getElementById('acc-free-margin').textContent = `$${acc.free_margin.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
                document.getElementById('acc-margin-level').textContent = `${acc.margin_level.toFixed(2)}%`;
            }

            // 2. Fetch Open Positions
            const posRes = await fetch('/api/trade/positions');
            const posData = await posRes.json();
            if (posData.success && posData.positions) {
                const posBody = document.getElementById('positions-list');
                const countOpenEl = document.getElementById('open-positions-count');
                const positions = posData.positions;

                countOpenEl.textContent = positions.length;

                if (positions.length === 0) {
                    posBody.innerHTML = `<tr><td colspan="10" class="empty-row">No open trading positions.</td></tr>`;
                } else {
                    posBody.innerHTML = '';
                    positions.forEach(pos => {
                        const tr = document.createElement('tr');
                        const p = this.getPrecision(pos.symbol);
                        const profColor = pos.profit >= 0 ? 'text-success' : 'text-danger';
                        const sign = pos.profit >= 0 ? '+' : '';

                        tr.innerHTML = `
                            <td>#${pos.ticket}</td>
                            <td><strong>${pos.symbol}</strong></td>
                            <td><span class="badge ${pos.type.toLowerCase()}">${pos.type}</span></td>
                            <td>${pos.volume.toFixed(2)}</td>
                            <td>${pos.price_open.toFixed(p)}</td>
                            <td>${pos.price_current.toFixed(p)}</td>
                            <td>${pos.sl > 0 ? pos.sl.toFixed(p) : '-'}</td>
                            <td>${pos.tp > 0 ? pos.tp.toFixed(p) : '-'}</td>
                            <td class="${profColor} font-bold">${sign}$${pos.profit.toFixed(2)}</td>
                            <td><button class="btn-close-trade" onclick="window.tradeManager.closePosition(${pos.ticket})">Close</button></td>
                        `;
                        posBody.appendChild(tr);
                    });
                }

                // Change detection for order lines redrawing in live mode
                const changed = this.checkLivePositionsChanged(positions);
                this.livePositions = positions;
                if (changed) {
                    this.drawAllChartLines();
                }
            }

            // 3. Fetch recent MT5 deals for the Trading History tab.
            const pendCountEl = document.getElementById('pending-positions-count');
            if (pendCountEl) pendCountEl.textContent = '0';
            const pendBody = document.getElementById('pending-list');
            if (pendBody) {
                pendBody.innerHTML = `<tr><td colspan="9" class="empty-row">Live pending order display is not available yet.</td></tr>`;
            }

            const historyRes = await fetch('/api/trade/history?days=365');
            const historyData = await historyRes.json();
            if (historyData.success && historyData.history) {
                this.renderLiveHistory(historyData.history);
            } else {
                this.renderLiveHistoryError(historyData.message || 'Failed to load live MT5 trade history.');
            }
        } catch (e) {
            console.error('Failed to poll live MT5 trade state:', e);
        }
    }

    async pollLivePrice() {
        const symbol = this.currentSymbol;
        try {
            const response = await fetch(`/api/price/${symbol}`);
            const data = await response.json();
            if (data.success && data.price) {
                this.currentBid = data.price.bid;
                this.currentAsk = data.price.ask;

                const p = this.getPrecision(symbol);
                document.getElementById('quick-sell-price').textContent = this.currentBid.toFixed(p);
                document.getElementById('quick-buy-price').textContent = this.currentAsk.toFixed(p);

                this.updateRiskRewardCalcs();
                this.updateExecutionButton();

                // Tick the live price into the active chart's current bar!
                if (window.chartManager && !window.chartManager.isReplayMode) {
                    window.chartManager.tickActiveChartPrice(symbol, this.currentBid);
                }
            }

        } catch (e) {
            console.error('Failed to poll live price:', e);
        }
    }

    checkLivePositionsChanged(newPositions) {
        if (!this.livePositions) return true;
        if (this.livePositions.length !== newPositions.length) return true;
        for (let i = 0; i < newPositions.length; i++) {
            const n = newPositions[i];
            const o = this.livePositions[i];
            if (!o) return true;
            if (n.ticket !== o.ticket || n.sl !== o.sl || n.tp !== o.tp || n.price_open !== o.price_open || n.volume !== o.volume) {
                return true;
            }
        }
        return false;
    }

    drawAllChartLines() {
        if (!window.chartManager || !window.chartManager.panels) return;

        // 1. Clear existing order lines from all panels
        window.chartManager.panels.forEach(panel => {
            if (panel.activeOrderLines) {
                panel.activeOrderLines.forEach(line => {
                    try {
                        line.remove();
                    } catch (e) {
                        console.error("Error removing line:", e);
                    }
                });
            }
            panel.activeOrderLines = [];
        });

        // 2. Fetch positions and pending orders depending on mode
        let positions = [];
        let pending = [];

        if (this.isReplayMode) {
            positions = this.virtualAccount.positions || [];
            pending = this.virtualAccount.pending || [];
        } else {
            positions = this.livePositions || [];
            pending = []; // API currently only manages live positions
        }

        // 3. Draw lines for each panel displaying matching symbols
        window.chartManager.panels.forEach(panel => {
            if (!panel.chartReady || !panel.chart) return;
            const symbol = panel.symbol.toUpperCase();

            // Open Positions
            positions.forEach(pos => {
                if (pos.symbol.toUpperCase() !== symbol) return;

                const p = this.getPrecision(pos.symbol);

                // A. Entry Price Line
                try {
                    const entryLine = panel.chart.createOrderLine();
                    entryLine.setPrice(pos.price_open);
                    entryLine.setQuantity(pos.volume.toFixed(2));
                    entryLine.setText(`${pos.type} #${pos.ticket}`);

                    const sideColor = pos.type === 'BUY' ? '#089981' : '#f23645';
                    entryLine.setLineColor(sideColor);
                    entryLine.setLineStyle(0); // Solid
                    entryLine.setBodyBorderColor(sideColor);
                    entryLine.setBodyBackgroundColor(pos.type === 'BUY' ? 'rgba(8, 153, 129, 0.15)' : 'rgba(242, 54, 69, 0.15)');
                    entryLine.setBodyTextColor('#ffffff');

                    // Bind cancel button to closing trade
                    entryLine.onCancel(() => {
                        if (this.isReplayMode) {
                            this.closePosition(pos.ticket);
                        } else {
                            if (confirm(`Are you sure you want to close live position #${pos.ticket}?`)) {
                                this.closePosition(pos.ticket);
                            }
                        }
                    });

                    panel.activeOrderLines.push(entryLine);
                } catch (e) {
                    console.error("Error creating entry line:", e);
                }

                // B. Stop Loss Line (if sl > 0)
                if (pos.sl > 0) {
                    try {
                        const slLine = panel.chart.createOrderLine();
                        slLine.setPrice(pos.sl);
                        slLine.setQuantity('');

                        // Calculate risk amount in USD
                        const dist = Math.abs(pos.price_open - pos.sl);
                        const contractSize = this.getContractSize(pos.symbol);
                        const lossQuote = pos.volume * contractSize * dist;
                        const lossUSD = this.convertToUSD(pos.symbol, lossQuote, pos.price_open);

                        slLine.setText(`SL: ${pos.sl.toFixed(p)} (-$${lossUSD.toFixed(2)})`);
                        slLine.setLineColor('#f23645');
                        slLine.setLineStyle(1); // Dashed
                        slLine.setBodyBorderColor('#f23645');
                        slLine.setBodyBackgroundColor('rgba(242, 54, 69, 0.1)');
                        slLine.setBodyTextColor('#f23645');

                        if (this.isReplayMode) {
                            slLine.onCancel(() => {
                                pos.sl = 0;
                                this.saveVirtualAccount();
                                this.updateTablesUI();
                                if (pos.symbol === this.currentSymbol) {
                                    const enableSLEl = document.getElementById('enable-sl');
                                    if (enableSLEl) enableSLEl.checked = false;
                                    const slContainer = document.getElementById('sl-control-container');
                                    if (slContainer) slContainer.style.display = 'none';
                                    this.updateRiskRewardCalcs();
                                }
                            });
                            slLine.onModify(() => {
                                let newPrice = slLine.price();
                                pos.sl = newPrice;
                                this.saveVirtualAccount();
                                this.updateTablesUI();
                                if (pos.symbol === this.currentSymbol) {
                                    const enableSLEl = document.getElementById('enable-sl');
                                    if (enableSLEl) enableSLEl.checked = true;
                                    const slContainer = document.getElementById('sl-control-container');
                                    if (slContainer) slContainer.style.display = 'flex';
                                    const slUnitBtn = document.querySelector('#sl-unit-selector .unit-btn[data-unit="price"]');
                                    if (slUnitBtn) {
                                        document.getElementById('sl-active-unit').value = 'price';
                                        document.querySelectorAll('#sl-unit-selector .unit-btn').forEach(b => b.classList.toggle('active', b === slUnitBtn));
                                    }
                                    const slInput = document.getElementById('trade-sl');
                                    if (slInput) slInput.value = newPrice.toFixed(p);
                                    this.updateRiskRewardCalcs();
                                }
                            });
                        }

                        panel.activeOrderLines.push(slLine);
                    } catch (e) {
                        console.error("Error creating SL line:", e);
                    }
                }

                // C. Take Profit Line (if tp > 0)
                if (pos.tp > 0) {
                    try {
                        const tpLine = panel.chart.createOrderLine();
                        tpLine.setPrice(pos.tp);
                        tpLine.setQuantity('');

                        // Calculate profit amount in USD
                        const dist = Math.abs(pos.price_open - pos.tp);
                        const contractSize = this.getContractSize(pos.symbol);
                        const profitQuote = pos.volume * contractSize * dist;
                        const profitUSD = this.convertToUSD(pos.symbol, profitQuote, pos.price_open);

                        tpLine.setText(`TP: ${pos.tp.toFixed(p)} (+$${profitUSD.toFixed(2)})`);
                        tpLine.setLineColor('#089981');
                        tpLine.setLineStyle(1); // Dashed
                        tpLine.setBodyBorderColor('#089981');
                        tpLine.setBodyBackgroundColor('rgba(8, 153, 129, 0.1)');
                        tpLine.setBodyTextColor('#089981');

                        if (this.isReplayMode) {
                            tpLine.onCancel(() => {
                                pos.tp = 0;
                                this.saveVirtualAccount();
                                this.updateTablesUI();
                                if (pos.symbol === this.currentSymbol) {
                                    const enableTPEl = document.getElementById('enable-tp');
                                    if (enableTPEl) enableTPEl.checked = false;
                                    const tpContainer = document.getElementById('tp-control-container');
                                    if (tpContainer) tpContainer.style.display = 'none';
                                    this.updateRiskRewardCalcs();
                                }
                            });
                            tpLine.onModify(() => {
                                let newPrice = tpLine.price();
                                pos.tp = newPrice;
                                this.saveVirtualAccount();
                                this.updateTablesUI();
                                if (pos.symbol === this.currentSymbol) {
                                    const enableTPEl = document.getElementById('enable-tp');
                                    if (enableTPEl) enableTPEl.checked = true;
                                    const tpContainer = document.getElementById('tp-control-container');
                                    if (tpContainer) tpContainer.style.display = 'flex';
                                    const tpUnitBtn = document.querySelector('#tp-unit-selector .unit-btn[data-unit="price"]');
                                    if (tpUnitBtn) {
                                        document.getElementById('tp-active-unit').value = 'price';
                                        document.querySelectorAll('#tp-unit-selector .unit-btn').forEach(b => b.classList.toggle('active', b === tpUnitBtn));
                                    }
                                    const tpInput = document.getElementById('trade-tp');
                                    if (tpInput) tpInput.value = newPrice.toFixed(p);
                                    this.updateRiskRewardCalcs();
                                }
                            });
                        }

                        panel.activeOrderLines.push(tpLine);
                    } catch (e) {
                        console.error("Error creating TP line:", e);
                    }
                }
            });

            // Pending Orders (Replay Mode only)
            pending.forEach(ord => {
                if (ord.symbol.toUpperCase() !== symbol) return;

                const p = this.getPrecision(ord.symbol);
                const price = ord.price_order || ord.price_pending || 0;

                // A. Pending Entry Line
                try {
                    const entryLine = panel.chart.createOrderLine();
                    entryLine.setPrice(price);
                    entryLine.setQuantity(ord.volume.toFixed(2));
                    entryLine.setText(`${ord.type} #${ord.ticket}`);
                    entryLine.setLineColor('#ff9800');
                    entryLine.setLineStyle(0); // Solid
                    entryLine.setBodyBorderColor('#ff9800');
                    entryLine.setBodyBackgroundColor('rgba(255, 152, 0, 0.15)');
                    entryLine.setBodyTextColor('#ff9800');

                    if (this.isReplayMode) {
                        entryLine.onCancel(() => {
                            this.cancelPending(ord.ticket);
                        });
                        entryLine.onModify(() => {
                            let newPrice = entryLine.price();
                            ord.price_order = newPrice;
                            if (ord.price_pending !== undefined) ord.price_pending = newPrice;
                            this.saveVirtualAccount();
                            this.updateTablesUI();
                            if (ord.symbol === this.currentSymbol) {
                                const priceInput = document.getElementById('trade-price');
                                if (priceInput) priceInput.value = newPrice.toFixed(p);
                                this.updateRiskRewardCalcs();
                            }
                        });
                    }

                    panel.activeOrderLines.push(entryLine);
                } catch (e) {
                    console.error("Error creating pending entry line:", e);
                }

                // B. Pending SL Line (if sl > 0)
                if (ord.sl > 0) {
                    try {
                        const slLine = panel.chart.createOrderLine();
                        slLine.setPrice(ord.sl);
                        slLine.setQuantity('');
                        slLine.setText(`SL: ${ord.sl.toFixed(p)}`);
                        slLine.setLineColor('#f23645');
                        slLine.setLineStyle(1); // Dashed
                        slLine.setBodyBorderColor('#f23645');
                        slLine.setBodyBackgroundColor('rgba(242, 54, 69, 0.1)');
                        slLine.setBodyTextColor('#f23645');

                        if (this.isReplayMode) {
                            slLine.onCancel(() => {
                                ord.sl = 0;
                                this.saveVirtualAccount();
                                this.updateTablesUI();
                                if (ord.symbol === this.currentSymbol) {
                                    const enableSLEl = document.getElementById('enable-sl');
                                    if (enableSLEl) enableSLEl.checked = false;
                                    const slContainer = document.getElementById('sl-control-container');
                                    if (slContainer) slContainer.style.display = 'none';
                                    this.updateRiskRewardCalcs();
                                }
                            });
                            slLine.onModify(() => {
                                let newPrice = slLine.price();
                                ord.sl = newPrice;
                                this.saveVirtualAccount();
                                this.updateTablesUI();
                                if (ord.symbol === this.currentSymbol) {
                                    const enableSLEl = document.getElementById('enable-sl');
                                    if (enableSLEl) enableSLEl.checked = true;
                                    const slContainer = document.getElementById('sl-control-container');
                                    if (slContainer) slContainer.style.display = 'flex';
                                    const slUnitBtn = document.querySelector('#sl-unit-selector .unit-btn[data-unit="price"]');
                                    if (slUnitBtn) {
                                        document.getElementById('sl-active-unit').value = 'price';
                                        document.querySelectorAll('#sl-unit-selector .unit-btn').forEach(b => b.classList.toggle('active', b === slUnitBtn));
                                    }
                                    const slInput = document.getElementById('trade-sl');
                                    if (slInput) slInput.value = newPrice.toFixed(p);
                                    this.updateRiskRewardCalcs();
                                }
                            });
                        }

                        panel.activeOrderLines.push(slLine);
                    } catch (e) {
                        console.error("Error creating pending SL line:", e);
                    }
                }

                // C. Pending TP Line (if tp > 0)
                if (ord.tp > 0) {
                    try {
                        const tpLine = panel.chart.createOrderLine();
                        tpLine.setPrice(ord.tp);
                        tpLine.setQuantity('');
                        tpLine.setText(`TP: ${ord.tp.toFixed(p)}`);
                        tpLine.setLineColor('#089981');
                        tpLine.setLineStyle(1); // Dashed
                        tpLine.setBodyBorderColor('#089981');
                        tpLine.setBodyBackgroundColor('rgba(8, 153, 129, 0.1)');
                        tpLine.setBodyTextColor('#089981');

                        if (this.isReplayMode) {
                            tpLine.onCancel(() => {
                                ord.tp = 0;
                                this.saveVirtualAccount();
                                this.updateTablesUI();
                                if (ord.symbol === this.currentSymbol) {
                                    const enableTPEl = document.getElementById('enable-tp');
                                    if (enableTPEl) enableTPEl.checked = false;
                                    const tpContainer = document.getElementById('tp-control-container');
                                    if (tpContainer) tpContainer.style.display = 'none';
                                    this.updateRiskRewardCalcs();
                                }
                            });
                            tpLine.onModify(() => {
                                let newPrice = tpLine.price();
                                ord.tp = newPrice;
                                this.saveVirtualAccount();
                                this.updateTablesUI();
                                if (ord.symbol === this.currentSymbol) {
                                    const enableTPEl = document.getElementById('enable-tp');
                                    if (enableTPEl) enableTPEl.checked = true;
                                    const tpContainer = document.getElementById('tp-control-container');
                                    if (tpContainer) tpContainer.style.display = 'flex';
                                    const tpUnitBtn = document.querySelector('#tp-unit-selector .unit-btn[data-unit="price"]');
                                    if (tpUnitBtn) {
                                        document.getElementById('tp-active-unit').value = 'price';
                                        document.querySelectorAll('#tp-unit-selector .unit-btn').forEach(b => b.classList.toggle('active', b === tpUnitBtn));
                                    }
                                    const tpInput = document.getElementById('trade-tp');
                                    if (tpInput) tpInput.value = newPrice.toFixed(p);
                                    this.updateRiskRewardCalcs();
                                }
                            });
                        }

                        panel.activeOrderLines.push(tpLine);
                    } catch (e) {
                        console.error("Error creating pending TP line:", e);
                    }
                }
            });
        });
    }
}

// Initialize
window.addEventListener('DOMContentLoaded', () => {
    window.chartManager = new ChartManager();
    window.tradeManager = new TradeManager();
});
