class TradingPlaybook {
    constructor() {
        this.storageKey = 'trading_playbook_workspace_v3';
        this.legacyWorkspaceKey = 'trading_playbook_workspace_v2';
        this.legacyNotesKey = 'trading_playbook_notes_v1';
        this.activeView = 'journal';
        this.activeNoteId = null;
        this.activeSetupId = null;
        this.activeFilter = 'all';
        this.activeTag = '';
        this.searchText = '';
        this.saveTimer = null;

        this.overlay = document.getElementById('playbook-overlay');
        this.panel = document.querySelector('.playbook-panel');
        this.toggleBtn = document.getElementById('playbook-toggle-btn');
        this.closeBtn = document.getElementById('playbook-close-btn');
        this.newBtn = document.getElementById('playbook-new-note-btn');
        this.fullscreenBtn = document.getElementById('playbook-fullscreen-btn');
        this.tabBtn = document.getElementById('playbook-tab-btn');
        this.resizeHandle = document.getElementById('playbook-resize-handle');
        this.searchInput = document.getElementById('playbook-search-input');
        this.noteList = document.getElementById('playbook-note-list');
        this.tagCloud = document.getElementById('playbook-tag-cloud');
        this.saveState = document.getElementById('playbook-save-state');

        this.journalView = document.getElementById('playbook-journal-view');
        this.setupsView = document.getElementById('playbook-setups-view');
        this.roadmapView = document.getElementById('playbook-roadmap-view');
        this.statsGrid = document.getElementById('playbook-stats-grid');
        this.insightStrip = document.getElementById('playbook-insight-strip');

        this.titleInput = document.getElementById('playbook-title-input');
        this.tagsInput = document.getElementById('playbook-tags-input');
        this.symbolInput = document.getElementById('playbook-symbol-input');
        this.timeframeInput = document.getElementById('playbook-timeframe-input');
        this.setupInput = document.getElementById('playbook-setup-input');
        this.rrInput = document.getElementById('playbook-rr-input');
        this.resultInput = document.getElementById('playbook-result-input');
        this.bodyInput = document.getElementById('playbook-body-input');
        this.imageInput = document.getElementById('playbook-image-input');
        this.dropZone = document.getElementById('playbook-drop-zone');
        this.imageGrid = document.getElementById('playbook-image-grid');

        this.setupList = document.getElementById('playbook-setup-list');
        this.setupTitleInput = document.getElementById('playbook-setup-title-input');
        this.setupStatusInput = document.getElementById('playbook-setup-status-input');
        this.setupMarketInput = document.getElementById('playbook-setup-market-input');
        this.setupTimeframeInput = document.getElementById('playbook-setup-timeframe-input');
        this.setupSampleInput = document.getElementById('playbook-setup-sample-input');
        this.setupBodyInput = document.getElementById('playbook-setup-body-input');

        this.roadmapInput = document.getElementById('playbook-roadmap-input');
        this.roadmapAddBtn = document.getElementById('playbook-roadmap-add-btn');
        this.roadmapBoard = document.getElementById('playbook-roadmap-board');

        if (!this.overlay || !this.toggleBtn || !this.noteList) return;

        this.workspace = this.loadWorkspace();
        this.activeNoteId = this.workspace.notes[0]?.id || null;
        this.activeSetupId = this.workspace.setups[0]?.id || null;
        this.init();
    }

    init() {
        this.bindPanel();
        this.bindPanelModes();
        this.bindGlobalControls();
        this.bindJournalControls();
        this.bindSetupControls();
        this.bindRoadmapControls();
        this.switchView('journal');
        this.applyInitialMode();
    }

    loadWorkspace() {
        try {
            const saved = JSON.parse(localStorage.getItem(this.storageKey) || 'null');
            if (saved?.notes && saved?.setups && saved?.roadmap) {
                const workspace = this.normalizeWorkspace(saved);
                this.persist(workspace);
                return workspace;
            }
        } catch (_) {
            localStorage.removeItem(this.storageKey);
        }

        let notes = null;
        try {
            const legacy = JSON.parse(localStorage.getItem(this.legacyWorkspaceKey) || '[]');
            if (Array.isArray(legacy) && legacy.length) notes = legacy;
        } catch (_) {
            notes = null;
        }

        if (!notes) {
            const legacyText = localStorage.getItem(this.legacyNotesKey);
            notes = this.seedNotes();
            if (legacyText) {
                notes.unshift(this.createNote({
                    title: 'Imported personal notes',
                    tags: ['Journal', 'Imported'],
                    body: legacyText
                }));
            }
        }

        const workspace = this.normalizeWorkspace({
            notes,
            setups: this.seedSetups(),
            roadmap: this.seedRoadmap()
        });
        this.persist(workspace);
        return workspace;
    }

    normalizeWorkspace(workspace) {
        const notes = (workspace.notes || []).map(note => ({
            setup: '',
            rr: '',
            images: [],
            ...note
        })).map(note => this.localizeDefaultNote(note));

        const setups = this.mergeDefaultSetups(workspace.setups || []);

        return {
            notes: notes.length ? notes : this.seedNotes(),
            setups: setups.length ? setups : this.seedSetups(),
            roadmap: this.localizeRoadmap(workspace.roadmap || [])
        };
    }

    localizeDefaultNote(note) {
        const careerSeed = this.seedNotes()[0];
        const templateSeed = this.seedNotes()[1];

        if (note.title === 'AI-era trading career map' || note.setup === 'Career Direction') {
            return { ...note, title: careerSeed.title, body: careerSeed.body };
        }

        if (note.title === 'Backtest review template') {
            return { ...note, title: templateSeed.title, body: templateSeed.body };
        }

        return note;
    }

    localizeRoadmap(roadmap) {
        if (!roadmap.length) return this.seedRoadmap();

        const titleMap = {
            'Build 100-trade journal sample': 'Ghi lại 100 mẫu backtest có screenshot',
            'Validate 2 repeatable setups': 'Validate 2 setup liquidity có expectancy dương',
            'Publish one research report on GitHub': 'Viết 1 research report đơn giản từ journal',
            'Turn best setup into alert rules': 'Biến setup tốt nhất thành alert rule',
            'Create public trading research portfolio': 'Tạo portfolio trading research cá nhân'
        };

        return roadmap.map(item => ({
            ...item,
            title: titleMap[item.title] || item.title
        }));
    }

