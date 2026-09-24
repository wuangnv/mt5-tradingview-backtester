(function () {
    const root = document.documentElement;
    const body = document.body;
    const views = Array.from(document.querySelectorAll('[data-preview-view]'));
    const routeButtons = Array.from(document.querySelectorAll('[data-preview-target]'));
    const navigation = Array.from(document.querySelectorAll('.u1-primary-nav [data-preview-target], .u1-sidebar [data-preview-target]'));

    function showView(name) {
        views.forEach((view) => view.classList.toggle('active', view.dataset.previewView === name));
        navigation.forEach((button) => button.classList.toggle('active', button.dataset.previewTarget === name));
        const main = document.querySelector('.u1-main');
        if (main) main.scrollTop = 0;
    }

    routeButtons.forEach((button) => {
        button.addEventListener('click', () => showView(button.dataset.previewTarget));
    });

    const themeToggle = document.getElementById('theme-toggle');
    const densityToggle = document.getElementById('density-toggle');

    function syncThemeControls(theme) {
        document.querySelectorAll('[data-theme-choice]').forEach((button) => {
            button.classList.toggle('active', button.dataset.themeChoice === theme);
        });
    }

    function setTheme(theme) {
        root.dataset.theme = theme === 'dark' ? 'dark' : 'light';
        syncThemeControls(root.dataset.theme);
    }

    function syncDensityControls(compact) {
        document.querySelectorAll('[data-density-choice]').forEach((button) => {
            const active = compact ? button.dataset.densityChoice === 'compact' : button.dataset.densityChoice === 'comfortable';
            button.classList.toggle('active', active);
        });
        if (densityToggle) densityToggle.textContent = compact ? 'Thoáng' : 'Gọn';
    }

    function setDensity(compact) {
        body.classList.toggle('compact', compact);
        syncDensityControls(compact);
    }

    themeToggle?.addEventListener('click', () => {
        setTheme(root.dataset.theme === 'dark' ? 'light' : 'dark');
    });

    densityToggle?.addEventListener('click', () => {
        setDensity(!body.classList.contains('compact'));
    });

    document.querySelectorAll('[data-theme-choice]').forEach((button) => {
        button.addEventListener('click', () => setTheme(button.dataset.themeChoice));
    });
    document.querySelectorAll('[data-density-choice]').forEach((button) => {
        button.addEventListener('click', () => setDensity(button.dataset.densityChoice === 'compact'));
    });

    syncThemeControls(root.dataset.theme || 'light');
    syncDensityControls(body.classList.contains('compact'));

    const strategyData = {
        london: {
            title: 'London breakout + retest',
            version: 'v0.4 · DRAFT',
            thesis: 'Tìm breakout khỏi London high/low rồi chờ retest có điều kiện trước khi vào lệnh.',
            entry: 'Breakout London high + retest ≤ 4 nến',
            stop: 'Sau swing retest + 1.5 pip buffer',
            exit: '2R hoặc đóng 16:30 London',
            skip: 'High-impact news ± 20 phút',
            links: '2 runs'
        },
        asia: {
            title: 'Asia range fade',
            version: 'v1.2 · STABLE',
            thesis: 'Fade biên Asia khi range đủ chặt và London chưa tạo displacement xác nhận.',
            entry: 'Sweep range edge + reclaim trong 2 nến',
            stop: 'Ngoài sweep extreme + buffer',
            exit: 'Mid-range trước, extension sau',
            skip: 'Range quá rộng hoặc có high-impact news',
            links: '4 runs'
        },
        ny: {
            title: 'NY continuation',
            version: 'v0.2 · PAUSED',
            thesis: 'Theo continuation sau displacement đầu New York nhưng chưa khóa được exit rule.',
            entry: 'Displacement + pullback vào imbalance',
            stop: 'Sau swing pullback',
            exit: 'Chưa định nghĩa',
            skip: 'Không vào khi London đã mở rộng quá mức',
            links: '0 runs'
        }
    };

    const strategyItems = Array.from(document.querySelectorAll('[data-strategy-key]'));
    function selectStrategy(key) {
        const item = strategyData[key];
        if (!item) return;
        strategyItems.forEach((button) => button.classList.toggle('active', button.dataset.strategyKey === key));
        const fields = {
            'strategy-title': item.title,
            'strategy-version': item.version,
            'strategy-thesis': item.thesis,
            'strategy-entry': item.entry,
            'strategy-stop': item.stop,
            'strategy-exit': item.exit,
            'strategy-skip': item.skip,
            'strategy-links-count': item.links
        };
        Object.entries(fields).forEach(([id, value]) => {
            const element = document.getElementById(id);
            if (element) element.textContent = value;
        });
        const actionNote = document.getElementById('strategy-action-note');
        if (actionNote) actionNote.hidden = true;
    }
    strategyItems.forEach((button) => button.addEventListener('click', () => selectStrategy(button.dataset.strategyKey)));
    document.getElementById('strategy-new-version')?.addEventListener('click', () => {
        const actionNote = document.getElementById('strategy-action-note');
        if (!actionNote) return;
        actionNote.hidden = false;
        actionNote.textContent = 'Preview: đã tạo nháp phiên bản kế tiếp trong UI; không ghi vào store thật.';
    });

    const datasetRows = Array.from(document.querySelectorAll('#dataset-rows tr'));
    function selectDataset(row) {
        if (!row) return;
        datasetRows.forEach((candidate) => candidate.classList.toggle('selected', candidate === row));
        const cells = row.querySelectorAll('td');
        const values = {
            'dataset-title': cells[0]?.textContent || '—',
            'dataset-range': cells[3]?.textContent || 'N/A',
            'dataset-bars': cells[4]?.textContent || 'N/A',
            'dataset-quality': cells[5]?.textContent || 'Unknown'
        };
        Object.entries(values).forEach(([id, value]) => {
            const element = document.getElementById(id);
            if (element) element.textContent = value;
        });
    }
    datasetRows.forEach((row) => row.addEventListener('click', () => selectDataset(row)));

    const lessonData = {
        structure: {
            title: 'Higher High, Higher Low và khi trend suy yếu',
            progress: '2 / 4',
            summary: 'Nhìn cấu trúc trước khi nhìn tín hiệu vào lệnh; một cây nến không tự xác nhận đảo chiều.',
            objective: 'Phân biệt uptrend đang khỏe, cấu trúc suy yếu và downtrend đã xác nhận.',
            example: 'HH 1.1050 → HL 1.1010 → HH 1.1080',
            note: 'Nếu giá phá HL 1.1010, uptrend suy yếu. Chỉ khi hình thành LL → LH → LL mới gọi downtrend rõ hơn.'
        },
        risk: {
            title: 'R, planned risk và realized R',
            progress: '0 / 3',
            summary: 'Tách ngân sách rủi ro dự kiến khỏi kết quả tiền thực tế để so các giao dịch công bằng hơn.',
            objective: 'Tính planned risk, realized R và nhận biết khi dữ liệu risk bị thiếu.',
            example: 'Risk 50 USD · Net +75 USD → +1,50R',
            note: 'Nếu planned risk không tồn tại thì realized R phải là N/A, không được suy ngược tùy ý từ P/L.'
        },
        review: {
            title: 'Review một trade bằng evidence chain',
            progress: '0 / 3',
            summary: 'Đi từ setup → quyết định → execution → kết quả → bằng chứng chart thay vì chỉ nhìn P/L.',
            objective: 'Viết review có thể truy về rule version, dữ liệu và context tại thời điểm quyết định.',
            example: 'Rule v0.4 → Decision → Fill/Replay → Net R → Note',
            note: 'Không dùng hindsight để thay đổi điều kiện đã biết tại thời điểm vào lệnh.'
        }
    };
    const lessonItems = Array.from(document.querySelectorAll('[data-lesson-key]'));
    function selectLesson(key) {
        const lesson = lessonData[key];
        if (!lesson) return;
        lessonItems.forEach((button) => button.classList.toggle('active', button.dataset.lessonKey === key));
        const fields = {
            'learn-title': lesson.title,
            'learn-progress': lesson.progress,
            'learn-summary': lesson.summary,
            'learn-objective': lesson.objective
        };
        Object.entries(fields).forEach(([id, value]) => {
            const element = document.getElementById(id);
            if (element) element.textContent = value;
        });
        const example = document.getElementById('learn-example');
        if (example) {
            const strong = example.querySelector('strong');
            const paragraph = example.querySelector('p');
            if (strong) strong.textContent = lesson.example;
            if (paragraph) paragraph.textContent = lesson.note;
        }
    }
    lessonItems.forEach((button) => button.addEventListener('click', () => selectLesson(button.dataset.lessonKey)));

    document.getElementById('trade-check-button')?.addEventListener('click', () => {
        const side = document.getElementById('trade-side')?.value || 'buy';
        const entry = Number(document.getElementById('trade-entry')?.value);
        const stop = Number(document.getElementById('trade-stop')?.value);
        const target = Number(document.getElementById('trade-target')?.value);
        const risk = Number(document.getElementById('trade-risk')?.value);
        const volume = Number(document.getElementById('trade-volume')?.value);
        const check = document.getElementById('trade-check-result');
        const state = document.getElementById('trade-draft-state');
        const step = document.getElementById('trade-step-check');
        if (!check || !state || !step) return;

        const numeric = [entry, stop, target, risk, volume].every(Number.isFinite);
        const riskDistance = side === 'buy' ? entry - stop : stop - entry;
        const rewardDistance = side === 'buy' ? target - entry : entry - target;
        const valid = numeric && riskDistance > 0 && rewardDistance > 0 && risk > 0 && volume > 0;
        check.classList.toggle('valid', valid);
        step.classList.toggle('current', valid);
        if (valid) {
            const rr = rewardDistance / riskDistance;
            check.querySelector('span').textContent = `Draft hợp lệ về hình học giá · planned RR 1 : ${rr.toFixed(2)}`;
            check.querySelector('strong').textContent = 'Đây chỉ là validation UI; broker check/send vẫn không khả dụng.';
            state.textContent = 'Đã kiểm tra · preview only';
            step.querySelector('small').textContent = 'UI pass';
        } else {
            check.querySelector('span').textContent = 'Draft chưa hợp lệ: kiểm tra hướng Entry / SL / TP và số dương.';
            check.querySelector('strong').textContent = 'Không có broker request nào được gửi.';
            state.textContent = 'Cần sửa';
            step.querySelector('small').textContent = 'Input lỗi';
        }
    });

    const analyticsView = document.getElementById('preview-analytics');
    const directionButtons = Array.from(document.querySelectorAll('button[data-analytics-direction]'));
    const directionName = document.getElementById('analytics-direction-name');
    const directionNote = document.getElementById('analytics-direction-note');
    const directionCopy = {
        a: {
            name: 'A — Phân tích theo diễn tiến',
            note: 'Ưu tiên đọc từ tổng quan → đường balance → trades → chi tiết.'
        },
        b: {
            name: 'B — Bàn nghiên cứu mật độ cao',
            note: 'Ưu tiên quét số và bảng nhanh; inspector luôn ở cạnh luồng làm việc.'
        },
        c: {
            name: 'C — Thẩm định theo chuỗi chứng cứ',
            note: 'Đưa provenance, giới hạn dữ liệu và selected trade vào cùng một evidence chain.'
        },
        d: {
            name: 'D — Nhật ký phân tích điềm tĩnh',
            note: 'Ngữ cảnh ở cột đọc riêng; chart và bảng thoáng hơn cho phiên review dài.'
        }
    };

    function setAnalyticsDirection(key) {
        if (!analyticsView || !directionCopy[key]) return;
        analyticsView.dataset.analyticsDirection = key;
        directionButtons.forEach((button) => {
            const active = button.dataset.analyticsDirection === key;
            button.classList.toggle('active', active);
            button.setAttribute('aria-pressed', String(active));
        });
        if (directionName) directionName.textContent = directionCopy[key].name;
        if (directionNote) directionNote.textContent = directionCopy[key].note;
    }

    directionButtons.forEach((button) => {
        button.addEventListener('click', () => setAnalyticsDirection(button.dataset.analyticsDirection));
    });

    const tradeRows = Array.from(document.querySelectorAll('#analytics-trades tr'));
    const outcomeFilter = document.getElementById('analytics-outcome-filter');
    const filterSummary = document.getElementById('analytics-filter-summary');
    const tableCount = document.getElementById('analytics-table-count');
    const inspectorId = document.getElementById('inspector-id');
    const inspectorResult = document.getElementById('inspector-result');
    const inspectorR = document.getElementById('inspector-r');
    const inspectorSetup = document.getElementById('inspector-setup');
    const inspectorNote = document.getElementById('inspector-note');

    function selectTrade(row) {
        if (!row || row.hidden) return;
        tradeRows.forEach((candidate) => candidate.classList.toggle('selected', candidate === row));
        if (inspectorId) inspectorId.textContent = row.dataset.tradeId || '—';
        if (inspectorResult) {
            inspectorResult.textContent = row.dataset.result || '—';
            inspectorResult.classList.toggle('positive', row.dataset.outcome === 'W');
            inspectorResult.classList.toggle('negative', row.dataset.outcome === 'L');
        }
        if (inspectorR) inspectorR.textContent = row.dataset.r || 'N/A';
        if (inspectorSetup) inspectorSetup.textContent = row.dataset.setup || 'N/A';
        if (inspectorNote) inspectorNote.textContent = row.dataset.note || 'Không có note.';
    }

    function applyOutcomeFilter() {
        const outcome = outcomeFilter?.value || 'all';
        let visibleCount = 0;
        tradeRows.forEach((row) => {
            const visible = outcome === 'all' || row.dataset.outcome === outcome;
            row.hidden = !visible;
            if (visible) visibleCount += 1;
        });
        if (filterSummary) filterSummary.textContent = `${visibleCount} / ${tradeRows.length} trades`;
        if (tableCount) tableCount.textContent = `${visibleCount} bản ghi · chọn một dòng để inspect`;
        const selected = tradeRows.find((row) => row.classList.contains('selected') && !row.hidden);
        if (!selected) selectTrade(tradeRows.find((row) => !row.hidden));
    }

    tradeRows.forEach((row) => row.addEventListener('click', () => selectTrade(row)));
    outcomeFilter?.addEventListener('change', applyOutcomeFilter);
    document.getElementById('analytics-reset')?.addEventListener('click', () => {
        if (outcomeFilter) outcomeFilter.value = 'all';
        applyOutcomeFilter();
        selectTrade(tradeRows[0]);
    });

    document.getElementById('analytics-show-provenance')?.addEventListener('click', (event) => {
        const context = document.getElementById('analytics-provenance');
        if (!context) return;
        if (['c', 'd'].includes(analyticsView?.dataset.analyticsDirection)) {
            context.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
            return;
        }
        const visible = context.classList.toggle('force-visible');
        event.currentTarget.textContent = visible ? 'Ẩn provenance' : 'Xem provenance';
        if (visible) context.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    });

    setAnalyticsDirection('a');
    applyOutcomeFilter();
    selectTrade(tradeRows[0]);

    function svgElement(name, attributes, text) {
        const element = document.createElementNS('http://www.w3.org/2000/svg', name);
        Object.entries(attributes || {}).forEach(([key, value]) => element.setAttribute(key, String(value)));
        if (text !== undefined) element.textContent = text;
        return element;
    }

    function drawCandles() {
        const svg = document.getElementById('candle-chart');
        if (!svg) return;
        svg.replaceChildren();

        const width = 1040;
        const height = 560;
        const plotLeft = 42;
        const plotRight = 970;
        const plotTop = 26;
        const plotBottom = 510;
        const candles = [
            [1.1708,1.1718,1.1702,1.1714],[1.1714,1.1721,1.1709,1.1710],[1.1710,1.1716,1.1704,1.1707],[1.1707,1.1715,1.1701,1.1712],
            [1.1712,1.1724,1.1708,1.1721],[1.1721,1.1727,1.1715,1.1724],[1.1724,1.1730,1.1718,1.1720],[1.1720,1.1726,1.1714,1.1717],
            [1.1717,1.1725,1.1711,1.1722],[1.1722,1.1735,1.1718,1.1732],[1.1732,1.1741,1.1727,1.1738],[1.1738,1.1744,1.1730,1.1734],
            [1.1734,1.1742,1.1729,1.1739],[1.1739,1.1751,1.1736,1.1748],[1.1748,1.1755,1.1741,1.1744],[1.1744,1.1750,1.1736,1.1739],
            [1.1739,1.1745,1.1729,1.1732],[1.1732,1.1738,1.1724,1.1728],[1.1728,1.1735,1.1721,1.1731],[1.1731,1.1741,1.1728,1.1738],
            [1.1738,1.1747,1.1733,1.1744],[1.1744,1.1752,1.1739,1.1748],[1.1748,1.1754,1.1740,1.1742],[1.1742,1.1749,1.1735,1.1739],
            [1.1739,1.1746,1.1730,1.1734],[1.1734,1.1742,1.1727,1.1730],[1.1730,1.1737,1.1724,1.1735],[1.1735,1.1744,1.1730,1.1740],
            [1.1740,1.1750,1.1736,1.1747],[1.1747,1.1756,1.1742,1.1752],[1.1752,1.1758,1.1746,1.1749],[1.1749,1.1754,1.1740,1.1744],
            [1.1744,1.1750,1.1735,1.1739],[1.1739,1.1745,1.1731,1.1736],[1.1736,1.1742,1.1728,1.1733],[1.1733,1.1741,1.1729,1.1739]
        ];
        const minPrice = 1.1695;
        const maxPrice = 1.1785;
        const xStep = (plotRight - plotLeft) / candles.length;
        const y = (price) => plotBottom - ((price - minPrice) / (maxPrice - minPrice)) * (plotBottom - plotTop);

        for (let i = 0; i <= 6; i += 1) {
            const gy = plotTop + ((plotBottom - plotTop) / 6) * i;
            svg.appendChild(svgElement('line', { x1: plotLeft, y1: gy, x2: plotRight, y2: gy, class: 'grid' }));
            const price = maxPrice - ((maxPrice - minPrice) / 6) * i;
            svg.appendChild(svgElement('text', { x: 980, y: gy + 4, class: 'axis-label' }, price.toFixed(5)));
        }
        for (let i = 0; i <= 6; i += 1) {
            const gx = plotLeft + ((plotRight - plotLeft) / 6) * i;
            svg.appendChild(svgElement('line', { x1: gx, y1: plotTop, x2: gx, y2: plotBottom, class: 'grid' }));
        }

        const zoneTop = y(1.17425);
        const zoneBottom = y(1.17355);
        svg.appendChild(svgElement('rect', { x: 350, y: zoneTop, width: 375, height: zoneBottom - zoneTop, rx: 2, class: 'zone' }));
        svg.appendChild(svgElement('text', { x: 358, y: zoneTop - 8, class: 'marker-label' }, 'Retest zone'));

        candles.forEach(([open, high, low, close], index) => {
            const x = plotLeft + xStep * index + xStep / 2;
            const bullish = close >= open;
            const klass = bullish ? 'bull' : 'bear';
            svg.appendChild(svgElement('line', { x1: x, y1: y(high), x2: x, y2: y(low), class: `wick ${klass}` }));
            const top = Math.min(y(open), y(close));
            const bodyHeight = Math.max(2, Math.abs(y(open) - y(close)));
            svg.appendChild(svgElement('rect', { x: x - 6, y: top, width: 12, height: bodyHeight, rx: 1, class: klass }));
        });

        const levels = [
            { price: 1.1779, cls: 'tp-line', label: 'TP 1.17790' },
            { price: 1.1739, cls: 'entry-line', label: 'ENTRY 1.17390' },
            { price: 1.1719, cls: 'sl-line', label: 'SL 1.17190' }
        ];
        levels.forEach((level) => {
            const ly = y(level.price);
            svg.appendChild(svgElement('line', { x1: 610, y1: ly, x2: plotRight, y2: ly, class: level.cls }));
            svg.appendChild(svgElement('text', { x: 824, y: ly - 6, class: 'marker-label' }, level.label));
        });

        const cutoffX = plotLeft + xStep * 31.5;
        svg.appendChild(svgElement('line', { x1: cutoffX, y1: plotTop, x2: cutoffX, y2: plotBottom, class: 'cutoff' }));
        svg.appendChild(svgElement('text', { x: cutoffX - 42, y: plotTop + 14, class: 'marker-label' }, 'REPLAY CUTOFF'));

        const timeLabels = ['09:00', '10:30', '12:00', '13:30', '15:00', '16:30'];
        timeLabels.forEach((label, index) => {
            const tx = plotLeft + ((plotRight - plotLeft) / (timeLabels.length - 1)) * index;
            svg.appendChild(svgElement('text', { x: tx - 14, y: 536, class: 'axis-label' }, label));
        });
    }

    drawCandles();
})();
