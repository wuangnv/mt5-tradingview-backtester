(function () {
    'use strict';

    const state = { runs: [], activeRunId: null };
    const el = id => document.getElementById(id);

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

    function metric(label, value) {
        const node = document.createElement('div');
        node.className = 'ev-metric';
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
        root.replaceChildren(
            metric('Trades', fmt(metrics.trade_count, 0)),
            metric('Win rate', pct(metrics.win_rate_pct)),
            metric('Net P/L', fmt(metrics.net_pnl)),
            metric('Profit factor', fmt(metrics.profit_factor_after_cost)),
            metric('Expectancy', fmt(metrics.expectancy_net_per_trade)),
            metric('Average R', fmt(metrics.average_realized_r)),
            metric('Max drawdown', fmt(metrics.max_drawdown)),
            metric('Max DD %', pct(metrics.max_drawdown_pct)),
            metric('Loss streak', fmt(metrics.max_loss_streak, 0)),
            metric('Start balance', fmt(metrics.starting_balance)),
            metric('End balance', fmt(metrics.ending_balance)),
            metric('Metric schema', fmt(metrics.metric_schema_version))
        );
    }

    function renderEquity(curve) {
        const canvas = el('ev-equity');
        const ratio = window.devicePixelRatio || 1;
        const width = Math.max(320, canvas.clientWidth || 800);
        const height = 180;
        canvas.width = Math.round(width * ratio);
        canvas.height = Math.round(height * ratio);
        const ctx = canvas.getContext('2d');
        ctx.scale(ratio, ratio);
        ctx.clearRect(0, 0, width, height);
        if (!Array.isArray(curve) || curve.length < 2) return;

        const values = curve.map(point => Number(point.equity)).filter(Number.isFinite);
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
        renderRuns();
        try {
            const [detail, metrics, ledger] = await Promise.all([
                api(`/api/runs/${encodeURIComponent(runId)}`),
                api(`/api/runs/${encodeURIComponent(runId)}/metrics`),
                api(`/api/runs/${encodeURIComponent(runId)}/ledger`)
            ]);
            const run = detail.run;
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
            renderMetrics(metrics.metrics);
            renderEquity(metrics.metrics.equity_curve);
            renderProvenance(run);
            renderLedger(ledger.trades || []);
            el('ev-export-json').disabled = false;
            el('ev-export-csv').disabled = false;
        } catch (error) {
            renderError(error.message);
        }
    }

    async function loadRuns() {
        el('ev-run-list').textContent = 'Loading...';
        try {
            const result = await api('/api/runs?limit=50');
            state.runs = result.runs || [];
            renderRuns();
            if (state.runs.length) await selectRun(state.activeRunId || state.runs[0].run_id);
        } catch (error) {
            state.runs = [];
            renderRuns();
            renderError(error.message);
        }
    }

    el('ev-refresh').addEventListener('click', loadRuns);
    el('ev-export-json').addEventListener('click', () => {
        if (state.activeRunId) window.location.href = `/api/runs/${encodeURIComponent(state.activeRunId)}/export.json`;
    });
    el('ev-export-csv').addEventListener('click', () => {
        if (state.activeRunId) window.location.href = `/api/runs/${encodeURIComponent(state.activeRunId)}/export.csv`;
    });
    window.addEventListener('resize', () => {
        if (!el('ev-detail').hidden && state.activeRunId) {
            api(`/api/runs/${encodeURIComponent(state.activeRunId)}/metrics`)
                .then(result => renderEquity(result.metrics.equity_curve))
                .catch(() => {});
        }
    });

    loadRuns();
})();
