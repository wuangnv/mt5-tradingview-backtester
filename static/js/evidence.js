(function () {
    'use strict';

    const initialQuery = new URLSearchParams(window.location.search);
    const state = { runs: [], activeRunId: initialQuery.get('run'), analytics: null };
    const el = id => document.getElementById(id);

    function analyticsParams() {
        const params = new URLSearchParams();
        const side = el('ev-filter-side').value;
        const outcome = el('ev-filter-outcome').value;
        if (side !== 'all') params.set('side', side);
        if (outcome !== 'all') params.set('outcome', outcome);
        return params;
    }

    function syncUrl() {
        const url = new URL(window.location.href);
        if (state.activeRunId) url.searchParams.set('run', state.activeRunId);
        else url.searchParams.delete('run');
        for (const key of ['side', 'outcome']) url.searchParams.delete(key);
        for (const [key, value] of analyticsParams()) url.searchParams.set(key, value);
        window.history.replaceState(null, '', url);
    }

    function practiceHref(tradeId = null) {
        const params = analyticsParams();
        params.set('run', state.activeRunId);
        if (tradeId != null) params.set('trade', tradeId);
        return `/practice?${params.toString()}`;
    }

    function fmt(value, digits = 2) {
        if (value === null || value === undefined || value === '') return 'unknown';
        if (typeof value === 'number') return value.toLocaleString(undefined, { maximumFractionDigits: digits });
        return String(value);
    }

    function pct(value) {
        return value === null || value === undefined ? 'unknown' : `${fmt(value, 2)}%`;
    }

    async function api(path) {
        const response = await fetch(path, { headers: { Accept: 'application/json' } });
        const body = await response.json().catch(() => null);
        if (!response.ok || !body?.success) {
            throw new Error(body?.error?.message || `Request failed (${response.status})`);
        }
        return body;
    }

    function renderError(message) {
        el('ev-empty').hidden = false;
        el('ev-detail').hidden = true;
        el('ev-empty').textContent = message;
    }

    function renderRuns() {
        const root = el('ev-run-list');
        root.replaceChildren();
        if (!state.runs.length) {
            root.textContent = 'No persisted runs found.';
            return;
        }
        for (const run of state.runs) {
            const button = document.createElement('button');
            button.type = 'button';
            button.className = `ev-run${run.run_id === state.activeRunId ? ' active' : ''}`;
            const id = document.createElement('span');
            id.className = 'ev-run-id';
            id.textContent = `Run ${fmt(run.run_id)}`;
            const date = document.createElement('span');
            date.className = 'ev-run-date';
            date.textContent = fmt(run.created_at_utc);
            const meta = document.createElement('span');
            meta.className = 'ev-run-meta';
            meta.textContent = `${fmt(run.data?.symbol)} ${fmt(run.data?.timeframe)} · ${fmt(run.data?.bars_replayed, 0)} bars`;
            button.append(id, date, meta);
            button.addEventListener('click', () => selectRun(run.run_id));
            root.appendChild(button);
        }
    }

    function metric(label, value, definition = null) {
        const node = document.createElement('div');
        node.className = 'ev-metric';
        if (definition) {
            node.title = `${definition.question}\nFormula: ${definition.formula}\nUnit: ${definition.unit}\nSource: ${definition.source}\nVersion: ${definition.version}`;
        }
        const labelNode = document.createElement('span');
        labelNode.className = 'ev-metric-label';
        labelNode.textContent = label;
        const valueNode = document.createElement('span');
        valueNode.className = 'ev-metric-value';
        valueNode.textContent = value;
        node.append(labelNode, valueNode);
        return node;
    }

    function renderMetrics(metrics) {
        const root = el('ev-metrics');
        const definition = key => metrics.definitions?.[key] || null;
        root.replaceChildren(
            metric('Closed trades (N)', fmt(metrics.closed_trade_count, 0), definition('closed_trade_count')),
            metric('Win rate', pct(metrics.win_rate_pct), definition('win_rate_pct')),
            metric('Net P/L', fmt(metrics.net_pnl), definition('net_pnl')),
            metric('Profit factor', fmt(metrics.profit_factor_after_cost), definition('profit_factor_after_cost')),
            metric('Payoff ratio', fmt(metrics.payoff_ratio_after_cost), definition('payoff_ratio_after_cost')),
            metric('Expectancy', fmt(metrics.expectancy_net_per_trade), definition('expectancy_net_per_trade')),
            metric('Average R', fmt(metrics.average_realized_r), definition('average_realized_r')),
            metric('Closed-balance DD', fmt(metrics.closed_trade_balance_max_drawdown), definition('closed_trade_balance_max_drawdown')),
            metric('Closed-balance DD %', pct(metrics.closed_trade_balance_max_drawdown_pct), definition('closed_trade_balance_max_drawdown_pct')),
            metric('Loss streak', fmt(metrics.max_loss_streak, 0), definition('max_loss_streak')),
            metric('Start balance', fmt(metrics.starting_balance), definition('starting_balance')),
            metric('End closed balance', fmt(metrics.ending_closed_trade_balance), definition('ending_closed_trade_balance')),
            metric('Metric schema', fmt(metrics.metric_schema_version))
        );
        el('ev-metric-basis').textContent = `costs: ${metrics.basis.costs} · R: ${metrics.basis.realized_r} · DD: closed-trade balance only`;
    }

    function renderLine(canvasId, curve, field) {
        const canvas = el(canvasId);
        const ratio = window.devicePixelRatio || 1;
        const width = Math.max(320, canvas.clientWidth || 800);
        const height = Number(canvas.getAttribute('height')) || 180;
        canvas.width = Math.round(width * ratio);
        canvas.height = Math.round(height * ratio);
        const ctx = canvas.getContext('2d');
        ctx.scale(ratio, ratio);
        ctx.clearRect(0, 0, width, height);
        if (!Array.isArray(curve) || curve.length < 2) return;

        const values = curve.map(point => Number(point[field])).filter(Number.isFinite);
        if (values.length < 2) return;
        let low = Math.min(...values);
        let high = Math.max(...values);
        if (low === high) { low -= 1; high += 1; }
        const pad = 16;
        const x = index => pad + (index / (values.length - 1)) * (width - pad * 2);
        const y = value => pad + (high - value) / (high - low) * (height - pad * 2);

        const styles = getComputedStyle(document.documentElement);
        ctx.strokeStyle = styles.getPropertyValue('--border-light').trim();
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(pad, height - pad);
        ctx.lineTo(width - pad, height - pad);
        ctx.stroke();

        ctx.strokeStyle = styles.getPropertyValue('--accent').trim();
        ctx.lineWidth = 2;
        ctx.beginPath();
        values.forEach((value, index) => {
            if (index === 0) ctx.moveTo(x(index), y(value));
            else ctx.lineTo(x(index), y(value));
        });
        ctx.stroke();
    }

    function renderHistogram(values) {
        const canvas = el('ev-r-histogram');
        const unavailable = el('ev-r-unavailable');
        const ratio = window.devicePixelRatio || 1;
        const width = Math.max(320, canvas.clientWidth || 520);
        const height = Number(canvas.getAttribute('height')) || 160;
        canvas.width = Math.round(width * ratio);
        canvas.height = Math.round(height * ratio);
        const ctx = canvas.getContext('2d');
        ctx.scale(ratio, ratio);
        ctx.clearRect(0, 0, width, height);
        unavailable.hidden = Array.isArray(values) && values.length > 0;
        if (!Array.isArray(values) || !values.length) return;

        const finite = values.map(Number).filter(Number.isFinite);
        if (!finite.length) return;
        let low = Math.min(...finite);
        let high = Math.max(...finite);
        if (low === high) { low -= 0.5; high += 0.5; }
        const bins = Math.max(3, Math.min(10, Math.ceil(Math.sqrt(finite.length))));
        const counts = Array.from({ length: bins }, () => 0);
        for (const value of finite) {
            const ratioWithin = (value - low) / (high - low);
            const index = Math.min(bins - 1, Math.floor(ratioWithin * bins));
            counts[index] += 1;
        }
        const pad = 18;
        const plotWidth = width - pad * 2;
        const plotHeight = height - pad * 2;
        const maxCount = Math.max(...counts, 1);
        const barWidth = plotWidth / bins;
        const styles = getComputedStyle(document.documentElement);
        ctx.fillStyle = styles.getPropertyValue('--accent').trim();
        counts.forEach((count, index) => {
            const barHeight = (count / maxCount) * plotHeight;
            ctx.fillRect(pad + index * barWidth + 1, pad + plotHeight - barHeight, Math.max(1, barWidth - 2), barHeight);
        });
        ctx.fillStyle = styles.getPropertyValue('--text-dim').trim();
        ctx.font = '10px monospace';
        ctx.fillText(low.toFixed(2), pad, height - 4);
        const highText = high.toFixed(2);
        ctx.fillText(highText, width - pad - ctx.measureText(highText).width, height - 4);
    }

    function renderAnalyticsCharts(metrics) {
        renderLine('ev-equity', metrics.closed_trade_balance_curve, 'closed_trade_balance');
        renderLine('ev-drawdown', metrics.closed_trade_balance_drawdown_curve, 'drawdown');
        renderHistogram(metrics.realized_r_values);
    }

    function renderScope(scope) {
        const range = scope.observed_range || {};
        const dateRange = range.first_close_utc && range.last_close_utc
            ? `${range.first_close_utc} → ${range.last_close_utc}`
            : 'no selected closes';
        el('ev-scope').textContent = `N ${scope.selected_trade_count}/${scope.total_trade_count} · ${dateRange} · ${scope.balance_curve_scope}`;
    }

    function addKv(root, label, value) {
        const unknown = value === null || value === undefined || value === '';
        const node = document.createElement('div');
        node.className = 'ev-kv';
        const labelNode = document.createElement('div');
        labelNode.className = 'ev-kv-label';
        labelNode.textContent = label;
        const valueNode = document.createElement('div');
        valueNode.className = `ev-kv-value${unknown ? ' ev-unknown' : ''}`;
        valueNode.textContent = fmt(value);
        node.append(labelNode, valueNode);
        root.appendChild(node);
    }

    function renderProvenance(run) {
        const root = el('ev-provenance');
        root.replaceChildren();
        const data = run.data || {};
        const assumptions = run.assumptions || {};
        const reproduce = run.reproduce || {};
        addKv(root, 'Artifact schema', run.artifact_schema_version);
        addKv(root, 'Status', run.status);
        addKv(root, 'Halt reason', run.halt_reason);
        addKv(root, 'Strategy', run.strategy_id);
        addKv(root, 'Strategy version', run.strategy_version);
        addKv(root, 'Dataset', data.dataset_id);
        addKv(root, 'Source', data.source_id);
        addKv(root, 'Requested range', data.requested_range);
        addKv(root, 'Observed range', data.observed_range);
        addKv(root, 'Timezone', data.timezone);
        addKv(root, 'Quality', data.quality_status);
        addKv(root, 'Cost model', assumptions.cost_model_version);
        addKv(root, 'Fill model', assumptions.fill_model_version);
        addKv(root, 'Risk model', assumptions.risk_model_version);
        addKv(root, 'Engine version', reproduce.engine_version);
        addKv(root, 'Metric version', reproduce.metric_version);
        addKv(root, 'Code hash', reproduce.code_hash);
    }

    function renderTradeInspector(trade) {
        const inspector = el('ev-inspector');
        const root = el('ev-inspector-grid');
        root.replaceChildren();
        addKv(root, 'Trade ID', trade.trade_id);
        addKv(root, 'Symbol', trade.symbol);
        addKv(root, 'Side', trade.side);
        addKv(root, 'Quantity', trade.quantity);
        addKv(root, 'Open UTC', trade.open_time_utc);
        addKv(root, 'Close UTC', trade.close_time_utc);
        addKv(root, 'Open price', trade.price_open);
        addKv(root, 'Close price', trade.price_close);
        addKv(root, 'Gross P/L', trade.gross_pnl);
        addKv(root, 'Fees', trade.fees);
        addKv(root, 'Net P/L', trade.net_pnl);
        addKv(root, 'Planned risk', trade.planned_risk_budget);
        addKv(root, 'Realized R', trade.realized_r);
        addKv(root, 'Legacy R', trade.legacy_r);
        addKv(root, 'Legacy result', trade.legacy_result);
        const practice = el('ev-open-practice');
        practice.href = practiceHref(trade.trade_id);
        inspector.hidden = false;
    }

    async function inspectTrade(tradeId) {
        if (!state.activeRunId) return;
        try {
            const result = await api(
                `/api/runs/${encodeURIComponent(state.activeRunId)}/trades/${encodeURIComponent(tradeId)}`
            );
            renderTradeInspector(result.trade);
        } catch (error) {
            renderError(error.message);
        }
    }

    function renderLedger(trades) {
        const root = el('ev-ledger');
        root.replaceChildren();
        el('ev-inspector').hidden = true;
        el('ev-ledger-count').textContent = `${trades.length} closed trade${trades.length === 1 ? '' : 's'}`;
        for (const trade of trades) {
            const row = document.createElement('tr');
            const tradeCell = document.createElement('td');
            const inspect = document.createElement('button');
            inspect.type = 'button';
            inspect.className = 'ev-trade-link';
            inspect.textContent = fmt(trade.trade_id);
            inspect.title = 'Inspect trade';
            inspect.addEventListener('click', () => inspectTrade(trade.trade_id));
            tradeCell.appendChild(inspect);
            row.appendChild(tradeCell);

            const values = [
                fmt(trade.side),
                fmt(trade.open_time_utc),
                fmt(trade.close_time_utc),
                fmt(trade.quantity, 4),
                fmt(trade.net_pnl),
                fmt(trade.fees),
                fmt(trade.realized_r),
            ];
            for (const value of values) {
                const cell = document.createElement('td');
                cell.textContent = value;
                row.appendChild(cell);
            }
            root.appendChild(row);
        }
    }

    async function selectRun(runId) {
        state.activeRunId = String(runId);
        syncUrl();
        const practice = document.querySelector('[data-workspace-link="practice"]');
        if (practice) practice.href = practiceHref();
        renderRuns();
        try {
            const query = analyticsParams().toString();
            const result = await api(`/api/analytics/runs/${encodeURIComponent(runId)}${query ? `?${query}` : ''}`);
            const analytics = result.analytics;
            state.analytics = analytics;
            const run = analytics.run;
            el('ev-empty').hidden = true;
            el('ev-detail').hidden = false;
            el('ev-title').textContent = `Run ${run.run_id}`;
            el('ev-subtitle').textContent = `${fmt(run.data?.symbol)} ${fmt(run.data?.timeframe)} · ${fmt(run.created_at_utc)}`;
            const reasons = run.comparison?.reasons || [];
            el('ev-compare-state').textContent = run.comparison?.ready
                ? 'Comparable metadata complete'
                : `Comparison blocked: ${reasons.join(', ')}`;
            const warning = el('ev-warning');
            warning.hidden = reasons.length === 0;
            warning.textContent = reasons.length
                ? 'Legacy artifact has unknown provenance/assumptions. Unknown fields remain unknown; this run is not treated as directly comparable.'
                : '';
            renderMetrics(analytics.metrics);
            renderAnalyticsCharts(analytics.metrics);
            renderScope(analytics.scope);
            renderProvenance(run);
            renderLedger(analytics.ledger || []);
            el('ev-export-json').disabled = false;
            el('ev-export-csv').disabled = false;
            await renderComparison();
        } catch (error) {
            renderError(error.message);
        }
    }

    function populateCompareRuns() {
        const select = el('ev-compare-run');
        const previous = select.value;
        select.replaceChildren(new Option('None', ''));
        for (const run of state.runs) {
            if (String(run.run_id) === String(state.activeRunId)) continue;
            select.appendChild(new Option(`Run ${run.run_id} · ${run.data?.symbol || '?'} ${run.data?.timeframe || '?'}`, run.run_id));
        }
        if (Array.from(select.options).some(option => option.value === previous)) select.value = previous;
    }

    async function renderComparison() {
        const compareId = el('ev-compare-run').value;
        const root = el('ev-compare-detail');
        if (!compareId || !state.activeRunId) {
            root.hidden = true;
            root.textContent = '';
            root.classList.remove('blocked');
            return;
        }
        const params = analyticsParams();
        params.append('run_id', state.activeRunId);
        params.append('run_id', compareId);
        try {
            const result = await api(`/api/analytics/compare?${params.toString()}`);
            const comparison = result.comparison;
            root.hidden = false;
            root.classList.toggle('blocked', !comparison.ranking_allowed);
            if (!comparison.ranking_allowed) {
                root.textContent = `Comparison blocked: ${comparison.reasons.join(', ')}. No ranking is shown across incompatible or unknown bases.`;
                return;
            }
            const [left, right] = comparison.runs;
            root.textContent = `Comparable basis · Run ${left.run.run_id}: N ${left.metrics.closed_trade_count}, net ${fmt(left.metrics.net_pnl)}, expectancy ${fmt(left.metrics.expectancy_net_per_trade)} · Run ${right.run.run_id}: N ${right.metrics.closed_trade_count}, net ${fmt(right.metrics.net_pnl)}, expectancy ${fmt(right.metrics.expectancy_net_per_trade)}.`;
        } catch (error) {
            root.hidden = false;
            root.classList.add('blocked');
            root.textContent = error.message;
        }
    }

    async function loadRuns() {
        el('ev-run-list').textContent = 'Loading...';
        try {
            const result = await api('/api/runs?limit=50');
            state.runs = result.runs || [];
            renderRuns();
            if (state.runs.length) {
                const selected = state.runs.some(run => String(run.run_id) === String(state.activeRunId))
                    ? state.activeRunId
                    : state.runs[0].run_id;
                state.activeRunId = String(selected);
                populateCompareRuns();
                await selectRun(selected);
            }
        } catch (error) {
            state.runs = [];
            renderRuns();
            renderError(error.message);
        }
    }

    el('ev-refresh').addEventListener('click', loadRuns);
    el('ev-filter-side').value = initialQuery.get('side') || 'all';
    el('ev-filter-outcome').value = initialQuery.get('outcome') || 'all';
    for (const id of ['ev-filter-side', 'ev-filter-outcome']) {
        el(id).addEventListener('change', () => {
            syncUrl();
            if (state.activeRunId) selectRun(state.activeRunId);
        });
    }
    el('ev-compare-run').addEventListener('change', renderComparison);
    el('ev-export-json').addEventListener('click', () => {
        if (!state.activeRunId) return;
        const query = analyticsParams().toString();
        window.location.href = `/api/analytics/runs/${encodeURIComponent(state.activeRunId)}/export.json${query ? `?${query}` : ''}`;
    });
    el('ev-export-csv').addEventListener('click', () => {
        if (!state.activeRunId) return;
        const query = analyticsParams().toString();
        window.location.href = `/api/analytics/runs/${encodeURIComponent(state.activeRunId)}/export.csv${query ? `?${query}` : ''}`;
    });
    window.addEventListener('resize', () => {
        if (!el('ev-detail').hidden && state.analytics) renderAnalyticsCharts(state.analytics.metrics);
    });

    loadRuns();
})();
