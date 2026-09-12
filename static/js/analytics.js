/**
 * analytics.js — data storytelling for replay practice.
 * Computes statistics from virtual-account trades and renders:
 *   - the Analytics tab in the bottom panel (equity curve + stat cards
 *     + saved sessions list)
 *   - the Session Report modal shown when a replay session ends
 * Sessions are persisted through the local Flask API. Existing browser-only
 * sessions are migrated once when the Analytics tab first loads.
 */

const LEGACY_VIRTUAL_SESSIONS_KEY = 'virtual_sessions_v1';
const START_BALANCE = 10000;

class Analytics {
    constructor() {
        this.sessions = [];
        this._pendingReport = null;
        this._activeReport = null;
        this._sessionsLoaded = false;
    }

    /* ── Statistics ─────────────────────────────────────────────────────── */

    /** Compute summary stats + equity curve from closed trades. */
    computeStats(history, startBalance = START_BALANCE) {
        const trades = (history || []).slice().sort((a, b) => a.time - b.time);
        const n = trades.length;
        const wins = trades.filter(t => t.profit > 0);
        const losses = trades.filter(t => t.profit <= 0);
        const grossProfit = wins.reduce((s, t) => s + t.profit, 0);
        const grossLoss = Math.abs(losses.reduce((s, t) => s + t.profit, 0));
        const net = grossProfit - grossLoss;

        let eq = startBalance, peak = startBalance, maxDD = 0;
        const curve = [{ t: trades.length ? trades[0].time : null, v: startBalance }];
        for (const t of trades) {
            eq += t.profit;
            curve.push({ t: t.time, v: eq });
            if (eq > peak) peak = eq;
            if (peak - eq > maxDD) maxDD = peak - eq;
        }

        let streak = 0, streakWin = null;
        for (let i = n - 1; i >= 0; i--) {
            const w = trades[i].profit > 0;
            if (streakWin === null) { streakWin = w; streak = 1; }
            else if (w === streakWin) streak++;
            else break;
        }

        const rs = trades.map(t => t.r).filter(r => Number.isFinite(r));

        return {
            trades: n,
            wins: wins.length,
            losses: losses.length,
            winRate: n ? (wins.length / n) * 100 : 0,
            grossProfit, grossLoss, net,
            profitFactor: grossLoss > 0 ? grossProfit / grossLoss : (grossProfit > 0 ? Infinity : 0),
            expectancy: n ? net / n : 0,
            avgWin: wins.length ? grossProfit / wins.length : 0,
            avgLoss: losses.length ? grossLoss / losses.length : 0,
            avgR: rs.length ? rs.reduce((s, r) => s + r, 0) / rs.length : null,
            maxDD,
            best: n ? Math.max(...trades.map(t => t.profit)) : 0,
            worst: n ? Math.min(...trades.map(t => t.profit)) : 0,
            streak, streakWin,
            curve
        };
    }

    /* ── Equity curve drawing (plain Canvas2D, no dependency) ───────────── */