    seedNotes() {
        return [
            this.createNote({
                title: 'Định hướng nghề trading trong thời AI',
                tags: ['Career', 'AI Research'],
                result: 'Idea',
                setup: 'Career Direction',
                body: [
                    'Hướng chính:',
                    '- Discretionary trader + công cụ quant/data + AI-assisted research.',
                    '',
                    'Nên học gì:',
                    '- Market microstructure: liquidity, spread, execution, session volatility.',
                    '- Statistics: expectancy, drawdown, sample size, market regime.',
                    '- Python/data: làm sạch journal, phân tích setup, tạo report.',
                    '- Automation: bắt đầu bằng alert, chỉ auto-trade khi rule thật rõ.',
                    '',
                    'Điều cần nhớ:',
                    '- Bot trading không làm tâm lý biến mất. Nó chuyển tâm lý thành hành vi hệ thống: áp lực liquidity, giới hạn risk, crowded strategy, và quyết định của người viết thuật toán.',
                    '- Mục tiêu của bạn không phải học thuộc một mô hình. Mục tiêu là tự xây một edge có dữ liệu chứng minh.'
                ].join('\n')
            }),
            this.createNote({
                title: 'Mẫu ghi chú sau khi backtest',
                tags: ['Backtest', 'Strategy'],
                result: 'Idea',
                setup: 'Liquidity sweep',
                body: this.getBacktestTemplate()
            })
        ];
    }

