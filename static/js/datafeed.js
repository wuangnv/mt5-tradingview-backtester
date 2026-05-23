/**
 * Custom JS API Datafeed for TradingView Advanced Charts (Charting Library)
 * Connects directly to Flask backend endpoints (/api/data and /api/price)
 */

const configurationData = {
    supported_resolutions: ['1', '5', '15', '30', '60', '240', 'D', 'W'],
    exchanges: [{
        value: 'Exness',
        name: 'Exness',
        desc: 'Exness Forex'
    }],
    symbols_types: [{
        name: 'forex',
        value: 'forex'
    }]
};

class MT5Datafeed {
    constructor() {
        this.subscribers = {};
        this.historyCache = new Map();
        this.historyRequests = new Map();
    }

    _historyKey(symbol, timeframe) {
        return `${symbol}::${timeframe}`;
    }

    getCachedHistory(symbol, timeframe) {
        const cached = this.historyCache.get(this._historyKey(symbol, timeframe));
        return cached ? cached.data : null;
    }

    hasHistoryCoverage(symbol, timeframe, timestamp, minBars = 2) {
        const data = this.getCachedHistory(symbol, timeframe);
        if (!data || data.length < minBars) return false;
        return data[0].time <= timestamp && data[data.length - 1].time >= timestamp;
    }

    storeHistory(symbol, timeframe, data) {
        if (!Array.isArray(data) || data.length === 0) return [];
        const sorted = data.slice().sort((a, b) => a.time - b.time);
        this.historyCache.set(this._historyKey(symbol, timeframe), {
            data: sorted,
            bars: sorted.length,
            updatedAt: Date.now()
        });
        return sorted;
    }

