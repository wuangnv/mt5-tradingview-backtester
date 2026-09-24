(() => {
    const app = document.getElementById('fx-app');
    const shell = document.querySelector('.fx-shell');
    const railButtons = Array.from(document.querySelectorAll('.fx-rail [data-space]'));
    const spaces = Array.from(document.querySelectorAll('[data-space-view]'));
    const panel = document.getElementById('fx-side-panel');
    const panelTitle = document.getElementById('fx-panel-title');
    const panelKicker = document.getElementById('fx-panel-kicker');
    const panelContent = document.getElementById('fx-panel-content');
    const gotoPopover = document.getElementById('fx-goto-popover');
    const playButton = document.getElementById('fx-play');
    const candleCounter = document.getElementById('fx-candle-counter');
    let activeSpace = 'overview';
    let playTimer = null;
    let replayIndex = 186;

    const panelMeta = {
        journal: { kicker: 'JOURNAL', title: 'Review phiên', template: 'fx-panel-journal-template' },
        analytics: { kicker: 'PHÂN TÍCH', title: 'Hiệu suất fixture', template: 'fx-panel-analytics-template' },
        order: { kicker: 'NHÁP LỆNH', title: 'Replay order', template: 'fx-panel-order-template' },
    };

    function setSpace(name) {
        if (['analytics', 'trade'].includes(name)) {
            setSpace('chart');
            railButtons.forEach((button) => button.classList.toggle('active', button.dataset.space === name));
            openPanel(name === 'analytics' ? 'analytics' : 'order');
            return;
        }
        activeSpace = name;
        spaces.forEach((space) => space.classList.toggle('active', space.dataset.spaceView === name));
        railButtons.forEach((button) => button.classList.toggle('active', button.dataset.space === name));
        closePanel();
    }

    function openPanel(name) {
        const meta = panelMeta[name];
        const template = document.getElementById(meta?.template);
        if (!meta || !template) return;
        panelKicker.textContent = meta.kicker;
        panelTitle.textContent = meta.title;
        panelContent.replaceChildren(template.content.cloneNode(true));
        shell.classList.add('panel-open');
        document.querySelectorAll('[data-panel]').forEach((button) => button.classList.toggle('active', button.dataset.panel === name));
        bindPanelControls();
    }

    function closePanel() {
        shell.classList.remove('panel-open');
        document.querySelectorAll('[data-panel]').forEach((button) => button.classList.remove('active'));
    }

    function bindPanelControls() {
        panelContent.querySelectorAll('[data-side]').forEach((button) => {
            button.addEventListener('click', () => {
                panelContent.querySelectorAll('[data-side]').forEach((item) => item.classList.toggle('active', item === button));
            });
        });
    }

    railButtons.forEach((button) => button.addEventListener('click', () => setSpace(button.dataset.space)));
    document.querySelectorAll('[data-space-jump]').forEach((button) => button.addEventListener('click', () => setSpace(button.dataset.spaceJump)));
    document.querySelectorAll('[data-panel]').forEach((button) => button.addEventListener('click', () => {
        if (activeSpace !== 'chart') setSpace('chart');
        openPanel(button.dataset.panel);
    }));
    document.getElementById('fx-panel-close')?.addEventListener('click', closePanel);

    document.getElementById('fx-theme-toggle')?.addEventListener('click', () => {
        const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
        document.documentElement.dataset.theme = next;
    });
    document.querySelector('[data-settings-theme]')?.addEventListener('click', () => document.getElementById('fx-theme-toggle')?.click());

    document.getElementById('fx-goto-button')?.addEventListener('click', (event) => {
        const nextHidden = !gotoPopover.hidden;
        gotoPopover.hidden = nextHidden;
        event.stopPropagation();
    });
    gotoPopover?.addEventListener('click', (event) => event.stopPropagation());
    document.addEventListener('click', () => { if (gotoPopover) gotoPopover.hidden = true; });

    document.querySelectorAll('.fx-timeframes button').forEach((button) => {
        button.addEventListener('click', () => {
            document.querySelectorAll('.fx-timeframes button').forEach((item) => item.classList.toggle('active', item === button));
        });
    });

    function updateReplayCounter() {
        if (candleCounter) candleCounter.textContent = `Nến ${replayIndex} / 420`;
    }

    function stopReplay() {
        if (playTimer) window.clearInterval(playTimer);
        playTimer = null;
        if (playButton) playButton.textContent = '▶';
    }

    playButton?.addEventListener('click', () => {
        if (playTimer) {
            stopReplay();
            return;
        }
        playButton.textContent = '❚❚';
        playTimer = window.setInterval(() => {
            replayIndex = Math.min(420, replayIndex + 1);
            updateReplayCounter();
            if (replayIndex >= 420) stopReplay();
        }, 550);
    });
    document.getElementById('fx-step-back')?.addEventListener('click', () => { stopReplay(); replayIndex = Math.max(1, replayIndex - 1); updateReplayCounter(); });
    document.getElementById('fx-step-forward')?.addEventListener('click', () => { stopReplay(); replayIndex = Math.min(420, replayIndex + 1); updateReplayCounter(); });
    document.getElementById('fx-speed')?.addEventListener('change', () => { if (playTimer) { stopReplay(); playButton?.click(); } });

    function svgElement(name, attributes, text) {
        const element = document.createElementNS('http://www.w3.org/2000/svg', name);
        Object.entries(attributes || {}).forEach(([key, value]) => element.setAttribute(key, String(value)));
        if (text !== undefined) element.textContent = text;
        return element;
    }

    function drawCandles() {
        const svg = document.getElementById('fx-candle-chart');
        if (!svg) return;
        svg.replaceChildren();
        const plot = { left: 44, right: 1028, top: 34, bottom: 570 };
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
        const step = (plot.right - plot.left) / candles.length;
        const y = (price) => plot.bottom - ((price - minPrice) / (maxPrice - minPrice)) * (plot.bottom - plot.top);

        for (let i = 0; i <= 6; i += 1) {
            const gy = plot.top + ((plot.bottom - plot.top) / 6) * i;
            const gx = plot.left + ((plot.right - plot.left) / 6) * i;
            svg.appendChild(svgElement('line', { x1: plot.left, y1: gy, x2: plot.right, y2: gy, class: 'grid' }));
            svg.appendChild(svgElement('line', { x1: gx, y1: plot.top, x2: gx, y2: plot.bottom, class: 'grid' }));
            const price = maxPrice - ((maxPrice - minPrice) / 6) * i;
            svg.appendChild(svgElement('text', { x: 1038, y: gy + 4, class: 'axis' }, price.toFixed(5)));
        }

        const zoneTop = y(1.17425);
        const zoneBottom = y(1.17355);
        svg.appendChild(svgElement('rect', { x: 370, y: zoneTop, width: 390, height: zoneBottom - zoneTop, rx: 2, class: 'zone' }));
        svg.appendChild(svgElement('text', { x: 378, y: zoneTop - 8, class: 'label' }, 'Retest zone'));

        candles.forEach(([open, high, low, close], index) => {
            const x = plot.left + step * index + step / 2;
            const klass = close >= open ? 'bull' : 'bear';
            svg.appendChild(svgElement('line', { x1: x, y1: y(high), x2: x, y2: y(low), class: `wick ${klass}` }));
            const top = Math.min(y(open), y(close));
            svg.appendChild(svgElement('rect', { x: x - 6, y: top, width: 12, height: Math.max(2, Math.abs(y(open) - y(close))), rx: 1, class: klass }));
        });

        [
            { price: 1.1779, cls: 'tp-line', label: 'TP 1.17790' },
            { price: 1.1739, cls: 'entry-line', label: 'ENTRY 1.17390' },
            { price: 1.1719, cls: 'sl-line', label: 'SL 1.17190' },
        ].forEach((level) => {
            const ly = y(level.price);
            svg.appendChild(svgElement('line', { x1: 645, y1: ly, x2: plot.right, y2: ly, class: level.cls }));
            svg.appendChild(svgElement('text', { x: 842, y: ly - 6, class: 'label' }, level.label));
        });

        const cutoffX = plot.left + step * 31.5;
        svg.appendChild(svgElement('line', { x1: cutoffX, y1: plot.top, x2: cutoffX, y2: plot.bottom, class: 'cutoff' }));
        svg.appendChild(svgElement('text', { x: cutoffX - 44, y: plot.top + 14, class: 'label' }, 'REPLAY CUTOFF'));
        ['09:00','10:30','12:00','13:30','15:00','16:30'].forEach((label, index, labels) => {
            const tx = plot.left + ((plot.right - plot.left) / (labels.length - 1)) * index;
            svg.appendChild(svgElement('text', { x: tx - 15, y: 600, class: 'axis' }, label));
        });
    }

    drawCandles();
})();