    seedSetups() {
        return [
            this.createSetup({
                templateKey: 'asian-range-sweep',
                title: 'Quét liquidity Asian range',
                status: 'Testing',
                market: 'London open / EUR, GBP pairs',
                timeframe: 'M5-M15',
                sample: 0,
                body: [
                    'Phù hợp khi:',
                    '- Bạn day trade forex và thấy thị trường tạo Asian range hẹp trước phiên London.',
                    '- Nên ưu tiên EURUSD, GBPUSD, EURJPY, GBPJPY khi spread bình thường.',
                    '',
                    'Ý tưởng liquidity:',
                    '- Đỉnh/đáy Asian session thường trở thành vùng liquidity rất rõ.',
                    '- London có thể sweep một bên, bẫy trader breakout, rồi quay về phía còn lại của range.',
                    '',
                    'Quy tắc entry:',
                    '- Đánh dấu Asian high và Asian low.',
                    '- Chờ London sweep một phía của range.',
                    '- Chỉ vào sau khi có rejection: đóng nến trở lại trong range, displacement, hoặc lower timeframe shift.',
                    '- Target 1 ở midpoint của range, target tiếp theo ở phía đối diện của Asian range.',
                    '',
                    'Invalidation:',
                    '- Giá accept bên ngoài Asian range bằng các nến mạnh.',
                    '- Sweep xảy ra lúc tin mạnh hoặc spread mở rộng.',
                    '- Sau sweep không có displacement.',
                    '',
                    'Câu hỏi khi backtest:',
                    '- Cặp nào tôn trọng Asian sweep tốt nhất?',
                    '- Sweep high hay sweep low hiệu quả hơn?',
                    '- Chờ nến đóng lại trong range có cải thiện win rate không?'
                ].join('\n')
            }),
            this.createSetup({
                templateKey: 'london-sweep-reversal',
                title: 'London open sweep reversal',
                status: 'Testing',
                market: 'London open',
                timeframe: 'M5-M15',
                sample: 0,
                body: [
                    'Phù hợp khi:',
                    '- Bạn muốn tìm 1-2 lệnh sạch đầu phiên London, không trade quá nhiều.',
                    '',
                    'Ý tưởng liquidity:',
                    '- London open thường hunt vùng high/low gần nhất hoặc equal highs/equal lows trong ngày.',
                    '- Setup reversal đẹp nhất xuất hiện khi cú sweep thất bại và giá không tiếp tục được.',
                    '',
                    'Quy tắc entry:',
                    '- Xác định liquidity pool gần nhất trước London open.',
                    '- Chờ sweep kèm rejection candle hoặc market structure shift.',
                    '- Entry khi giá retrace về rejection candle / small imbalance / broken structure.',
                    '- Stop đặt ngoài cực trị của sweep.',
                    '- Target internal liquidity tiếp theo, sau đó là midpoint hoặc vùng liquidity đối diện.',
                    '',
                    'Invalidation:',
                    '- Nến đóng và giữ chắc bên ngoài vùng vừa bị sweep.',
                    '- Không có lower timeframe shift sau sweep.',
                    '- Hướng trade ngược với impulse HTF quá mạnh.',
                    '',
                    'Câu hỏi khi backtest:',
                    '- Reversal sau 1 lần sweep tốt hơn hay sau double sweep tốt hơn?',
                    '- Average R trước NY open là bao nhiêu?'
                ].join('\n')
            }),
            this.createSetup({
                templateKey: 'ny-continuation-after-london',
                title: 'NY continuation sau London impulse',
                status: 'Testing',
                market: 'New York open',
                timeframe: 'M5-M15',
                sample: 0,
                body: [
                    'Phù hợp khi:',
                    '- London đã tạo hướng rõ, bạn muốn trade tiếp diễn thay vì bắt đảo chiều.',
                    '',
                    'Ý tưởng liquidity:',
                    '- London tạo impulse và để lại pullback liquidity.',
                    '- NY thường sweep vùng pullback high/low nhỏ trước khi tiếp tục hướng London.',
                    '',
                    'Quy tắc entry:',
                    '- Xác định hướng impulse của London.',
                    '- Chờ NY pullback để sweep minor liquidity ngược hướng chính.',
                    '- Entry sau rejection và structure shift trở lại cùng hướng London.',
                    '- Stop ngoài cực trị pullback sweep của NY.',
                    '- Target London high/low extension hoặc HTF liquidity tiếp theo.',
                    '',
                    'Invalidation:',
                    '- NY phá cấu trúc London mạnh theo hướng ngược lại.',
                    '- Pullback quá nông, R:R xấu.',
                    '- Tin tức tạo spike một chiều nhưng không có retest sạch.',
                    '',
                    'Câu hỏi khi backtest:',
                    '- Cặp nào tiếp diễn tốt hơn trong NY?',
                    '- Chờ NY sweep có giảm false continuation entry không?'
                ].join('\n')
            }),
            this.createSetup({
                templateKey: 'htf-poi-sweep',
                title: 'HTF POI liquidity sweep',
                status: 'Testing',
                market: 'London / NY với H1-H4 context',
                timeframe: 'M15-H1',
                sample: 0,
                body: [
                    'Phù hợp khi:',
                    '- Bạn muốn trade ít hơn nhưng sạch hơn, dùng context H1/H4 thay vì đuổi theo mọi chuyển động M5.',
                    '',
                    'Ý tưởng liquidity:',
                    '- Giá đi vào một HTF point of interest, sweep internal liquidity, rồi phản ứng.',
                    '- Cách này giúp tránh trade liquidity sweep ở vị trí ngẫu nhiên.',
                    '',
                    'Quy tắc entry:',
                    '- Đánh dấu H1/H4 supply-demand zone, prior swing, hoặc unmitigated imbalance.',
                    '- Chờ giá chạm POI.',
                    '- Trên M5/M15, chờ liquidity sweep bên trong POI.',
                    '- Entry sau displacement rời khỏi POI và pullback.',
                    '- Stop ngoài cực trị sweep trong POI.',
                    '',
                    'Invalidation:',
                    '- Giá accept xuyên qua POI.',
                    '- Trong POI không có sweep hoặc không có displacement.',
                    '- HTF trend quá mạnh ngược hướng reversal của bạn.',
                    '',
                    'Câu hỏi khi backtest:',
                    '- Loại HTF POI nào cho R tốt nhất?',
                    '- Context H4 có tốt hơn H1 không?'
                ].join('\n')
            }),
            this.createSetup({
                templateKey: 'breakout-retest-acceptance',
                title: 'Breakout retest sau khi accept liquidity',
                status: 'Testing',
                market: 'Trending day / London hoặc NY',
                timeframe: 'M5-M30',
                sample: 0,
                body: [
                    'Phù hợp khi:',
                    '- Giá không đảo chiều sau sweep mà accept rõ bên ngoài vùng liquidity.',
                    '',
                    'Ý tưởng liquidity:',
                    '- Không phải liquidity sweep nào cũng đảo chiều.',
                    '- Nếu giá phá, accept, rồi retest vùng vừa sweep, phe bị kẹt có thể tạo lực cho continuation.',
                    '',
                    'Quy tắc entry:',
                    '- Đánh dấu equal highs/equal lows hoặc prior session high/low rõ ràng.',
                    '- Chờ break mạnh và đóng nến vượt qua liquidity.',
                    '- Không fade cú break đầu tiên.',
                    '- Entry khi retest giữ được level như support/resistance.',
                    '- Target HTF liquidity pool tiếp theo.',
                    '',
                    'Invalidation:',
                    '- Retest thất bại và giá đóng lại trong range cũ.',
                    '- Break chỉ là news spike và spread bất thường.',
                    '- Retest tạo stop quá xa, R:R xấu.',
                    '',
                    'Câu hỏi khi backtest:',
                    '- Rule accept nào tốt hơn: 1 nến đóng, 2 nến đóng, hay retest hold?',
                    '- Phiên nào có continuation sạch nhất?'
                ].join('\n')
            }),
            this.createSetup({
                templateKey: 'failed-breakout-trap',
                title: 'Failed breakout liquidity trap',
                status: 'Testing',
                market: 'Range day / late London / early NY',
                timeframe: 'M5-M15',
                sample: 0,
                body: [
                    'Phù hợp khi:',
                    '- Range day, breakout hay thất bại và giá quay lại vùng value.',
                    '',
                    'Ý tưởng liquidity:',
                    '- Trader breakout vào lệnh khi giá phá range.',
                    '- Nếu giá thất bại và đóng lại trong range, stop của họ có thể đẩy giá về phía còn lại.',
                    '',
                    'Quy tắc entry:',
                    '- Xác định intraday range rõ ràng.',
                    '- Chờ breakout vượt range high/low.',
                    '- Entry sau khi nến đóng trở lại trong range với momentum.',
                    '- Stop ngoài cực trị failed breakout.',
                    '- Target midpoint, sau đó là liquidity phía đối diện range.',
                    '',
                    'Invalidation:',
                    '- Giá retest và giữ được bên ngoài range.',
                    '- Range quá rộng, R:R không đẹp.',
                    '- HTF trend đang breakout quá mạnh.',
                    '',
                    'Câu hỏi khi backtest:',
                    '- Range size nào là lý tưởng?',
                    '- Có cần chốt một phần ở midpoint không?'
                ].join('\n')
            }),
            this.createSetup({
                templateKey: 'liquidity-sweep-continuation',
                title: 'Liquidity sweep continuation',
                status: 'Testing',
                market: 'London / NY session',
                timeframe: 'M15-H1',
                sample: 0,
                body: [
                    'Ý tưởng:',
                    '- Giá sweep vùng liquidity rõ ràng, rejection, rồi tiếp tục theo cấu trúc chính.',
                    '',
                    'Quy tắc entry:',
                    '- Sweep prior high/low.',
                    '- Có displacement hoặc rejection rõ.',
                    '- Entry khi retrace hoặc khi break xác nhận.',
                    '',
                    'Invalidation:',
                    '- Sau sweep không có rejection.',
                    '- News spike làm hướng đi không rõ hoặc spread/slippage bất thường.',
                    '',
                    'Ghi chú automation:',
                    '- Bắt đầu bằng alert detection trước khi nghĩ tới auto-entry.'
                ].join('\n')
            })
        ];
    }

    mergeDefaultSetups(existingSetups) {
        const defaults = this.seedSetups();
        const defaultByKey = new Map(defaults.map(setup => [setup.templateKey, setup]));
        const current = existingSetups.map(setup => {
            const normalized = { templateKey: '', ...setup };
            const localized = defaultByKey.get(normalized.templateKey);
            return localized ? { ...normalized, ...localized, id: normalized.id, createdAt: normalized.createdAt || localized.createdAt } : normalized;
        });
        const existingKeys = new Set(current.map(setup => setup.templateKey).filter(Boolean));
        const existingTitles = new Set(current.map(setup => setup.title));
        const missingDefaults = defaults.filter(setup => {
            if (setup.templateKey && existingKeys.has(setup.templateKey)) return false;
            return !existingTitles.has(setup.title);
        });

        return [...current, ...missingDefaults];
    }

