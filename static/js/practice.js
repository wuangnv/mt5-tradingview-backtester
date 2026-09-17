(() => {
    const state = {
        selected: null,
        context: null,
        journal: null,
    };

    const els = {
        refresh: document.getElementById('pr-refresh'),
        sourceList: document.getElementById('pr-source-list'),
        title: document.getElementById('pr-trade-title'),
        subtitle: document.getElementById('pr-trade-subtitle'),
        prev: document.getElementById('pr-prev'),
        next: document.getElementById('pr-next'),
        cursor: document.getElementById('pr-cursor'),
        error: document.getElementById('pr-error'),
        chart: document.getElementById('pr-chart'),
        chartEmpty: document.getElementById('pr-chart-empty'),
        side: document.getElementById('pr-side'),
        entry: document.getElementById('pr-entry'),
        exit: document.getElementById('pr-exit'),
        pnl: document.getElementById('pr-pnl'),
        sourceId: document.getElementById('pr-source-id'),
        form: document.getElementById('pr-journal-form'),
        intendedEntry: document.getElementById('pr-intended-entry'),
        intendedStop: document.getElementById('pr-intended-stop'),
        intendedTarget: document.getElementById('pr-intended-target'),
        grade: document.getElementById('pr-grade'),
        checkEntry: document.getElementById('pr-check-entry'),
        checkRisk: document.getElementById('pr-check-risk'),
        checkExit: document.getElementById('pr-check-exit'),
        notes: document.getElementById('pr-notes'),
        save: document.getElementById('pr-save'),
        revision: document.getElementById('pr-revision'),
        fillSummary: document.getElementById('pr-fill-summary'),
        journalSource: document.getElementById('pr-journal-source'),
    };

    async function requestJson(url, options = {}) {
        const response = await fetch(url, {
            ...options,
            headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
        });
        const body = await response.json().catch(() => null);
        if (!response.ok) throw new Error(body?.error?.message || `Request failed (${response.status})`);
        return body;
    }

    function showError(error) {
        els.error.hidden = false;
        els.error.textContent = error instanceof Error ? error.message : String(error);
    }

    function clearError() {
        els.error.hidden = true;
        els.error.textContent = '';
    }

    function numberOrNull(input) {
        const text = input.value.trim();
        if (!text) return null;
        const value = Number(text);
        if (!Number.isFinite(value)) throw new Error(`${input.name || 'value'} must be a number`);
        return value;
    }

    function formatTime(ms) {
        if (!Number.isFinite(Number(ms))) return '-';
        return new Date(Number(ms)).toLocaleString('en-GB', {
            year: 'numeric', month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit',
            timeZone: 'UTC',
        }) + ' UTC';
    }

    function formatPrice(value) {
        return value == null ? '-' : Number(value).toFixed(5);
    }

    async function loadSources() {
        clearError();
        els.sourceList.textContent = 'Loading...';
        try {
            const body = await requestJson('/api/runs?limit=30');
            const groups = [];
            for (const run of body.runs || []) {
                const ledger = await requestJson(`/api/runs/${encodeURIComponent(run.run_id)}/ledger`);
                groups.push({ run, trades: ledger.trades || [] });
            }
            renderSources(groups);
        } catch (error) {
            els.sourceList.textContent = '';
            showError(error);
        }
    }

    function renderSources(groups) {
        els.sourceList.textContent = '';
        if (!groups.length) {
            els.sourceList.textContent = 'No evidence runs.';
            return;
        }
        for (const group of groups) {
            const wrapper = document.createElement('div');
            wrapper.className = 'pr-source-group';
            const heading = document.createElement('div');
            heading.className = 'pr-source-run';
            heading.textContent = `Run ${group.run.run_id} · ${group.run.data?.symbol || '?'} ${group.run.data?.timeframe || '?'}`;
            wrapper.appendChild(heading);
            for (const trade of group.trades) {
                const button = document.createElement('button');
                button.type = 'button';
                button.className = 'pr-trade-button';
                button.dataset.runId = group.run.run_id;
                button.dataset.tradeId = trade.trade_id;
                const id = document.createElement('strong');
                id.textContent = `#${trade.trade_id}`;
                const side = document.createElement('span');
                side.textContent = trade.side;
                const meta = document.createElement('span');
                meta.className = 'meta';
                meta.textContent = `${trade.open_time_utc} · ${formatPrice(trade.price_open)}`;
                button.append(id, side, meta);
                button.addEventListener('click', () => selectTrade(group.run.run_id, trade.trade_id, button));
                wrapper.appendChild(button);
            }
            els.sourceList.appendChild(wrapper);
        }
    }

    async function selectTrade(runId, tradeId, button) {
        clearError();
        state.selected = { runId: String(runId), tradeId: String(tradeId) };
        document.querySelectorAll('.pr-trade-button.active').forEach(node => node.classList.remove('active'));
        button?.classList.add('active');
        await loadContext();
    }

    async function loadContext(cursorMs = null) {
        if (!state.selected) return;
        clearError();
        try {
            const query = cursorMs == null ? '' : `?cursor_ms=${encodeURIComponent(cursorMs)}`;
            const { runId, tradeId } = state.selected;
            const body = await requestJson(`/api/practice/runs/${encodeURIComponent(runId)}/trades/${encodeURIComponent(tradeId)}/context${query}`);
            state.context = body.context;
            state.journal = body.context.journal || null;
            renderContext();
        } catch (error) {
            showError(error);
        }
    }

    function renderContext() {
        const context = state.context;
        const trade = context.trade;
        els.title.textContent = `Run ${context.source.evidence_run_id} / Trade ${trade.trade_id}`;
        els.subtitle.textContent = `${trade.symbol} ${trade.timeframe} · open ${trade.open_time_utc}`;
        els.cursor.textContent = formatTime(context.replay.cursor_ms);
        els.prev.disabled = context.replay.previous_cursor_ms == null;
        els.next.disabled = context.replay.next_cursor_ms == null;
        els.side.textContent = `${trade.side} ${trade.quantity}`;
        els.entry.textContent = formatPrice(trade.price_open);
        els.exit.textContent = trade.outcome_revealed ? formatPrice(trade.price_close) : 'hidden';
        els.pnl.textContent = trade.outcome_revealed ? Number(trade.net_pnl).toFixed(2) : 'hidden';
        els.sourceId.textContent = context.history.source_id;
        els.save.disabled = false;
        els.chartEmpty.hidden = Boolean(context.bars?.length);
        renderJournal(state.journal);
        drawChart(context);
    }

    function renderJournal(entry) {
        if (!entry) {
            els.intendedEntry.value = '';
            els.intendedStop.value = '';
            els.intendedTarget.value = '';
            els.grade.value = 'unclear';
            els.checkEntry.checked = false;
            els.checkRisk.checked = false;
            els.checkExit.checked = false;
            els.notes.value = '';
            els.revision.textContent = 'No entry';
            els.fillSummary.textContent = '-';
            els.journalSource.textContent = '-';
            return;
        }
        const review = entry.review;
        els.intendedEntry.value = review.intended_entry ?? '';
        els.intendedStop.value = review.intended_stop ?? '';
        els.intendedTarget.value = review.intended_target ?? '';
        els.grade.value = review.execution_grade || 'unclear';
        els.checkEntry.checked = Boolean(review.rule_checks?.entry);
        els.checkRisk.checked = Boolean(review.rule_checks?.risk);
        els.checkExit.checked = Boolean(review.rule_checks?.exit);
        els.notes.value = review.notes || '';
        els.revision.textContent = `Revision ${review.revision}`;
        const exit = entry.fill.exit == null ? 'hidden' : formatPrice(entry.fill.exit);
        els.fillSummary.textContent = `${entry.fill.side} ${entry.fill.quantity} @ ${formatPrice(entry.fill.entry)} -> ${exit}`;
        els.journalSource.textContent = `${entry.source.evidence_run_id}/${entry.source.trade_id}`;
    }

    function drawChart(context) {
        const canvas = els.chart;
        const rect = canvas.getBoundingClientRect();
        const width = Math.max(320, Math.floor(rect.width));
        const height = Math.max(260, Math.floor(rect.height));
        const ratio = window.devicePixelRatio || 1;
        canvas.width = Math.floor(width * ratio);
        canvas.height = Math.floor(height * ratio);
        const ctx = canvas.getContext('2d');
        ctx.scale(ratio, ratio);
        ctx.clearRect(0, 0, width, height);
        const bars = context.bars || [];
        if (!bars.length) return;

        const css = getComputedStyle(document.documentElement);
        const up = css.getPropertyValue('--up').trim() || '#26a69a';
        const down = css.getPropertyValue('--down').trim() || '#ef5350';
        const border = css.getPropertyValue('--border').trim() || '#2a2e39';
        const dim = css.getPropertyValue('--text-dim').trim() || '#787b86';
        const accent = css.getPropertyValue('--accent').trim() || '#2962ff';
        const pad = { left: 10, right: 64, top: 14, bottom: 24 };
        const plotW = width - pad.left - pad.right;
        const plotH = height - pad.top - pad.bottom;
        const lows = bars.map(bar => bar.low);
        const highs = bars.map(bar => bar.high);
        const intended = [numberOrNull(els.intendedEntry), numberOrNull(els.intendedStop), numberOrNull(els.intendedTarget)].filter(v => v != null);
        const allLow = Math.min(...lows, context.trade.price_open, ...intended);
        const allHigh = Math.max(...highs, context.trade.price_open, ...intended);
        const span = Math.max(allHigh - allLow, Math.abs(allHigh || 1) * 0.0001);
        const min = allLow - span * 0.06;
        const max = allHigh + span * 0.06;
        const y = price => pad.top + ((max - price) / (max - min)) * plotH;

        ctx.strokeStyle = border;
        ctx.lineWidth = 1;
        for (let i = 0; i <= 4; i += 1) {
            const gy = pad.top + (plotH * i) / 4;
            ctx.beginPath();
            ctx.moveTo(pad.left, gy);
            ctx.lineTo(width - pad.right, gy);
            ctx.stroke();
            const price = max - ((max - min) * i) / 4;
            ctx.fillStyle = dim;
            ctx.font = '10px monospace';
            ctx.fillText(price.toFixed(5), width - pad.right + 6, gy + 3);
        }

        const step = plotW / Math.max(1, bars.length);
        const bodyW = Math.max(2, Math.min(9, step * 0.58));
        bars.forEach((bar, index) => {
            const x = pad.left + step * index + step / 2;
            const rising = bar.close >= bar.open;
            ctx.strokeStyle = rising ? up : down;
            ctx.fillStyle = rising ? up : down;
            ctx.beginPath();
            ctx.moveTo(x, y(bar.high));
            ctx.lineTo(x, y(bar.low));
            ctx.stroke();
            const top = Math.min(y(bar.open), y(bar.close));
            const bodyH = Math.max(1, Math.abs(y(bar.close) - y(bar.open)));
            ctx.fillRect(x - bodyW / 2, top, bodyW, bodyH);
        });

        function priceLine(price, label, color, dashed) {
            if (price == null || !Number.isFinite(Number(price))) return;
            ctx.save();
            ctx.strokeStyle = color;
            ctx.fillStyle = color;
            ctx.lineWidth = 1;
            if (dashed) ctx.setLineDash([4, 4]);
            const py = y(Number(price));
            ctx.beginPath();
            ctx.moveTo(pad.left, py);
            ctx.lineTo(width - pad.right, py);
            ctx.stroke();
            ctx.font = '10px monospace';
            ctx.fillText(`${label} ${Number(price).toFixed(5)}`, pad.left + 4, Math.max(11, py - 4));
            ctx.restore();
        }

        priceLine(context.trade.price_open, 'fill', accent, false);
        priceLine(numberOrNull(els.intendedEntry), 'entry', dim, true);
        priceLine(numberOrNull(els.intendedStop), 'stop', down, true);
        priceLine(numberOrNull(els.intendedTarget), 'target', up, true);
    }

    async function saveJournal(event) {
        event.preventDefault();
        if (!state.selected || !state.context) return;
        clearError();
        try {
            const payload = {
                cursor_ms: state.context.replay.cursor_ms,
                intended_entry: numberOrNull(els.intendedEntry),
                intended_stop: numberOrNull(els.intendedStop),
                intended_target: numberOrNull(els.intendedTarget),
                execution_grade: els.grade.value,
                rule_checks: {
                    entry: els.checkEntry.checked,
                    risk: els.checkRisk.checked,
                    exit: els.checkExit.checked,
                },
                notes: els.notes.value,
            };
            let body;
            if (state.journal) {
                body = await requestJson(`/api/practice/journal/${encodeURIComponent(state.journal.id)}`, {
                    method: 'PATCH', body: JSON.stringify(payload),
                });
            } else {
                const { runId, tradeId } = state.selected;
                body = await requestJson(`/api/practice/runs/${encodeURIComponent(runId)}/trades/${encodeURIComponent(tradeId)}/journal`, {
                    method: 'POST', body: JSON.stringify(payload),
                });
            }
            state.journal = body.entry;
            renderJournal(state.journal);
            drawChart(state.context);
        } catch (error) {
            showError(error);
        }
    }

    els.refresh.addEventListener('click', loadSources);
    els.prev.addEventListener('click', () => loadContext(state.context?.replay?.previous_cursor_ms));
    els.next.addEventListener('click', () => loadContext(state.context?.replay?.next_cursor_ms));
    els.form.addEventListener('submit', saveJournal);
    [els.intendedEntry, els.intendedStop, els.intendedTarget].forEach(input => {
        input.addEventListener('input', () => {
            if (state.context) {
                try { drawChart(state.context); } catch (error) { showError(error); }
            }
        });
    });
    window.addEventListener('resize', () => { if (state.context) drawChart(state.context); });
    loadSources();
})();
