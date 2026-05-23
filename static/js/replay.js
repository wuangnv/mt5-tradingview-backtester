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

    startFromIndex(data, startIndex) {
        this.fullData = data;
        this.isPlaying = false;
        this._lastDisplayedIndex = -1; // Force full setData on first render

        // Clamp index: minimum 10 bars so there's some history visible
        this.currentIndex = Math.max(10, Math.min(startIndex, data.length - 1));

        this._applyToChart();
        this._updateUI();

        // Set date input to current bar time (timezone-adjusted)
        const bar = data[this.currentIndex];
        if (bar) this._setDateInput(bar.time);

        console.log(`Replay: bar ${this.currentIndex + 1} / ${data.length} | ${this._formatBarTime(this.currentIndex)}`);
    }

    stop() {
        this.pause();
        this.fullData = [];
        this.currentIndex = 0;
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

        if (isForward) {
            // Efficient: add bars one by one
            for (let i = this._lastDisplayedIndex + 1; i <= this.currentIndex; i++) {
                window.MT5Datafeed.updateRealtime(cm.activePanel.symbol, cm.activePanel.timeframe, this.fullData[i]);
            }
        } else {
            // Backward seek or initial load – reset datafeed cache & force redraw
            window.MT5Datafeed.resetReplayCache(cm.activePanel.symbol, cm.activePanel.timeframe);
            if (cm.activePanel.chart) {
                try {
                    cm.activePanel.chart.resetData();
                } catch (e) {
                    console.error("Error calling resetData on backward seek:", e);
                }
            }
        }
        this._lastDisplayedIndex = this.currentIndex;
    }

    // ─── Playback ─────────────────────────────────────────────────────────

    play() {
        if (!this.fullData.length) return;
        // If already at end, restart from beginning
        if (this.currentIndex >= this.fullData.length - 1) {
            this.currentIndex = Math.max(0, this.fullData.length - 2);
            this._lastDisplayedIndex = -1;
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
        let lo = 0, hi = this.fullData.length - 1;
        while (lo < hi) {
            const mid = (lo + hi) >> 1;
            if (this.fullData[mid].time < timestamp) lo = mid + 1;
            else hi = mid;
        }
        this.seekTo(lo);
    }

    // ─── Jump to Date ─────────────────────────────────────────────────────

    async jumpToDate() {
        const val = document.getElementById('replay-start-date').value;
        if (!val) { alert('Please select a date'); return; }

        // datetime-local gives LOCAL time; convert to UTC timestamp
        const localDate = new Date(val);
        if (isNaN(localDate)) { alert('Invalid date'); return; }

        const targetTs = Math.floor(localDate.getTime() / 1000);

        if (!this.fullData.length) return;

        const firstTs = this.fullData[0].time;
        const lastTs  = this.fullData[this.fullData.length - 1].time;

        if (targetTs < firstTs || targetTs > lastTs) {
            const ok = confirm(
                `Date is outside the loaded range:\n` +
                `${new Date(firstTs * 1000).toLocaleDateString()} → ${new Date(lastTs * 1000).toLocaleDateString()}\n\n` +
                `Load 10 000 bars from MT5 to expand range?`
            );
            if (!ok) return;
            if (window.chartManager) {
                const success = await window.chartManager.loadMoreData(10000);
                if (success) {
                    this.fullData = window.chartManager.fullData;
                    this._lastDisplayedIndex = -1;
                } else return;
            }
        }

        // Binary search — O(log n) instead of old linear O(n)
        let lo = 0, hi = this.fullData.length - 1;
        while (lo < hi) {
            const mid = (lo + hi) >> 1;
            if (this.fullData[mid].time < targetTs) lo = mid + 1;
            else hi = mid;
        }
        this.seekTo(lo);
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
        btn.title = this.isJumpMode
            ? 'Jump Mode: ON – click chart to seek'
            : 'Jump Mode: OFF – click to enable';
    }

    // ─── UI updates ───────────────────────────────────────────────────────

    _updateUI() {
        const total = this.fullData.length;
        const idx   = this.currentIndex;

        document.getElementById('replay-progress').textContent = `${idx + 1} / ${total}`;

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
        if (window.tradeManager && this.fullData[idx]) {
            window.tradeManager.onReplayTick(this.fullData[idx]);
        }

        if (window.chartManager) {
            window.chartManager.updateOHLCInfo(this.fullData[idx]);
        }
    }

    _updatePlayPauseBtn() {
        const playSvg = document.getElementById('svg-play');
        const pauseSvg = document.getElementById('svg-pause');
        if (playSvg && pauseSvg) {
            playSvg.style.display = this.isPlaying ? 'none' : 'block';
            pauseSvg.style.display = this.isPlaying ? 'block' : 'none';
        }
    }

    // ─── Helpers ──────────────────────────────────────────────────────────

    _formatBarTime(index) {
        const bar = this.fullData[index];
        if (!bar) return '';
        const tz = window.chartManager?.timezoneOffset ?? 7;
        const d = new Date(bar.time * 1000);
        d.setUTCHours(d.getUTCHours() + tz);
        return [
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
        // Format YYYY-MM-DDTHH:MM for datetime-local input
        const pad = n => String(n).padStart(2, '0');
        const val = `${d.getUTCFullYear()}-${pad(d.getUTCMonth()+1)}-${pad(d.getUTCDate())}T${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
        document.getElementById('replay-start-date').value = val;
    }
}

// Initialize
window.addEventListener('DOMContentLoaded', () => {
    window.replayManager = new ReplayManager();
});