    seedRoadmap() {
        return [
            this.createRoadmapItem('Ghi lại 100 mẫu backtest có screenshot', 'Learning'),
            this.createRoadmapItem('Validate 2 setup liquidity có expectancy dương', 'Testing'),
            this.createRoadmapItem('Viết 1 research report đơn giản từ journal', 'Validated'),
            this.createRoadmapItem('Biến setup tốt nhất thành alert rule', 'Automating'),
            this.createRoadmapItem('Tạo portfolio trading research cá nhân', 'Published')
        ];
    }

    getBacktestTemplate() {
        return [
            'Giả thuyết:',
            '- ',
            '',
            'Bối cảnh thị trường:',
            '- Session:',
            '- Trend/range:',
            '- Vùng liquidity:',
            '',
            'Kế hoạch trade:',
            '- Entry:',
            '- Stop loss:',
            '- Take profit:',
            '- Invalidation:',
            '',
            'Kết quả:',
            '- R multiple:',
            '- Mistake:',
            '- Bài học:',
            '',
            'Lần test tiếp theo:',
            '- '
        ].join('\n');
    }

    createNote(overrides = {}) {
        const now = new Date().toISOString();
        const context = this.getChartContext();

        return {
            id: `note_${Date.now()}_${Math.random().toString(16).slice(2)}`,
            title: 'Untitled note',
            tags: ['Backtest'],
            symbol: context.symbol,
            timeframe: context.timeframe,
            setup: '',
            rr: '',
            result: '',
            body: '',
            images: [],
            createdAt: now,
            updatedAt: now,
            ...overrides
        };
    }

    createSetup(overrides = {}) {
        const now = new Date().toISOString();
        return {
            id: `setup_${Date.now()}_${Math.random().toString(16).slice(2)}`,
            title: 'New setup',
            status: 'Learning',
            market: '',
            timeframe: '',
            sample: 0,
            body: '',
            createdAt: now,
            updatedAt: now,
            ...overrides
        };
    }

    createRoadmapItem(title, stage = 'Learning') {
        const now = new Date().toISOString();
        return {
            id: `road_${Date.now()}_${Math.random().toString(16).slice(2)}`,
            title,
            stage,
            createdAt: now,
            updatedAt: now
        };
    }

    bindPanel() {
        this.toggleBtn.addEventListener('click', () => this.toggle());
        if (this.closeBtn) this.closeBtn.addEventListener('click', () => this.close());

        this.overlay.addEventListener('click', (event) => {
            if (event.target === this.overlay) this.close();
        });

        document.addEventListener('keydown', (event) => {
            if (event.key === 'Escape' && this.overlay.classList.contains('open')) this.close();
        });
    }

    bindPanelModes() {
        if (this.fullscreenBtn) {
            this.fullscreenBtn.addEventListener('click', () => this.toggleFullscreen());
        }

        if (this.tabBtn) {
            this.tabBtn.addEventListener('click', () => {
                const url = new URL(window.location.href);
                url.searchParams.set('playbook', 'fullscreen');
                window.open(url.toString(), '_blank', 'noopener');
            });
        }

        if (!this.resizeHandle || !this.panel) return;

        this.resizeHandle.addEventListener('mousedown', (event) => {
            if (this.overlay.classList.contains('fullscreen')) return;
            event.preventDefault();
            const startX = event.clientX;
            const startWidth = this.panel.getBoundingClientRect().width;
            this.overlay.classList.add('resizing');

            const onMove = (moveEvent) => {
                const delta = startX - moveEvent.clientX;
                const min = Math.min(560, window.innerWidth - 24);
                const max = Math.max(min, window.innerWidth - 24);
                const nextWidth = Math.min(max, Math.max(min, startWidth + delta));
                document.documentElement.style.setProperty('--playbook-width', `${Math.round(nextWidth)}px`);
                localStorage.setItem('trading_playbook_panel_width', String(Math.round(nextWidth)));
            };

            const onUp = () => {
                this.overlay.classList.remove('resizing');
                document.removeEventListener('mousemove', onMove);
                document.removeEventListener('mouseup', onUp);
            };

            document.addEventListener('mousemove', onMove);
            document.addEventListener('mouseup', onUp);
        });
    }

    applyInitialMode() {
        const savedWidth = Number(localStorage.getItem('trading_playbook_panel_width'));
        if (Number.isFinite(savedWidth) && savedWidth > 0) {
            document.documentElement.style.setProperty('--playbook-width', `${savedWidth}px`);
        }

        const params = new URLSearchParams(window.location.search);
        if (params.get('playbook') === 'fullscreen') {
            this.open();
            this.setFullscreen(true);
        }
    }

    toggleFullscreen() {
        this.setFullscreen(!this.overlay.classList.contains('fullscreen'));
        this.open();
    }

    setFullscreen(enabled) {
        this.overlay.classList.toggle('fullscreen', enabled);
        this.fullscreenBtn?.classList.toggle('active', enabled);
        document.body.classList.toggle('playbook-fullscreen-lock', enabled);
    }

    bindGlobalControls() {
        document.querySelectorAll('[data-playbook-view]').forEach(button => {
            button.addEventListener('click', () => this.switchView(button.dataset.playbookView));
        });

        if (this.newBtn) {
            this.newBtn.addEventListener('click', () => {
                if (this.activeView === 'journal') this.addNote();
                if (this.activeView === 'setups') this.addSetup();
                if (this.activeView === 'roadmap') this.focusRoadmapInput();
            });
        }

        if (this.searchInput) {
            this.searchInput.addEventListener('input', () => {
                this.searchText = this.searchInput.value.trim().toLowerCase();
                this.renderSidebar();
            });
        }
    }