    async fetchHistory(symbol, timeframe, bars = 2000, options = {}) {
        const key = this._historyKey(symbol, timeframe);
        const cached = this.historyCache.get(key);
        const force = Boolean(options.force);

        if (!force && cached?.data?.length >= bars) {
            console.log(`[Datafeed] history cache hit for ${symbol} (${timeframe}) with ${cached.data.length} bars`);
            return cached.data;
        }

        const requestKey = `${key}::${bars}`;
        if (!force && this.historyRequests.has(requestKey)) {
            console.log(`[Datafeed] sharing in-flight history request for ${symbol} (${timeframe}) ${bars} bars`);
            return this.historyRequests.get(requestKey);
        }

        const request = (async () => {
            console.log(`[Datafeed] fetching ${bars} bars for ${symbol} (${timeframe}) from backend`);
            const res = await fetch('/api/data', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ symbol, timeframe, bars })
            });
            const result = await res.json();
            if (result.success && result.data && result.data.length > 0) {
                return this.storeHistory(symbol, timeframe, result.data);
            }
            return [];
        })();

        this.historyRequests.set(requestKey, request);
        try {
            return await request;
        } finally {
            this.historyRequests.delete(requestKey);
        }
    }

    filterReplayBars(bars) {
        if (!Array.isArray(bars)) return [];
        if (window.chartManager?.isReplayMode && window.replayManager?.fullData && window.replayManager?.currentIndex !== undefined) {
            const activeBar = window.replayManager.fullData[window.replayManager.currentIndex];
            if (activeBar) {
                return bars.filter(bar => bar.time <= activeBar.time);
            }
        }
        return bars;
    }

    toTradingViewBars(bars) {
        return bars.map(bar => ({
            time: bar.time * 1000,
            open: bar.open,
            high: bar.high,
            low: bar.low,
            close: bar.close,
            volume: bar.tick_volume || bar.volume || 0
        }));
    }

    onReady(callback) {
        setTimeout(() => callback(configurationData), 0);
    }

    searchSymbols(userInput, exchange, symbolType, onResultReadyCallback) {
        fetch('/api/symbols')
            .then(res => res.json())
            .then(result => {
                if (result.success && result.symbols) {
                    const symbols = result.symbols.map(sym => ({
                        symbol: sym,
                        full_name: sym,
                        description: `${sym} Forex (MT5)`,
                        exchange: 'Exness',
                        type: 'forex'
                    }));
                    const filtered = symbols.filter(s => s.symbol.toLowerCase().includes(userInput.toLowerCase()));
                    onResultReadyCallback(filtered);
                } else {
                    onResultReadyCallback([]);
                }
            })
            .catch(() => onResultReadyCallback([]));
    }

    resolveSymbol(symbolName, onSymbolResolvedCallback, onResolveErrorCallback) {
        let precision = 5;
        if (symbolName.includes('JPY') || symbolName.includes('XAU') || symbolName.includes('GOLD') || symbolName.includes('USOIL') || symbolName.includes('BTC')) {
            precision = 2;
        } else if (symbolName.includes('XAG') || symbolName.includes('SILVER')) {
            precision = 3;
        }

        const symbolInfo = {
            name: symbolName,
            full_name: symbolName,
            description: symbolName,
            ticker: symbolName,
            type: 'forex',
            session: '24x7',
            timezone: 'Asia/Ho_Chi_Minh',
            exchange: 'Exness',
            minmov: 1,
            pricescale: Math.pow(10, precision),
            has_intraday: true,
            has_daily: true,
            has_weekly_and_monthly: true,
            has_no_volume: false,
            supported_resolutions: configurationData.supported_resolutions,
            volume_precision: 2,
            data_status: 'streaming'
        };

        setTimeout(() => onSymbolResolvedCallback(symbolInfo), 0);
    }

    async getBars(symbolInfo, resolution, periodParams, onHistoryCallback, onErrorCallback) {
        const { from, to, firstDataRequest } = periodParams;
        
        console.log(`[Datafeed] getBars called for ${symbolInfo.name} (${resolution}), from: ${new Date(from*1000).toISOString()}, to: ${new Date(to*1000).toISOString()}, firstDataRequest: ${firstDataRequest}`);

        // If it's not the first data request, tell TradingView we have no more historical data to prevent infinite loading loops
        if (!firstDataRequest) {
            console.log(`[Datafeed] getBars returning noData: true (non-first request)`);
            onHistoryCallback([], { noData: true });
            return;
        }

        const tfMap = {
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
        const timeframe = tfMap[resolution] || 'H1';

        const cm = window.chartManager;
        let panel = null;
        if (cm) {
            panel = cm.panels.find(p => p.symbol === symbolInfo.name && p.timeframe === timeframe);
            if (!panel && cm.activePanel) {
                panel = cm.activePanel;
            }
        }

        if (panel && panel.symbol === symbolInfo.name && panel.timeframe === timeframe && panel.activeLoadPromise) {
            console.log(`[Datafeed] getBars awaiting activeLoadPromise for ${symbolInfo.name} (${timeframe})`);
            await panel.activeLoadPromise;
        }

        const cachedHistory = this.getCachedHistory(symbolInfo.name, timeframe);
        if (cachedHistory && cachedHistory.length > 2) {
            console.log(`[Datafeed] getBars (GLOBAL CACHE HIT) for ${symbolInfo.name} (${timeframe}) with ${cachedHistory.length} bars`);
            if (panel && panel.symbol === symbolInfo.name && panel.timeframe === timeframe) {
                panel.fullData = cachedHistory;
            }

            const tvBars = this.toTradingViewBars(this.filterReplayBars(cachedHistory));

            console.log(`[Datafeed] getBars successfully returning ${tvBars.length} CACHED bars to TradingView`);
            onHistoryCallback(tvBars, { noData: tvBars.length === 0 });
            return;
        }

        try {
            const data = await this.fetchHistory(symbolInfo.name, timeframe, 2000);

            if (data.length > 0) {
                let bars = data;
                
                // Store full data in the chartManager panel so Replay can access it
                if (cm) {
                    let targetPanel = cm.panels.find(p => p.symbol === symbolInfo.name && p.timeframe === timeframe);
                    if (!targetPanel && cm.activePanel) {
                        targetPanel = cm.activePanel;
                    }
                    if (targetPanel) {
                        targetPanel.fullData = data;
                        targetPanel.symbol = symbolInfo.name;
                        targetPanel.timeframe = timeframe;
                        targetPanel.updateHeader();
                    }
                }

                const tvBars = this.toTradingViewBars(this.filterReplayBars(bars));

                console.log(`[Datafeed] getBars successfully returning ${tvBars.length} bars to TradingView`);
                onHistoryCallback(tvBars, { noData: tvBars.length === 0 });
            } else {
                console.log(`[Datafeed] getBars: No historical data returned by backend API`);
                onHistoryCallback([], { noData: true });
            }
        } catch (err) {
            console.error(`[Datafeed] getBars error:`, err);
            onErrorCallback(err);
        }
    }

    subscribeBars(symbolInfo, resolution, onRealtimeCallback, subscriberUID, onResetCacheNeededCallback) {
        this.subscribers[subscriberUID] = {
            symbolInfo,
            resolution,
            onRealtimeCallback,
            onResetCacheNeededCallback
        };
    }

    unsubscribeBars(subscriberUID) {
        delete this.subscribers[subscriberUID];
    }

    /**
     * Pushes real-time bar updates to matching subscribers
     */
    updateRealtime(symbol, timeframe, bar) {
        const cached = this.getCachedHistory(symbol, timeframe);
        if (cached && bar) {
            const idx = cached.findIndex(d => d.time === bar.time);
            if (idx >= 0) {
                cached[idx] = bar;
            } else if (!cached.length || bar.time > cached[cached.length - 1].time) {
                cached.push(bar);
            }
        }

        const tfMap = {
            'M1': '1',
            'M5': '5',
            'M15': '15',
            'M30': '30',
            'H1': '60',
            'H4': '240',
            'D1': 'D',
            'W1': 'W'
        };
        const resStr = tfMap[timeframe] || '60';

        for (const uid in this.subscribers) {
            const sub = this.subscribers[uid];
            if (sub.symbolInfo.name === symbol && sub.resolution === resStr) {
                sub.onRealtimeCallback({
                    time: bar.time * 1000,
                    open: bar.open,
                    high: bar.high,
                    low: bar.low,
                    close: bar.close,
                    volume: bar.tick_volume || bar.volume || 0
                });
            }
        }
    }

    /**
     * Triggers cache reset on active subscribers to force history reload (for backwards seek / seeks)
     */
    resetReplayCache(symbol, timeframe) {
        const tfMap = {
            'M1': '1',
            'M5': '5',
            'M15': '15',
            'M30': '30',
            'H1': '60',
            'H4': '240',
            'D1': 'D',
            'W1': 'W'
        };
        const resStr = tfMap[timeframe] || '60';

        for (const uid in this.subscribers) {
            const sub = this.subscribers[uid];
            if (sub.symbolInfo.name === symbol && sub.resolution === resStr) {
                if (sub.onResetCacheNeededCallback) {
                    sub.onResetCacheNeededCallback();
                }
            }
        }
    }
}

window.MT5Datafeed = new MT5Datafeed();
