/**
 * playbook.js — TradingPlaybook
 * Journal / Setups / Roadmap drawer. Local-first, same storage key as the
 * legacy playbook so existing notes survive the UI rebuild.
 */

const PLAYBOOK_KEY = 'trading_playbook_workspace_v3';

const pbT = (key, vars) => window.I18N ? window.I18N.t(key, vars) : key;

class TradingPlaybook {
    constructor() {
        this.workspace = this._load();
        this.view = 'journal';
        this.search = '';

        this._els = {
            drawer: document.getElementById('playbook-drawer'),
            noteTitle: document.getElementById('pb-note-title'),
            noteTags: document.getElementById('pb-note-tags'),
            noteBody: document.getElementById('pb-note-body'),
            noteAdd: document.getElementById('pb-note-add'),
            noteSearch: document.getElementById('pb-note-search'),
            noteList: document.getElementById('pb-note-list'),
            setupTitle: document.getElementById('pb-setup-title'),
            setupBody: document.getElementById('pb-setup-body'),
            setupAdd: document.getElementById('pb-setup-add'),
            setupList: document.getElementById('pb-setup-list'),
            roadmapTitle: document.getElementById('pb-roadmap-title'),
            roadmapAdd: document.getElementById('pb-roadmap-add'),
            roadmapList: document.getElementById('pb-roadmap-list')
        };

        this._wire();
        this.render();
    }

    _load() {
        try {
            const raw = localStorage.getItem(PLAYBOOK_KEY);
            if (raw) {
                const ws = JSON.parse(raw);
                return {
                    notes: Array.isArray(ws.notes) ? ws.notes : [],
                    setups: Array.isArray(ws.setups) ? ws.setups : [],
                    roadmap: Array.isArray(ws.roadmap) ? ws.roadmap : []
                };
            }
        } catch (err) { /* corrupted — start fresh */ }
        return { notes: [], setups: [], roadmap: [] };
    }

    _save() {
        localStorage.setItem(PLAYBOOK_KEY, JSON.stringify(this.workspace));
    }

    _wire() {
        document.querySelectorAll('.pb-tab').forEach(tab => {
            tab.addEventListener('click', () => this.switchView(tab.dataset.pbView));
        });
        this._els.noteAdd.addEventListener('click', () => this.addNote());
        this._els.setupAdd.addEventListener('click', () => this.addSetup());
        this._els.roadmapAdd.addEventListener('click', () => this.addGoal());
        this._els.noteSearch.addEventListener('input', () => {
            this.search = this._els.noteSearch.value.trim().toLowerCase();
            this.renderNotes();
        });
    }

    switchView(view) {
        this.view = view;
        document.querySelectorAll('.pb-tab').forEach(t =>
            t.classList.toggle('active', t.dataset.pbView === view));
        document.getElementById('pb-journal-view').style.display = view === 'journal' ? 'block' : 'none';
        document.getElementById('pb-setups-view').style.display = view === 'setups' ? 'block' : 'none';
        document.getElementById('pb-roadmap-view').style.display = view === 'roadmap' ? 'block' : 'none';
    }

    /* ── Journal ────────────────────────────────────────────────────────── */

    addNote() {
        const title = this._els.noteTitle.value.trim();
        if (!title) { window.showToast(pbT('toast.noteNeedsTitle'), 'error'); return; }
        this.workspace.notes.unshift({
            id: Date.now(),
            title,
            tags: this._els.noteTags.value.split(',').map(t => t.trim()).filter(Boolean),
            body: this._els.noteBody.value.trim(),
            createdAt: Date.now()
        });
        this._els.noteTitle.value = this._els.noteTags.value = this._els.noteBody.value = '';
        this._save();
        this.renderNotes();
        window.showToast(pbT('toast.noteSaved'), 'success');
    }

    deleteNote(id) {
        this.workspace.notes = this.workspace.notes.filter(n => n.id !== id);
        this._save();
        this.renderNotes();
    }

