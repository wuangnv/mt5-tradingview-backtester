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
        this._localStatusCache = null;
        this._localStatusTs = 0;
    }

    // ─── Local History Store Methods ──────────────────────────────────────

    /**
     * Fetch historical data from local JSON files (no MT5 needed)
     */
    async fetchLocalHistory(symbol, timeframe, fromTime, toTime) {
        try {
            const body = { symbol, timeframe };
            if (fromTime) body.from_time = fromTime;
            if (toTime) body.to_time = toTime;
            const res = await fetch('/api/history/data', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body)
            });
            const result = await res.json();
            if (result.success && result.data && result.data.length > 0) {
                return this.storeHistory(symbol, timeframe, result.data);
            }
            return [];
        } catch (err) {
            console.error('[Datafeed] fetchLocalHistory error:', err);
            return [];
        }
    }

    /**
     * Get local history store status (cached for 5s)
     */
    async getLocalHistoryStatus() {
        if (this._localStatusCache && Date.now() - this._localStatusTs < 5000) {
            return this._localStatusCache;
        }
        try {
            const res = await fetch('/api/history/status');
            const result = await res.json();
            if (result.success) {
                this._localStatusCache = result.files || [];
                this._localStatusTs = Date.now();
                return this._localStatusCache;
            }
        } catch (err) {
            console.error('[Datafeed] getLocalHistoryStatus error:', err);
        }
        return [];
    }

    async getLocalCoverage(symbol, timeframe) {
        try {
            const params = new URLSearchParams({ symbol, timeframe });
            const res = await fetch(`/api/history/coverage?${params.toString()}`);
            const result = await res.json();
            return result.success ? result.coverage : null;
        } catch (err) {
            console.error('[Datafeed] getLocalCoverage error:', err);
            return null;
        }
    }

    /**
     * Check if local history file covers a specific timestamp
     */
    async hasLocalCoverage(symbol, timeframe, timestamp) {
        const files = await this.getLocalHistoryStatus();
        const entry = files.find(f => f.symbol === symbol && f.timeframe === timeframe);
        if (!entry) return false;
        return entry.first_time <= timestamp && entry.last_time >= timestamp;
    }

    /**
     * Load local data into cache (bulk preload for replay mode)
     */
    async loadAndCacheLocalData(symbol, timeframe) {
        console.log(`[Datafeed] loadAndCacheLocalData: ${symbol} ${timeframe}`);
        return await this.fetchHistory(symbol, timeframe, 2000);
    }

    async loadReplayWindow(symbol, timeframe, cursorTime, beforeBars = 900, afterBars = 300) {
        const tfSeconds = this._timeframeSeconds(timeframe);
        const from = Math.max(0, Math.floor(cursorTime - beforeBars * tfSeconds));
        const to = Math.floor(cursorTime + afterBars * tfSeconds);
        const cached = this.coverageInfo(symbol, timeframe, cursorTime);
        if (cached.covered && cached.first <= from && cached.last >= to && cached.data.length > 0) {
            return cached.data;
        }

        return await this.fetchHistoryRange(symbol, timeframe, from, to, {
            target: cursorTime,
            countBack: beforeBars + afterBars + 1
        });
    }

    aggregateM1Bars(m1Bars, timeframe, cursorTime = null) {
        if (timeframe === 'M1') return Array.isArray(m1Bars) ? m1Bars : [];
        if (!Array.isArray(m1Bars) || !m1Bars.length) return [];

        const tfSeconds = this._timeframeSeconds(timeframe);
        const cursorBucket = cursorTime ? Math.floor(cursorTime / tfSeconds) * tfSeconds : null;
        const buckets = new Map();

        m1Bars.slice().sort((a, b) => a.time - b.time).forEach(bar => {
            if (!bar || typeof bar.time !== 'number') return;
            const bucketTime = Math.floor(bar.time / tfSeconds) * tfSeconds;
            if (cursorBucket !== null && bucketTime === cursorBucket && bar.time > cursorTime) {
                return;
            }

            let bucket = buckets.get(bucketTime);
            if (!bucket) {
                bucket = {
                    time: bucketTime,
                    open: bar.open,
                    high: bar.high,
                    low: bar.low,
                    close: bar.close,
                    volume: 0,
                    replayCursorTime: bar.time,
                    source: 'm1_aggregated'
                };
                buckets.set(bucketTime, bucket);
            }

            bucket.high = Math.max(bucket.high, bar.high);
            bucket.low = Math.min(bucket.low, bar.low);
            bucket.close = bar.close;
            bucket.replayCursorTime = bar.time;
            bucket.volume += Number(bar.volume ?? bar.tick_volume ?? 0);
        });

        return Array.from(buckets.values()).sort((a, b) => a.time - b.time);
    }

    async loadSyncedReplayWindow(symbol, timeframe, cursorTime, beforeBars = null, afterBars = null) {
        const windowSize = this.replayWindowSize(timeframe);
        beforeBars = beforeBars ?? windowSize.before;
        afterBars = afterBars ?? windowSize.after;

        if (timeframe === 'M1') {
            return await this.loadReplayWindow(symbol, 'M1', cursorTime, beforeBars, afterBars);
        }

        const tfSeconds = this._timeframeSeconds(timeframe);
        const ratio = Math.max(1, Math.ceil(tfSeconds / 60));
        if (ratio >= 5) {
            const hybrid = await this.loadHybridReplayWindow(symbol, timeframe, cursorTime, beforeBars, afterBars);
            if (hybrid.length > 0) {
                return hybrid;
            }
        }

        const beforeM1 = Math.max(900, beforeBars * ratio + ratio);
        const afterM1 = Math.max(300, afterBars * ratio + ratio);
        const from = Math.max(0, Math.floor(cursorTime - beforeM1 * 60));
        const to = Math.floor(cursorTime + afterM1 * 60);
        const maxChunks = Math.max(5, Math.ceil((beforeM1 + afterM1 + 1) / 1440) + 2);

        const m1Bars = await this.fetchHistoryRange(symbol, 'M1', from, to, {
            target: cursorTime,
            countBack: beforeM1 + afterM1 + 1,
            maxChunks
        });
        const aggregated = this.aggregateM1Bars(m1Bars, timeframe, cursorTime);
        if (aggregated.length > 0) {
            console.log(`[Datafeed] synced ${symbol} ${timeframe} from M1: ${aggregated.length} bars`);
            return aggregated;
        }

        console.warn(`[Datafeed] M1 sync unavailable for ${symbol} ${timeframe}; falling back to native ${timeframe}`);
        return await this.loadReplayWindow(symbol, timeframe, cursorTime, beforeBars, afterBars);
    }

    async loadHybridReplayWindow(symbol, timeframe, cursorTime, beforeBars, afterBars) {
        const tfSeconds = this._timeframeSeconds(timeframe);
        const bucketTime = Math.floor(cursorTime / tfSeconds) * tfSeconds;
        const nativeBars = await this.loadReplayWindow(symbol, timeframe, cursorTime, beforeBars, afterBars);
        if (!nativeBars.length) return [];

        const m1Bars = await this.fetchHistoryRange(symbol, 'M1', bucketTime, cursorTime, {
            target: cursorTime,
            countBack: Math.max(2, Math.ceil((cursorTime - bucketTime) / 60) + 2),
            maxChunks: 2
        });
        const partial = this.aggregateM1Bars(m1Bars, timeframe, cursorTime)
            .find(bar => bar.time === bucketTime);
        if (!partial) return nativeBars;

        partial.replayCursorTime = cursorTime;
        partial.source = 'native_with_m1_partial';

        const merged = nativeBars
            .filter(bar => bar.time !== bucketTime)
            .concat(partial)
            .sort((a, b) => a.time - b.time);

        console.log(`[Datafeed] synced ${symbol} ${timeframe} hybrid: ${merged.length} bars`);
        return merged;
    }

    async ensureReplayData(symbol, timeframe) {
        const rm = window.replayManager;
        const cm = window.chartManager;
        const cursor = rm?.cursorTimestamp;
        if (!cm?.isReplayMode || !rm || !cursor) return null;
        if (rm.symbol && rm.symbol !== symbol) return null;

        if (rm.timeframe === timeframe && Array.isArray(rm.fullData) && rm.fullData.length) {
            return rm.fullData;
        }

        const data = await this.loadSyncedReplayWindow(symbol, timeframe, cursor);
        if (!data.length) return null;

        let idx = this.findIndexAtOrBefore(data, cursor);
        if (idx < 0) idx = 0;

        rm.fullData = data;
        rm.currentIndex = idx;
        rm.symbol = symbol;
        rm.timeframe = timeframe;
        rm._lastDisplayedIndex = -1;

        rm._updateUI?.();
        return data;
    }

    /**
     * Download history from MT5 to local storage
     */
    async downloadHistory(symbol, timeframe, bars, onProgress, signal) {
        try {
            if (onProgress) onProgress('downloading');
            const res = await fetch('/api/history/download', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ symbol, timeframe, bars }),
                signal: signal
            });
            const result = await res.json();
            this._localStatusCache = null; // Invalidate status cache
            if (onProgress) onProgress('done');
            return result;
        } catch (err) {
            console.error('[Datafeed] downloadHistory error:', err);
            if (onProgress) onProgress('error');
            return { success: false, message: err.message };
        }
    }

    _historyKey(symbol, timeframe) {
        return `${symbol}::${timeframe}`;
    }

    _resolutionToTimeframe(resolution) {
        return {
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
        }[resolution] || 'H1';
    }

    _timeframeSeconds(timeframe) {
        return {
            M1: 60,
            M5: 300,
            M15: 900,
            M30: 1800,
            H1: 3600,
            H4: 14400,
            D1: 86400,
            W1: 604800
        }[timeframe] || 3600;
    }

    replayWindowSize(timeframe) {
        return {
            M1: { before: 900, after: 300 },
            M5: { before: 560, after: 180 },
            M15: { before: 420, after: 160 },
            M30: { before: 340, after: 120 },
            H1: { before: 240, after: 90 },
            H4: { before: 140, after: 50 },
            D1: { before: 90, after: 30 },
            W1: { before: 52, after: 16 }
        }[timeframe] || { before: 420, after: 160 };
    }

    getCachedHistory(symbol, timeframe) {
        const cached = this.historyCache.get(this._historyKey(symbol, timeframe));
        return cached ? cached.data : null;
    }

    findIndexAtOrBefore(bars, timestamp) {
        if (!Array.isArray(bars) || !bars.length) return -1;
        let lo = 0;
        let hi = bars.length - 1;
        let ans = -1;
        while (lo <= hi) {
            const mid = (lo + hi) >> 1;
            if (bars[mid].time <= timestamp) {
                ans = mid;
                lo = mid + 1;
            } else {
                hi = mid - 1;
            }
        }
        return ans;
    }

    hasHistoryCoverage(symbol, timeframe, timestamp, minBars = 2) {
        const data = this.getCachedHistory(symbol, timeframe);
        if (!data || data.length < minBars) return false;
        return data[0].time <= timestamp && data[data.length - 1].time >= timestamp;
    }

    coverageInfo(symbol, timeframe, timestamp) {
        const data = this.getCachedHistory(symbol, timeframe);
        if (!data || data.length === 0) {
            return { covered: false, bars: 0, first: null, last: null, data: [] };
        }

        const first = data[0].time;
        const last = data[data.length - 1].time;
        return {
            covered: first <= timestamp && last >= timestamp,
            bars: data.length,
            first,
            last,
            data
        };
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

    async fetchHistoryRange(symbol, timeframe, from, to, options = {}) {
        const requestKey = `${this._historyKey(symbol, timeframe)}::range::${from}::${to}::${options.countBack || ''}::${options.maxChunks || ''}`;
        if (!options.force && this.historyRequests.has(requestKey)) {
            return this.historyRequests.get(requestKey);
        }
        const request = (async () => {
            const res = await fetch('/api/data/range', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    symbol,
                    timeframe,
                    from,
                    to,
                    target: options.target || null,
                    countBack: options.countBack || null,
                    maxChunks: options.maxChunks || null,
                    mode: window.appMode || 'backtest'
                })
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

    getReplayWindowBars(symbol, timeframe, from, to, countBack, firstDataRequest) {
        const cm = window.chartManager;
        const panel = cm?.activePanel;
        if (!cm?.isReplayMode || !panel?.isReplayMode) return null;

        const rm = window.replayManager;
        let replayData = null;
        let replayIndex = null;

        if (
            panel.symbol === symbol &&
            panel.timeframe === timeframe &&
            Array.isArray(panel.fullData) &&
            panel.fullData.length > 0
        ) {
            replayData = panel.fullData;
            replayIndex = panel.replayIndex;
        } else if (rm?.fullData?.length && (!rm.symbol || rm.symbol === symbol) && (!rm.timeframe || rm.timeframe === timeframe)) {
            replayData = rm.fullData;
            replayIndex = rm.currentIndex;
        }

        if (!replayData?.length) return null;
        if (replayIndex === undefined || replayIndex === null || replayIndex < 0) {
            replayIndex = this.findIndexAtOrBefore(replayData, rm?.cursorTimestamp || to);
        }

        const endIndex = Math.max(0, Math.min(replayIndex || 0, replayData.length - 1));
        const firstTime = replayData[0]?.time;
        if (firstTime && to < firstTime) return { bars: [], noData: true };
        const allowed = replayData.slice(0, endIndex + 1);
        if (firstDataRequest) {
            const requested = Math.max(120, Math.ceil((countBack || 250) * 1.2));
            return { bars: allowed.slice(-requested), noData: allowed.length === 0 };
        }
        const ranged = allowed.filter(bar => bar.time >= from && bar.time <= to);
        if (ranged.length > 0) return { bars: ranged, noData: false };
        // In replay mode, empty ranges after the cursor are expected future space,
        // not missing history. Returning noData=true here can leave TV in a
        // loading/no-data loop after interval changes.
        return { bars: [], noData: false };
    }

    async fetchHistoryCovering(symbol, timeframe, timestamp, initialBars = 2000, options = {}) {
        const defaultMaxBars = {
            M1: 45000,
            M5: 70000,
            M15: 70000,
            M30: 60000,
            H1: 50000,
            H4: 30000,
            D1: 15000,
            W1: 8000
        }[timeframe] || 50000;
        const maxBars = options.maxBars || defaultMaxBars;
        const attempts = [];
        let bars = Math.max(2000, Math.ceil(initialBars));

        while (bars <= maxBars) {
            attempts.push(bars);
            bars = Math.ceil(bars * 1.75);
        }
        if (attempts[attempts.length - 1] !== maxBars) attempts.push(maxBars);

        for (const requestBars of [...new Set(attempts)]) {
            const cached = this.coverageInfo(symbol, timeframe, timestamp);
            if (cached.covered) return cached.data;

            const needsMoreBars = cached.bars < requestBars;
            if (!needsMoreBars && cached.bars > 0) continue;

            console.log(`[Datafeed] fetching coverage ${symbol} ${timeframe}: ${requestBars} bars for ${new Date(timestamp * 1000).toISOString()}`);
            const data = await this.fetchHistory(symbol, timeframe, requestBars);
            if (data.length && data[0].time <= timestamp && data[data.length - 1].time >= timestamp) {
                return data;
            }
        }

        const finalCoverage = this.coverageInfo(symbol, timeframe, timestamp);
        return finalCoverage.data;
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
        const { from, to, firstDataRequest, countBack } = periodParams;
        
        console.log(`[Datafeed] getBars called for ${symbolInfo.name} (${resolution}), from: ${new Date(from*1000).toISOString()}, to: ${new Date(to*1000).toISOString()}, firstDataRequest: ${firstDataRequest}`);

        const timeframe = this._resolutionToTimeframe(resolution);

        const cm = window.chartManager;
        const panel = cm?.activePanel || null;
        const replayMode = Boolean(cm?.isReplayMode && window.replayManager?.cursorTimestamp);
        if (panel && panel.symbol === symbolInfo.name && panel.activeLoadPromise && (panel.timeframe === timeframe || replayMode)) {
            console.log(`[Datafeed] getBars awaiting activeLoadPromise for ${symbolInfo.name} (${timeframe})`);
            try {
                await panel.activeLoadPromise;
            } catch (err) {
                console.warn(`[Datafeed] activeLoadPromise failed for ${symbolInfo.name} (${timeframe}):`, err);
            }
        }

        if (replayMode) {
            const isFocusedReplayChart =
                panel?.isReplayMode &&
                panel.symbol === symbolInfo.name &&
                panel.timeframe === timeframe;
            if (isFocusedReplayChart && (!panel.fullData || panel.fullData.length === 0) && cm?.syncPanelReplayToTimestamp) {
                await cm.syncPanelReplayToTimestamp(panel, window.replayManager.cursorTimestamp);
            } else {
                await this.ensureReplayData(symbolInfo.name, timeframe);
            }
        }

        const replayResult = this.getReplayWindowBars(symbolInfo.name, timeframe, from, to, countBack, firstDataRequest);
        if (replayResult) {
            const tvBars = this.toTradingViewBars(replayResult.bars);
            console.log(`[Datafeed] getBars returning ${tvBars.length} replay-window bars`);
            onHistoryCallback(tvBars, { noData: replayResult.noData });
            return;
        }

        const cachedHistory = this.getCachedHistory(symbolInfo.name, timeframe);
        if (cachedHistory && cachedHistory.length > 2 && firstDataRequest) {
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
            let data = [];
            if (firstDataRequest) {
                data = await this.fetchHistory(symbolInfo.name, timeframe, countBack || 2000);
            } else {
                data = await this.fetchHistoryRange(symbolInfo.name, timeframe, from, to, {
                    countBack,
                    target: to
                });
            }

            if (data.length > 0) {
                let bars = data;
                if (!firstDataRequest) {
                    bars = bars.filter(bar => bar.time >= from && bar.time <= to);
                    if (countBack && bars.length > countBack) bars = bars.slice(-countBack);
                }
                
                // Store full data in the chartManager panel so Replay can access it
                if (cm && firstDataRequest) {
                    if (panel) {
                        panel.fullData = data;
                        panel.symbol = symbolInfo.name;
                        panel.timeframe = timeframe;
                        panel.updateHeader();
                    }
                }

                const tvBars = this.toTradingViewBars(this.filterReplayBars(bars));

                console.log(`[Datafeed] getBars successfully returning ${tvBars.length} bars to TradingView`);
                onHistoryCallback(tvBars, { noData: tvBars.length === 0 });
            } else {
                console.log(`[Datafeed] getBars: No historical data returned by backend API`);
                onHistoryCallback([], { noData: !firstDataRequest });
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
