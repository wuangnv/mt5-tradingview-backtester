// Bar Replay Manager – Improved
// Key improvements vs old version:
//  • Performance: series.update() for forward movement (O(1) vs O(n))
//  • No more setTimeout race conditions — centering is synchronous
//  • Keyboard shortcuts: Space, ←/→, Shift+←/→, Esc
//  • Binary search for jump-to-date (was linear scan)
//  • Arrow keys to change speed
//  • Proper timezone-aware date input

class ReplayManager {
    constructor() {
        this.fullData = [];
        this.currentIndex = 0;
        this.symbol = null;
        this.timeframe = null;
        this.cursorTimestamp = null;
        this._lastDisplayedIndex = -1; // Track what's currently on chart

        this.isPlaying = false;
        this.playInterval = null;
        this.speed = 1000; // ms per bar

        this.isJumpMode = false;

        // Keyboard handler (attached globally, checks replay mode internally)
        this._keyHandler = this._onKeyDown.bind(this);
        document.addEventListener('keydown', this._keyHandler);

        this._initUI();
    }

    // ─── UI Initialization ────────────────────────────────────────────────

    _initUI() {
        document.getElementById('replay-play-pause').addEventListener('click', () => {
            this.isPlaying ? this.pause() : this.play();
        });

        document.getElementById('replay-prev').addEventListener('click', () => this.previousBar());
        document.getElementById('replay-next').addEventListener('click', () => this.nextBar());

        document.getElementById('replay-slider').addEventListener('input', (e) => {
            // Pause while dragging for smooth seek
            const wasPaused = !this.isPlaying;
            if (!wasPaused) this.pause();
            this.seekTo(parseInt(e.target.value));
            // Don't auto-resume — user can press play
        });

        document.getElementById('replay-speed').addEventListener('change', (e) => {
            this.speed = parseInt(e.target.value);
            if (this.isPlaying) {
                this.pause();
                this.play();
            }
        });

        document.getElementById('replay-jump-date').addEventListener('click', () => this.jumpToDate());
        document.getElementById('replay-jump-mode').addEventListener('click', () => this.toggleJumpMode());

        document.getElementById('replay-close').addEventListener('click', () => {
            this.stop();
            if (window.chartManager) window.chartManager.exitReplayMode();
        });
    }

    // ─── Keyboard Shortcuts ───────────────────────────────────────────────

    _onKeyDown(e) {
        // Only active in replay mode
        if (!window.chartManager?.isReplayMode) return;
        // Don't intercept when user is typing
        if (['INPUT', 'SELECT', 'TEXTAREA'].includes(e.target.tagName)) return;

        switch (e.code) {
            case 'Space':
                e.preventDefault();
                this.isPlaying ? this.pause() : this.play();
                break;

            case 'ArrowRight':
                e.preventDefault();
                e.shiftKey ? this.skipBars(10) : this.nextBar();
                break;

            case 'ArrowLeft':
                e.preventDefault();
                e.shiftKey ? this.skipBars(-10) : this.previousBar();
                break;

            case 'ArrowUp':
                e.preventDefault();
                this._changeSpeedStep(-1); // Faster
                break;

            case 'ArrowDown':
                e.preventDefault();
                this._changeSpeedStep(+1); // Slower
                break;

            case 'Escape':
                e.preventDefault();
                this.stop();
                if (window.chartManager) window.chartManager.exitReplayMode();
                break;
        }
    }

    // ─── Start / Stop ─────────────────────────────────────────────────────

    startFromIndex(data, startIndex, symbol = null, timeframe = null) {
        this.fullData = data;
        this.symbol = symbol;
        this.timeframe = timeframe;
        this.isPlaying = false;
        this._lastDisplayedIndex = -1; // Force full setData on first render

        const maxIndex = Math.max(0, data.length - 1);
        const minIndex = Math.min(10, maxIndex);
        this.currentIndex = Math.max(minIndex, Math.min(startIndex, maxIndex));

        this._applyToChart();
        this._updateUI();

        // Set date input to current bar time (timezone-adjusted)
        const bar = data[this.currentIndex];
        this.cursorTimestamp = bar ? (bar.replayCursorTime || bar.time) : null;
        if (bar) this._setDateInput(this.cursorTimestamp);

        console.log(`Replay: bar ${this.currentIndex + 1} / ${data.length} | ${this._formatBarTime(this.currentIndex)}`);
    }

    stop() {
        this.pause();
        this.fullData = [];
        this.currentIndex = 0;
        this.symbol = null;
        this.timeframe = null;
        this.cursorTimestamp = null;
        this._lastDisplayedIndex = -1;
        this.isJumpMode = false;
        this._updateJumpModeBtn();
        if (window.chartManager) window.chartManager.setJumpMode(false);
    }

