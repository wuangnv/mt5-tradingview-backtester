/**
 * replay.js — ReplayManager
 * Bar-replay engine: play/pause/step, jump-to-date, jump-mode click-to-seek,
 * speed control and keyboard shortcuts.
 *
 * Contract with datafeed.js (do not rename):
 *   window.replayManager.cursorTimestamp / fullData / currentIndex
 *   window.replayManager.symbol / timeframe / _updateUI() / _lastDisplayedIndex
 */

class ReplayManager {
    constructor() {
        this.active = false;
        this.isPlaying = false;
        this.isJumpMode = false;

        this.symbol = null;
        this.timeframe = null;
        this.fullData = null;
        this.currentIndex = -1;
        this._lastDisplayedIndex = -1;

        this.speed = 1000;
        this.speedSteps = [4000, 2000, 1000, 500, 200, 100, 50];
        this._timer = null;
        this._extending = false;

        this._els = {
            bar: document.getElementById('replay-bar'),
            close: document.getElementById('rb-close'),
            jump: document.getElementById('rb-jump'),
            jumpMode: document.getElementById('rb-jump-mode'),
            date: document.getElementById('rb-date'),
            prev: document.getElementById('rb-prev'),
            play: document.getElementById('rb-play'),
            next: document.getElementById('rb-next'),
            speed: document.getElementById('rb-speed'),
            progress: document.getElementById('rb-progress'),
            iconPlay: document.getElementById('rb-icon-play'),
            iconPause: document.getElementById('rb-icon-pause')
        };

        this._wire();
    }

    get cursorTimestamp() {
        const bar = this.fullData?.[this.currentIndex];
        return bar ? bar.time : null;
    }

    /* ── UI wiring ──────────────────────────────────────────────────────── */

    _wire() {
        const e = this._els;
        e.close.addEventListener('click', () => this.stop());
        e.play.addEventListener('click', () => this.togglePlay());
        e.next.addEventListener('click', () => this.nextBar());
        e.prev.addEventListener('click', () => this.previousBar());
        e.jump.addEventListener('click', () => this.openJumpModal());
        e.date.addEventListener('click', () => this.openJumpModal());
        e.jumpMode.addEventListener('click', () => this.toggleJumpMode());
        e.speed.addEventListener('change', () => this.setSpeed(Number(e.speed.value)));

        document.getElementById('jump-go').addEventListener('click', () => {
            const value = document.getElementById('jump-datetime').value;
            if (!value) return;
            const ts = Math.floor(new Date(value).getTime() / 1000); // browser local tz
            if (!Number.isFinite(ts)) { window.showToast('Invalid date.', 'error'); return; }
            window.closeModal('modal-jump');
            if (this.active) this.seekToTime(ts);
            else this.startAt(ts);
        });

        document.addEventListener('keydown', (ev) => {
            if (!this.active) return;
            if (ev.target.matches('input, select, textarea')) return;
            switch (ev.code) {
                case 'Space': ev.preventDefault(); this.togglePlay(); break;
                case 'ArrowRight': ev.preventDefault(); ev.shiftKey ? this.skipBars(10) : this.nextBar(); break;
                case 'ArrowLeft': ev.preventDefault(); ev.shiftKey ? this.skipBars(-10) : this.previousBar(); break;
                case 'ArrowUp': ev.preventDefault(); this._changeSpeedStep(1); break;
                case 'ArrowDown': ev.preventDefault(); this._changeSpeedStep(-1); break;
                case 'Escape': this.stop(); break;
            }
        });
    }

    /* ── Enter / exit ───────────────────────────────────────────────────── */

