// Main Chart Manager - TradingView Style (Multi-Chart Grid Layout)

// ─── Custom Label PaneView & Renderer for Drawings ────────────────────────
class CustomLabelPaneView {
    constructor(drawing) {
        this._drawing = drawing;
        this._renderer = new CustomLabelRenderer(drawing);
    }
    zOrder() {
        return "normal";
    }
    renderer() {
        return this._renderer;
    }
}

class CustomLabelRenderer {
    constructor(drawing) {
        this._drawing = drawing;
    }
    draw(s) {
        s.useBitmapCoordinateSpace(t => this.drawImpl(t));
    }
    drawImpl(s) {
        const { context: ctx, horizontalPixelRatio: pixelRatio } = s;
        const viewport = this._drawing.getViewport();
        if (!viewport || !this._drawing.options.visible || !this._drawing.isValid()) return;
        
        const opts = this._drawing.options;
        if (!opts || !opts.customLabelText) return;
        
        // Calculate text position based on drawing type
        let position = null;
        let align = "center";
        let baseline = "middle";
        
        const anchors = this._drawing.anchors;
        if (!anchors || anchors.length === 0) return;
        
        const p0 = this._drawing.anchorToPixel(anchors[0], viewport);
        if (!p0) return;
        
        if (this._drawing.type === 'trend-line' || this._drawing.type === 'ray' || this._drawing.type === 'arrow' || this._drawing.type === 'extended-line') {
            const p1 = this._drawing.anchorToPixel(anchors[1] || anchors[0], viewport);
            if (p0 && p1) {
                position = {
                    x: (p0.x + p1.x) / 2,
                    y: (p0.y + p1.y) / 2 - 10
                };
                align = "center";
                baseline = "bottom";
            }
        } else if (this._drawing.type === 'horizontal-line') {
            position = {
                x: 15,
                y: p0.y - 8
            };
            align = "left";
            baseline = "bottom";
        } else if (this._drawing.type === 'horizontal-ray') {
            position = {
                x: Math.max(15, p0.x + 15),
                y: p0.y - 8
            };
            align = "left";
            baseline = "bottom";
        } else if (this._drawing.type === 'rectangle') {
            const p1 = this._drawing.anchorToPixel(anchors[1] || anchors[0], viewport);
            if (p0 && p1) {
                position = {
                    x: (p0.x + p1.x) / 2,
                    y: (p0.y + p1.y) / 2
                };
                align = "center";
                baseline = "middle";
            }
        } else {
            position = {
                x: p0.x,
                y: p0.y - 12
            };
            align = "center";
            baseline = "bottom";
        }
        
        if (position) {
            ctx.save();
            
            const fontSize = (opts.customLabelFontSize || 12) * pixelRatio;
            const fontWeight = opts.customLabelFontWeight || 'normal';
            const fontFamily = opts.customLabelFontFamily || 'sans-serif';
            ctx.font = `${fontWeight} ${fontSize}px ${fontFamily}`;
            ctx.fillStyle = opts.customLabelColor || '#d1d4dc';
            ctx.textAlign = align;
            ctx.textBaseline = baseline;
            
            const x = position.x * pixelRatio;
            const y = position.y * pixelRatio;
            
            ctx.fillText(opts.customLabelText, x, y);
            ctx.restore();
        }
    }
}

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
        this.drawingManager = null;

        // Local drawing state
        this.currentDrawing = null;
        this._draggedDrawing = null;
        this._dragStartPoint = null;
        this._dragStartAnchors = null;

        this.init();
    }

    init() {
        this.createElements();
        this.createChart();
        this.setupMouseListeners();
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

    createChart() {
        // Inject cursor override styles dynamically if not loaded
        if (!document.getElementById('cursor-override-styles')) {
            const cursorStyle = document.createElement('style');
            cursorStyle.id = 'cursor-override-styles';
            cursorStyle.innerHTML = `
                .cursor-pointer-force, .cursor-pointer-force * {
                    cursor: pointer !important;
                }
                .cursor-move-force, .cursor-move-force * {
                    cursor: move !important;
                }
            `;
            document.head.appendChild(cursorStyle);
        }

        this.chart = LightweightCharts.createChart(this.chartContainerEl, {
            width: this.chartContainerEl.clientWidth || 300,
            height: this.chartContainerEl.clientHeight || 300,
            layout: {
                background: { color: '#131722' },
                textColor: '#d1d4dc',
            },
            grid: {
                vertLines: { color: 'rgba(42,46,57,0.5)', style: 1 },
                horzLines: { color: 'rgba(42,46,57,0.5)', style: 1 },
            },
            crosshair: {
                mode: LightweightCharts.CrosshairMode.Normal,
                vertLine: { color: '#758696', width: 1, style: 3, labelBackgroundColor: '#2962ff' },
                horzLine: { color: '#758696', width: 1, style: 3, labelBackgroundColor: '#2962ff' },
            },
            rightPriceScale: {
                borderColor: '#2a2e39',
                scaleMargins: { top: 0.1, bottom: 0.1 },
            },
            timeScale: {
                borderColor: '#2a2e39',
                timeVisible: true,
                secondsVisible: false,
                rightOffset: 12,
                barSpacing: 8,
                minBarSpacing: 4,
                tickMarkFormatter: this.manager._makeTickFormatter(),
            },
            localization: {
                timeFormatter: this.manager._makeTimeFormatter(),
            },
            handleScroll: { mouseWheel: true, pressedMouseMove: true },
            handleScale: { axisPressedMouseMove: true, mouseWheel: true, pinch: true },
        });

        this.candlestickSeries = this.chart.addSeries(LightweightCharts.CandlestickSeries, {
            upColor: '#2196F3',
            downColor: '#FF9800',
            borderUpColor: '#2196F3',
            borderDownColor: '#FF9800',
            wickUpColor: '#2196F3',
            wickDownColor: '#FF9800',
            priceFormat: { type: 'price', precision: 5, minMove: 0.00001 },
        });

        // Initialize DrawingManager
        this.drawingManager = new window.LightweightChartsDrawing.DrawingManager();
        this.drawingManager.attach(this.chart, this.candlestickSeries, this.chartContainerEl);

        this.drawingManager.on("drawing:updated", () => this.saveDrawings());
        this.drawingManager.on("drawing:removed", () => this.saveDrawings());

        // Responsive Resize
        this.resizeObserver = new ResizeObserver(entries => {
            if (!entries || entries.length === 0) return;
            const { width, height } = entries[0].contentRect;
            this.width = width;
            this.height = height;
            this.rect = this.chartContainerEl.getBoundingClientRect();
            if (this.chart) {
                this.chart.applyOptions({ width, height });
            }
        });
        this.resizeObserver.observe(this.chartContainerEl);

        // TimeScale scroll and zoom sync hook
        this.chart.timeScale().subscribeVisibleLogicalRangeChange(range => {
            if (this.manager.syncScroll && range && !this.manager._syncingTimeScale) {
                this.manager.syncTimeScale(this.id, range);
            }
        });

        // Crosshair move sync hook
        this.chart.subscribeCrosshairMove(param => {
            if (this.manager.activePanel === this) {
                this.manager.updateOHLCInfo(param, this);
            }
            if (this.manager.syncCrosshair && !this.manager._syncingCrosshair) {
                this.manager.syncCrosshairMove(this.id, param);
            }
        });

        // Replay click jump handler
        this.chart.subscribeClick(param => {
            if (this.isReplayMode && window.replayManager?.isJumpMode && param.time) {
                const clickedTime = param.time;
                let lo = 0, hi = this.fullData.length - 1;
                while (lo < hi) {
                    const mid = (lo + hi) >> 1;
                    if (this.fullData[mid].time < clickedTime) lo = mid + 1;
                    else hi = mid;
                }
                if (window.replayManager) {
                    window.replayManager.seekTo(lo);
                }
            }
        });
    }

    async loadData() {
        this.updateHeader();
        
        if (this.manager.activePanel === this) {
            const ohlcInfoEl = document.getElementById('ohlc-info');
            if (ohlcInfoEl) {
                ohlcInfoEl.textContent = `Loading ${this.symbol} ${this.timeframe}...`;
            }
        }

        try {
            const res = await fetch('/api/data', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    symbol: this.symbol,
                    timeframe: this.timeframe,
                    bars: 5000,
                }),
            });

            const result = await res.json();

            if (result.success && result.data && result.data.length > 0) {
                this.fullData = result.data;

                const precision = this.manager.getPrecisionForSymbol(this.symbol);
                this.candlestickSeries.applyOptions({
                    priceFormat: {
                        type: 'price',
                        precision,
                        minMove: Math.pow(10, -precision),
                    },
                });

                if (!this.isReplayMode) {
                    this.candlestickSeries.setData(this.fullData);
                    try {
                        this.chart.timeScale().fitContent();
                    } catch (_) {}
                }

                console.log(`✅ Loaded ${result.data.length} bars for panel ${this.id}: ${result.symbol} ${result.timeframe}`);
                this.loadDrawings();
                
                // Propagate layout timescales if scroll sync is active
                if (this.manager.syncScroll) {
                    const otherActivePanel = this.manager.panels.find(p => p !== this && p.chart);
                    if (otherActivePanel) {
                        const range = otherActivePanel.chart.timeScale().getVisibleLogicalRange();
                        if (range) {
                            try {
                                this.chart.timeScale().setVisibleLogicalRange(range);
                            } catch (_) {}
                        }
                    }
                }
            } else {
                console.error('❌ Failed to load data:', result.message);
                if (this.manager.activePanel === this) {
                    const ohlcInfoEl = document.getElementById('ohlc-info');
                    if (ohlcInfoEl) {
                        ohlcInfoEl.textContent = `❌ ${this.symbol}: ${result.message}`;
                    }
                }
            }
        } catch (e) {
            console.error('❌ Error loading data:', e);
            if (this.manager.activePanel === this) {
                const ohlcInfoEl = document.getElementById('ohlc-info');
                if (ohlcInfoEl) {
                    ohlcInfoEl.textContent = `❌ Network error: ${e.message}`;
                }
            }
        }
    }

    async loadMoreData(barCount = 10000) {
        try {
            const res = await fetch('/api/data', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    symbol: this.symbol,
                    timeframe: this.timeframe,
                    bars: barCount,
                }),
            });
            const result = await res.json();
            if (result.success && result.data && result.data.length > 0) {
                this.fullData = result.data;
                if (!this.isReplayMode) {
                    this.candlestickSeries.setData(this.fullData);
                    try {
                        this.chart.timeScale().fitContent();
                    } catch (_) {}
                }
                return true;
            }
            alert(`Failed to load more data:\n${result.message}`);
            return false;
        } catch (e) {
            alert(`Error loading data:\n${e.message}`);
            return false;
        }
    }

    enterReplayMode() {
        if (this.fullData.length === 0) {
            alert('Please load data first!');
            return;
        }

        this.isReplayMode = true;
        document.getElementById('replay-controls').style.display = 'flex';
        document.querySelector('.chart-area').classList.add('replay-mode');

        let startIndex = Math.floor(this.fullData.length * 0.7);
        try {
            const range = this.chart.timeScale().getVisibleLogicalRange();
            if (range) {
                const mid = Math.floor((range.from + range.to) / 2);
                startIndex = Math.max(10, Math.min(mid, this.fullData.length - 1));
            }
        } catch (_) {}

        this.replayIndex = startIndex;
        this.replayPlaying = false;

        if (window.replayManager) {
            window.replayManager.startFromIndex(this.fullData, startIndex);
        }
    }

    exitReplayMode() {
        this.isReplayMode = false;
        this.replayPlaying = false;
        this.replayIndex = null;
        document.getElementById('replay-controls').style.display = 'none';
        document.querySelector('.chart-area').classList.remove('replay-mode');

        if (window.replayManager) window.replayManager.stop();

        this.candlestickSeries.setData(this.fullData);
        try {
            this.chart.timeScale().fitContent();
        } catch (_) {}
    }

    setJumpMode(enabled) {
        document.querySelector('.chart-area').classList.toggle('jump-mode', enabled);
    }

    setupMouseListeners() {
        const container = this.chartContainerEl;

        container.addEventListener('mouseenter', () => {
            this.rect = container.getBoundingClientRect();
            this.width = container.clientWidth;
            this.height = container.clientHeight;
        });

        container.addEventListener('mousedown', (e) => {
            this.rect = container.getBoundingClientRect();
            this.width = container.clientWidth;
            this.height = container.clientHeight;
            
            const x = e.clientX - this.rect.left;
            const y = e.clientY - this.rect.top;
            const point = { x, y };

            const activeTool = this.manager.activeTool;

            if (!activeTool || activeTool === 'cursor') {
                if (this.drawingManager) {
                    const hoveredAnchor = this.drawingManager.hitTestAnchor(point);
                    if (hoveredAnchor !== null) {
                        return;
                    }
                    
                    const hoveredDrawing = this.drawingManager.hitTest(point);
                    if (hoveredDrawing) {
                        this.drawingManager.selectDrawing(hoveredDrawing.id);
                        
                        if (!hoveredDrawing.options?.locked) {
                            this._draggedDrawing = hoveredDrawing;
                            this._dragStartPoint = point;
                            this._dragStartAnchors = hoveredDrawing._anchors.map(a => {
                                const startX = this.chart.timeScale().timeToCoordinate(a.time);
                                const startY = this.candlestickSeries.priceToCoordinate(a.price);
                                return {
                                    time: a.time,
                                    price: a.price,
                                    startX: startX,
                                    startY: startY
                                };
                            });
                            container.classList.add('cursor-move-force');
                            
                            e.stopPropagation();
                            e.preventDefault();
                        }
                        return;
                    }
                }
                return;
            }
            
            const ToolClass = this.manager.getToolClass(activeTool);
            if (!ToolClass) return;
            
            let time = this.chart.timeScale().coordinateToTime(x);
            let price = this.candlestickSeries.coordinateToPrice(y);
            
            if (time === null || price === null) return;
            
            const requiresTwo = ['trend-line', 'ray', 'arrow', 'extended-line', 'rectangle'].includes(activeTool);
            
            if (activeTool === 'long-position' || activeTool === 'short-position') {
                const id = `${activeTool}_${Date.now()}`;
                
                let pipSize = 0.0001;
                if (this.symbol.includes('JPY')) {
                    pipSize = 0.01;
                } else if (this.symbol.includes('XAU') || this.symbol.includes('GOLD')) {
                    pipSize = 0.1;
                } else if (this.symbol.includes('BTC') || this.symbol.includes('ETH')) {
                    pipSize = 1.0;
                }
                
                let tpPrice, slPrice;
                if (activeTool === 'long-position') {
                    tpPrice = price + 200 * pipSize;
                    slPrice = price - 100 * pipSize;
                } else {
                    tpPrice = price - 200 * pipSize;
                    slPrice = price + 100 * pipSize;
                }
                
                const drawing = new ToolClass(id, [
                    { time, price: price },
                    { time, price: tpPrice },
                    { time, price: slPrice }
                ]);
                this.decorateDrawing(drawing);
                
                this.drawingManager.addDrawing(drawing);
                this.drawingManager.selectDrawing(drawing.id);
                
                this.manager.resetToCursor();
                this.saveDrawings();
            } else if (requiresTwo) {
                if (!this.currentDrawing) {
                    const id = `${activeTool}_${Date.now()}`;
                    const drawing = new ToolClass(id, [{ time, price }, { time, price }]);
                    this.decorateDrawing(drawing);
                    drawing.setState("editing");
                    this.drawingManager.addDrawing(drawing);
                    this.currentDrawing = drawing;
                } else {
                    this.currentDrawing.updateAnchor(1, { time, price });
                    this.currentDrawing.setState("normal");
                    this.drawingManager.selectDrawing(this.currentDrawing.id);
                    this.currentDrawing = null;
                    
                    this.manager.resetToCursor();
                    this.saveDrawings();
                }
            } else {
                const id = `${activeTool}_${Date.now()}`;
                let style = {};
                let options = {};
                if (activeTool === 'text') {
                    style = { labelColor: '#e0e3eb', lineColor: '#2962ff' };
                    options = {
                        text: 'Text',
                        fontSize: 14,
                        fontFamily: 'sans-serif',
                        fontWeight: 'normal',
                        textAlign: 'left',
                        backgroundColor: 'transparent',
                        borderColor: 'transparent'
                    };
                }
                const drawing = new ToolClass(id, [{ time, price }], style, options);
                this.decorateDrawing(drawing);
                this.drawingManager.addDrawing(drawing);
                
                this.manager.resetToCursor();
                this.saveDrawings();

                // If Text Tool, open Settings Modal immediately to let user type text
                if (activeTool === 'text') {
                    this.manager.openDrawingSettings(drawing, this, true);
                }
            }
            
            e.stopPropagation();
        }, true);
        
        container.addEventListener('mousemove', (e) => {
            if (!this.rect) {
                this.rect = container.getBoundingClientRect();
            }
            const x = e.clientX - this.rect.left;
            const y = e.clientY - this.rect.top;
            const point = { x, y };

            const activeTool = this.manager.activeTool;

            // Custom drawing translation (drag and drop)
            if (this._draggedDrawing) {
                const dx = x - this._dragStartPoint.x;
                const dy = y - this._dragStartPoint.y;
                
                if (dx === 0 && dy === 0) return;
                
                const unsnappedAnchors = [];
                let valid = true;
                for (let i = 0; i < this._dragStartAnchors.length; i++) {
                    const anchor = this._dragStartAnchors[i];
                    const startX = anchor.startX;
                    const startY = anchor.startY;
                    
                    if (startX === null || startY === null) {
                        valid = false;
                        break;
                    }
                    
                    const newX = startX + dx;
                    const newY = startY + dy;
                    
                    const newTime = this.chart.timeScale().coordinateToTime(newX);
                    const newPrice = this.candlestickSeries.coordinateToPrice(newY);
                    
                    if (newTime === null || newPrice === null) {
                        valid = false;
                        break;
                    }
                    
                    unsnappedAnchors.push({ time: newTime, price: newPrice });
                }
                
                if (valid && unsnappedAnchors.length > 0) {
                    for (let i = 0; i < unsnappedAnchors.length; i++) {
                        this._draggedDrawing.updateAnchor(i, unsnappedAnchors[i]);
                    }
                }
                
                e.stopPropagation();
                e.preventDefault();
                return;
            }

            // Interactive anchor creation
            if (this.currentDrawing) {
                let time = this.chart.timeScale().coordinateToTime(x);
                let price = this.candlestickSeries.coordinateToPrice(y);
                
                if (time === null || price === null) return;
                
                this.currentDrawing.updateAnchor(1, { time, price });
                return;
            }

            // Hover pointer indicator overrides
            if (activeTool === 'cursor' && this.drawingManager) {
                const now = Date.now();
                if (!this._lastHoverTime || now - this._lastHoverTime > 33) {
                    this._lastHoverTime = now;
                    const hoveredAnchor = this.drawingManager.hitTestAnchor(point);
                    if (hoveredAnchor !== null) {
                        if (!container.classList.contains('cursor-move-force')) {
                            container.classList.remove('cursor-pointer-force');
                            container.classList.add('cursor-move-force');
                        }
                    } else {
                        const hoveredDrawing = this.drawingManager.hitTest(point);
                        if (hoveredDrawing) {
                            if (!container.classList.contains('cursor-pointer-force')) {
                                container.classList.remove('cursor-move-force');
                                container.classList.add('cursor-pointer-force');
                            }
                        } else {
                            if (container.classList.contains('cursor-pointer-force') || container.classList.contains('cursor-move-force')) {
                                container.classList.remove('cursor-pointer-force');
                                container.classList.remove('cursor-move-force');
                            }
                        }
                    }
                }
            }
        });

        // Double click to open Settings Modal
        container.addEventListener('dblclick', (e) => {
            const x = e.clientX - this.rect.left;
            const y = e.clientY - this.rect.top;
            const point = { x, y };

            if (this.drawingManager) {
                const hoveredDrawing = this.drawingManager.hitTest(point);
                if (hoveredDrawing) {
                    this.manager.openDrawingSettings(hoveredDrawing, this, false);
                }
            }
        });
    }

    handleMouseUp() {
        if (this._draggedDrawing) {
            this._draggedDrawing = null;
            this.chartContainerEl.classList.remove('cursor-move-force');
            this.saveDrawings();
        }
    }

    decorateDrawing(drawing) {
        if (!drawing) return;
        if (drawing._decorated) return;
        drawing._decorated = true;

        if (drawing.type === 'text-annotation') {
            if (!drawing.hasOwnProperty('textOptions') && !Object.prototype.hasOwnProperty.call(drawing, 'textOptions')) {
                Object.defineProperty(drawing, 'textOptions', {
                    get: function() {
                        return this._textOptions || {};
                    },
                    set: function(val) {
                        this._textOptions = val;
                        if (typeof this.setTextOptions === 'function') {
                            this.setTextOptions(val);
                        }
                    },
                    configurable: true,
                    enumerable: true
                });
            }

            const originalToJSON = drawing.toJSON;
            drawing.toJSON = function() {
                const json = originalToJSON.call(this);
                json.options = {
                    ...json.options,
                    ...this._textOptions
                };
                return json;
            };
            return;
        }

        const originalPaneViews = drawing.paneViews;
        drawing.paneViews = function() {
            let views = originalPaneViews.call(this);
            if (!Array.isArray(views)) views = [];
            
            if (this._options && this._options.customLabelText) {
                if (!this._customLabelPaneView) {
                    this._customLabelPaneView = new CustomLabelPaneView(this);
                }
                if (!views.includes(this._customLabelPaneView)) {
                    views = [...views, this._customLabelPaneView];
                }
            }
            return views;
        };
    }

    saveDrawings() {
        if (!this.drawingManager) return;
        const serialized = this.drawingManager.exportDrawings();
        localStorage.setItem(`drawings_${this.id}_${this.symbol}`, JSON.stringify(serialized));
    }

    loadDrawings() {
        if (!this.drawingManager) return;
        this.drawingManager.clearAll();
        const saved = localStorage.getItem(`drawings_${this.id}_${this.symbol}`);
        if (saved) {
            try {
                const serialized = JSON.parse(saved);
                this.drawingManager.importDrawings(serialized, (type, data) => {
                    const ToolClass = this.manager.getToolClass(type);
                    if (ToolClass) {
                        const drawing = new ToolClass(data.id, data.anchors, data.style, data.options);
                        this.decorateDrawing(drawing);
                        return drawing;
                    }
                    return null;
                });
            } catch (e) {
                console.error("Failed to load drawings:", e);
            }
        }
    }

    cancelCurrentDrawing() {
        if (this.currentDrawing) {
            this.drawingManager.removeDrawing(this.currentDrawing.id);
            this.currentDrawing = null;
        }
    }

    deleteSelectedDrawing() {
        if (this.drawingManager) {
            const selected = this.drawingManager.getSelectedDrawing();
            if (selected) {
                this.drawingManager.removeDrawing(selected.id);
                this.saveDrawings();
            }
        }
    }

    _applyTimezoneFormatters() {
        if (this.chart) {
            this.chart.applyOptions({
                timeScale: { tickMarkFormatter: this.manager._makeTickFormatter() },
                localization: { timeFormatter: this.manager._makeTimeFormatter() },
            });
        }
    }

    updateChart(data) {
        if (this.candlestickSeries) {
            this.candlestickSeries.setData(data);
        }
    }

    destroy() {
        if (this.resizeObserver) {
            this.resizeObserver.disconnect();
        }
        if (this.drawingManager) {
            this.drawingManager.clearAll();
        }
        if (this.chart) {
            try {
                this.chart.removeSeries(this.candlestickSeries);
            } catch (_) {}
            this.chart = null;
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
        this.syncScroll = true;
        this.syncCrosshair = true;
        
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

        this.init();
    }

    async init() {
        await this.checkMT5Status();
        await this.loadSymbols();
        
        const savedLayout = localStorage.getItem('activeLayout') || '1';
        this.activeLayout = savedLayout;
        
        this.setLayout(this.activeLayout);
        this.setupEventListeners();
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
                    p.chart.applyOptions({ width, height });
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
        if (symbolSelect) symbolSelect.value = panel.symbol;

        document.querySelectorAll('.tf-btn').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.tf === panel.timeframe);
        });

        // Sync Replay controls
        if (panel.isReplayMode) {
            document.getElementById('replay-controls').style.display = 'flex';
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
            document.getElementById('replay-controls').style.display = 'none';
            document.querySelector('.chart-area').classList.remove('replay-mode');
            if (window.replayManager) {
                window.replayManager.pause();
            }
        }

        this.updateOHLCInfo(null);
    }

    // Time Scale scroll & zoom synchronization
    syncTimeScale(sourcePanelId, range) {
        this._syncingTimeScale = true;
        this.panels.forEach(panel => {
            if (panel.id !== sourcePanelId && panel.chart) {
                try {
                    panel.chart.timeScale().setVisibleLogicalRange(range);
                } catch (e) {
                    console.error("Error syncing timescale:", e);
                }
            }
        });
        this._syncingTimeScale = false;
    }

    // Crosshair tracking synchronization
    syncCrosshairMove(sourcePanelId, param) {
        this._syncingCrosshair = true;
        
        const time = param ? param.time : null;
        this.panels.forEach(panel => {
            if (panel.id !== sourcePanelId && panel.chart) {
                const syncLine = panel.syncLineEl;
                if (!syncLine) return;
                
                if (time) {
                    const x = panel.chart.timeScale().timeToCoordinate(time);
                    const w = panel.width || panel.chartContainerEl.clientWidth;
                    if (x !== null && x >= 0 && x <= w) {
                        syncLine.style.transform = `translateX(${x}px)`;
                        syncLine.style.display = 'block';
                    } else {
                        syncLine.style.display = 'none';
                    }
                } else {
                    syncLine.style.display = 'none';
                }
            }
        });
        
        this._syncingCrosshair = false;
    }

    // Toolbar Event Bindings
    setupEventListeners() {
        // Centralized Symbol select change
        document.getElementById('symbol-select').addEventListener('change', async (e) => {
            if (!this.activePanel) return;
            this.activePanel.saveDrawings();
            
            const oldSymbol = this.activePanel.symbol;
            const newSymbol = e.target.value;
            if (oldSymbol === newSymbol) return;

            let savedReplayTimestamp = null;
            const wasReplay = this.activePanel.isReplayMode;

            if (wasReplay && this.activePanel.replayIndex !== null && this.activePanel.fullData) {
                const currentBar = this.activePanel.fullData[this.activePanel.replayIndex];
                if (currentBar) {
                    savedReplayTimestamp = currentBar.time;
                }
            }

            this.activePanel.symbol = newSymbol;
            await this.activePanel.loadData();

            if (wasReplay && savedReplayTimestamp && this.activePanel.fullData.length > 0) {
                let bestIndex = 0;
                let minDiff = Infinity;
                for (let i = 0; i < this.activePanel.fullData.length; i++) {
                    const diff = Math.abs(this.activePanel.fullData[i].time - savedReplayTimestamp);
                    if (diff < minDiff) {
                        minDiff = diff;
                        bestIndex = i;
                    }
                }
                
                this.activePanel.replayIndex = bestIndex;
                if (window.replayManager) {
                    window.replayManager.startFromIndex(this.activePanel.fullData, bestIndex);
                }
            }
        });

        // Timezone selection
        document.getElementById('timezone-select').addEventListener('change', (e) => {
            this.timezoneOffset = parseInt(e.target.value);
            this.panels.forEach(p => p._applyTimezoneFormatters());
            this.updateOHLCInfo(null);
        });

        // Centralized Timeframe change
        document.querySelectorAll('.tf-btn').forEach(btn => {
            btn.addEventListener('click', async (e) => {
                if (!this.activePanel) return;
                
                document.querySelectorAll('.tf-btn').forEach(b => b.classList.remove('active'));
                e.target.classList.add('active');
                
                const oldTimeframe = this.activePanel.timeframe;
                const newTimeframe = e.target.dataset.tf;
                if (oldTimeframe === newTimeframe) return;

                let savedReplayTimestamp = null;
                const wasReplay = this.activePanel.isReplayMode;

                if (wasReplay && this.activePanel.replayIndex !== null && this.activePanel.fullData) {
                    const currentBar = this.activePanel.fullData[this.activePanel.replayIndex];
                    if (currentBar) {
                        savedReplayTimestamp = currentBar.time;
                    }
                }

                this.activePanel.timeframe = newTimeframe;
                await this.activePanel.loadData();

                if (wasReplay && savedReplayTimestamp && this.activePanel.fullData.length > 0) {
                    let bestIndex = 0;
                    let minDiff = Infinity;
                    for (let i = 0; i < this.activePanel.fullData.length; i++) {
                        const diff = Math.abs(this.activePanel.fullData[i].time - savedReplayTimestamp);
                        if (diff < minDiff) {
                            minDiff = diff;
                            bestIndex = i;
                        }
                    }
                    
                    this.activePanel.replayIndex = bestIndex;
                    if (window.replayManager) {
                        window.replayManager.startFromIndex(this.activePanel.fullData, bestIndex);
                    }
                }
            });
        });

        // Replay toggle click
        document.getElementById('replay-btn').addEventListener('click', () => {
            if (this.activePanel) {
                this.activePanel.isReplayMode ? this.activePanel.exitReplayMode() : this.activePanel.enterReplayMode();
            }
        });

        // Layout Dropdown toggle
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

        // Layout choices
        document.querySelectorAll('.layout-option').forEach(option => {
            option.addEventListener('click', (e) => {
                const layout = option.dataset.layout;
                this.setLayout(layout);
            });
        });

        // Synchronization switches
        const syncScrollBtn = document.getElementById('sync-scroll-btn');
        if (syncScrollBtn) {
            syncScrollBtn.addEventListener('click', () => {
                this.syncScroll = !this.syncScroll;
                syncScrollBtn.classList.toggle('active', this.syncScroll);
                syncScrollBtn.title = `Sync Time/Scroll: ${this.syncScroll ? 'ON' : 'OFF'}`;
                
                // Align other panels to active panel timescale when turned ON
                if (this.syncScroll && this.activePanel) {
                    try {
                        const range = this.activePanel.chart.timeScale().getVisibleLogicalRange();
                        if (range) this.syncTimeScale(this.activePanel.id, range);
                    } catch (_) {}
                }
            });
        }

        const syncCrosshairBtn = document.getElementById('sync-crosshair-btn');
        if (syncCrosshairBtn) {
            syncCrosshairBtn.addEventListener('click', () => {
                this.syncCrosshair = !this.syncCrosshair;
                syncCrosshairBtn.classList.toggle('active', this.syncCrosshair);
                syncCrosshairBtn.title = `Sync Crosshair: ${this.syncCrosshair ? 'ON' : 'OFF'}`;
                if (!this.syncCrosshair) {
                    this.panels.forEach(p => {
                        const line = p.syncLineEl;
                        if (line) line.style.display = 'none';
                    });
                }
            });
        }

        // ─── Drawing Sidebar Select ───────────────────────────────────────────
        const toolItems = document.querySelectorAll('.tool-item');
        toolItems.forEach(item => {
            item.addEventListener('click', (e) => {
                const tool = item.dataset.tool;
                if (tool === 'clear') {
                    if (this.activePanel && this.activePanel.drawingManager) {
                        this.activePanel.drawingManager.clearAll();
                        localStorage.removeItem(`drawings_${this.activePanel.id}_${this.activePanel.symbol}`);
                    }
                } else {
                    toolItems.forEach(btn => {
                        if (btn.dataset.tool !== 'clear') {
                            btn.classList.remove('active');
                        }
                    });
                    item.classList.add('active');
                    this.activeTool = tool;
                    
                    if (tool === 'cursor') {
                        if (this.activePanel && this.activePanel.drawingManager) {
                            this.activePanel.drawingManager.deselectAll();
                        }
                        if (this.activePanel && this.activePanel.currentDrawing) {
                            this.activePanel.drawingManager.removeDrawing(this.activePanel.currentDrawing.id);
                            this.activePanel.currentDrawing = null;
                        }
                    }
                }
            });
        });

        // Keydown Esc and Delete listener
        window.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                if (this.activePanel) {
                    this.activePanel.cancelCurrentDrawing();
                }
                this.activeTool = 'cursor';
                toolItems.forEach(btn => {
                    if (btn.dataset.tool !== 'clear') {
                        btn.classList.remove('active');
                    }
                });
                const cursorBtn = document.querySelector('.tool-item[data-tool="cursor"]');
                if (cursorBtn) cursorBtn.classList.add('active');
            } else if (e.key === 'Delete' || e.key === 'Backspace') {
                const activeEl = document.activeElement;
                if (activeEl && (
                    activeEl.tagName === 'INPUT' || 
                    activeEl.tagName === 'SELECT' || 
                    activeEl.tagName === 'TEXTAREA' || 
                    activeEl.isContentEditable
                )) {
                    return;
                }
                
                if (this.activePanel) {
                    this.activePanel.deleteSelectedDrawing();
                }
            }
        });

        // Window level mouseup to release drawing drag
        window.addEventListener('mouseup', (e) => {
            this.panels.forEach(p => p.handleMouseUp());
        });

        // Drawing settings modal buttons
        const btnSave = document.getElementById('settings-modal-save');
        if (btnSave) btnSave.addEventListener('click', () => this.saveDrawingSettings());

        const btnCancel = document.getElementById('settings-modal-cancel');
        if (btnCancel) btnCancel.addEventListener('click', () => this.cancelDrawingSettings());

        const btnClose = document.getElementById('settings-modal-close');
        if (btnClose) btnClose.addEventListener('click', () => this.cancelDrawingSettings());

        const btnDelete = document.getElementById('settings-modal-delete');
        if (btnDelete) btnDelete.addEventListener('click', () => this.deleteDrawingSettings());

        const modalOverlay = document.getElementById('drawing-settings-overlay');
        if (modalOverlay) {
            modalOverlay.addEventListener('click', (e) => {
                if (e.target === modalOverlay) {
                    this.cancelDrawingSettings();
                }
            });
        }
    }

    resetToCursor() {
        this.activeTool = 'cursor';
        document.querySelectorAll('.tool-item').forEach(btn => {
            if (btn.dataset.tool !== 'clear') {
                btn.classList.remove('active');
            }
        });
        const cursorBtn = document.querySelector('.tool-item[data-tool="cursor"]');
        if (cursorBtn) cursorBtn.classList.add('active');
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

    formatDateWithTimezone(timestamp) {
        const date = new Date(timestamp * 1000);
        date.setUTCHours(date.getUTCHours() + this.timezoneOffset);
        const dd = String(date.getUTCDate()).padStart(2, '0');
        const mm = String(date.getUTCMonth() + 1).padStart(2, '0');
        const yyyy = date.getUTCFullYear();
        const hh = String(date.getUTCHours()).padStart(2, '0');
        const min = String(date.getUTCMinutes()).padStart(2, '0');
        return `${dd}/${mm}/${yyyy} ${hh}:${min}`;
    }

    getTimezoneName() {
        const o = this.timezoneOffset;
        if (o === 0) return 'UTC';
        return o > 0 ? `UTC+${o}` : `UTC${o}`;
    }

    updateOHLCInfo(param, panel) {
        if (!this.ohlcInfoEl) {
            this.ohlcInfoEl = document.getElementById('ohlc-info');
        }
        const el = this.ohlcInfoEl;
        if (!el) return;
        if (!panel) panel = this.activePanel;
        if (!panel) return;

        if (!param || !param.time || !param.seriesData.get(panel.candlestickSeries)) {
            const txt = `${panel.symbol} · ${panel.timeframe} · ${this.getTimezoneName()}`;
            if (el.textContent !== txt) {
                el.textContent = txt;
            }
            return;
        }
        const d = param.seriesData.get(panel.candlestickSeries);
        const dateStr = this.formatDateWithTimezone(param.time);
        const p = this.getPrecisionForSymbol(panel.symbol);
        const chg = d.close - d.open;
        const chgPct = ((chg / d.open) * 100).toFixed(2);
        const chgColor = chg >= 0 ? '#2196F3' : '#FF9800';
        
        const html = `
            <span style="color:#787b86">${panel.symbol} ${panel.timeframe} (${this.getTimezoneName()})</span>
            <span style="margin-left:12px">O</span> <span style="color:#d1d4dc">${d.open.toFixed(p)}</span>
            <span style="margin-left:8px">H</span> <span style="color:#089981">${d.high.toFixed(p)}</span>
            <span style="margin-left:8px">L</span> <span style="color:#f23645">${d.low.toFixed(p)}</span>
            <span style="margin-left:8px">C</span> <span style="color:#d1d4dc">${d.close.toFixed(p)}</span>
            <span style="margin-left:8px;color:${chgColor}">${chg >= 0 ? '+' : ''}${chg.toFixed(p)} (${chg >= 0 ? '+' : ''}${chgPct}%)</span>
            <span style="margin-left:12px;color:#787b86">${dateStr}</span>
        `;
        
        if (el.innerHTML !== html) {
            el.innerHTML = html;
        }
    }

    getPrecisionForSymbol(symbol) {
        if (symbol.includes('JPY')) return 3;
        if (symbol.includes('XAU') || symbol.includes('GOLD')) return 2;
        if (symbol.includes('XAG') || symbol.includes('SILVER')) return 3;
        if (symbol.includes('BTC') || symbol.includes('ETH')) return 2;
        return 5;
    }

    getToolClass(type) {
        const ToolClassMap = {
            'trend-line': window.LightweightChartsDrawing.TrendLine,
            'horizontal-line': window.LightweightChartsDrawing.HorizontalLine,
            'ray': window.LightweightChartsDrawing.Ray,
            'arrow': window.LightweightChartsDrawing.Arrow,
            'extended-line': window.LightweightChartsDrawing.ExtendedLine,
            'horizontal-ray': window.LightweightChartsDrawing.HorizontalRay,
            'rectangle': window.LightweightChartsDrawing.Rectangle,
            'long-position': window.LightweightChartsDrawing.LongPosition,
            'short-position': window.LightweightChartsDrawing.ShortPosition,
            'text': window.LightweightChartsDrawing.TextAnnotation
        };
        return ToolClassMap[type];
    }

    openDrawingSettings(drawing, panel, isNew = false) {
        this.activeSettingsDrawing = drawing;
        this.activeSettingsPanel = panel;
        this.isNewSettingsDrawing = isNew;
        
        // Backup original state for cancellation
        this.originalDrawingState = {
            style: { ...drawing.style },
            options: { ...drawing.options },
            anchors: drawing.anchors ? drawing.anchors.map(a => ({ ...a })) : []
        };
        if (drawing.type === 'text-annotation') {
            this.originalDrawingState.textOptions = { ...drawing.textOptions };
        }

        const modalOverlay = document.getElementById('drawing-settings-overlay');
        const modalTitle = document.getElementById('settings-modal-title');
        const modalBody = document.getElementById('settings-modal-body');
        
        if (!modalOverlay || !modalBody) return;

        // Set title
        const typeLabels = {
            'text-annotation': 'Cài đặt Chữ (Text)',
            'trend-line': 'Đường xu hướng (Trend Line)',
            'horizontal-line': 'Đường nằm ngang (Horizontal Line)',
            'ray': 'Tia vẽ (Ray)',
            'arrow': 'Mũi tên (Arrow)',
            'extended-line': 'Đường kéo dài (Extended Line)',
            'horizontal-ray': 'Tia nằm ngang (Horizontal Ray)',
            'rectangle': 'Hình chữ nhật (Rectangle)',
            'long-position': 'Vị thế Mua (Long)',
            'short-position': 'Vị thế Bán (Short)'
        };
        modalTitle.textContent = typeLabels[drawing.type] || 'Cài đặt vật thể';

        // Render fields based on drawing type
        let html = '';

        if (drawing.type === 'text-annotation') {
            // Text annotation layout
            const opts = drawing.textOptions || {};
            const text = opts.text || '';
            const fontSize = opts.fontSize || 14;
            const fontWeight = opts.fontWeight || 'normal';
            const textColor = drawing.style.labelColor || '#d1d4dc';
            
            const hasBg = opts.backgroundColor && opts.backgroundColor !== 'transparent';
            const bgColor = hasBg ? opts.backgroundColor : '#ffffff';
            const hasBorder = opts.borderColor && opts.borderColor !== 'transparent';
            const borderColor = hasBorder ? opts.borderColor : '#2962ff';

            html = `
                <div class="form-group">
                    <label>Nội dung chữ</label>
                    <textarea id="modal-text-content" class="form-control-text" rows="3" placeholder="Nhập chữ ở đây...">${text}</textarea>
                </div>
                <div class="form-row">
                    <div class="form-group">
                        <label>Màu chữ</label>
                        <div class="color-picker-wrapper">
                            <input type="color" id="modal-text-color" class="form-control-color" value="${this._hexColor(textColor)}">
                        </div>
                    </div>
                    <div class="form-group">
                        <label>Cỡ chữ</label>
                        <select id="modal-text-size" class="form-control-select">
                            <option value="10" ${fontSize == 10 ? 'selected' : ''}>10px</option>
                            <option value="11" ${fontSize == 11 ? 'selected' : ''}>11px</option>
                            <option value="12" ${fontSize == 12 ? 'selected' : ''}>12px</option>
                            <option value="14" ${fontSize == 14 ? 'selected' : ''}>14px</option>
                            <option value="16" ${fontSize == 16 ? 'selected' : ''}>16px</option>
                            <option value="20" ${fontSize == 20 ? 'selected' : ''}>20px</option>
                            <option value="24" ${fontSize == 24 ? 'selected' : ''}>24px</option>
                            <option value="28" ${fontSize == 28 ? 'selected' : ''}>28px</option>
                            <option value="36" ${fontSize == 36 ? 'selected' : ''}>36px</option>
                        </select>
                    </div>
                </div>
                <div class="checkbox-group">
                    <input type="checkbox" id="modal-text-bold" ${fontWeight === 'bold' ? 'checked' : ''}>
                    <label for="modal-text-bold">Chữ in đậm (Bold)</label>
                </div>
                
                <div class="tool-separator" style="width: 100%; margin: 8px 0;"></div>
                
                <div class="form-row">
                    <div class="form-group">
                        <div class="checkbox-group">
                            <input type="checkbox" id="modal-text-bg-toggle" ${hasBg ? 'checked' : ''}>
                            <label for="modal-text-bg-toggle">Màu nền</label>
                        </div>
                    </div>
                    <div class="form-group" id="modal-text-bg-color-group" style="display: ${hasBg ? 'block' : 'none'};">
                        <input type="color" id="modal-text-bg-color" class="form-control-color" value="${this._hexColor(bgColor)}">
                    </div>
                </div>

                <div class="form-row">
                    <div class="form-group">
                        <div class="checkbox-group">
                            <input type="checkbox" id="modal-text-border-toggle" ${hasBorder ? 'checked' : ''}>
                            <label for="modal-text-border-toggle">Đường viền</label>
                        </div>
                    </div>
                    <div class="form-group" id="modal-text-border-color-group" style="display: ${hasBorder ? 'block' : 'none'};">
                        <input type="color" id="modal-text-border-color" class="form-control-color" value="${this._hexColor(borderColor)}">
                    </div>
                </div>
            `;
        } else {
            // Geometry drawing layout
            const opts = drawing.options || {};
            const style = drawing.style || {};
            
            const hasLabel = !!opts.customLabelText;
            const labelText = opts.customLabelText || '';
            const labelColor = opts.customLabelColor || '#d1d4dc';
            const labelFontSize = opts.customLabelFontSize || 12;
            const labelFontWeight = opts.customLabelFontWeight || 'normal';

            const lineColor = style.lineColor || '#2962ff';
            const lineWidth = style.lineWidth || 2;

            html = `
                <!-- Nhóm 1: Nhãn chữ -->
                <div class="checkbox-group">
                    <input type="checkbox" id="modal-label-toggle" ${hasLabel ? 'checked' : ''}>
                    <label for="modal-label-toggle">Hiển thị nhãn chữ</label>
                </div>
                
                <div id="modal-label-settings-group" style="display: ${hasLabel ? 'flex' : 'none'}; flex-direction: column; gap: 12px; margin-left: 10px;">
                    <div class="form-group">
                        <label>Nội dung nhãn</label>
                        <input type="text" id="modal-label-text" class="form-control-text" value="${labelText}" placeholder="Nhập nhãn chữ...">
                    </div>
                    <div class="form-row">
                        <div class="form-group">
                            <label>Màu chữ</label>
                            <input type="color" id="modal-label-color" class="form-control-color" value="${this._hexColor(labelColor)}">
                        </div>
                        <div class="form-group">
                            <label>Cỡ chữ</label>
                            <select id="modal-label-size" class="form-control-select">
                                <option value="10" ${labelFontSize == 10 ? 'selected' : ''}>10px</option>
                                <option value="11" ${labelFontSize == 11 ? 'selected' : ''}>11px</option>
                                <option value="12" ${labelFontSize == 12 ? 'selected' : ''}>12px</option>
                                <option value="14" ${labelFontSize == 14 ? 'selected' : ''}>14px</option>
                                <option value="16" ${labelFontSize == 16 ? 'selected' : ''}>16px</option>
                                <option value="20" ${labelFontSize == 20 ? 'selected' : ''}>20px</option>
                            </select>
                        </div>
                    </div>
                    <div class="checkbox-group">
                        <input type="checkbox" id="modal-label-bold" ${labelFontWeight === 'bold' ? 'checked' : ''}>
                        <label for="modal-label-bold">Nhãn chữ in đậm</label>
                    </div>
                </div>

                <div class="tool-separator" style="width: 100%; margin: 8px 0;"></div>

                <!-- Nhóm 2: Kiểu dáng đường vẽ -->
                <div class="form-row">
                    <div class="form-group">
                        <label>Màu viền / nét vẽ</label>
                        <input type="color" id="modal-line-color" class="form-control-color" value="${this._hexColor(lineColor)}">
                    </div>
                    <div class="form-group">
                        <label>Độ dày nét vẽ</label>
                        <select id="modal-line-width" class="form-control-select">
                            <option value="1" ${lineWidth == 1 ? 'selected' : ''}>1px</option>
                            <option value="2" ${lineWidth == 2 ? 'selected' : ''}>2px</option>
                            <option value="3" ${lineWidth == 3 ? 'selected' : ''}>3px</option>
                            <option value="4" ${lineWidth == 4 ? 'selected' : ''}>4px</option>
                        </select>
                    </div>
                </div>
            `;

            // If it is a Rectangle, let's also add Background Fill Color and Opacity controls!
            if (drawing.type === 'rectangle') {
                const fillColor = style.fillColor || 'rgba(41, 98, 255, 0.1)';
                const fillOpacity = style.fillOpacity !== undefined ? style.fillOpacity : 0.1;
                
                // Parse standard color in case it has rgba
                let parsedHex = '#2962ff';
                if (fillColor.startsWith('#')) {
                    parsedHex = fillColor;
                } else if (fillColor.startsWith('rgba')) {
                    const m = fillColor.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
                    if (m) {
                        const r = parseInt(m[1]).toString(16).padStart(2, '0');
                        const g = parseInt(m[2]).toString(16).padStart(2, '0');
                        const b = parseInt(m[3]).toString(16).padStart(2, '0');
                        parsedHex = `#${r}${g}${b}`;
                    }
                }
                
                html += `
                    <div class="tool-separator" style="width: 100%; margin: 8px 0;"></div>
                    <div class="form-row">
                        <div class="form-group">
                            <label>Màu nền</label>
                            <input type="color" id="modal-fill-color" class="form-control-color" value="${parsedHex}">
                        </div>
                        <div class="form-group">
                            <label>Độ mờ nền (${Math.round(fillOpacity * 100)}%)</label>
                            <input type="range" id="modal-fill-opacity" class="replay-slider" min="0" max="1" step="0.05" value="${fillOpacity}" style="height: 24px;">
                        </div>
                    </div>
                `;
            }
        }

        modalBody.innerHTML = html;

        // Add dynamic visibility events
        if (drawing.type === 'text-annotation') {
            const bgToggle = document.getElementById('modal-text-bg-toggle');
            const bgGroup = document.getElementById('modal-text-bg-color-group');
            if (bgToggle && bgGroup) {
                bgToggle.addEventListener('change', (e) => {
                    bgGroup.style.display = e.target.checked ? 'block' : 'none';
                });
            }
            
            const borderToggle = document.getElementById('modal-text-border-toggle');
            const borderGroup = document.getElementById('modal-text-border-color-group');
            if (borderToggle && borderGroup) {
                borderToggle.addEventListener('change', (e) => {
                    borderGroup.style.display = e.target.checked ? 'block' : 'none';
                });
            }
        } else {
            const labelToggle = document.getElementById('modal-label-toggle');
            const labelGroup = document.getElementById('modal-label-settings-group');
            if (labelToggle && labelGroup) {
                labelToggle.addEventListener('change', (e) => {
                    labelGroup.style.display = e.target.checked ? 'flex' : 'none';
                });
            }

            if (drawing.type === 'rectangle') {
                const opacitySlider = document.getElementById('modal-fill-opacity');
                if (opacitySlider) {
                    opacitySlider.addEventListener('input', (e) => {
                        const lbl = opacitySlider.previousElementSibling;
                        if (lbl) {
                            lbl.textContent = `Độ mờ nền (${Math.round(parseFloat(e.target.value) * 100)}%)`;
                        }
                    });
                }
            }
        }

        // Show Modal
        modalOverlay.classList.add('show');

        // Auto-focus and select textarea if text annotation
        if (drawing.type === 'text-annotation') {
            const textarea = document.getElementById('modal-text-content');
            if (textarea) {
                setTimeout(() => {
                    textarea.focus();
                    textarea.select();
                }, 50);

                // Keyboard listener for Ctrl+Enter or Cmd+Enter to save
                const handleKeyDown = (e) => {
                    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
                        e.preventDefault();
                        textarea.removeEventListener('keydown', handleKeyDown);
                        this.saveDrawingSettings();
                    }
                };
                textarea.addEventListener('keydown', handleKeyDown);
            }
        }
    }

    _hexColor(color) {
        if (!color) return '#d1d4dc';
        if (color.startsWith('#')) {
            if (color.length === 4) { // shorthand hex
                return '#' + color[1] + color[1] + color[2] + color[2] + color[3] + color[3];
            }
            return color.toLowerCase();
        }
        if (color.startsWith('rgb')) {
            const m = color.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
            if (m) {
                const r = parseInt(m[1]).toString(16).padStart(2, '0');
                const g = parseInt(m[2]).toString(16).padStart(2, '0');
                const b = parseInt(m[3]).toString(16).padStart(2, '0');
                return `#${r}${g}${b}`;
            }
        }
        // Name translations
        const names = {
            'red': '#ff0000', 'green': '#00ff00', 'blue': '#0000ff', 'white': '#ffffff', 'black': '#000000',
            'yellow': '#ffff00', 'cyan': '#00ffff', 'magenta': '#ff00ff', 'gray': '#808080', 'grey': '#808080'
        };
        return names[color.toLowerCase()] || '#d1d4dc';
    }

    cancelDrawingSettings() {
        const drawing = this.activeSettingsDrawing;
        const panel = this.activeSettingsPanel;
        if (!drawing || !panel) return;

        if (this.isNewSettingsDrawing) {
            // Delete new drawing
            panel.drawingManager.removeDrawing(drawing.id);
            panel.saveDrawings();
        } else if (this.originalDrawingState) {
            // Restore original state
            drawing.style = this.originalDrawingState.style;
            drawing.options = this.originalDrawingState.options;
            if (drawing.type === 'text-annotation' && this.originalDrawingState.textOptions) {
                drawing.setTextOptions(this.originalDrawingState.textOptions);
            }
            drawing.requestUpdate();
        }

        this.closeDrawingSettings();
    }

    deleteDrawingSettings() {
        const drawing = this.activeSettingsDrawing;
        const panel = this.activeSettingsPanel;
        if (!drawing || !panel) return;

        panel.drawingManager.removeDrawing(drawing.id);
        panel.saveDrawings();
        
        this.closeDrawingSettings();
    }

    saveDrawingSettings() {
        const drawing = this.activeSettingsDrawing;
        const panel = this.activeSettingsPanel;
        if (!drawing || !panel) return;

        if (drawing.type === 'text-annotation') {
            const textContent = document.getElementById('modal-text-content').value || 'Text';
            const textColor = document.getElementById('modal-text-color').value;
            const textSize = parseInt(document.getElementById('modal-text-size').value) || 14;
            const textBold = document.getElementById('modal-text-bold').checked;
            
            const bgToggle = document.getElementById('modal-text-bg-toggle').checked;
            const bgColor = bgToggle ? document.getElementById('modal-text-bg-color').value : 'transparent';
            
            const borderToggle = document.getElementById('modal-text-border-toggle').checked;
            const borderColor = borderToggle ? document.getElementById('modal-text-border-color').value : 'transparent';

            const textOptions = {
                text: textContent,
                fontSize: textSize,
                fontWeight: textBold ? 'bold' : 'normal',
                backgroundColor: bgColor,
                borderColor: borderColor
            };

            // Set both style (for labelColor) and options (for serialization and Gt internal states)
            drawing.style = {
                ...drawing.style,
                labelColor: textColor,
                lineColor: borderColor !== 'transparent' ? borderColor : drawing.style.lineColor
            };

            drawing.options = {
                ...drawing.options,
                ...textOptions
            };

            // Gt specific setters
            drawing.setTextOptions(textOptions);
            drawing.requestUpdate();
            
        } else {
            const labelToggle = document.getElementById('modal-label-toggle').checked;
            const labelText = labelToggle ? document.getElementById('modal-label-text').value : '';
            const labelColor = labelToggle ? document.getElementById('modal-label-color').value : '#d1d4dc';
            const labelSize = labelToggle ? parseInt(document.getElementById('modal-label-size').value) : 12;
            const labelBold = labelToggle ? document.getElementById('modal-label-bold').checked : false;

            const lineColor = document.getElementById('modal-line-color').value;
            const lineWidth = parseInt(document.getElementById('modal-line-width').value) || 2;

            // Apply style updates
            const newStyle = {
                ...drawing.style,
                lineColor: lineColor,
                lineWidth: lineWidth,
                labelColor: labelColor
            };

            // Custom rectangle background options
            if (drawing.type === 'rectangle') {
                const fillColor = document.getElementById('modal-fill-color').value;
                const fillOpacity = parseFloat(document.getElementById('modal-fill-opacity').value) || 0.1;
                
                // Convert hex fill color to rgba to preserve transparency
                let rgbaFill = fillColor;
                if (fillColor.startsWith('#')) {
                    const r = parseInt(fillColor.slice(1, 3), 16);
                    const g = parseInt(fillColor.slice(3, 5), 16);
                    const b = parseInt(fillColor.slice(5, 7), 16);
                    rgbaFill = `rgba(${r}, ${g}, ${b}, ${fillOpacity})`;
                }
                
                newStyle.fillColor = rgbaFill;
                newStyle.fillOpacity = fillOpacity;
            }

            drawing.style = newStyle;

            // Apply options updates
            drawing.options = {
                ...drawing.options,
                customLabelText: labelText || undefined,
                customLabelColor: labelColor,
                customLabelFontSize: labelSize,
                customLabelFontWeight: labelBold ? 'bold' : 'normal'
            };
            
            drawing.requestUpdate();
        }

        panel.saveDrawings();
        this.closeDrawingSettings();
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
            const el = document.getElementById('mt5-status');
            if (data.connected) {
                el.classList.add('connected');
                el.querySelector('.status-text').textContent = 'MT5 Connected';
            } else {
                el.querySelector('.status-text').textContent = 'MT5 Disconnected';
            }
        } catch (e) { console.error('MT5 status check failed:', e); }
    }

    async loadSymbols() {
        try {
            const res = await fetch('/api/symbols');
            const data = await res.json();
            if (data.success && data.symbols.length > 0) {
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

// Initialize
window.addEventListener('DOMContentLoaded', () => {
    window.chartManager = new ChartManager();
});