    drawEquityCurve(canvas, curve, opts = {}) {
        if (!canvas) return;
        const dpr = window.devicePixelRatio || 1;
        const w = canvas.clientWidth || canvas.parentElement?.clientWidth || 300;
        const h = canvas.clientHeight || 150;
        canvas.width = Math.round(w * dpr);
        canvas.height = Math.round(h * dpr);
        const ctx = canvas.getContext && canvas.getContext('2d');
        if (!ctx) return; // headless / unsupported canvas
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.clearRect(0, 0, w, h);

        const styles = getComputedStyle(document.documentElement);
        const colUp = styles.getPropertyValue('--up').trim() || '#26a69a';
        const colDown = styles.getPropertyValue('--down').trim() || '#ef5350';
        const colGrid = styles.getPropertyValue('--border').trim() || '#2a2e39';
        const colText = styles.getPropertyValue('--text-dim').trim() || '#787b86';

        if (!curve || curve.length < 2) {
            ctx.fillStyle = colText;
            ctx.font = '12px sans-serif';
            ctx.textAlign = 'center';
            ctx.fillText(window.I18N?.t('an.empty') || 'No closed trades yet.', w / 2, h / 2);
            return;
        }

        const values = curve.map(p => p.v);
        let min = Math.min(...values), max = Math.max(...values);
        if (min === max) { min -= 1; max += 1; }
        const padY = (max - min) * 0.08;
        min -= padY; max += padY;

        const padL = 56, padR = 12, padT = 10, padB = 18;
        const iw = w - padL - padR, ih = h - padT - padB;
        const x = (i) => padL + (i / (curve.length - 1)) * iw;
        const y = (v) => padT + (1 - (v - min) / (max - min)) * ih;

        // Horizontal gridlines + value labels
        ctx.strokeStyle = colGrid;
        ctx.fillStyle = colText;
        ctx.font = '10px sans-serif';
        ctx.textAlign = 'right';
        ctx.lineWidth = 1;
        const ticks = 4;
        for (let i = 0; i <= ticks; i++) {
            const v = min + (i / ticks) * (max - min);
            const yy = y(v);
            ctx.globalAlpha = 0.5;
            ctx.beginPath(); ctx.moveTo(padL, yy); ctx.lineTo(w - padR, yy); ctx.stroke();
            ctx.globalAlpha = 1;
            ctx.fillText('$' + Math.round(v).toLocaleString('en-US'), padL - 6, yy + 3);
        }

        const up = curve[curve.length - 1].v >= curve[0].v;
        const line = up ? colUp : colDown;

        // Area fill
        const grad = ctx.createLinearGradient(0, padT, 0, h - padB);
        grad.addColorStop(0, line + '3d');
        grad.addColorStop(1, line + '05');
        ctx.beginPath();
        ctx.moveTo(x(0), y(curve[0].v));
        curve.forEach((p, i) => ctx.lineTo(x(i), y(p.v)));
        ctx.lineTo(x(curve.length - 1), h - padB);
        ctx.lineTo(x(0), h - padB);
        ctx.closePath();
        ctx.fillStyle = grad;
        ctx.fill();

        // Line
        ctx.beginPath();
        curve.forEach((p, i) => i ? ctx.lineTo(x(i), y(p.v)) : ctx.moveTo(x(i), y(p.v)));
        ctx.strokeStyle = line;
        ctx.lineWidth = 1.6;
        ctx.stroke();

        // Start-balance baseline
        const baseY = y(opts.baseline ?? curve[0].v);
        ctx.setLineDash([4, 4]);
        ctx.strokeStyle = colText;
        ctx.lineWidth = 1;
        ctx.globalAlpha = 0.6;
        ctx.beginPath(); ctx.moveTo(padL, baseY); ctx.lineTo(w - padR, baseY); ctx.stroke();
        ctx.setLineDash([]);
        ctx.globalAlpha = 1;
    }

    /* ── Stat cards ─────────────────────────────────────────────────────── */