    // ─── Core Chart Update ────────────────────────────────────────────────

    /**
     * Applies this.currentIndex to the chart.
     * Uses series.update() (O(1)) when moving forward.
     * Falls back to setData() (O(n)) when moving backward or initializing.
     */
    _applyToChart() {
        const cm = window.chartManager;
        if (!cm?.activePanel?.chartReady) return;

        const isForward =
            this._lastDisplayedIndex >= 0 &&
            this.currentIndex >= this._lastDisplayedIndex;

        cm.activePanel.fullData = this.fullData;
        cm.activePanel.replayIndex = this.currentIndex;
        cm.activePanel.isReplayMode = true;
        cm.activePanel.applyReplayFrameToChart?.({
            forceReset: !isForward,
            focus: !isForward,
            focusDelay: 400
        });

        this._lastDisplayedIndex = this.currentIndex;
    }

    // ─── Playback ─────────────────────────────────────────────────────────

    play() {
        if (!this.fullData.length) return;
        if (this.fullData.length < 2) return;

        if (this.currentIndex >= this.fullData.length - 1) {
            this.currentIndex = Math.max(0, this.fullData.length - 301);
            this._lastDisplayedIndex = -1;
            this._applyToChart();
            this._updateUI();
        }

        this.isPlaying = true;
        this._updatePlayPauseBtn();

        this.playInterval = setInterval(() => {
            if (this.currentIndex < this.fullData.length - 1) {
                this.currentIndex++;
                this._applyToChart();
                this._updateUI();
            } else {
                this.pause();
                document.getElementById('replay-progress').textContent =
                    `Finished (${this.fullData.length} bars)`;
            }
        }, this.speed);
    }

    pause() {
        this.isPlaying = false;
        this._updatePlayPauseBtn();
        if (this.playInterval) {
            clearInterval(this.playInterval);
            this.playInterval = null;
        }
    }

    // ─── Navigation ───────────────────────────────────────────────────────

    nextBar() {
        if (this.currentIndex < this.fullData.length - 1) {
            this.currentIndex++;
            this._applyToChart();
            this._updateUI();
        }
    }

    previousBar() {
        if (this.currentIndex > 0) {
            this.currentIndex--;
            this._applyToChart();
            this._updateUI();
        }
    }

    skipBars(n) {
        const next = Math.max(0, Math.min(this.currentIndex + n, this.fullData.length - 1));
        if (next !== this.currentIndex) {
            this.currentIndex = next;
            this._applyToChart();
            this._updateUI();
        }
    }

    seekTo(index) {
        if (index >= 0 && index < this.fullData.length) {
            this.currentIndex = index;
            this._applyToChart();
            this._updateUI();
        }
    }

    seekToTime(timestamp) {
        if (!this.fullData || !this.fullData.length) return;
        let idx = window.MT5Datafeed?.findIndexAtOrBefore?.(this.fullData, timestamp);
        if (idx === undefined || idx < 0) idx = 0;
        this.seekTo(idx);
    }

    // ─── Jump to Date ─────────────────────────────────────────────────────

