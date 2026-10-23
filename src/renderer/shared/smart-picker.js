class SmartPickerManager {
    constructor() {
        this.panel = document.createElement('div');
        this.panel.className = 'smart-picker-panel';
        document.body.appendChild(this.panel);
        
        this.activeInput = null;
        this.currentData = []; 
        this.items = [];       
        this.selectedIndex = -1;

        // Prevent input from losing focus when clicking the panel or dragging the scrollbar
        this.panel.addEventListener('mousedown', (e) => {
            e.preventDefault();
        });

        document.addEventListener('focusin', e => this.onFocus(e));
        document.addEventListener('input', e => this.onInput(e));
        document.addEventListener('keydown', e => this.onKeyDown(e), true);
        
        // Use mousedown to safely detect outside clicks without race conditions
        document.addEventListener('mousedown', e => this.onDocumentMouseDown(e));
        window.addEventListener('resize', () => { if (this.activeInput) this.positionPanel(); });
    }

    loadData(type) {
        // Fix: Properly reference the global 'state' variable instead of window.state
        const s = typeof state !== 'undefined' ? state : null;
        if (!s) return [];
        
        switch (type) {
            case 'employees': {
                const list = s.employees || [];
                return list.map(e => ({
                    value: e.employee_code,
                    label: `${e.employee_code} - ${e.employee_name}`,
                    search: `${e.employee_code} ${e.employee_name}`.toLowerCase()
                }));
            }
            case 'items': {
                const list = s.items || [];
                return list.map(i => ({
                    value: i.item_name,
                    label: i.item_name,
                    search: String(i.item_name || '').toLowerCase()
                }));
            }
            case 'entitlement-items': {
                const list = (s.entitlementOptions && s.entitlementOptions.items) || [];
                return [...new Set(list.map(value => String(value || '').trim()).filter(Boolean))].map(value => ({
                    value,
                    label: value,
                    search: value.toLowerCase()
                }));
            }
            case 'entitlement-units': {
                const list = (s.entitlementOptions && s.entitlementOptions.units) || [];
                return [...new Set(list.map(value => String(value || '').trim()).filter(Boolean))].map(value => ({
                    value,
                    label: value,
                    search: value.toLowerCase()
                }));
            }
            case 'annual-fys': {
                const list = (s.entitlementOptions && s.entitlementOptions.annualFinancialYears) || [];
                return [...new Set(list.map(Number).filter(year => Number.isInteger(year) && year >= 1900 && year <= 9998))]
                    .sort((a, b) => b - a)
                    .map(year => ({
                        value: String(year),
                        label: `FY ${year}-${String((year + 1) % 100).padStart(2, '0')}`,
                        search: `fy ${year}-${String((year + 1) % 100).padStart(2, '0')} ${year}`
                    }));
            }
            case 'units': {
                const units = new Set();
                (s.employees || []).forEach(e => { if (e.unit) units.add(String(e.unit).trim()); });
                (s.policies || []).forEach(p => { if (p.unit) units.add(String(p.unit).trim()); });
                if (s.uniformIssueMatrix && Array.isArray(s.uniformIssueMatrix.rows)) {
                    s.uniformIssueMatrix.rows.forEach(r => { if (r.unit) units.add(String(r.unit).trim()); });
                }
                return [...units].filter(Boolean).sort().map(u => ({
                    value: u,
                    label: u,
                    search: u.toLowerCase()
                }));
            }
            case 'godowns': {
                const godowns = new Set();
                (s.employees || []).forEach(e => { if (e.godown) godowns.add(String(e.godown).trim()); });
                if (s.uniformIssueMatrix && Array.isArray(s.uniformIssueMatrix.rows)) {
                    s.uniformIssueMatrix.rows.forEach(r => { if (r.godown) godowns.add(String(r.godown).trim()); });
                }
                return [...godowns].filter(Boolean).sort().map(g => ({
                    value: g,
                    label: g,
                    search: g.toLowerCase()
                }));
            }
            case 'fys': {
                const fys = new Set();
                (s.uniformIssues || []).forEach(i => { if (i.issue_year) fys.add(i.issue_year); });
                if (fys.size === 0) {
                    const currentYear = new Date().getFullYear();
                    for (let y = currentYear; y >= currentYear - 5; y--) fys.add(y);
                }
                return [...fys].filter(Boolean).sort().reverse().map(y => ({
                    value: String(y),
                    label: String(y),
                    search: String(y)
                }));
            }
            default:
                return [];
        }
    }

    onFocus(e) {
        if (e.target && e.target.hasAttribute('data-smart-picker')) {
            this.open(e.target);
        } else if (this.activeInput && e.target !== this.activeInput) {
            this.close();
        }
    }

    onDocumentMouseDown(e) {
        if (!this.activeInput || this.panel.style.display !== 'block') return;
        
        const inPanel = this.panel.contains(e.target);
        const isInput = e.target === this.activeInput;
        const isLabel = e.target.closest('label') && e.target.closest('label').contains(this.activeInput);
        
        if (!inPanel && !isInput && !isLabel) {
            this.close();
        }
    }

    onInput(e) {
        if (e.target === this.activeInput) {
            this.renderList();
        }
    }

    onKeyDown(e) {
        if (!this.activeInput || this.panel.style.display !== 'block') return;

        if (e.key === 'ArrowDown') {
            e.preventDefault();
            this.selectedIndex = Math.min(this.selectedIndex + 1, this.items.length - 1);
            this.updateSelection();
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            this.selectedIndex = Math.max(this.selectedIndex - 1, 0);
            this.updateSelection();
        } else if (e.key === 'Enter') {
            if (this.selectedIndex >= 0 && this.items[this.selectedIndex]) {
                e.preventDefault();
                e.stopPropagation();
                this.selectItem(this.items[this.selectedIndex]);
            }
        } else if (e.key === 'Escape') {
            e.preventDefault();
            this.close();
        }
    }

    open(input) {
        this.activeInput = input;
        const type = input.getAttribute('data-smart-picker');
        
        // Load data strictly ONCE per focus event and cache it in memory
        this.currentData = this.loadData(type);
        
        this.panel.style.display = 'block';
        this.positionPanel();
        this.renderList();
    }

    close() {
        this.panel.style.display = 'none';
        this.activeInput = null;
        this.currentData = [];
        this.items = [];
        this.selectedIndex = -1;
    }

    positionPanel() {
        if (!this.activeInput) return;
        const rect = this.activeInput.getBoundingClientRect();
        this.panel.style.top = `${rect.bottom + window.scrollY + 2}px`;
        this.panel.style.left = `${rect.left + window.scrollX}px`;
        this.panel.style.width = `${Math.max(rect.width, 220)}px`;
    }

    renderList() {
        if (!this.activeInput) return;
        
        const rawValue = (this.activeInput.value || '').trim();
        const query = rawValue.toLowerCase();
        
        // Show complete list immediately if input is empty. Cap at 150 for DOM performance.
        if (query === '') {
            this.items = this.currentData.slice(0, 150);
        } else {
            // Filter strictly against the in-memory cache
            this.items = this.currentData.filter(item => item.search.includes(query)).slice(0, 150);
        }

        this.selectedIndex = this.items.length > 0 ? 0 : -1;

        if (!this.currentData.length) {
            this.panel.innerHTML = `<div class="smart-picker-empty">${this.escapeHtml(this.activeInput.dataset.emptyMessage || 'No options available.')}</div>`;
        } else if (this.items.length === 0 && query !== '') {
            // Display No Matches ONLY if data exists but filter yields zero records
            this.panel.innerHTML = `<div class="smart-picker-empty">No Matches Found</div>`;
        } else {
            this.panel.innerHTML = this.items.map((item, idx) => `
                <div class="smart-picker-item ${idx === 0 ? 'selected' : ''}" data-idx="${idx}">
                    ${this.escapeHtml(item.label)}
                </div>
            `).join('');

            const elements = this.panel.querySelectorAll('.smart-picker-item');
            elements.forEach(el => {
                // Use mousedown to prevent the input from losing focus before the selection completes
                el.addEventListener('mousedown', (e) => {
                    e.preventDefault();
                    const idx = parseInt(e.currentTarget.getAttribute('data-idx'), 10);
                    this.selectItem(this.items[idx]);
                });
                el.addEventListener('mousemove', (e) => {
                    this.selectedIndex = parseInt(e.currentTarget.getAttribute('data-idx'), 10);
                    this.updateSelection();
                });
            });
        }
    }

    updateSelection() {
        const elements = this.panel.querySelectorAll('.smart-picker-item');
        elements.forEach((el, idx) => {
            if (idx === this.selectedIndex) {
                el.classList.add('selected');
                
                // Smart scroll-into-view logic
                const panelRect = this.panel.getBoundingClientRect();
                const elRect = el.getBoundingClientRect();
                if (elRect.bottom > panelRect.bottom) {
                    this.panel.scrollTop += elRect.bottom - panelRect.bottom;
                } else if (elRect.top < panelRect.top) {
                    this.panel.scrollTop -= panelRect.top - elRect.top;
                }
            } else {
                el.classList.remove('selected');
            }
        });
    }

    selectItem(item) {
        if (!this.activeInput) return;
        
        this.activeInput.value = item.value;
        this.activeInput.dispatchEvent(new Event('input', { bubbles: true }));
        this.activeInput.dispatchEvent(new Event('change', { bubbles: true }));
        
        this.close();
    }

    escapeHtml(value) {
        return String(value ?? "").replace(/[&<>"']/g, (char) => ({
            "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
        })[char]);
    }
}

window.addEventListener('DOMContentLoaded', () => {
    window.smartPickerManager = new SmartPickerManager();
});