    renderNotes() {
        const notes = this.workspace.notes.filter(n => {
            if (!this.search) return true;
            const hay = `${n.title} ${n.body} ${(n.tags || []).join(' ')}`.toLowerCase();
            return hay.includes(this.search);
        });
        this._els.noteList.innerHTML = notes.length ? notes.map(n => `
            <div class="pb-card">
                <h4>${this._esc(n.title)}</h4>
                ${(n.tags || []).length ? `<p style="color:var(--accent);font-size:11px">${n.tags.map(t => '#' + this._esc(t)).join(' ')}</p>` : ''}
                ${n.body ? `<p>${this._esc(n.body)}</p>` : ''}
                <p style="font-size:11px;margin-top:6px">${new Date(n.createdAt).toLocaleString(window.I18N?.dateLocale() || 'en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}</p>
                <div class="pb-card-actions">
                    <button class="pb-mini-btn danger" data-del-note="${n.id}">${pbT('misc.delete')}</button>
                </div>
            </div>`).join('')
            : `<p style="color:var(--text-dim);font-size:12px;font-style:italic">${pbT('misc.noNotes')}</p>`;
        this._els.noteList.querySelectorAll('[data-del-note]').forEach(btn =>
            btn.addEventListener('click', () => this.deleteNote(Number(btn.dataset.delNote))));
    }

    /* ── Setups ─────────────────────────────────────────────────────────── */

    addSetup() {
        const title = this._els.setupTitle.value.trim();
        if (!title) { window.showToast(pbT('toast.setupNeedsName'), 'error'); return; }
        this.workspace.setups.unshift({
            id: Date.now(),
            title,
            body: this._els.setupBody.value.trim(),
            createdAt: Date.now()
        });
        this._els.setupTitle.value = this._els.setupBody.value = '';
        this._save();
        this.renderSetups();
        window.showToast(pbT('toast.setupSaved'), 'success');
    }

    deleteSetup(id) {
        this.workspace.setups = this.workspace.setups.filter(s => s.id !== id);
        this._save();
        this.renderSetups();
    }

    renderSetups() {
        this._els.setupList.innerHTML = this.workspace.setups.length
            ? this.workspace.setups.map(s => `
                <div class="pb-card">
                    <h4>${this._esc(s.title)}</h4>
                    ${s.body ? `<p>${this._esc(s.body)}</p>` : ''}
                    <div class="pb-card-actions">
                        <button class="pb-mini-btn danger" data-del-setup="${s.id}">${pbT('misc.delete')}</button>
                    </div>
                </div>`).join('')
            : `<p style="color:var(--text-dim);font-size:12px;font-style:italic">${pbT('misc.noSetups')}</p>`;
        this._els.setupList.querySelectorAll('[data-del-setup]').forEach(btn =>
            btn.addEventListener('click', () => this.deleteSetup(Number(btn.dataset.delSetup))));
    }

    /* ── Roadmap ────────────────────────────────────────────────────────── */

    addGoal() {
        const title = this._els.roadmapTitle.value.trim();
        if (!title) { window.showToast(pbT('toast.goalNeedsTitle'), 'error'); return; }
        this.workspace.roadmap.unshift({ id: Date.now(), title, done: false, createdAt: Date.now() });
        this._els.roadmapTitle.value = '';
        this._save();
        this.renderRoadmap();
    }

    toggleGoal(id) {
        const goal = this.workspace.roadmap.find(g => g.id === id);
        if (goal) { goal.done = !goal.done; this._save(); this.renderRoadmap(); }
    }

    deleteGoal(id) {
        this.workspace.roadmap = this.workspace.roadmap.filter(g => g.id !== id);
        this._save();
        this.renderRoadmap();
    }

    renderRoadmap() {
        this._els.roadmapList.innerHTML = this.workspace.roadmap.length
            ? this.workspace.roadmap.map(g => `
                <div class="pb-card" style="display:flex;align-items:center;gap:10px">
                    <input type="checkbox" data-toggle-goal="${g.id}" ${g.done ? 'checked' : ''} style="width:auto">
                    <h4 style="flex:1;${g.done ? 'text-decoration:line-through;color:var(--text-dim)' : ''}">${this._esc(g.title)}</h4>
                    <button class="pb-mini-btn danger" data-del-goal="${g.id}">${pbT('misc.delete')}</button>
                </div>`).join('')
            : `<p style="color:var(--text-dim);font-size:12px;font-style:italic">${pbT('misc.noGoals')}</p>`;
        this._els.roadmapList.querySelectorAll('[data-toggle-goal]').forEach(box =>
            box.addEventListener('change', () => this.toggleGoal(Number(box.dataset.toggleGoal))));
        this._els.roadmapList.querySelectorAll('[data-del-goal]').forEach(btn =>
            btn.addEventListener('click', () => this.deleteGoal(Number(btn.dataset.delGoal))));
    }

    _esc(s) {
        return String(s ?? '').replace(/[&<>"']/g, c =>
            ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    }

    render() {
        this.renderNotes();
        this.renderSetups();
        this.renderRoadmap();
    }
}

window.tradingPlaybook = new TradingPlaybook();