    bindJournalControls() {
        const duplicateBtn = document.getElementById('playbook-duplicate-note-btn');
        const deleteBtn = document.getElementById('playbook-delete-note-btn');

        if (duplicateBtn) duplicateBtn.addEventListener('click', () => this.duplicateActiveNote());
        if (deleteBtn) deleteBtn.addEventListener('click', () => this.deleteActiveNote());

        document.querySelectorAll('.playbook-filter').forEach(button => {
            button.addEventListener('click', () => {
                this.activeFilter = button.dataset.filter || 'all';
                this.activeTag = '';
                document.querySelectorAll('.playbook-filter').forEach(item => {
                    item.classList.toggle('active', item === button);
                });
                this.renderSidebar();
            });
        });

        document.querySelectorAll('#playbook-quick-tags button').forEach(button => {
            button.addEventListener('click', () => this.addTag(button.dataset.tag));
        });

        [this.titleInput, this.tagsInput, this.symbolInput, this.timeframeInput, this.setupInput, this.rrInput, this.resultInput, this.bodyInput].forEach(input => {
            if (!input) return;
            input.addEventListener('input', () => this.scheduleJournalSave());
            input.addEventListener('change', () => this.scheduleJournalSave());
        });

        if (this.imageInput) {
            this.imageInput.addEventListener('change', async () => {
                await this.addImageFiles(Array.from(this.imageInput.files || []));
                this.imageInput.value = '';
            });
        }

        if (this.dropZone) {
            ['dragenter', 'dragover'].forEach(type => {
                this.dropZone.addEventListener(type, (event) => {
                    event.preventDefault();
                    this.dropZone.classList.add('dragging');
                });
            });

            ['dragleave', 'drop'].forEach(type => {
                this.dropZone.addEventListener(type, (event) => {
                    event.preventDefault();
                    this.dropZone.classList.remove('dragging');
                });
            });

            this.dropZone.addEventListener('drop', async (event) => {
                await this.addImageFiles(Array.from(event.dataTransfer?.files || []));
            });
        }

        document.addEventListener('paste', async (event) => {
            if (!this.overlay.classList.contains('open') || this.activeView !== 'journal') return;
            const files = Array.from(event.clipboardData?.files || []).filter(file => file.type.startsWith('image/'));
            if (!files.length) return;
            event.preventDefault();
            await this.addImageFiles(files);
        });
    }

    bindSetupControls() {
        const newSetupBtn = document.getElementById('playbook-new-setup-btn');
        const deleteSetupBtn = document.getElementById('playbook-delete-setup-btn');

        if (newSetupBtn) newSetupBtn.addEventListener('click', () => this.addSetup());
        if (deleteSetupBtn) deleteSetupBtn.addEventListener('click', () => this.deleteActiveSetup());

        [this.setupTitleInput, this.setupStatusInput, this.setupMarketInput, this.setupTimeframeInput, this.setupSampleInput, this.setupBodyInput].forEach(input => {
            if (!input) return;
            input.addEventListener('input', () => this.scheduleSetupSave());
            input.addEventListener('change', () => this.scheduleSetupSave());
        });
    }

    bindRoadmapControls() {
        if (this.roadmapAddBtn) {
            this.roadmapAddBtn.addEventListener('click', () => this.addRoadmapItem());
        }

        if (this.roadmapInput) {
            this.roadmapInput.addEventListener('keydown', (event) => {
                if (event.key === 'Enter') this.addRoadmapItem();
            });
        }
    }

    switchView(view) {
        this.saveCurrentView();
        this.activeView = view;

        document.querySelectorAll('[data-playbook-view]').forEach(button => {
            button.classList.toggle('active', button.dataset.playbookView === view);
        });

        this.overlay.classList.remove('view-journal', 'view-setups', 'view-roadmap');
        this.overlay.classList.add(`view-${view}`);

        this.journalView.hidden = view !== 'journal';
        this.setupsView.hidden = view !== 'setups';
        this.roadmapView.hidden = view !== 'roadmap';
        document.querySelector('.playbook-filter-row').hidden = view !== 'journal';
        this.tagCloud.hidden = view !== 'journal';

        if (this.newBtn) {
            this.newBtn.textContent = view === 'journal' ? 'New Note' : view === 'setups' ? 'New Setup' : 'New Goal';
        }

        this.renderSidebar();
        this.renderActiveView();
    }

    renderActiveView() {
        if (this.activeView === 'journal') {
            this.renderJournalStats();
            this.loadActiveNote();
        }
        if (this.activeView === 'setups') {
            this.renderSetups();
            this.loadActiveSetup();
        }
        if (this.activeView === 'roadmap') this.renderRoadmap();
    }

    renderSidebar() {
        this.renderTagCloud();
        if (this.activeView === 'journal') return this.renderJournalList();
        if (this.activeView === 'setups') return this.renderSetupSidebar();
        this.renderRoadmapSidebar();
    }

    renderTagCloud() {
        if (!this.tagCloud) return;

        const tags = [...new Set(this.workspace.notes.flatMap(note => note.tags || []))].sort();
        this.tagCloud.innerHTML = tags.map(tag => {
            const active = tag === this.activeTag ? ' active' : '';
            return `<button class="${active}" data-tag="${this.escapeHtml(tag)}">#${this.escapeHtml(tag)}</button>`;
        }).join('');

        this.tagCloud.querySelectorAll('button').forEach(button => {
            button.addEventListener('click', () => {
                this.activeTag = this.activeTag === button.dataset.tag ? '' : button.dataset.tag;
                this.activeFilter = 'all';
                document.querySelectorAll('.playbook-filter').forEach(item => {
                    item.classList.toggle('active', item.dataset.filter === 'all');
                });
                this.renderSidebar();
            });
        });
    }

    renderJournalList() {
        const filtered = this.getFilteredNotes();

        if (!filtered.length) {
            this.noteList.innerHTML = '<div class="playbook-empty-state">No journal notes match this search.</div>';
            return;
        }

        this.noteList.innerHTML = filtered.map(note => {
            const active = note.id === this.activeNoteId ? ' active' : '';
            const rr = note.rr !== '' && note.rr !== null ? `${Number(note.rr).toFixed(1)}R` : '';
            const meta = [note.symbol, note.timeframe, note.setup, note.result, rr].filter(Boolean).join(' - ');
            const tags = (note.tags || []).slice(0, 4).map(tag => `<span class="playbook-tag">${this.escapeHtml(tag)}</span>`).join('');

            return `
                <button class="playbook-note-card${active}" data-note-id="${note.id}">
                    <span class="playbook-note-title">${this.escapeHtml(note.title || 'Untitled note')}</span>
                    <span class="playbook-note-meta">${this.escapeHtml(meta || this.formatDate(note.updatedAt))}</span>
                    <span class="playbook-note-tags">${tags}</span>
                </button>
            `;
        }).join('');

        this.noteList.querySelectorAll('.playbook-note-card').forEach(card => {
            card.addEventListener('click', () => {
                this.saveJournalNow();
                this.activeNoteId = card.dataset.noteId;
                this.renderJournalList();
                this.loadActiveNote();
            });
        });
    }