    async jumpToDate() {
        const val = document.getElementById('replay-start-date').value;
        if (!val) { alert('Please select a date'); return; }

        const date = this._parseDateTimeString(val);
        if (!date) { alert('Invalid date format. Please use DD/MM/YYYY HH:MM'); return; }

        // Local date parsed from input -> convert to UTC timestamp based on chart timezone
        const tz = window.chartManager?.timezoneOffset ?? 7;
        const targetTs = Math.floor(date.getTime() / 1000) - (tz * 3600);

        if (!this.fullData.length) return;

        const firstTs = this.fullData[0].time;
        const lastTs  = this.fullData[this.fullData.length - 1].time;

        const shouldRefreshSyncedWindow = true;
        if (shouldRefreshSyncedWindow || targetTs < firstTs || targetTs > lastTs) {
            const activePanel = window.chartManager?.activePanel;
            if (!activePanel) return;

            const timeframe = activePanel.timeframe;
            const symbol = activePanel.symbol;

            const hasLocal = await window.MT5Datafeed.hasLocalCoverage(symbol, 'M1', targetTs)
                || await window.MT5Datafeed.hasLocalCoverage(symbol, timeframe, targetTs);

            if (hasLocal) {
                console.log(`[Replay] jumpToDate: Loading local replay window`);
                const progress = document.getElementById('replay-progress');
                if (progress) progress.textContent = 'Loading replay window...';

                const data = await window.MT5Datafeed.loadSyncedReplayWindow(symbol, timeframe, targetTs);
                const idx = window.MT5Datafeed.findIndexAtOrBefore(data, targetTs);
                if (data.length > 0 && idx >= 0) {
                    this.fullData = data;
                    activePanel.fullData = data;
                    activePanel.replayIndex = idx;
                    this._lastDisplayedIndex = -1;
                    activePanel.updateReplayCoverageLabel?.();
                    // Fall through to binary search below
                } else {
                    alert('Local data does not cover this date. Please download more history.');
                    return;
                }
            } else {
                // Estimate bars needed based on the current timeframe
                const timeframeSeconds = {
                    'M1': 60, 'M5': 300, 'M15': 900, 'M30': 1800,
                    'H1': 3600, 'H4': 14400, 'D1': 86400, 'W1': 604800
                }[timeframe] || 3600;

                const secondsDiff = lastTs - targetTs;
                let estimatedBars = Math.ceil((secondsDiff / timeframeSeconds) * 1.15);
                const barsToLoad = Math.max(5000, Math.min(estimatedBars, 100000));

                const formattedTarget = date.toLocaleDateString();
                const ok = confirm(
                    `Date ${formattedTarget} is outside the current loaded range.\n\n` +
                    `No local history found for ${symbol} ${timeframe}.\n` +
                    `Estimated bars needed: ~${estimatedBars} bars.\n\n` +
                    `Option 1: Download ${barsToLoad} bars from MT5 and save locally?\n` +
                    `(Use the 📥 Download History button to pre-download large datasets)`
                );
                if (!ok) return;

                // Download from MT5 and save to local file
                const progress = document.getElementById('replay-progress');
                if (progress) progress.textContent = `Downloading ${barsToLoad} bars...`;

                const result = await window.MT5Datafeed.downloadHistory(symbol, timeframe, barsToLoad);
                if (!result.success) {
                    alert("Failed to download history from MetaTrader 5.\n" + (result.message || ''));
                    return;
                }

                // Now load the saved local data into cache
                const data = await window.MT5Datafeed.loadSyncedReplayWindow(symbol, timeframe, targetTs);
                if (data.length > 0) {
                    this.fullData = data;
                    activePanel.fullData = data;
                    this._lastDisplayedIndex = -1;
                    activePanel.updateReplayCoverageLabel?.();
                } else {
                    alert("Downloaded but could not load data.");
                    return;
                }
            }
        }

        let idx = window.MT5Datafeed?.findIndexAtOrBefore?.(this.fullData, targetTs);
        if (idx === undefined || idx < 0) idx = 0;
        this.seekTo(idx);
    }

    // ─── Speed control ────────────────────────────────────────────────────

    _speeds() { return [4000, 2000, 1000, 500, 200, 100, 50]; }

    _changeSpeedStep(delta) {
        const speeds = this._speeds();
        const idx = speeds.indexOf(this.speed);
        const newIdx = Math.max(0, Math.min(idx + delta, speeds.length - 1));
        if (newIdx !== idx) {
            this.speed = speeds[newIdx];
            document.getElementById('replay-speed').value = this.speed;
            if (this.isPlaying) { this.pause(); this.play(); }
        }
    }

    // ─── Jump Mode ────────────────────────────────────────────────────────

    toggleJumpMode() {
        this.isJumpMode = !this.isJumpMode;
        this._updateJumpModeBtn();
        if (window.chartManager) window.chartManager.setJumpMode(this.isJumpMode);
    }

    _updateJumpModeBtn() {
        const btn = document.getElementById('replay-jump-mode');
        btn.classList.toggle('active', this.isJumpMode);
        btn.setAttribute('aria-pressed', String(this.isJumpMode));
        btn.title = this.isJumpMode
            ? 'Jump Mode: ON - click chart to choose the replay bar'
            : 'Jump Mode: OFF - click to choose a replay start bar';
    }

    // ─── UI updates ───────────────────────────────────────────────────────

