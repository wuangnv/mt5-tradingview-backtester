(() => {
    const $ = (id) => document.getElementById(id);
    const errorBox = $("risk-error");
    let lastStreakValues = [];
    let lastEquityValues = [];

    function percent(value) {
        if (value == null || !Number.isFinite(Number(value))) return "N/A";
        return `${(Number(value) * 100).toFixed(2)}%`;
    }

    function number(value, digits = 2) {
        if (value == null || !Number.isFinite(Number(value))) return "N/A";
        return Number(value).toLocaleString(undefined, { maximumFractionDigits: digits });
    }

    function setError(message) {
        errorBox.textContent = message || "";
        errorBox.hidden = !message;
    }

    async function postJson(path, payload) {
        const response = await fetch(path, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
        });
        const data = await response.json();
        if (!response.ok || !data.success) {
            throw new Error(data?.error?.message || `Request failed (${response.status})`);
        }
        return data.scenario;
    }

    async function getJson(path) {
        const response = await fetch(path);
        const data = await response.json();
        if (!response.ok || !data.success) {
            throw new Error(data?.error?.message || `Request failed (${response.status})`);
        }
        return data;
    }

    async function postData(path, payload) {
        const response = await fetch(path, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
        });
        const data = await response.json();
        if (!response.ok || !data.success) {
            const error = new Error(data?.error?.message || `Request failed (${response.status})`);
            error.code = data?.error?.code;
            throw error;
        }
        return data;
    }

    function drawSeries(canvas, values) {
        const width = Math.max(320, Math.floor(canvas.getBoundingClientRect().width || 640));
        const height = 180;
        const ratio = window.devicePixelRatio || 1;
        canvas.width = width * ratio;
        canvas.height = height * ratio;
        const ctx = canvas.getContext("2d");
        ctx.scale(ratio, ratio);
        ctx.clearRect(0, 0, width, height);
        if (!values.length) return;

        const style = getComputedStyle(document.documentElement);
        const border = style.getPropertyValue("--border-light").trim() || "#363c4e";
        const text = style.getPropertyValue("--text-dim").trim() || "#787b86";
        const accent = style.getPropertyValue("--accent").trim() || "#2962ff";
        const min = Math.min(...values);
        const max = Math.max(...values);
        const span = Math.max(max - min, Math.abs(max) * 0.05, 1e-9);
        const left = 42;
        const right = 10;
        const top = 12;
        const bottom = 25;

        ctx.strokeStyle = border;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(left, top);
        ctx.lineTo(left, height - bottom);
        ctx.lineTo(width - right, height - bottom);
        ctx.stroke();

        ctx.fillStyle = text;
        ctx.font = "10px sans-serif";
        ctx.fillText(number(max, 4), 2, top + 4);
        ctx.fillText(number(min, 4), 2, height - bottom + 3);
        ctx.fillText("0", left - 3, height - 7);
        ctx.fillText(String(values.length - 1), width - right - 12, height - 7);

        ctx.strokeStyle = accent;
        ctx.lineWidth = 2;
        ctx.beginPath();
        values.forEach((value, index) => {
            const x = left + (index / Math.max(values.length - 1, 1)) * (width - left - right);
            const y = top + ((max - value) / span) * (height - top - bottom);
            if (index === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
        });
        ctx.stroke();
    }

    function meta(target, scenario) {
        target.innerHTML = `<strong>${scenario.label}</strong> · ${scenario.model_version}<br>${scenario.assumptions.join(" · ")}<br>${scenario.formula?.at_least_one_streak || scenario.formula}`;
    }

    async function runStreak() {
        setError("");
        try {
            const scenario = await postJson("/api/risk-lab/streak", {
                loss_probability: Number($("risk-q").value) / 100,
                streak_length: Number($("risk-k").value),
                horizon: Number($("risk-n").value),
            });
            $("risk-next-k").textContent = percent(scenario.next_k_all_losses_probability);
            $("risk-at-least").textContent = percent(scenario.at_least_one_streak_probability);
            lastStreakValues = scenario.horizon_curve.map((point) => point.probability);
            drawSeries($("risk-streak-chart"), lastStreakValues);
            meta($("risk-streak-meta"), scenario);
        } catch (error) {
            setError(error.message);
        }
    }

    async function runEquity() {
        setError("");
        try {
            const scenario = await postJson("/api/risk-lab/equity", {
                starting_equity: Number($("risk-equity").value),
                risk_fraction: Number($("risk-fraction").value) / 100,
                losses: Number($("risk-losses").value),
            });
            $("risk-ending-equity").textContent = number(scenario.ending_equity, 2);
            $("risk-drawdown").textContent = percent(scenario.drawdown_fraction);
            $("risk-recovery").textContent = percent(scenario.recovery_fraction);
            lastEquityValues = scenario.path.map((point) => point.equity);
            drawSeries($("risk-equity-chart"), lastEquityValues);
            meta($("risk-equity-meta"), scenario);
        } catch (error) {
            setError(error.message);
        }
    }

    async function runBreakeven() {
        setError("");
        try {
            const scenario = await postJson("/api/risk-lab/breakeven", {
                win_payoff: Number($("risk-win").value),
                loss_amount: Number($("risk-loss").value),
                extra_cost: Number($("risk-cost").value),
                win_probability: Number($("risk-win-prob").value) / 100,
            });
            $("risk-breakeven-rate").textContent = percent(scenario.breakeven_win_rate);
            $("risk-expectancy").textContent = scenario.expectancy == null ? "N/A" : number(scenario.expectancy, 4);
            meta($("risk-breakeven-meta"), scenario);
        } catch (error) {
            setError(error.message);
        }
    }

    function bootstrapPayload() {
        return {
            run_id: $("risk-bootstrap-run").value.trim(),
            seed: Number($("risk-bootstrap-seed").value),
            path_count: Number($("risk-bootstrap-paths").value),
            horizon: Number($("risk-bootstrap-horizon").value),
            breach_drawdown_fraction: Number($("risk-bootstrap-threshold").value) / 100,
        };
    }

    function showEligibility(eligibility) {
        const state = $("risk-bootstrap-state");
        state.dataset.eligible = String(eligibility.eligible);
        if (eligibility.eligible) {
            state.textContent = `Eligible: ${eligibility.observed.closed_trades} trades across ${eligibility.observed.utc_day_blocks} UTC-day blocks.`;
        } else {
            state.textContent = `Locked: ${eligibility.reasons.join(" · ")}`;
        }
        $("risk-bootstrap-run-action").disabled = !eligibility.eligible;
        return eligibility.eligible;
    }

    async function checkBootstrapEligibility() {
        setError("");
        const runId = $("risk-bootstrap-run").value.trim();
        if (!runId) {
            setError("Run ID is required.");
            return false;
        }
        try {
            const data = await getJson(`/api/risk-lab/bootstrap/eligibility/${encodeURIComponent(runId)}`);
            return showEligibility(data.eligibility);
        } catch (error) {
            setError(error.message);
            return false;
        }
    }

    async function runBootstrap() {
        setError("");
        try {
            const eligible = await checkBootstrapEligibility();
            if (!eligible) return;
            const data = await postData("/api/risk-lab/bootstrap", bootstrapPayload());
            const simulation = data.simulation;
            $("risk-bootstrap-terminal").textContent = number(simulation.results.terminal_equity.p50, 2);
            $("risk-bootstrap-dd").textContent = percent(simulation.results.max_drawdown_fraction.p50);
            $("risk-bootstrap-streak").textContent = number(simulation.results.max_loss_streak.p50, 1);
            $("risk-bootstrap-breach").textContent = percent(simulation.results.breach_rate);
            $("risk-bootstrap-se").textContent = percent(simulation.results.breach_monte_carlo_se);
            $("risk-bootstrap-meta").textContent = `${simulation.label} · ${simulation.model_version} · seed ${simulation.inputs.seed} · ${simulation.inputs.path_count} paths · ${simulation.method.block_count} UTC-day blocks. ${simulation.limits.join(" ")}`;
        } catch (error) {
            setError(error.message);
        }
    }

    $("risk-streak-run").addEventListener("click", runStreak);
    $("risk-equity-run").addEventListener("click", runEquity);
    $("risk-breakeven-run").addEventListener("click", runBreakeven);
    $("risk-bootstrap-check").addEventListener("click", checkBootstrapEligibility);
    $("risk-bootstrap-run-action").addEventListener("click", runBootstrap);
    $("risk-bootstrap-run").addEventListener("input", () => {
        $("risk-bootstrap-run-action").disabled = true;
        $("risk-bootstrap-state").textContent = "Eligibility changed; check this run again.";
        delete $("risk-bootstrap-state").dataset.eligible;
    });

    Promise.all([runStreak(), runEquity(), runBreakeven()]);
    $("risk-bootstrap-run-action").disabled = true;
    window.addEventListener("resize", () => {
        drawSeries($("risk-streak-chart"), lastStreakValues);
        drawSeries($("risk-equity-chart"), lastEquityValues);
    });
})();