    renderSetupSidebar() {
        const setups = this.getFilteredSetups();
        if (!setups.length) {
            this.noteList.innerHTML = '<div class="playbook-empty-state">No setups found.</div>';
            return;
        }

        this.noteList.innerHTML = setups.map(setup => {
            const active = setup.id === this.activeSetupId ? ' active' : '';
            const meta = [setup.status, setup.market, setup.timeframe].filter(Boolean).join(' - ');
            return `
                <button class="playbook-note-card${active}" data-setup-id="${setup.id}">
                    <span class="playbook-note-title">${this.escapeHtml(setup.title)}</span>
                    <span class="playbook-note-meta">${this.escapeHtml(meta || 'Setup')}</span>
                    <span class="playbook-note-tags">
                        ${setup.templateKey ? '<span class="playbook-tag">Liquidity PA</span>' : ''}
                        <span class="playbook-tag">${Number(setup.sample || 0)} samples</span>
                    </span>
                </button>
            `;
        }).join('');

        this.noteList.querySelectorAll('[data-setup-id]').forEach(card => {
            card.addEventListener('click', () => {
                this.saveSetupNow();
                this.activeSetupId = card.dataset.setupId;
                this.renderSidebar();
                this.renderSetups();
                this.loadActiveSetup();
            });
        });
    }

