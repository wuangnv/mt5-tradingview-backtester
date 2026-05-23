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

        // Cache hit check: if we already have the full history for this symbol and timeframe
        if (panel && panel.symbol === symbolInfo.name && panel.timeframe === timeframe && panel.fullData && panel.fullData.length > 2) {
            console.log(`[Datafeed] getBars (CACHED HIT) for ${symbolInfo.name} (${timeframe}) with ${panel.fullData.length} bars`);
            let bars = panel.fullData;
            
            // If in Replay Mode, filter bars by timestamp to support multi-timeframe sync
            if (cm?.isReplayMode && window.replayManager?.fullData && window.replayManager?.currentIndex !== undefined) {
                const activeBar = window.replayManager.fullData[window.replayManager.currentIndex];
                if (activeBar) {
                    const activeTime = activeBar.time;
                    bars = bars.filter(bar => bar.time <= activeTime);
                }
            }

            const tvBars = bars.map(bar => ({
                time: bar.time * 1000, // TV expects milliseconds
                open: bar.open,
                high: bar.high,
                low: bar.low,
                close: bar.close,
                volume: bar.tick_volume || bar.volume || 0
            }));

            console.log(`[Datafeed] getBars successfully returning ${tvBars.length} CACHED bars to TradingView`);
            onHistoryCallback(tvBars, { noData: tvBars.length === 0 });
            return;
        }

        try {
            console.log(`[Datafeed] Fetching ${timeframe} history from backend API...`);
            const res = await fetch('/api/data', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    symbol: symbolInfo.name,
                    timeframe: timeframe,
                    bars: 2000
                })
            });
            const result = await res.json();

            if (result.success && result.data && result.data.length > 0) {
                let bars = result.data;
                
                // Store full data in the chartManager panel so Replay can access it
                if (cm) {
                    let targetPanel = cm.panels.find(p => p.symbol === symbolInfo.name && p.timeframe === timeframe);
                    if (!targetPanel && cm.activePanel) {
                        targetPanel = cm.activePanel;
                    }
                    if (targetPanel) {
                        targetPanel.fullData = result.data;
                        targetPanel.symbol = symbolInfo.name;
                        targetPanel.timeframe = timeframe;
                        targetPanel.updateHeader();
                    }
                }

                // If in Replay Mode, filter bars by timestamp to support multi-timeframe sync
                if (window.chartManager?.isReplayMode && window.replayManager?.fullData && window.replayManager?.currentIndex !== undefined) {
                    const activeBar = window.replayManager.fullData[window.replayManager.currentIndex];
                    if (activeBar) {
                        const activeTime = activeBar.time;
                        bars = bars.filter(bar => bar.time <= activeTime);
                    }
                }

                const tvBars = bars.map(bar => ({
                    time: bar.time * 1000, // TV expects milliseconds
                    open: bar.open,
                    high: bar.high,
                    low: bar.low,
                    close: bar.close,
                    volume: bar.tick_volume || bar.volume || 0
                }));

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
