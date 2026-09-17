(() => {
    const state = { workspace: null, selectedRun: null };
    const byId = (id) => document.getElementById(id);

    async function request(url, options = {}) {
        const response = await fetch(url, {
            ...options,
            headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
        });
        const body = await response.json().catch(() => null);
        if (!response.ok) {
            throw new Error(body?.error?.message || `Request failed (${response.status})`);
        }
        return body;
    }

    function setStatus(message, kind = '') {
        const root = byId('rw-status');
        root.textContent = message || '';
        root.className = `rw-status${kind ? ` ${kind}` : ''}`;
    }

    function parseJson(text, fieldName) {
        try {
            const value = JSON.parse(text);
            if (!value || Array.isArray(value) || typeof value !== 'object') {
                throw new Error();
            }
            return value;
        } catch (_) {
            throw new Error(`${fieldName} must be a JSON object.`);
        }
    }

    function option(select, value, label) {
        const item = document.createElement('option');
        item.value = value;
        item.textContent = label;
        select.appendChild(item);
    }

    function renderSelects() {
        const workspace = state.workspace;
        const hypothesisSelect = document.querySelector('#rw-strategy-form [name="hypothesis_id"]');
        const strategySelect = document.querySelector('#rw-protocol-form [name="strategy_version_id"]');
        const protocolSelect = document.querySelector('#rw-run-form [name="protocol_id"]');
        [hypothesisSelect, strategySelect, protocolSelect].forEach((select) => { select.textContent = ''; });

        option(hypothesisSelect, '', 'Select hypothesis');
        workspace.hypotheses.forEach((item) => option(hypothesisSelect, item.id, `${item.id} · ${item.title}`));
        option(strategySelect, '', 'Select strategy version');
        workspace.strategy_versions.forEach((item) => option(strategySelect, item.id, `${item.strategy_key}@${item.version}`));
        option(protocolSelect, '', 'Select protocol');
        workspace.protocols.forEach((item) => option(protocolSelect, item.id, `${item.id} · ${item.name}`));
    }

    function renderSideList(rootId, items, title, meta) {
        const root = byId(rootId);
        root.textContent = '';
        items.forEach((item) => {
            const row = document.createElement('div');
            row.className = 'rw-list-item';
            const heading = document.createElement('div');
            heading.className = 'rw-list-title';
            heading.textContent = title(item);
            const detail = document.createElement('div');
            detail.className = 'rw-list-meta';
            detail.textContent = meta(item);
            row.append(heading, detail);
            root.appendChild(row);
        });
    }

    function shortKey(value) {
        return value ? `${value.slice(0, 10)}…` : '—';
    }

    function renderRuns() {
        const root = byId('rw-runs');
        root.textContent = '';
        const runs = state.workspace.runs;
        byId('rw-run-count').textContent = `${runs.length} run${runs.length === 1 ? '' : 's'}`;
        runs.forEach((run) => {
            const tr = document.createElement('tr');
            const idCell = document.createElement('td');
            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'rw-run-link';
            button.textContent = `#${run.id}`;
            button.addEventListener('click', () => selectRun(run.id));
            idCell.appendChild(button);
            [
                idCell,
                cell(run.status),
                cell(`${run.strategy_key}@${run.strategy_version}`),
                cell(run.protocol_name),
                cell(shortKey(run.repro_key)),
            ].forEach((node) => tr.appendChild(node));
            root.appendChild(tr);
        });
    }

    function cell(value) {
        const td = document.createElement('td');
        td.textContent = value ?? '—';
        return td;
    }

    function addKv(root, label, value) {
        const item = document.createElement('div');
        const key = document.createElement('div');
        const val = document.createElement('div');
        key.className = 'rw-kv-label';
        val.className = 'rw-kv-value';
        key.textContent = label;
        val.textContent = typeof value === 'object' && value !== null ? JSON.stringify(value) : (value ?? '—');
        item.append(key, val);
        root.appendChild(item);
    }

    function renderRunDetail(run) {
        state.selectedRun = run;
        byId('rw-run-detail').hidden = false;
        byId('rw-run-title').textContent = `Run #${run.id}`;
        byId('rw-run-status').textContent = run.status;
        const meta = byId('rw-run-meta');
        meta.textContent = '';
        addKv(meta, 'Repro key', run.repro_key);
        addKv(meta, 'Budget', run.budget);
        addKv(meta, 'Cutoff ms', run.protocol.cutoff_ms);
        addKv(meta, 'Dataset', run.protocol.dataset_id);
        addKv(meta, 'Dataset SHA-256', run.protocol.dataset_sha256);
        addKv(meta, 'Strategy', `${run.strategy_version.strategy_key}@${run.strategy_version.version}`);
        addKv(meta, 'Terminal reason', run.terminal_reason);

        const planned = run.status === 'planned';
        const running = run.status === 'running';
        byId('rw-start').disabled = !planned;
        byId('rw-cancel').disabled = !(planned || running);
        document.querySelectorAll('#rw-complete-form input, #rw-complete-form textarea, #rw-complete-form button')
            .forEach((node) => { node.disabled = !running; });
        document.querySelectorAll('#rw-fail-form input, #rw-fail-form button')
            .forEach((node) => { node.disabled = !(planned || running); });
        const observed = document.querySelector('#rw-complete-form [name="observed_until_ms"]');
        if (running && !observed.value) observed.value = run.protocol.cutoff_ms;
    }

    async function loadWorkspace(message = '') {
        const body = await request('/api/research');
        state.workspace = body.workspace;
        byId('rw-schema').textContent = `schema v${body.workspace.schema_version}`;
        renderSelects();
        renderSideList('rw-hypothesis-list', body.workspace.hypotheses, (x) => x.title, (x) => `#${x.id}`);
        renderSideList('rw-strategy-list', body.workspace.strategy_versions, (x) => `${x.strategy_key}@${x.version}`, (x) => `hypothesis #${x.hypothesis_id}`);
        renderSideList('rw-protocol-list', body.workspace.protocols, (x) => x.name, (x) => `${x.dataset_id} · ${shortKey(x.dataset_sha256)} · cutoff ${x.cutoff_ms}`);
        renderRuns();
        if (state.selectedRun) {
            const exists = body.workspace.runs.some((run) => run.id === state.selectedRun.id);
            if (exists) await selectRun(state.selectedRun.id, false);
        }
        if (message) setStatus(message, 'ok');
    }

    async function selectRun(runId, announce = true) {
        const body = await request(`/api/research/runs/${runId}`);
        renderRunDetail(body.run);
        if (announce) setStatus(`Selected run #${runId}.`);
    }

    function bindForm(id, buildPayload, endpoint, successMessage) {
        byId(id).addEventListener('submit', async (event) => {
            event.preventDefault();
            try {
                const form = event.currentTarget;
                const data = new FormData(form);
                const body = buildPayload(data);
                await request(endpoint, { method: 'POST', body: JSON.stringify(body) });
                await loadWorkspace(successMessage);
            } catch (error) {
                setStatus(error.message, 'error');
            }
        });
    }

    bindForm('rw-hypothesis-form', (data) => ({
        title: data.get('title'), thesis: data.get('thesis'),
    }), '/api/research/hypotheses', 'Hypothesis saved.');

    bindForm('rw-strategy-form', (data) => ({
        hypothesis_id: Number(data.get('hypothesis_id')),
        strategy_key: data.get('strategy_key'),
        version: data.get('version'),
        rules: parseJson(data.get('rules'), 'Rules JSON'),
    }), '/api/research/strategy-versions', 'Strategy version saved.');

    bindForm('rw-protocol-form', (data) => ({
        strategy_version_id: Number(data.get('strategy_version_id')),
        name: data.get('name'),
        dataset_id: data.get('dataset_id'),
        dataset_sha256: data.get('dataset_sha256'),
        data_start_ms: Number(data.get('data_start_ms')),
        cutoff_ms: Number(data.get('cutoff_ms')),
        seed: Number(data.get('seed')),
        parameters: parseJson(data.get('parameters'), 'Parameters JSON'),
    }), '/api/research/protocols', 'Protocol saved.');

    bindForm('rw-run-form', (data) => {
        const budget = {
            max_bars: Number(data.get('max_bars')),
            max_runtime_ms: Number(data.get('max_runtime_ms')),
        };
        if (data.get('note')) budget.note = data.get('note');
        return { protocol_id: Number(data.get('protocol_id')), budget };
    }, '/api/research/runs', 'Planned run created.');

    byId('rw-start').addEventListener('click', async () => {
        try {
            await request(`/api/research/runs/${state.selectedRun.id}/start`, { method: 'POST', body: '{}' });
            await loadWorkspace('Run started.');
        } catch (error) { setStatus(error.message, 'error'); }
    });

    byId('rw-cancel').addEventListener('click', async () => {
        try {
            await request(`/api/research/runs/${state.selectedRun.id}/cancel`, {
                method: 'POST', body: JSON.stringify({ reason: 'cancelled from research workspace' }),
            });
            await loadWorkspace('Run cancelled.');
        } catch (error) { setStatus(error.message, 'error'); }
    });

    byId('rw-complete-form').addEventListener('submit', async (event) => {
        event.preventDefault();
        try {
            const data = new FormData(event.currentTarget);
            await request(`/api/research/runs/${state.selectedRun.id}/complete`, {
                method: 'POST',
                body: JSON.stringify({
                    observed_until_ms: Number(data.get('observed_until_ms')),
                    result: parseJson(data.get('result'), 'Result JSON'),
                }),
            });
            await loadWorkspace('Run completed.');
        } catch (error) { setStatus(error.message, 'error'); }
    });

    byId('rw-fail-form').addEventListener('submit', async (event) => {
        event.preventDefault();
        try {
            const data = new FormData(event.currentTarget);
            await request(`/api/research/runs/${state.selectedRun.id}/fail`, {
                method: 'POST', body: JSON.stringify({ reason: data.get('reason') }),
            });
            await loadWorkspace('Run marked failed.');
        } catch (error) { setStatus(error.message, 'error'); }
    });

    byId('rw-refresh').addEventListener('click', () => loadWorkspace('Workspace refreshed.').catch((error) => setStatus(error.message, 'error')));
    loadWorkspace().catch((error) => setStatus(error.message, 'error'));
})();