    renderRoadmapSidebar() {
        const counts = this.getRoadmapStages().map(stage => {
            const count = this.workspace.roadmap.filter(item => item.stage === stage).length;
            return `
                <button class="playbook-note-card" data-road-stage="${stage}">
                    <span class="playbook-note-title">${stage}</span>
                    <span class="playbook-note-meta">${count} career items</span>
                </button>
            `;
        }).join('');

        this.noteList.innerHTML = counts;
        this.noteList.querySelectorAll('[data-road-stage]').forEach(button => {
            button.addEventListener('click', () => {
                const column = this.roadmapBoard?.querySelector(`[data-stage="${button.dataset.roadStage}"]`);
                column?.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'start' });
            });
        });
    }

    getFilteredNotes() {
        return this.workspace.notes
            .filter(note => {
                const tags = note.tags || [];
                const haystack = [note.title, note.body, note.symbol, note.timeframe, note.setup, note.result, tags.join(' ')].join(' ').toLowerCase();
                const matchesSearch = !this.searchText || haystack.includes(this.searchText);
                const matchesFilter = this.activeFilter === 'all' || tags.includes(this.activeFilter);
                const matchesTag = !this.activeTag || tags.includes(this.activeTag);
                return matchesSearch && matchesFilter && matchesTag;
            })
            .sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
    }

    getFilteredSetups() {
        return this.workspace.setups
            .filter(setup => {
                const haystack = [setup.title, setup.status, setup.market, setup.timeframe, setup.body].join(' ').toLowerCase();
                return !this.searchText || haystack.includes(this.searchText);
            })
            .sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
    }

    renderJournalStats() {
        const notes = this.workspace.notes;
        const trades = notes.filter(note => ['Win', 'Loss', 'Breakeven'].includes(note.result));
        const wins = trades.filter(note => note.result === 'Win').length;
        const losses = trades.filter(note => note.result === 'Loss').length;
        const rrValues = trades.map(note => Number(note.rr)).filter(value => Number.isFinite(value));
        const avgR = rrValues.length ? rrValues.reduce((sum, value) => sum + value, 0) / rrValues.length : 0;
        const winRate = trades.length ? (wins / trades.length) * 100 : 0;
        const bestSetup = this.getBestSetup(trades);
        const topMistake = this.getTopTag('Mistake');

        this.statsGrid.innerHTML = [
            ['Trades', trades.length],
            ['Win Rate', `${winRate.toFixed(0)}%`],
            ['Avg R', `${avgR.toFixed(2)}R`],
            ['Best Setup', bestSetup || 'Need data']
        ].map(([label, value]) => `
            <div class="playbook-stat-card">
                <span>${label}</span>
                <strong>${this.escapeHtml(value)}</strong>
            </div>
        `).join('');

        this.insightStrip.innerHTML = `
            <span>Wins: ${wins}</span>
            <span>Losses: ${losses}</span>
            <span>Tracked images: ${notes.reduce((sum, note) => sum + (note.images?.length || 0), 0)}</span>
            <span>Most useful review tag: ${this.escapeHtml(topMistake || 'Add Mistake tags')}</span>
        `;
    }

    getBestSetup(trades) {
        const grouped = {};
        trades.forEach(note => {
            const name = note.setup || 'Unlabeled';
            if (!grouped[name]) grouped[name] = [];
            grouped[name].push(Number(note.rr));
        });

        return Object.entries(grouped)
            .map(([name, values]) => ({
                name,
                avg: values.filter(Number.isFinite).reduce((sum, value) => sum + value, 0) / Math.max(1, values.filter(Number.isFinite).length),
                count: values.length
            }))
            .filter(item => item.count >= 2)
            .sort((a, b) => b.avg - a.avg)[0]?.name;
    }

    getTopTag(excludedTag) {
        const counts = {};
        this.workspace.notes.forEach(note => {
            (note.tags || []).forEach(tag => {
                if (tag === excludedTag) counts[tag] = (counts[tag] || 0) + 1;
            });
        });
        return Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0];
    }

    loadActiveNote() {
        const note = this.getActiveNote();
        if (!note) return;

        this.titleInput.value = note.title || '';
        this.tagsInput.value = (note.tags || []).join(', ');
        this.symbolInput.value = note.symbol || '';
        this.timeframeInput.value = note.timeframe || '';
        this.setupInput.value = note.setup || '';
        this.rrInput.value = note.rr ?? '';
        this.resultInput.value = note.result || '';
        this.bodyInput.value = note.body || '';
        this.renderImages(note);
        this.setSaveState('Saved locally');
    }

    scheduleJournalSave() {
        this.setSaveState('Saving...');
        clearTimeout(this.saveTimer);
        this.saveTimer = setTimeout(() => this.saveJournalNow(), 250);
    }

    saveJournalNow() {
        const note = this.getActiveNote();
        if (!note || !this.titleInput) return;

        note.title = this.titleInput.value.trim() || 'Untitled note';
        note.tags = this.parseTags(this.tagsInput.value);
        note.symbol = this.symbolInput.value.trim().toUpperCase();
        note.timeframe = this.timeframeInput.value.trim().toUpperCase();
        note.setup = this.setupInput.value.trim();
        note.rr = this.rrInput.value === '' ? '' : Number(this.rrInput.value);
        note.result = this.resultInput.value;
        note.body = this.bodyInput.value;
        note.updatedAt = new Date().toISOString();

        this.persist();
        this.renderSidebar();
        this.renderJournalStats();
        this.setSaveState('Saved locally');
    }

    addNote() {
        this.saveJournalNow();
        const note = this.createNote({
            title: 'New backtest note',
            body: this.getBacktestTemplate()
        });
        this.workspace.notes.unshift(note);
        this.activeNoteId = note.id;
        this.persist();
        this.renderSidebar();
        this.renderJournalStats();
        this.loadActiveNote();
        this.open();
        this.titleInput?.focus();
        this.titleInput?.select();
    }

    duplicateActiveNote() {
        const note = this.getActiveNote();
        if (!note) return;

        this.saveJournalNow();
        const copy = this.createNote({
            title: `${note.title || 'Untitled note'} copy`,
            tags: [...(note.tags || [])],
            symbol: note.symbol,
            timeframe: note.timeframe,
            setup: note.setup,
            rr: note.rr,
            result: note.result,
            body: note.body,
            images: JSON.parse(JSON.stringify(note.images || []))
        });

        this.workspace.notes.unshift(copy);
        this.activeNoteId = copy.id;
        this.persist();
        this.renderSidebar();
        this.renderJournalStats();
        this.loadActiveNote();
    }

    deleteActiveNote() {
        const note = this.getActiveNote();
        if (!note) return;

        const ok = confirm(`Delete "${note.title || 'Untitled note'}"?`);
        if (!ok) return;

        this.workspace.notes = this.workspace.notes.filter(item => item.id !== note.id);
        if (!this.workspace.notes.length) this.workspace.notes.push(this.createNote({ title: 'New note' }));
        this.activeNoteId = this.workspace.notes[0].id;
        this.persist();
        this.renderSidebar();
        this.renderJournalStats();
        this.loadActiveNote();
    }

    addTag(tag) {
        const tags = this.parseTags(this.tagsInput.value);
        if (!tags.includes(tag)) tags.push(tag);
        this.tagsInput.value = tags.join(', ');
        this.scheduleJournalSave();
    }

    async addImageFiles(files) {
        const note = this.getActiveNote();
        if (!note) return;

        const images = files.filter(file => file.type.startsWith('image/'));
        if (!images.length) return;

        this.setSaveState('Saving images...');
        for (const file of images) {
            const src = await this.fileToCompressedImage(file);
            note.images.push({
                id: `img_${Date.now()}_${Math.random().toString(16).slice(2)}`,
                name: file.name || 'chart-screenshot.png',
                src,
                createdAt: new Date().toISOString()
            });
        }

        note.updatedAt = new Date().toISOString();
        this.persist();
        this.renderImages(note);
        this.renderSidebar();
        this.renderJournalStats();
        this.setSaveState('Saved locally');
    }

    renderImages(note) {
        if (!this.imageGrid) return;

        if (!note.images?.length) {
            this.imageGrid.innerHTML = '<div class="playbook-empty-state">No images yet.</div>';
            return;
        }

        this.imageGrid.innerHTML = note.images.map(image => `
            <figure class="playbook-image-card">
                <img src="${image.src}" alt="${this.escapeHtml(image.name || 'Trading note image')}">
                <button type="button" data-image-id="${image.id}" title="Remove image">x</button>
            </figure>
        `).join('');

        this.imageGrid.querySelectorAll('button').forEach(button => {
            button.addEventListener('click', () => {
                note.images = note.images.filter(image => image.id !== button.dataset.imageId);
                note.updatedAt = new Date().toISOString();
                this.persist();
                this.renderImages(note);
                this.renderSidebar();
                this.renderJournalStats();
            });
        });
    }

    renderSetups() {
        if (!this.setupList) return;

        this.setupList.innerHTML = this.workspace.setups.map(setup => {
            const linkedTrades = this.workspace.notes.filter(note => note.setup === setup.title);
            const active = setup.id === this.activeSetupId ? ' active' : '';
            return `
                <button class="playbook-setup-card${active}" data-setup-id="${setup.id}">
                    <strong>${this.escapeHtml(setup.title)}</strong>
                    <span>${this.escapeHtml(setup.status)} - ${linkedTrades.length} linked trades${setup.templateKey ? ' - liquidity template' : ''}</span>
                </button>
            `;
        }).join('');

        this.setupList.querySelectorAll('[data-setup-id]').forEach(card => {
            card.addEventListener('click', () => {
                this.saveSetupNow();
                this.activeSetupId = card.dataset.setupId;
                this.renderSetups();
                this.renderSidebar();
                this.loadActiveSetup();
            });
        });
    }

    loadActiveSetup() {
        const setup = this.getActiveSetup();
        if (!setup) return;

        this.setupTitleInput.value = setup.title || '';
        this.setupStatusInput.value = setup.status || 'Learning';
        this.setupMarketInput.value = setup.market || '';
        this.setupTimeframeInput.value = setup.timeframe || '';
        this.setupSampleInput.value = setup.sample || 0;
        this.setupBodyInput.value = setup.body || '';
    }

    scheduleSetupSave() {
        clearTimeout(this.saveTimer);
        this.saveTimer = setTimeout(() => this.saveSetupNow(), 250);
    }

    saveSetupNow() {
        const setup = this.getActiveSetup();
        if (!setup || !this.setupTitleInput) return;

        setup.title = this.setupTitleInput.value.trim() || 'New setup';
        setup.status = this.setupStatusInput.value;
        setup.market = this.setupMarketInput.value.trim();
        setup.timeframe = this.setupTimeframeInput.value.trim().toUpperCase();
        setup.sample = Number(this.setupSampleInput.value || 0);
        setup.body = this.setupBodyInput.value;
        setup.updatedAt = new Date().toISOString();

        this.persist();
        this.renderSetups();
        this.renderSidebar();
    }

    addSetup() {
        this.saveSetupNow();
        const setup = this.createSetup({
            title: 'New setup',
            body: [
                'Ý tưởng:',
                '- ',
                '',
                'Quy tắc entry:',
                '- ',
                '',
                'Invalidation:',
                '- ',
                '',
                'Market regime phù hợp:',
                '- ',
                '',
                'Ghi chú automation:',
                '- '
            ].join('\n')
        });
        this.workspace.setups.unshift(setup);
        this.activeSetupId = setup.id;
        this.persist();
        this.renderSetups();
        this.renderSidebar();
        this.loadActiveSetup();
        this.setupTitleInput?.focus();
        this.setupTitleInput?.select();
    }

    deleteActiveSetup() {
        const setup = this.getActiveSetup();
        if (!setup) return;

        const ok = confirm(`Delete setup "${setup.title}"?`);
        if (!ok) return;

        this.workspace.setups = this.workspace.setups.filter(item => item.id !== setup.id);
        if (!this.workspace.setups.length) this.workspace.setups.push(this.createSetup({ title: 'New setup' }));
        this.activeSetupId = this.workspace.setups[0].id;
        this.persist();
        this.renderSetups();
        this.renderSidebar();
        this.loadActiveSetup();
    }

    renderRoadmap() {
        const stages = this.getRoadmapStages();
        this.roadmapBoard.innerHTML = stages.map(stage => {
            const cards = this.workspace.roadmap.filter(item => item.stage === stage);
            return `
                <section class="playbook-roadmap-column" data-stage="${stage}">
                    <header>
                        <strong>${stage}</strong>
                        <span>${cards.length}</span>
                    </header>
                    <div class="playbook-roadmap-cards">
                        ${cards.map(card => this.renderRoadmapCard(card)).join('')}
                    </div>
                </section>
            `;
        }).join('');

        this.roadmapBoard.querySelectorAll('[data-road-action]').forEach(button => {
            button.addEventListener('click', () => this.moveRoadmapItem(button.dataset.roadId, button.dataset.roadAction));
        });

        this.roadmapBoard.querySelectorAll('[data-road-delete]').forEach(button => {
            button.addEventListener('click', () => this.deleteRoadmapItem(button.dataset.roadDelete));
        });
    }

    renderRoadmapCard(card) {
        return `
            <article class="playbook-roadmap-card">
                <p>${this.escapeHtml(card.title)}</p>
                <div>
                    <button data-road-id="${card.id}" data-road-action="prev" title="Move left">&lt;</button>
                    <button data-road-id="${card.id}" data-road-action="next" title="Move right">&gt;</button>
                    <button data-road-delete="${card.id}" title="Delete">x</button>
                </div>
            </article>
        `;
    }

    addRoadmapItem() {
        const title = this.roadmapInput?.value.trim();
        if (!title) return;

        this.workspace.roadmap.push(this.createRoadmapItem(title, 'Learning'));
        this.roadmapInput.value = '';
        this.persist();
        this.renderRoadmap();
        this.renderSidebar();
    }

    moveRoadmapItem(id, direction) {
        const stages = this.getRoadmapStages();
        const item = this.workspace.roadmap.find(card => card.id === id);
        if (!item) return;

        const current = stages.indexOf(item.stage);
        const next = direction === 'next' ? Math.min(stages.length - 1, current + 1) : Math.max(0, current - 1);
        item.stage = stages[next];
        item.updatedAt = new Date().toISOString();
        this.persist();
        this.renderRoadmap();
        this.renderSidebar();
    }

    deleteRoadmapItem(id) {
        this.workspace.roadmap = this.workspace.roadmap.filter(item => item.id !== id);
        this.persist();
        this.renderRoadmap();
        this.renderSidebar();
    }

    focusRoadmapInput() {
        this.roadmapInput?.focus();
    }

    getRoadmapStages() {
        return ['Learning', 'Testing', 'Validated', 'Automating', 'Published'];
    }

    getActiveNote() {
        return this.workspace.notes.find(note => note.id === this.activeNoteId) || this.workspace.notes[0] || null;
    }

    getActiveSetup() {
        return this.workspace.setups.find(setup => setup.id === this.activeSetupId) || this.workspace.setups[0] || null;
    }

    saveCurrentView() {
        if (this.activeView === 'journal') this.saveJournalNow();
        if (this.activeView === 'setups') this.saveSetupNow();
    }

    fileToCompressedImage(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onerror = reject;
            reader.onload = () => {
                const image = new Image();
                image.onerror = reject;
                image.onload = () => {
                    const maxWidth = 1400;
                    const scale = Math.min(1, maxWidth / image.width);
                    const canvas = document.createElement('canvas');
                    canvas.width = Math.max(1, Math.round(image.width * scale));
                    canvas.height = Math.max(1, Math.round(image.height * scale));
                    const ctx = canvas.getContext('2d');
                    ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
                    resolve(canvas.toDataURL('image/jpeg', 0.84));
                };
                image.src = reader.result;
            };
            reader.readAsDataURL(file);
        });
    }

    getChartContext() {
        const symbolSelect = document.getElementById('symbol-select');
        const activeTf = document.querySelector('.tf-btn.active');

        return {
            symbol: symbolSelect?.value || 'EURUSD',
            timeframe: activeTf?.dataset.tf || 'H1'
        };
    }

    parseTags(value) {
        return [...new Set(
            String(value || '')
                .split(',')
                .map(tag => tag.trim())
                .filter(Boolean)
        )];
    }

    persist(workspace = this.workspace) {
        localStorage.setItem(this.storageKey, JSON.stringify(workspace));
    }

    setSaveState(text) {
        if (this.saveState) this.saveState.textContent = text;
    }

    formatDate(value) {
        if (!value) return '';
        return new Date(value).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    }

    escapeHtml(value) {
        return String(value || '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }

    open() {
        this.overlay.classList.add('open');
        this.overlay.setAttribute('aria-hidden', 'false');
        this.toggleBtn.classList.add('active');
        document.body.classList.toggle('playbook-fullscreen-lock', this.overlay.classList.contains('fullscreen'));
    }

    close() {
        this.saveCurrentView();
        this.overlay.classList.remove('open');
        this.overlay.setAttribute('aria-hidden', 'true');
        this.toggleBtn.classList.remove('active');
        document.body.classList.remove('playbook-fullscreen-lock');
    }

    toggle() {
        this.overlay.classList.contains('open') ? this.close() : this.open();
    }
}

window.addEventListener('DOMContentLoaded', () => {
    window.tradingPlaybook = new TradingPlaybook();
});
