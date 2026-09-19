(() => {
    const els = {
        mode: document.getElementById('td-mode'),
        account: document.getElementById('td-account'),
        server: document.getElementById('td-server'),
        balance: document.getElementById('td-balance'),
        riskLimit: document.getElementById('td-risk-limit'),
        live: document.getElementById('td-live'),
        form: document.getElementById('td-order-form'),
        symbol: document.getElementById('td-symbol'),
        side: document.getElementById('td-side'),
        volume: document.getElementById('td-volume'),
        stop: document.getElementById('td-stop'),
        target: document.getElementById('td-target'),
        preview: document.getElementById('td-preview'),
        submit: document.getElementById('td-submit'),
        positions: document.getElementById('td-positions'),
        requests: document.getElementById('td-requests'),
        error: document.getElementById('td-error'),
        refresh: document.getElementById('td-refresh'),
    };

    let state = null;
    let previewTimer = null;
    const memoryIntents = new Map();
    const intentPrefix = 'trade-desk-intent:';

    const requestId = () => window.crypto?.randomUUID?.() || `req-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const money = value => `$${Number(value || 0).toFixed(2)}`;
    const price = value => Number(value || 0).toFixed(5);

    function readIntent(key) {
        try {
            const raw = window.sessionStorage?.getItem(intentPrefix + key);
            return raw ? JSON.parse(raw) : (memoryIntents.get(key) || null);
        } catch (_) {
            return memoryIntents.get(key) || null;
        }
    }

    function writeIntent(key, value) {
        memoryIntents.set(key, value);
        try {
            window.sessionStorage?.setItem(intentPrefix + key, JSON.stringify(value));
        } catch (_) { /* in-memory fallback keeps double-click idempotence */ }
    }

    function clearIntent(key) {
        memoryIntents.delete(key);
        try {
            window.sessionStorage?.removeItem(intentPrefix + key);
        } catch (_) { /* ignore unavailable storage */ }
    }

    function durableRequestId(key, intent) {
        const signature = JSON.stringify(intent);
        const existing = readIntent(key);
        if (existing?.signature === signature && existing?.request_id) return existing.request_id;
        if (existing?.request_id) {
            const error = new Error('Resolve the previous execution request before submitting a changed intent.');
            error.code = 'EXECUTION_INTENT_PENDING';
            throw error;
        }
        const next = {signature, request_id: requestId()};
        writeIntent(key, next);
        return next.request_id;
    }

    function orderPayload() {
        return {
            symbol: els.symbol.value,
            side: els.side.value,
            volume: Number(els.volume.value),
            stop_loss: Number(els.stop.value),
            take_profit: els.target.value === '' ? null : Number(els.target.value),
        };
    }

    async function jsonFetch(url, options = {}) {
        const response = await fetch(url, options);
        const body = await response.json();
        if (!response.ok || !body.success) {
            const error = new Error(body.error?.message || `HTTP ${response.status}`);
            error.status = response.status;
            error.code = body.error?.code;
            throw error;
        }
        return body;
    }

    async function reconcileUnknown(request_id) {
        const body = await jsonFetch(`/api/execution/requests/${encodeURIComponent(request_id)}/reconcile`, {
            method: 'POST',
            headers: {'Content-Type': 'application/json', 'X-Execution-Intent': 'confirmed'},
            body: JSON.stringify({}),
        });
        if (body.result?.status === 'unknown') {
            const error = new Error('Request status is still unknown. Reconcile again before creating a new intent.');
            error.code = 'EXECUTION_UNKNOWN';
            throw error;
        }
        return body.result;
    }

    function showError(message) {
        els.error.textContent = message;
        els.error.hidden = !message;
    }

    function renderState(next) {
        state = next;
        if (els.mode) {
            els.mode.textContent = next.adapter === 'mt5-demo-socket'
                ? 'MT5 DEMO / LIVE BLOCKED'
                : 'DEMO SIMULATOR / NO MT5';
        }
        els.account.textContent = next.account.account_id;
        els.server.textContent = next.account.server;
        els.balance.textContent = money(next.account.balance);
        els.riskLimit.textContent = `${money(next.limits.max_risk_amount)} / ${next.limits.max_risk_pct}%`;
        els.live.textContent = 'Locked';

        els.positions.innerHTML = next.positions.length ? next.positions.map(pos => `
            <tr>
                <td>${pos.position_id}</td><td>${pos.symbol}</td><td>${pos.side}</td><td>${pos.volume}</td>
                <td>${price(pos.entry_price)}</td><td>${price(pos.stop_loss)}</td><td>${pos.take_profit == null ? '-' : price(pos.take_profit)}</td>
                <td><button class="td-close" type="button" data-close="${pos.position_id}">Close</button></td>
            </tr>`).join('') : '<tr><td class="td-empty" colspan="8">No simulated open positions.</td></tr>';

        els.requests.innerHTML = next.requests.length ? next.requests.map(req => `
            <tr><td>${req.request_id}</td><td>${req.operation}</td><td>${req.status}</td><td>${new Date(req.updated_at_ms).toLocaleTimeString()}</td></tr>`
        ).join('') : '<tr><td class="td-empty" colspan="4">No execution requests yet.</td></tr>';
    }

    async function refresh() {
        try {
            showError('');
            const body = await jsonFetch('/api/execution/state');
            renderState(body.state);
            try {
                const readiness = await jsonFetch('/api/live-readiness/state');
                const live = readiness.state;
                els.live.textContent = live.ready_for_live_gate
                    ? 'Locked / readiness passed'
                    : `Locked / ${live.probe === 'disabled' ? 'readiness disabled' : 'not ready'}`;
            } catch (_) {
                els.live.textContent = 'Locked / readiness unavailable';
            }
        } catch (error) {
            showError(error.message);
        }
    }

    async function preview() {
        try {
            const body = await jsonFetch('/api/execution/preview', {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({order: orderPayload()}),
            });
            const item = body.preview;
            els.preview.textContent = item.passed
                ? `PASS | entry ${price(item.entry_price)} | stop risk ${money(item.estimated_stop_risk)} / ${money(item.risk_limit)}`
                : `BLOCKED | ${item.reasons.join('; ')}`;
            els.preview.className = `td-preview ${item.passed ? 'ready' : 'denied'}`;
            els.submit.disabled = !item.passed;
        } catch (error) {
            els.preview.textContent = `BLOCKED | ${error.message}`;
            els.preview.className = 'td-preview denied';
            els.submit.disabled = true;
        }
    }

    function schedulePreview() {
        window.clearTimeout(previewTimer);
        previewTimer = window.setTimeout(preview, 120);
    }

    els.form.addEventListener('input', schedulePreview);
    els.form.addEventListener('submit', async event => {
        event.preventDefault();
        if (!state) return;
        const intentKey = 'place';
        const intent = {
            mode: 'demo',
            account_id: state.account.account_id,
            account_server: state.account.server,
            order: orderPayload(),
        };
        try {
            showError('');
            intent.request_id = durableRequestId(intentKey, intent);
            const body = await jsonFetch('/api/execution/orders', {
                method: 'POST',
                headers: {'Content-Type': 'application/json', 'X-Execution-Intent': 'confirmed'},
                body: JSON.stringify(intent),
            });
            if (body.result?.status === 'unknown') await reconcileUnknown(intent.request_id);
            clearIntent(intentKey);
            await refresh();
            await preview();
        } catch (error) {
            if (!['EXECUTION_UNKNOWN', 'EXECUTION_INTENT_PENDING'].includes(error.code)) clearIntent(intentKey);
            showError(error.message);
        }
    });

    els.positions.addEventListener('click', async event => {
        const button = event.target.closest('[data-close]');
        if (!button || !state) return;
        const intentKey = `close:${button.dataset.close}`;
        const intent = {
            mode: 'demo',
            account_id: state.account.account_id,
            account_server: state.account.server,
            position_id: button.dataset.close,
        };
        try {
            showError('');
            const request_id = durableRequestId(intentKey, intent);
            const body = await jsonFetch(`/api/execution/positions/${encodeURIComponent(button.dataset.close)}/close`, {
                method: 'POST',
                headers: {'Content-Type': 'application/json', 'X-Execution-Intent': 'confirmed'},
                body: JSON.stringify({
                    mode: intent.mode,
                    account_id: intent.account_id,
                    account_server: intent.account_server,
                    request_id,
                }),
            });
            if (body.result?.status === 'unknown') await reconcileUnknown(request_id);
            clearIntent(intentKey);
            await refresh();
            await preview();
        } catch (error) {
            if (!['EXECUTION_UNKNOWN', 'EXECUTION_INTENT_PENDING'].includes(error.code)) clearIntent(intentKey);
            showError(error.message);
        }
    });

    els.refresh.addEventListener('click', refresh);
    refresh().then(preview);
})();