    _statCards(stats) {
        const t = (k, v) => window.I18N?.t(k, v) ?? k;
        const money = (v) => {
            const el = Number(v || 0);
            const sign = el < 0 ? '-' : '';
            return `${sign}$${Math.abs(el).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
        };
        const cls = (v) => v > 0 ? 'cell-pos' : v < 0 ? 'cell-neg' : '';
        const pf = stats.profitFactor === Infinity ? '∞' : stats.profitFactor.toFixed(2);
        const streakTxt = stats.streak
            ? t(stats.streakWin ? 'an.streakWin' : 'an.streakLoss', { n: stats.streak })
            : '—';
        return [
            ['an.netPL', money(stats.net), cls(stats.net)],
            ['an.trades', String(stats.trades), ''],
            ['an.wins', String(stats.wins), 'cell-pos'],
            ['an.losses', String(stats.losses), 'cell-neg'],
            ['an.winRate', stats.winRate.toFixed(1) + '%', ''],
            ['an.profitFactor', pf, ''],
            ['an.expectancy', money(stats.expectancy), cls(stats.expectancy)],
            ['an.avgWin', money(stats.avgWin), 'cell-pos'],
            ['an.avgLoss', money(stats.avgLoss), 'cell-neg'],
            ['an.avgR', stats.avgR === null ? '—' : stats.avgR.toFixed(2) + 'R', ''],
            ['an.maxDD', money(stats.maxDD), stats.maxDD > 0 ? 'cell-neg' : ''],
            ['an.best', money(stats.best), 'cell-pos'],
            ['an.worst', money(stats.worst), 'cell-neg'],
            ['an.streak', streakTxt, '']
        ];
    }

    _renderStatsGrid(el, stats) {
        if (!el) return;
        el.innerHTML = this._statCards(stats).map(([label, value, cls]) => `
            <div class="an-card">
                <span class="an-card-label">${window.I18N?.t(label) ?? label}</span>
                <b class="an-card-value ${cls}">${value}</b>
            </div>`).join('');
    }

    /* ── Analytics tab ──────────────────────────────────────────────────── */

    render() {
        const view = document.getElementById('analytics-view');
        if (!view || view.style.display === 'none') return;
        const acc = window.tradeManager?.virtualAccount;
        if (!acc) return;
        const stats = this.computeStats(acc.history, START_BALANCE);
        // Append current floating equity as the last curve point
        if (acc.positions?.length && stats.curve.length) {
            const floating = acc.positions.reduce((s, p) => s + (p.profit || 0), 0);
            stats.curve.push({ t: null, v: acc.balance + floating });
        }
        this._renderStatsGrid(document.getElementById('an-stats'), stats);
        this.drawEquityCurve(document.getElementById('eq-canvas'), stats.curve, { baseline: START_BALANCE });
        this.renderSessions();
        this.renderSessionProgress();
    }

    /* ── Session report ─────────────────────────────────────────────────── */

    /** Build a report object for the replay session that just ended. */
    buildSessionReport({ symbol, timeframe, barsReplayed, realMs, newTrades, startBalance }) {
        return {
            id: Date.now(),
            date: Date.now(),
            symbol, timeframe, barsReplayed, realMs,
            startBalance,
            trades: newTrades,
            stats: this.computeStats(newTrades, startBalance)
        };
    }

    /** Show the report modal when the session produced at least one trade. */
    maybeShowSessionReport(report) {
        if (!report || !report.trades.length) return;
        this._pendingReport = report;
        this._showSessionReport(report, true);
    }

    _showSessionReport(report, canSave) {
        const t = (k, v) => window.I18N?.t(k, v) ?? k;
        const stats = this.computeStats(report.trades, report.startBalance);
        report.stats = stats;
        this._activeReport = report;

        const meta = document.getElementById('report-meta');
        if (meta) {
            const mins = Math.max(1, Math.round((report.realMs || 0) / 60000));
            meta.innerHTML = `
                <span>${t('report.symbol')}: <b>${report.symbol} ${report.timeframe}</b></span>
                <span>${t('report.bars')}: <b>${report.barsReplayed}</b></span>
                <span>${t('report.duration')}: <b>${mins} min</b></span>`;
        }
        this._renderStatsGrid(document.getElementById('report-stats'), stats);
        window.openModal('modal-report');
        requestAnimationFrame(() =>
            this.drawEquityCurve(document.getElementById('report-canvas'), stats.curve, { baseline: report.startBalance }));

        const saveBtn = document.getElementById('report-save');
        if (saveBtn) {
            saveBtn.style.display = canSave ? '' : 'none';
            saveBtn.disabled = !canSave;
            saveBtn.textContent = t('report.save');
        }
    }

    async savePendingReport() {
        if (!this._pendingReport) return;
        const saveBtn = document.getElementById('report-save');
        if (saveBtn) {
            saveBtn.disabled = true;
            saveBtn.textContent = window.I18N?.t('report.saving');
        }
        try {
            const saved = await this._saveReport(this._pendingReport);
            this.sessions = [this._toSummary(saved), ...this.sessions.filter(s => s.id !== saved.id)];
            this._pendingReport = null;
            if (saveBtn) saveBtn.textContent = window.I18N?.t('report.saved');
            window.showToast(window.I18N?.t('toast.sessionSaved'), 'success');
            this.renderSessions();
            this.renderSessionProgress();
        } catch (err) {
            console.error('[Analytics] save session failed:', err);
            if (saveBtn) {
                saveBtn.disabled = false;
                saveBtn.textContent = window.I18N?.t('report.save');
            }
            window.showToast(window.I18N?.t('toast.sessionSaveFail', { msg: err.message }), 'error');
        }
    }

    /* ── Persisted replay sessions ──────────────────────────────────────── */

    _loadLegacySessions() {
        try {
            const raw = localStorage.getItem(LEGACY_VIRTUAL_SESSIONS_KEY);
            const arr = raw ? JSON.parse(raw) : [];
            return Array.isArray(arr) ? arr : [];
        } catch (err) {
            console.warn('[Analytics] legacy session data is unreadable:', err);
            return [];
        }
    }

    async loadSessions() {
        try {
            const res = await fetch('/api/sessions?limit=50');
            const result = await res.json();
            if (!res.ok || !result.success) throw new Error(result.message || `HTTP ${res.status}`);
            this.sessions = Array.isArray(result.sessions) ? result.sessions : [];
            await this._migrateLegacySessions();
        } catch (err) {
            console.error('[Analytics] load sessions failed:', err);
            window.showToast(window.I18N?.t('toast.sessionLoadFail', { msg: err.message }), 'error');
        } finally {
            this._sessionsLoaded = true;
            this.renderSessions();
            this.renderSessionProgress();
        }
    }

    async _migrateLegacySessions() {
        const legacy = this._loadLegacySessions();
        if (!legacy.length) return;

        const remaining = [];
        for (const report of legacy) {
            try {
                const saved = await this._saveReport(report);
                this.sessions.push(this._toSummary(saved));
            } catch (err) {
                console.warn('[Analytics] legacy session migration failed:', err);
                remaining.push(report);
            }
        }
        if (remaining.length) {
            localStorage.setItem(LEGACY_VIRTUAL_SESSIONS_KEY, JSON.stringify(remaining));
            window.showToast(window.I18N?.t('toast.sessionMigrationFail', { n: remaining.length }), 'error');
        } else {
            localStorage.removeItem(LEGACY_VIRTUAL_SESSIONS_KEY);
        }
        this.sessions.sort((a, b) => b.date - a.date);
    }

    async _saveReport(report) {
        const res = await fetch('/api/session/save', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(report)
        });
        const result = await res.json();
        if (!res.ok || !result.success || !result.session) {
            throw new Error(result.message || `HTTP ${res.status}`);
        }
        return result.session;
    }

    _toSummary(report) {
        const stats = report.stats || this.computeStats(report.trades, report.startBalance);
        return {
            id: report.id,
            date: report.date,
            symbol: report.symbol,
            timeframe: report.timeframe,
            barsReplayed: report.barsReplayed,
            realMs: report.realMs,
            startBalance: report.startBalance,
            stats: {
                trades: stats.trades,
                net: stats.net,
                winRate: stats.winRate
            }
        };
    }

    async openSession(id) {
        try {
            const res = await fetch(`/api/sessions/${encodeURIComponent(id)}`);
            const result = await res.json();
            if (!res.ok || !result.success || !result.session) {
                throw new Error(result.message || `HTTP ${res.status}`);
            }
            this._pendingReport = null;
            this._showSessionReport(result.session, false);
        } catch (err) {
            console.error('[Analytics] load session detail failed:', err);
            window.showToast(window.I18N?.t('toast.sessionOpenFail', { msg: err.message }), 'error');
        }
    }

    async deleteSession(id) {
        try {
            const res = await fetch(`/api/sessions/${encodeURIComponent(id)}`, { method: 'DELETE' });
            const result = await res.json();
            if (!res.ok || !result.success) throw new Error(result.message || `HTTP ${res.status}`);
            this.sessions = this.sessions.filter(s => s.id !== id);
            this.renderSessions();
            this.renderSessionProgress();
        } catch (err) {
            console.error('[Analytics] delete session failed:', err);
            window.showToast(window.I18N?.t('toast.sessionDeleteFail', { msg: err.message }), 'error');
        }
    }

    exportPendingReportCsv() {
        if (this._activeReport) this._exportReportCsv(this._activeReport);
    }

    exportReportPng() {
        const report = this._activeReport;
        if (!report) return;
        const canvas = document.createElement('canvas');
        if (typeof canvas.toBlob !== 'function') {
            window.showToast(window.I18N?.t('toast.reportExportFail'), 'error');
            return;
        }
        try {
            const width = 1200;
            const height = 760;
            const styles = getComputedStyle(document.documentElement);
            const background = styles.getPropertyValue('--bg-panel').trim() || '#1e222d';
            const surface = styles.getPropertyValue('--bg-panel-alt').trim() || '#171b26';
            const border = styles.getPropertyValue('--border').trim() || '#2a2e39';
            const text = styles.getPropertyValue('--text-bright').trim() || '#eceff5';
            const dim = styles.getPropertyValue('--text-dim').trim() || '#787b86';
            const accent = styles.getPropertyValue('--accent').trim() || '#2962ff';
            const stats = this.computeStats(report.trades, report.startBalance);
            const source = document.getElementById('report-canvas');
            const cards = this._statCards(stats);

            canvas.width = width;
            canvas.height = height;
            const ctx = canvas.getContext('2d');
            if (!ctx) throw new Error('Canvas is unavailable');

            ctx.fillStyle = background;
            ctx.fillRect(0, 0, width, height);
            ctx.fillStyle = accent;
            ctx.fillRect(0, 0, width, 6);
            ctx.fillStyle = text;
            ctx.font = '700 30px sans-serif';
            ctx.fillText(window.I18N?.t('report.title') || 'Session Report', 48, 58);
            ctx.fillStyle = dim;
            ctx.font = '16px sans-serif';
            const minutes = Math.max(1, Math.round((report.realMs || 0) / 60000));
            ctx.fillText(`${report.symbol} ${report.timeframe}  •  ${report.barsReplayed} bars  •  ${minutes} min`, 48, 88);
            ctx.fillText(new Date(report.date || Date.now()).toLocaleString(window.I18N?.dateLocale() || 'en-GB'), 48, 112);

            ctx.fillStyle = surface;
            ctx.fillRect(48, 140, 1104, 260);
            if (source?.width && source?.height) {
                ctx.drawImage(source, 48, 140, 1104, 260);
            } else {
                ctx.fillStyle = dim;
                ctx.font = '16px sans-serif';
                ctx.fillText(window.I18N?.t('an.empty') || 'No closed trades yet.', 72, 270);
            }

            const columns = 5;
            const cardWidth = 208;
            const cardHeight = 94;
            cards.forEach(([label, value, className], index) => {
                const x = 48 + (index % columns) * (cardWidth + 16);
                const y = 424 + Math.floor(index / columns) * (cardHeight + 16);
                ctx.fillStyle = surface;
                ctx.fillRect(x, y, cardWidth, cardHeight);
                ctx.strokeStyle = border;
                ctx.strokeRect(x + 0.5, y + 0.5, cardWidth - 1, cardHeight - 1);
                ctx.fillStyle = dim;
                ctx.font = '600 13px sans-serif';
                ctx.fillText(window.I18N?.t(label) || label, x + 14, y + 28);
                ctx.fillStyle = className === 'cell-pos'
                    ? (styles.getPropertyValue('--up').trim() || '#26a69a')
                    : className === 'cell-neg'
                        ? (styles.getPropertyValue('--down').trim() || '#ef5350')
                        : text;
                ctx.font = '700 19px monospace';
                ctx.fillText(String(value), x + 14, y + 62);
            });

            canvas.toBlob(blob => {
                if (!blob) {
                    window.showToast(window.I18N?.t('toast.reportExportFail'), 'error');
                    return;
                }
                this._downloadBlob(blob, this._reportFilename('png', report));
            }, 'image/png');
        } catch (err) {
            console.error('[Analytics] PNG export failed:', err);
            window.showToast(window.I18N?.t('toast.reportExportFail'), 'error');
        }
    }

    _exportReportCsv(report) {
        const stats = this.computeStats(report.trades, report.startBalance);
        const rows = [
            ['Session Report'],
            ['Symbol', report.symbol],
            ['Timeframe', report.timeframe],
            ['Saved at', new Date(report.date || Date.now()).toISOString()],
            ['Bars replayed', report.barsReplayed],
            ['Duration (ms)', report.realMs],
            ['Start balance', report.startBalance],
            ['Net P/L', stats.net],
            ['Win rate (%)', stats.winRate.toFixed(2)],
            [],
            ['Close time', 'Open time', 'Ticket', 'Symbol', 'Side', 'Volume', 'Entry price', 'Exit price', 'P/L', 'R', 'Result'],
            ...report.trades.map(trade => [
                new Date(trade.time * 1000).toISOString(),
                new Date(trade.time_open * 1000).toISOString(),
                trade.ticket,
                trade.symbol,
                trade.type,
                trade.volume,
                trade.price_open,
                trade.price_close,
                trade.profit,
                trade.r ?? '',
                trade.result
            ])
        ];
        const csv = rows.map(row => row.map(this._csvCell).join(',')).join('\r\n');
        this._downloadBlob(new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8' }), this._reportFilename('csv', report));
    }

    _csvCell(value) {
        let text = String(value ?? '');
        if (/^[=+\-@]/.test(text)) text = `'${text}`;
        return `"${text.replaceAll('"', '""')}"`;
    }

    _reportFilename(extension, report = this._activeReport) {
        const symbol = String(report?.symbol || 'session').replace(/[^A-Za-z0-9_-]/g, '_');
        const timeframe = String(report?.timeframe || '').replace(/[^A-Za-z0-9_-]/g, '_');
        const date = new Date(report?.date || Date.now()).toISOString().slice(0, 10);
        return `backtest-${symbol}${timeframe ? '-' + timeframe : ''}-${date}.${extension}`;
    }

    _downloadBlob(blob, filename) {
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = filename;
        document.body.appendChild(link);
        link.click();
        link.remove();
        setTimeout(() => URL.revokeObjectURL(url), 0);
    }

    renderSessionProgress() {
        const el = document.getElementById('an-progress');
        if (!el) return;
        if (!this.sessions.length) {
            el.innerHTML = `<p class="an-empty-note">${window.I18N?.t('an.noProgress') || 'Save sessions to compare your progress.'}</p>`;
            return;
        }
        const recent = this.sessions[0];
        const prior = this.sessions.slice(1);
        const average = this.sessions.reduce((sum, session) => sum + Number(session.stats?.net || 0), 0) / this.sessions.length;
        const priorAverage = prior.length
            ? prior.reduce((sum, session) => sum + Number(session.stats?.net || 0), 0) / prior.length
            : null;
        const best = this.sessions.reduce((current, session) =>
            Number(session.stats?.net || 0) > Number(current.stats?.net || 0) ? session : current, recent);
        const recentNet = Number(recent.stats?.net || 0);
        const comparison = priorAverage === null ? '—' : this._money(recentNet - priorAverage);
        const cards = [
            ['an.sessionsCompleted', this.sessions.length, ''],
            ['an.avgSession', this._money(average), this._moneyClass(average)],
            ['an.bestSession', this._money(Number(best.stats?.net || 0)), this._moneyClass(Number(best.stats?.net || 0))],
            ['an.recentVsAvg', comparison, priorAverage === null ? '' : this._moneyClass(recentNet - priorAverage)]
        ];
        el.innerHTML = cards.map(([label, value, cls]) => `
            <div class="an-card">
                <span class="an-card-label">${window.I18N?.t(label) ?? label}</span>
                <b class="an-card-value ${cls}">${value}</b>
            </div>`).join('');
    }

    _money(value) {
        const number = Number(value || 0);
        const sign = number < 0 ? '-' : '';
        return `${sign}$${Math.abs(number).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    }

    _moneyClass(value) {
        return value > 0 ? 'cell-pos' : value < 0 ? 'cell-neg' : '';
    }

    /* ── Saved sessions list ────────────────────────────────────────────── */

    renderSessions() {
        const el = document.getElementById('an-sessions');
        if (!el) return;
        const t = (k, v) => window.I18N?.t(k, v) ?? k;
        if (!this._sessionsLoaded) {
            el.innerHTML = `<p class="an-empty-note">${t('an.loadingSessions')}</p>`;
            return;
        }
        el.innerHTML = this.sessions.length ? this.sessions.map(s => {
            const net = s.stats?.net ?? 0;
            const cls = net >= 0 ? 'cell-pos' : 'cell-neg';
            const when = new Date(s.date).toLocaleString(window.I18N?.dateLocale() || 'en-GB',
                { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
            const sign = net < 0 ? '-' : '';
            return `<div class="an-session-row">
                <span class="sess-when">${when}</span>
                <span class="sess-sym">${s.symbol} ${s.timeframe}</span>
                <span>${s.stats?.trades ?? 0} ${t('an.trades').toLowerCase()}</span>
                <span>WR ${(s.stats?.winRate ?? 0).toFixed(0)}%</span>
                <b class="${cls}">${sign}$${Math.abs(net).toFixed(2)}</b>
                <button class="pb-mini-btn" data-open-session="${s.id}">${t('an.open')}</button>
                <button class="pb-mini-btn" data-export-session="${s.id}">CSV</button>
                <button class="pb-mini-btn danger" data-del-session="${s.id}">${t('misc.delete')}</button>
            </div>`;
        }).join('') : `<p class="an-empty-note">${t('an.noSessions')}</p>`;
        el.querySelectorAll('[data-open-session]').forEach(btn =>
            btn.addEventListener('click', () => this.openSession(Number(btn.dataset.openSession))));
        el.querySelectorAll('[data-export-session]').forEach(btn =>
            btn.addEventListener('click', async () => {
                const id = Number(btn.dataset.exportSession);
                try {
                    const res = await fetch(`/api/sessions/${encodeURIComponent(id)}`);
                    const result = await res.json();
                    if (!res.ok || !result.success || !result.session) {
                        throw new Error(result.message || `HTTP ${res.status}`);
                    }
                    this._exportReportCsv(result.session);
                } catch (err) {
                    console.error('[Analytics] export session failed:', err);
                    window.showToast(window.I18N?.t('toast.sessionOpenFail', { msg: err.message }), 'error');
                }
            }));
        el.querySelectorAll('[data-del-session]').forEach(btn =>
            btn.addEventListener('click', () => this.deleteSession(Number(btn.dataset.delSession))));
    }
}

window.analytics = new Analytics();