    _updateUI() {
        const total = this.fullData.length;
        const idx   = this.currentIndex;
        const activeBar = this.fullData[idx];
        this.cursorTimestamp = activeBar ? (activeBar.replayCursorTime || activeBar.time) : null;

        const progressPct = total > 1 ? ((idx / (total - 1)) * 100) : 0;
        document.getElementById('replay-progress').textContent =
            `${idx + 1} / ${total} (${progressPct.toFixed(0)}%)`;

        const slider = document.getElementById('replay-slider');
        slider.max   = total - 1;
        slider.value = idx;

        document.getElementById('replay-prev').disabled = idx <= 0;
        document.getElementById('replay-next').disabled = idx >= total - 1;

        document.getElementById('replay-current-date').textContent =
            this._formatBarTime(idx);

        // Sync active panel replayIndex
        if (window.chartManager && window.chartManager.activePanel) {
            window.chartManager.activePanel.replayIndex = idx;
        }

        // Trigger simulator trading ticks
        if (window.tradeManager && activeBar) {
            window.tradeManager.onReplayTick(activeBar);
        }

        if (window.chartManager) {
            window.chartManager.updateOHLCInfo(activeBar);
            window.chartManager.syncReplayPanelsToCursor?.(this.cursorTimestamp, {
                sourcePanel: window.chartManager.activePanel,
                forceReset: this._lastDisplayedIndex < 0
            });
        }
    }

    _updatePlayPauseBtn() {
        const playSvg = document.getElementById('svg-play');
        const pauseSvg = document.getElementById('svg-pause');
        const btn = document.getElementById('replay-play-pause');
        if (playSvg && pauseSvg) {
            playSvg.style.display = this.isPlaying ? 'none' : 'block';
            pauseSvg.style.display = this.isPlaying ? 'block' : 'none';
        }
        if (btn) {
            btn.classList.toggle('playing', this.isPlaying);
            btn.title = this.isPlaying ? 'Pause replay (Space)' : 'Play replay (Space)';
        }
    }

    // ─── Helpers ──────────────────────────────────────────────────────────

    _formatBarTime(index) {
        const bar = this.fullData[index];
        if (!bar) return '';
        const timestamp = bar.replayCursorTime || bar.time;
        const tz = window.chartManager?.timezoneOffset ?? 7;
        const d = new Date(timestamp * 1000);
        d.setUTCHours(d.getUTCHours() + tz);
        const weekdays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
        return [
            weekdays[d.getUTCDay()], ' ',
            String(d.getUTCDate()).padStart(2, '0'), '/',
            String(d.getUTCMonth() + 1).padStart(2, '0'), '/',
            d.getUTCFullYear(), ' ',
            String(d.getUTCHours()).padStart(2, '0'), ':',
            String(d.getUTCMinutes()).padStart(2, '0'),
        ].join('');
    }

    _setDateInput(timestamp) {
        const tz = window.chartManager?.timezoneOffset ?? 7;
        const d = new Date(timestamp * 1000);
        d.setUTCHours(d.getUTCHours() + tz);
        // Format as DD/MM/YYYY HH:MM for easy manual reading & text parsing
        const pad = n => String(n).padStart(2, '0');
        const val = `${pad(d.getUTCDate())}/${pad(d.getUTCMonth()+1)}/${d.getUTCFullYear()} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
        document.getElementById('replay-start-date').value = val;
    }

    _parseDateTimeString(str) {
        if (!str) return null;

        // Clean up string
        const cleaned = str.replace(/,/g, ' ').replace(/\s+/g, ' ').trim();

        // Try parsing DD/MM/YYYY HH:MM or DD/MM/YYYY
        const dmyMatch = cleaned.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})(?:\s+(\d{1,2}):(\d{1,2}))?$/);
        if (dmyMatch) {
            const day = parseInt(dmyMatch[1], 10);
            const month = parseInt(dmyMatch[2], 10) - 1; // 0-indexed
            const year = parseInt(dmyMatch[3], 10);
            const hour = dmyMatch[4] ? parseInt(dmyMatch[4], 10) : 0;
            const minute = dmyMatch[5] ? parseInt(dmyMatch[5], 10) : 0;
            return new Date(year, month, day, hour, minute);
        }

        // Try parsing YYYY-MM-DD HH:MM or YYYY-MM-DD
        const ymdMatch = cleaned.match(/^(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})(?:\s+(\d{1,2}):(\d{1,2}))?$/);
        if (ymdMatch) {
            const year = parseInt(ymdMatch[1], 10);
            const month = parseInt(ymdMatch[2], 10) - 1;
            const day = parseInt(ymdMatch[3], 10);
            const hour = ymdMatch[4] ? parseInt(ymdMatch[4], 10) : 0;
            const minute = ymdMatch[5] ? parseInt(ymdMatch[5], 10) : 0;
            return new Date(year, month, day, hour, minute);
        }

        // Fallback to standard JavaScript date parsing
        const fallback = new Date(str);
        return isNaN(fallback.getTime()) ? null : fallback;
    }
}

// Initialize
window.addEventListener('DOMContentLoaded', () => {
    window.replayManager = new ReplayManager();
});