    /** Topbar Replay button: pick a date, then start. */
    promptStart() {
        if (this.active) { this.stop(); return; }
        const panel = window.chartManager?.activePanel;
        if (!panel) return;
        // Prefill the modal with the last available cached bar or now
        const cached = window.MT5Datafeed.getCachedHistory(panel.symbol, panel.timeframe);
        const base = cached?.length ? cached[cached.length - 1].time : Math.floor(Date.now() / 1000);
        const d = new Date(base * 1000);
        const pad = (n) => String(n).padStart(2, '0');
        document.getElementById('jump-datetime').value =
            `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
        window.openModal('modal-jump');
    }

    async startAt(ts) {
        const cm = window.chartManager;
        const panel = cm?.activePanel;
        if (!panel) return;

        window.showVeil('Loading replay data…');
        try {
            const df = window.MT5Datafeed;
            const data = await df.fetchHistoryCovering(panel.symbol, panel.timeframe, ts, 3000);
            if (!data.length) {
                window.showToast(`No data for ${panel.symbol} ${panel.timeframe}. Download history first (History button) or connect MT5.`, 'error');
                return;
            }
            let idx = df.findIndexAtOrBefore(data, ts);
            if (idx < 0) idx = 0;

            this.symbol = panel.symbol;
            this.timeframe = panel.timeframe;
            this.fullData = data;
            this.currentIndex = idx;
            this._lastDisplayedIndex = -1;
            this.active = true;

            panel.isReplayMode = true;
            panel.fullData = data;
            panel.replayIndex = idx;

            await cm.enterReplayMode(this.cursorTimestamp);

            panel.resetData();
            this._els.bar.classList.add('open');
            document.getElementById('btn-replay').classList.add('active');
            this._focusCursor(panel);
            this._updateUI();
            window.tradeManager?.refreshModeUI();
            window.tradeManager?.updateAccountUI();
            window.tradeManager?.renderTables();
            window.showToast(`Replay started on ${this.symbol} ${this.timeframe}`, 'success');
        } catch (err) {
            console.error('[Replay] start failed:', err);
            window.showToast('Failed to start replay: ' + err.message, 'error');
        } finally {
            window.hideVeil();
        }
    }

    stop() {
        this.pause();
        this.active = false;
        this.isJumpMode = false;
        this._els.jumpMode.classList.remove('active');
        this.fullData = null;
        this.currentIndex = -1;
        this.symbol = null;
        this.timeframe = null;

        this._els.bar.classList.remove('open');
        document.getElementById('btn-replay').classList.remove('active');
        window.chartManager?.exitReplayMode();
        window.tradeManager?.refreshModeUI();
        window.tradeManager?.updateAccountUI();
        window.tradeManager?.renderTables();
    }

    /* ── Playback ───────────────────────────────────────────────────────── */

    togglePlay() { this.isPlaying ? this.pause() : this.play(); }

    play() {
        if (!this.active || this.isPlaying) return;
        this.isPlaying = true;
        this._timer = setInterval(() => this._stepForward(), this.speed);
        this._els.iconPlay.style.display = 'none';
        this._els.iconPause.style.display = 'block';
    }

    pause() {
        this.isPlaying = false;
        if (this._timer) { clearInterval(this._timer); this._timer = null; }
        this._els.iconPlay.style.display = 'block';
        this._els.iconPause.style.display = 'none';
    }

    setSpeed(ms) {
        this.speed = ms;
        this._els.speed.value = String(ms);
        if (this.isPlaying) { this.pause(); this.play(); }
    }

    _changeSpeedStep(delta) {
        const i = this.speedSteps.indexOf(this.speed);
        const next = Math.min(this.speedSteps.length - 1, Math.max(0, (i < 0 ? 2 : i) + delta));
        this.setSpeed(this.speedSteps[next]);
    }

    nextBar() { if (this.active) this._stepForward(); }
    previousBar() { if (this.active) this.seekTo(this.currentIndex - 1); }
    skipBars(n) { if (this.active) this.seekTo(this.currentIndex + n); }

    _stepForward() {
        if (this.currentIndex >= this.fullData.length - 1) {
            this.pause();
            this._extendData();
            return;
        }
        this.currentIndex += 1;
        this._applyFrame('forward');
    }

    seekTo(index) {
        if (!this.fullData?.length) return;
        const clamped = Math.max(0, Math.min(this.fullData.length - 1, index));
        if (clamped === this.currentIndex) return;
        const direction = clamped > this.currentIndex ? 'forward' : 'reset';
        this.currentIndex = clamped;
        this._applyFrame(direction === 'forward' && clamped === this._lastDisplayedIndex + 1 ? 'forward' : 'reset');
    }

    async seekToTime(ts) {
        const df = window.MT5Datafeed;
        let idx = df.findIndexAtOrBefore(this.fullData || [], ts);
        if (idx < 0) {
            // Outside loaded window — load around the target
            window.showVeil('Loading data…');
            try {
                const data = await df.loadSyncedReplayWindow(this.symbol, this.timeframe, ts);
                if (!data.length) {
                    window.showToast('No data at that date. Download history first.', 'error');
                    return;
                }
                this.fullData = data;
                idx = Math.max(0, df.findIndexAtOrBefore(data, ts));
                this._syncActivePanelData();
            } finally {
                window.hideVeil();
            }
        }
        this.currentIndex = idx;
        this._applyFrame('reset');
        this._focusCursor(window.chartManager?.activePanel);
    }

    toggleJumpMode() {
        this.isJumpMode = !this.isJumpMode;
        this._els.jumpMode.classList.toggle('active', this.isJumpMode);
        if (this.isJumpMode) window.showToast('Jump mode: click anywhere on the chart to seek.', 'success');
    }

    openJumpModal() { window.openModal('modal-jump'); }

    /* ── Frame application ──────────────────────────────────────────────── */

    _syncActivePanelData() {
        const panel = window.chartManager?.activePanel;
        if (panel && panel.isReplayMode) {
            panel.fullData = this.fullData;
            panel.replayIndex = this.currentIndex;
        }
    }

    _applyFrame(direction) {
        const df = window.MT5Datafeed;
        const bar = this.fullData[this.currentIndex];
        if (!bar) return;

        this._syncActivePanelData();

        if (direction === 'forward') {
            // O(1): push the newly revealed bar as a realtime update
            df.updateRealtime(this.symbol, this.timeframe, bar);
        } else {
            window.chartManager?.activePanel?.resetData();
        }
        this._lastDisplayedIndex = this.currentIndex;

        this._updateUI();
        window.tradeManager?.onReplayTick(bar, this.symbol);
        window.chartManager?.syncReplayPanelsToCursor(bar.time);

        if (this.currentIndex >= this.fullData.length - 50) this._extendData();
    }

    _focusCursor(panel) {
        if (!panel?.chart || !this.fullData?.length) return;
        try {
            const bar = this.fullData[this.currentIndex];
            const tfSec = this._tfSeconds();
            const span = tfSec * 80;
            panel.chart.setVisibleRange({ from: bar.time - span, to: bar.time + tfSec * 15 });
        } catch (err) { /* chart not ready yet */ }
    }

    _tfSeconds() {
        return { M1: 60, M5: 300, M15: 900, M30: 1800, H1: 3600, H4: 14400, D1: 86400, W1: 604800 }[this.timeframe] || 3600;
    }

    /** Grow the loaded window when the cursor approaches the end. */
    async _extendData() {
        if (this._extending) return;
        this._extending = true;
        try {
            const df = window.MT5Datafeed;
            const more = await df.fetchHistory(this.symbol, this.timeframe, this.fullData.length * 2);
            if (more.length > this.fullData.length) {
                this.fullData = more;
                this._syncActivePanelData();
                this._updateUI();
            }
        } catch (err) { /* offline — replay pauses at the edge */ }
        finally { this._extending = false; }
    }

    /* ── UI sync (called by datafeed.js too) ────────────────────────────── */

    _updateUI() {
        const bar = this.fullData?.[this.currentIndex];
        this._els.progress.textContent = `${this.currentIndex + 1} / ${this.fullData?.length || 0}`;
        this._els.date.textContent = bar
            ? new Date(bar.time * 1000).toLocaleString('en-GB', {
                day: '2-digit', month: 'short', year: 'numeric',
                hour: '2-digit', minute: '2-digit'
              })
            : '—';
    }
}

window.replayManager = new ReplayManager();
