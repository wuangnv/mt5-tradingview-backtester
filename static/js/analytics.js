/**
 * analytics.js — data storytelling for replay practice.
 * Computes statistics from virtual-account trades and renders:
 *   - the Analytics tab in the bottom panel (equity curve + stat cards
 *     + saved sessions list)
 *   - the Session Report modal shown when a replay session ends
 * Sessions can be saved to localStorage ('virtual_sessions_v1').
 */

const VIRTUAL_SESSIONS_KEY = 'virtual_sessions_v1';
const START_BALANCE = 10000;

class Analytics {
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
        const t = (k, v) => window.I18N?.t(k, v) ?? k;

        const meta = document.getElementById('report-meta');
        if (meta) {
            const mins = Math.max(1, Math.round((report.realMs || 0) / 60000));
            meta.innerHTML = `
                <span>${t('report.symbol')}: <b>${report.symbol} ${report.timeframe}</b></span>
                <span>${t('report.bars')}: <b>${report.barsReplayed}</b></span>
                <span>${t('report.duration')}: <b>${mins} min</b></span>`;
        }
        this._renderStatsGrid(document.getElementById('report-stats'), report.stats);
        window.openModal('modal-report');
        // Canvas needs the modal visible to have a size
        requestAnimationFrame(() =>
            this.drawEquityCurve(document.getElementById('report-canvas'), report.stats.curve, { baseline: report.startBalance }));

        const saveBtn = document.getElementById('report-save');
        if (saveBtn) {
            saveBtn.disabled = false;
            saveBtn.textContent = t('report.save');
        }
    }

    savePendingReport() {
        if (!this._pendingReport) return;
        const sessions = this._loadSessions();
        sessions.unshift(this._pendingReport);
        while (sessions.length > 50) sessions.pop();
        try { localStorage.setItem(VIRTUAL_SESSIONS_KEY, JSON.stringify(sessions)); } catch (err) { /* quota */ }
        this._pendingReport = null;
        const saveBtn = document.getElementById('report-save');
        if (saveBtn) { saveBtn.disabled = true; saveBtn.textContent = window.I18N?.t('report.saved'); }
        window.showToast(window.I18N?.t('toast.sessionSaved'), 'success');
        this.renderSessions();
    }

    /* ── Saved sessions list ────────────────────────────────────────────── */

    _loadSessions() {
        try {
            const raw = localStorage.getItem(VIRTUAL_SESSIONS_KEY);
            const arr = raw ? JSON.parse(raw) : [];
            return Array.isArray(arr) ? arr : [];
        } catch (err) { return []; }
    }

    deleteSession(id) {
        const sessions = this._loadSessions().filter(s => s.id !== id);
        localStorage.setItem(VIRTUAL_SESSIONS_KEY, JSON.stringify(sessions));
        this.renderSessions();
    }

    renderSessions() {
        const el = document.getElementById('an-sessions');
        if (!el) return;
        const t = (k, v) => window.I18N?.t(k, v) ?? k;
        const sessions = this._loadSessions();
        el.innerHTML = sessions.length ? sessions.map(s => {
            const net = s.stats?.net ?? 0;
            const cls = net >= 0 ? 'cell-pos' : 'cell-neg';
            const when = new Date(s.date).toLocaleString(window.I18N?.dateLocale() || 'en-GB',
                { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
            const sign = net < 0 ? '-' : '';
            return `<div class="an-session-row">
                <span class="sess-when">${when}</span>
                <span class="sess-sym">${s.symbol} ${s.timeframe}</span>
                <span>${s.stats?.trades ?? s.trades.length} ${t('an.trades').toLowerCase()}</span>
                <span>WR ${(s.stats?.winRate ?? 0).toFixed(0)}%</span>
                <b class="${cls}">${sign}$${Math.abs(net).toFixed(2)}</b>
                <button class="pb-mini-btn danger" data-del-session="${s.id}">${t('misc.delete')}</button>
            </div>`;
        }).join('') : `<p class="an-empty-note">${t('an.noSessions')}</p>`;
        el.querySelectorAll('[data-del-session]').forEach(btn =>
            btn.addEventListener('click', () => this.deleteSession(Number(btn.dataset.delSession))));
    }
}

window.analytics = new Analytics();
