const AnalyticsState = {
    payroll_summary: null,
    detailed_report: null,
    monthly: null,
    yearly: null,
    unit: null,
    item: null,
    employee: null,
    filters: {}
};

function getMonthNameLocal(monthNum) {
    const names = ["", "January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
    return names[Number(monthNum)] || "";
}

function escapeHtmlLocal(str) {
    if (str === null || str === undefined) return "";
    return String(str).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
}

function formatCost(val) {
    return val !== undefined && val !== null ? `₹${Number(val).toFixed(2)}` : '₹0.00';
}

function createSummaryCardsHTML(summary) {
    return `
        <div class="mini-stats" style="grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); margin-bottom: 24px;">
            <article><span>Total Employees</span><strong>${summary.total_employees || 0}</strong></article>
            <article><span>Total Units</span><strong>${summary.total_units || 0}</strong></article>
            <article><span>Items Types</span><strong>${summary.total_items_issued || 0}</strong></article>
            <article><span>Total Qty</span><strong>${summary.total_quantity_issued || 0}</strong></article>
            <article><span>Transactions</span><strong>${summary.total_transactions || 0}</strong></article>
            <article><span>Avg Qty/Emp</span><strong>${Number(summary.average_issue_per_employee || 0).toFixed(1)}</strong></article>
            <article><span>Pending Qty</span><strong class="text-amber">${summary.pending_qty_count || 0}</strong></article>
            <article><span>Total Ded Cases</span><strong class="text-red">${summary.deduction_count || 0}</strong></article>
            <article><span>Total Waived</span><strong class="text-green">${summary.waiver_count || 0}</strong></article>
            <article><span>Cost (Total)</span><strong>${formatCost(summary.total_distribution_cost)}</strong></article>
            <article><span>Recovery Amt</span><strong class="text-red">${formatCost(summary.total_recovery_amount)}</strong></article>
            <article><span>Waived Amt</span><strong class="text-green">${formatCost(summary.total_waived_amount)}</strong></article>
        </div>
    `;
}

function createHorizontalChart(title, data, valueKey = 'value') {
    if (!data || !data.length) return `<div class="panel flush"><div class="panel-heading"><h3>${title}</h3></div><div style="padding: 24px;" class="empty">No data available.</div></div>`;
    const max = Math.max(...data.map(d => Number(d[valueKey])), 1);
    const bars = data.map(d => {
        const pct = (Number(d[valueKey]) / max) * 100;
        return `
            <div style="display: grid; grid-template-columns: 140px 1fr 60px; gap: 12px; align-items: center; margin-bottom: 12px;">
                <span style="font-size: 13px; text-overflow: ellipsis; overflow: hidden; white-space: nowrap;" title="${escapeHtmlLocal(d.label)}">${escapeHtmlLocal(d.label)}</span>
                <div style="background: #111821; height: 16px; border-radius: 4px; border: 1px solid var(--line); overflow: hidden;"><div style="background: var(--blue); height: 100%; width: ${pct}%;"></div></div>
                <span style="font-size: 13px; text-align: right;">${d[valueKey]}</span>
            </div>
        `;
    }).join('');
    return `<div class="panel flush" style="display: flex; flex-direction: column;"><div class="panel-heading"><h3>${title}</h3></div><div style="padding: 18px; flex: 1; overflow: auto;">${bars}</div></div>`;
}

function createVerticalTrendChart(title, data) {
    if (!data || !data.length) return `<div class="panel flush"><div class="panel-heading"><h3>${title}</h3></div><div style="padding: 24px;" class="empty">No trend data available.</div></div>`;
    const maxQty = Math.max(...data.map(d => Number(d.total_qty)), 1);
    const cols = data.map(d => {
        const mName = getMonthNameLocal(d.month_num).substring(0,3);
        const pctQty = (Number(d.total_qty) / maxQty) * 100;
        return `
            <div style="flex: 1; display: flex; flex-direction: column; justify-content: flex-end; align-items: center; gap: 8px;">
                <span style="font-size: 11px; color: var(--muted); transform: rotate(-45deg); margin-bottom: 4px;">${d.total_qty}</span>
                <div style="width: 100%; max-width: 32px; height: ${pctQty}%; background: var(--blue); border-radius: 4px 4px 0 0;" title="Qty: ${d.total_qty}"></div>
                <span style="font-size: 12px; border-top: 1px solid var(--line); padding-top: 8px; width: 100%; text-align: center;">${mName}</span>
            </div>
        `;
    }).join('');
    return `<div class="panel flush" style="margin-bottom: 24px;"><div class="panel-heading"><h3>${title}</h3></div><div style="padding: 18px 24px 24px; height: 260px; display: flex; gap: 4px; align-items: flex-end; border-bottom: 1px solid var(--line);">${cols}</div></div>`;
}

function createDetailedTable(data) {
    if (!data || !data.length) return `<div class="panel flush"><div class="empty" style="padding: 24px;">No records match these filters.</div></div>`;
    const rows = data.map(r => {
        const badgeColor = r.decision_status === 'Deduct' ? 'text-red' : (r.decision_status === 'Waive' ? 'text-green' : (r.decision_status === 'Hold' ? 'text-blue' : (r.decision_status === 'Pending' ? 'text-amber' : '')));
        return `
            <tr>
                <td>${r.issued_at ? r.issued_at.split('T')[0] : '-'}</td>
                <td>${r.financial_year || '-'}/${r.issue_month ? String(r.issue_month).padStart(2,'0') : '-'}</td>
                <td>${escapeHtmlLocal(r.employee_code)}</td>
                <td>${escapeHtmlLocal(r.employee_name)}</td>
                <td>${escapeHtmlLocal(r.unit)}</td>
                <td>${escapeHtmlLocal(r.item_name)}</td>
                <td><strong>${r.quantity}</strong></td>
                <td>${formatCost(r.rate)}</td>
                <td>${formatCost(r.amount)}</td>
                <td class="${badgeColor}" style="font-weight: 600;">${r.decision_status}</td>
                <td class="reason">${escapeHtmlLocal(r.remarks || '-')}</td>
            </tr>
        `;
    }).join('');
    return `<div class="panel flush"><div class="panel-heading"><h3>Detailed Transactions</h3></div><div class="table-wrap" style="max-height: 500px; overflow: auto;"><table><thead><tr><th>Issue Date</th><th>FY / MTH</th><th>Code</th><th>Name</th><th>Unit</th><th>Item</th><th>Qty</th><th>Rate</th><th>Total Amount</th><th>Status</th><th>Remarks</th></tr></thead><tbody>${rows}</tbody></table></div></div>`;
}

function createDecisionRegisterHTML(type) {
    const pfx = `dr_${type}`;
    const titles = { monthly: 'MONTHLY', yearly: 'YEARLY', unit: 'UNIT', item: 'ITEM', employee: 'EMPLOYEE' };
    const title = `${titles[type]} REVIEW DECISION REGISTER`;
    return `
    <div class="panel flush" style="margin-top: 24px; display: flex; flex-direction: column;">
        <div class="panel-heading" style="display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid var(--line); padding-bottom: 16px;">
            <div><h3 style="margin: 0 0 4px 0;">${title}</h3><p style="margin: 0; color: var(--muted); font-size: 13px;">Automatic operational ledger of review decisions for this filter.</p></div>
            <div style="display: flex; gap: 10px;">
                <button type="button" class="secondary" id="btn_export_${pfx}_pdf">Export PDF</button>
                <button type="button" class="secondary" id="btn_export_${pfx}_excel">Export Excel</button>
            </div>
        </div>
        <div class="mini-stats" style="margin: 18px 18px 0 18px; grid-template-columns: repeat(4, 1fr);" id="${pfx}_summary_cards"></div>
        <div style="margin: 18px; display: flex; gap: 10px; background: #111821; padding: 12px; border-radius: 6px; border: 1px solid var(--line);">
            <input type="text" id="${pfx}_search_emp" autocomplete="off" placeholder="Employee (Code/Name)" style="flex: 1;" />
            <input type="text" id="${pfx}_search_unit" autocomplete="off" placeholder="Unit" style="flex: 1;" />
            <input type="text" id="${pfx}_search_item" autocomplete="off" placeholder="Item" style="flex: 1;" />
            <select id="${pfx}_search_decision" style="flex: 1;">
                <option value="">All Decisions</option>
                <option value="Deduct">Deduct</option>
                <option value="Hold">Hold</option>
                <option value="Waive">Waive</option>
            </select>
        </div>
        <div class="table-wrap" style="max-height: 500px; overflow: auto;">
            <table>
                <thead>
                    <tr><th>Payroll Month</th><th>Code</th><th>Name</th><th>Unit</th><th>Item</th><th>Qty</th><th>Decision</th><th>Ded Amount</th><th>Review Date</th><th>Approved By</th><th>Remarks</th><th>Current Status</th></tr>
                </thead>
                <tbody id="${pfx}_table_body"></tbody>
            </table>
        </div>
    </div>`;
}

function updateDecisionRegister(type) {
    const data = AnalyticsState[type]?.decisionRegister || [];
    const pfx = `dr_${type}`;
    const empFilter = (document.getElementById(`${pfx}_search_emp`)?.value || '').toLowerCase();
    const unitFilter = (document.getElementById(`${pfx}_search_unit`)?.value || '').toLowerCase();
    const itemFilter = (document.getElementById(`${pfx}_search_item`)?.value || '').toLowerCase();
    const decisionFilter = document.getElementById(`${pfx}_search_decision`)?.value || '';

    const filtered = data.filter(r => {
        if (empFilter && !String(r.employee_code).toLowerCase().includes(empFilter) && !String(r.employee_name).toLowerCase().includes(empFilter)) return false;
        if (unitFilter && !String(r.unit).toLowerCase().includes(unitFilter)) return false;
        if (itemFilter && !String(r.item_name).toLowerCase().includes(itemFilter)) return false;
        if (decisionFilter && r.decision !== decisionFilter) return false;
        return true;
    });

    let deductCount = 0, holdCount = 0, waiveCount = 0, recoveryAmt = 0;
    filtered.forEach(r => {
        if (r.decision === 'Deduct') { deductCount++; recoveryAmt += Number(r.deduction_amount || 0); }
        if (r.decision === 'Hold') holdCount++;
        if (r.decision === 'Waive') waiveCount++;
    });

    const sumHtml = `
        <article><span>Total Deduct Cases</span><strong class="text-red">${deductCount}</strong></article>
        <article><span>Total Hold Cases</span><strong class="text-blue">${holdCount}</strong></article>
        <article><span>Total Waive Cases</span><strong class="text-green">${waiveCount}</strong></article>
        <article><span>Total Recovery Amount</span><strong class="text-red">${formatCost(recoveryAmt)}</strong></article>
    `;
    const summaryEl = document.getElementById(`${pfx}_summary_cards`);
    if (summaryEl) summaryEl.innerHTML = sumHtml;

    const rowsHtml = filtered.map(r => {
        const dateStr = r.review_date ? r.review_date.split('T')[0] : '-';
        const payrollMonth = `${getMonthNameLocal(r.issue_month)} ${r.issue_year}`;
        const badge = r.decision === 'Deduct' ? 'text-red' : (r.decision === 'Waive' ? 'text-green' : 'text-blue');
        return `
            <tr>
                <td>${payrollMonth}</td>
                <td>${escapeHtmlLocal(r.employee_code)}</td>
                <td>${escapeHtmlLocal(r.employee_name)}</td>
                <td>${escapeHtmlLocal(r.unit)}</td>
                <td>${escapeHtmlLocal(r.item_name)}</td>
                <td><strong>${r.quantity}</strong></td>
                <td class="${badge}" style="font-weight: 600;">${r.decision}</td>
                <td class="text-red">${r.decision === 'Deduct' ? formatCost(r.deduction_amount) : '-'}</td>
                <td>${dateStr}</td>
                <td>${escapeHtmlLocal(r.approved_by || '-')}</td>
                <td class="reason">${escapeHtmlLocal(r.remarks || '-')}</td>
                <td>${escapeHtmlLocal(r.current_status)}</td>
            </tr>
        `;
    }).join('') || `<tr><td colspan="12" class="empty" style="text-align: center; padding: 24px;">No review decisions match your filters.</td></tr>`;

    const bodyEl = document.getElementById(`${pfx}_table_body`);
    if (bodyEl) bodyEl.innerHTML = rowsHtml;

    AnalyticsState[type].filteredDecisionRegister = filtered;
    AnalyticsState[type].filteredDecisionRegisterStats = { deductCount, holdCount, waiveCount, recoveryAmt };
}

function getReportPeriodString(type, filters) {
    if (type === 'monthly') return `${getMonthNameLocal(filters.month)} ${filters.fy}`;
    if (type === 'yearly') return `FY ${filters.fy}`;
    if (type === 'unit') return `${filters.unit} - FY ${filters.fy}`;
    if (type === 'item') return `${filters.item} - FY ${filters.fy}`;
    if (type === 'employee') return `${filters.employee}${filters.fy ? ' - FY ' + filters.fy : ''}`;
    return "ALL";
}

// ------------------------------------------------------------------
// STANDARD ANALYTICS RENDERER
// ------------------------------------------------------------------

async function renderAnalytics(reportType, containerId, data) {
    const container = document.getElementById(containerId);
    if (!container) return;

    if (!data) {
        container.innerHTML = `<div class="empty" style="padding: 24px; text-align: center; border: 1px dashed var(--line); border-radius: 6px; color: var(--muted);">Generate report to view data.</div>`;
        return;
    }

    let html = createSummaryCardsHTML(data.summary);

    if (reportType === 'monthly') {
        html += `<div style="display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 18px; margin-bottom: 24px;">${createHorizontalChart('Item Distribution', data.itemWise)}${createHorizontalChart('Top 10 Units', data.unitWise)}${createHorizontalChart('Top 10 Employees', data.topEmployees)}</div>`;
    } else if (reportType === 'yearly') {
        html += createVerticalTrendChart('Yearly Monthly Distribution Trend', data.monthlyTrend);
        html += `<div style="display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 18px; margin-bottom: 24px;">${createHorizontalChart('Item Distribution', data.itemWise)}${createHorizontalChart('Top Units', data.unitWise)}${createHorizontalChart('Top Employees', data.topEmployees)}</div>`;
    } else if (reportType === 'unit') {
        html += `<div style="display: grid; grid-template-columns: 1fr 1fr; gap: 18px; margin-bottom: 24px;">${createHorizontalChart('Item Breakdown', data.itemWise)}${createHorizontalChart('Top Employees', data.topEmployees)}</div>`;
    } else if (reportType === 'item') {
        html += createVerticalTrendChart('Item Specific Monthly Trend', data.monthlyTrend);
        html += `<div style="display: grid; grid-template-columns: 1fr 1fr; gap: 18px; margin-bottom: 24px;">${createHorizontalChart('Unit Consumption', data.unitWise)}${createHorizontalChart('Top Employees', data.topEmployees)}</div>`;
    } else if (reportType === 'employee') {
        html += `<div style="display: grid; grid-template-columns: 1fr; gap: 18px; margin-bottom: 24px;">${createHorizontalChart('Employee History Items', data.itemWise)}</div>`;
    }

    html += createDetailedTable(data.table || data.timeline);
    html += createDecisionRegisterHTML(reportType);
    
    container.innerHTML = html;
    updateDecisionRegister(reportType);
}

// ------------------------------------------------------------------
// PAYROLL DEDUCTION SUMMARY RENDERER
// ------------------------------------------------------------------

function renderPayrollSummaryTable(data) {
    const container = document.getElementById('content_analytics_payroll_summary');
    if (!container) return;

    if (!data || !data.rows || data.rows.length === 0) {
        container.innerHTML = `<div class="panel flush" style="padding: 32px; text-align: center; color: var(--muted); border: 1px dashed var(--line); border-radius: 6px;">No finalized deductions found for the selected period.</div>`;
        return;
    }

    const items = data.items || [];
    const rows = data.rows || [];
    
    // Dynamic Table Headers
    let ths = `<th style="width:60px;">Sr No</th>
               <th>Employee Code</th>
               <th>Employee Name</th>
               <th>Unit Name</th>
               <th>Payroll Month</th>`;
               
    items.forEach(item => { ths += `<th>${escapeHtmlLocal(item)}</th>`; });
    ths += `<th style="min-width:140px;">Total Deduction Amount (₹)</th>`;
    
    // Dynamic Table Rows
    let trs = rows.map((r, index) => {
        let tds = `<td>${index + 1}</td>
                   <td>${escapeHtmlLocal(r.employee_code)}</td>
                   <td>${escapeHtmlLocal(r.employee_name)}</td>
                   <td>${escapeHtmlLocal(r.unit)}</td>
                   <td>${escapeHtmlLocal(r.payroll_month)}</td>`;
                   
        // Dynamic Items. Ensures '0' is populated strictly if item wasn't deducted.
        items.forEach(item => {
            const qty = r.items[item] || 0;
            tds += `<td>${qty}</td>`;
        });
        tds += `<td class="text-red"><strong>${formatCost(r.total_amount)}</strong></td>`;
        return `<tr>${tds}</tr>`;
    }).join('');
    
    container.innerHTML = `
    <div class="panel flush" style="margin-top: 0;">
        <div class="table-wrap" style="max-height: 600px; overflow: auto;">
            <table>
                <thead><tr>${ths}</tr></thead>
                <tbody>${trs}</tbody>
            </table>
        </div>
    </div>`;
}

function renderDetailedDeductionReport(data) {
    const container = document.getElementById('content_analytics_detailed_report');
    if (!container) return;
    const editButton = document.getElementById('btn_edit_detailed_report_rates');
    if (editButton) editButton.disabled = !data?.items?.length;
    if (!data || !Array.isArray(data.rows) || !data.rows.length) {
        container.innerHTML = `<div class="panel flush" style="padding: 32px; text-align: center; color: var(--muted); border: 1px dashed var(--line); border-radius: 6px;">No finalized deductions match the selected filters.</div>`;
        return;
    }
    const items = data.items || [];
    const itemInfo = new Map((data.itemInfo || []).map((entry) => [entry.item, entry]));
    const fixedHeaders = ['Sr.', 'Sr. No. in their Register', 'Code', 'Name', 'Father', 'Unit', 'For Month of', 'Deducted in Month of'];
    const columns = [...fixedHeaders, ...items, 'Total'];
    const metaRow = (label, key) => {
        const cells = Array(columns.length).fill('');
        cells[7] = label;
        items.forEach((item, index) => { cells[8 + index] = escapeHtmlLocal(itemInfo.get(item)?.[key] ?? 'N/A'); });
        return `<tr class="detailed-report-meta">${cells.map((cell) => `<th>${cell}</th>`).join('')}</tr>`;
    };
    const header = `<thead><tr><th colspan="${columns.length}" class="detailed-report-title">${escapeHtmlLocal(data.reportTitle || 'Detailed Deductions')}</th></tr>${metaRow('Max Supplied p.a.', 'max_supplied_pa')}${metaRow('Deduction Rate', 'deduction_rate')}${metaRow('Actual Rate', 'actual_rate')}<tr>${columns.map((column) => `<th>${escapeHtmlLocal(column)}</th>`).join('')}</tr></thead>`;
    const rows = data.rows.map((row) => `<tr>
        <td>${row.sr}</td><td>${row.register_serial ?? 'N/A'}</td><td>${escapeHtmlLocal(row.employee_code)}</td>
        <td>${escapeHtmlLocal(row.employee_name)}</td><td>${escapeHtmlLocal(row.father_name)}</td><td>${escapeHtmlLocal(row.unit)}</td>
        <td>${escapeHtmlLocal(row.for_month)}</td><td>${escapeHtmlLocal(row.deduction_month_display || 'N/A')}</td>
        ${items.map((item) => `<td class="number-cell">${Number(row.items[item] || 0)}</td>`).join('')}
        <td class="number-cell"><strong>${formatCost(row.total)}</strong></td>
    </tr>`).join('');
    container.innerHTML = `<div class="panel flush"><div class="detailed-report-table-wrap"><table class="detailed-report-table">${header}<tbody>${rows}</tbody></table></div><p class="muted" style="padding: 0 16px 14px;">Rates and annual limits are item-level values for the filtered records. Values shown as “Varies by unit” differ across included units. Total uses the application deduction-rate fallback (unit policy, stored review rate, then inventory cost).</p></div>`;
}

function closeDetailedReportEditor() {
    const backdrop = document.getElementById('detailedReportEditorBackdrop');
    if (backdrop) { backdrop.classList.remove('show'); backdrop.setAttribute('aria-hidden', 'true'); }
}
window.closeDetailedReportEditor = closeDetailedReportEditor;

function openDetailedReportEditor() {
    const data = AnalyticsState.detailed_report;
    const backdrop = document.getElementById('detailedReportEditorBackdrop');
    const content = document.getElementById('detailedReportEditorContent');
    if (!data || !backdrop || !content) return;
    const groups = [];
    const mode = data.calculationMode || 'item_annual';
    const annualEnabled = mode === 'item_annual' || mode === 'combined';
    const unitEnabled = mode === 'unit_wise' || mode === 'combined';
    const sections = [];
    (data.itemInfo || []).forEach((info, itemIndex) => {
        const contexts = info.contexts?.length ? info.contexts : [{ unit: '', financial_year: null, annual_limit: null, unit_limit: null, deduction_rate: null }];
        const seenAnnualScopes = new Set();
        const contextRows = contexts.map((context) => {
            const index = groups.push({
                item_name: info.item, unit: context.unit, financial_year: context.financial_year,
                initial_annual_limit: context.annual_limit, initial_unit_limit: context.unit_limit,
                initial_deduction_rate: context.deduction_rate,
            }) - 1;
            const annualScope = `${info.item.toLowerCase()}|${context.financial_year}`;
            const showAnnual = annualEnabled && !seenAnnualScopes.has(annualScope);
            seenAnnualScopes.add(annualScope);
            return `<div class="form-grid" style="grid-template-columns:repeat(auto-fit,minmax(150px,1fr));align-items:end;margin:8px 0 14px;">
              <label>Unit <input readonly value="${escapeHtmlLocal(context.unit || 'N/A')}"></label><label>Financial Year <input readonly value="${context.financial_year ? `FY ${context.financial_year}-${String(Number(context.financial_year) + 1).slice(-2)}` : 'N/A'}"></label>
              ${showAnnual ? `<label>Global Item Annual Limit <input type="number" min="0" step="1" name="annual_${index}" value="${context.annual_limit ?? ''}" placeholder="Not configured"></label>` : annualEnabled ? '<label>Global Item Annual Limit <input readonly value="Shared for this item and financial year"></label>' : ''}
              ${unitEnabled ? `<label>Unit Entitlement <input type="number" min="0" step="1" name="unit_${index}" value="${context.unit_limit ?? ''}" placeholder="Not configured"></label>` : ''}
              <label>Deduction Rate <input type="number" min="0" step="0.01" name="deduction_${index}" value="${context.deduction_rate ?? ''}" placeholder="Not configured"></label>
            </div>`;
        }).join('');
        const actualValue = info.actual_price === 'N/A' ? '' : info.actual_price;
        const actualRateField = `<label style="display:grid;grid-template-columns:minmax(180px,1fr) minmax(130px,220px);gap:10px;align-items:center;margin:8px 0;">
          <span>Global Actual Price</span><input type="number" min="0" step="0.01" name="actual_price_${itemIndex}" value="${escapeHtmlLocal(actualValue)}" placeholder="Not configured" aria-label="Global actual price for ${escapeHtmlLocal(info.item)}">
        </label><p class="muted">Independent of inventory stock and unit deduction rates. Blank means no saved Actual Price.</p>`;
        sections.push(`<section class="panel flush" style="padding:14px;margin-bottom:12px;"><h4 style="margin:0 0 8px;">${escapeHtmlLocal(info.item)}</h4>${contextRows}<div><strong>Actual Price · Global Item Value</strong>${actualRateField}</div></section>`);
    });
    window.DetailedReportEditGroups = groups;
    content.innerHTML = `<p class="muted">Max Supplied p.a. is controlled by ${mode === 'combined' ? 'both global annual and unit-specific policies' : mode === 'unit_wise' ? 'unit-specific entitlements' : 'global item-wise annual limits'} for the selected report context. Deduction rates remain unit-specific. Actual Prices are global item values stored independently from inventory records and deduction rates.</p>${sections.join('')}`;
    const message = document.getElementById('detailedReportEditorMessage');
    if (message) message.textContent = '';
    backdrop.classList.add('show'); backdrop.setAttribute('aria-hidden', 'false');
}

document.addEventListener('click', (event) => {
    if (event.target?.closest?.('#btn_edit_detailed_report_rates')) openDetailedReportEditor();
    if (event.target?.closest?.('[data-close-detailed-report-editor]') || event.target?.id === 'detailedReportEditorBackdrop') closeDetailedReportEditor();
});
document.addEventListener('submit', async (event) => {
    if (event.target?.id !== 'detailedReportEditorForm') return;
    event.preventDefault();
    const form = event.target;
    const button = document.getElementById('saveDetailedReportValues');
    const message = document.getElementById('detailedReportEditorMessage');
    const data = AnalyticsState.detailed_report;
    const groups = window.DetailedReportEditGroups || [];
    const actualPricesByItem = new Map((data?.itemInfo || []).map((info, itemIndex) => [info.item, form.elements[`actual_price_${itemIndex}`]?.value]));
    const changedValue = (current, original) => String(current ?? '') !== String(original ?? '');
    const payloads = groups.map((group, index) => {
        const annual = form.elements[`annual_${index}`]?.value;
        const unit = form.elements[`unit_${index}`]?.value;
        const deduction = form.elements[`deduction_${index}`]?.value;
        const itemIndex = (data?.itemInfo || []).findIndex((entry) => entry.item === group.item_name);
        const actualPrice = actualPricesByItem.get(group.item_name);
        const info = itemIndex >= 0 ? data.itemInfo[itemIndex] : null;
        return {
            item_name: group.item_name,
            unit: group.unit,
            financial_year: group.financial_year,
            annual_limit: changedValue(annual, group.initial_annual_limit) ? annual : undefined,
            unit_limit: changedValue(unit, group.initial_unit_limit) ? unit : undefined,
            deduction_rate: changedValue(deduction, group.initial_deduction_rate) ? deduction : undefined,
            actual_price: index === groups.findIndex((candidate) => candidate.item_name === group.item_name)
                && changedValue(actualPrice, info?.actual_price === 'N/A' ? '' : info?.actual_price) ? actualPrice : undefined,
        };
    });
    if (!payloads.length) return;
    button.disabled = true; if (message) message.textContent = 'Saving values and recalculating pending reviews…';
    try {
        let generated = 0;
        let affectsReviewQueue = false;
        let actualPriceChanged = false;
        for (const payload of payloads) {
            const result = await window.uniformManager.saveDetailedReportItemValues(payload);
            generated += Number(result.generated || 0);
            affectsReviewQueue = affectsReviewQueue || Boolean(result.reviewCalculationsChanged);
            actualPriceChanged = actualPriceChanged || Boolean(result.actualPriceChanged);
            if (result.state && typeof loadState === 'function') state = result.state;
        }
        if (affectsReviewQueue && typeof window.refreshReviewQueue === 'function') await window.refreshReviewQueue();
        if (actualPriceChanged && typeof window.refreshActualPriceData === 'function') await window.refreshActualPriceData();
        if (typeof loadState === 'function') await loadState();
        closeDetailedReportEditor();
        const reportForm = document.getElementById('form_analytics_detailed_report');
        if (reportForm) reportForm.requestSubmit();
        if (typeof toast === 'function') toast(`Item values saved${affectsReviewQueue ? `. Review Queue recalculated (${generated} pending rows generated)` : ''}.`);
    } catch (error) {
        if (message) message.textContent = error.message || 'Could not save item values.';
    } finally { button.disabled = false; }
});

async function loadDetailedDeductionReportOptions() {
    const form = document.getElementById('form_analytics_detailed_report');
    if (!form) return;
    try {
        const options = await window.uniformManager.getAnalyticsData('detailed_report_options', {});
        const fill = (selector, values, labelFn = (value) => value) => {
            const select = document.querySelector(selector);
            if (!select) return;
            const first = select.options[0];
            select.replaceChildren(first);
            (values || []).forEach((value) => {
                const option = document.createElement('option'); option.value = value; option.textContent = labelFn(value); select.appendChild(option);
            });
        };
        fill('#detailedReportFinancialYear', options.financialYears, (year) => `FY ${year}-${String(Number(year) + 1).slice(-2)}`);
        fill('#detailedReportDeductionMonth', options.deductionMonths, (month) => {
            const date = new Date(`${month}-01T00:00:00`);
            return date.toLocaleString('en-US', { month: 'short', year: 'numeric' });
        });
        fill('#detailedReportUnit', options.units);
    } catch (error) {
        if (typeof showImportError === 'function') showImportError(error.message || 'Could not load report filters.');
    }
}
window.loadDetailedDeductionReportOptions = loadDetailedDeductionReportOptions;

document.addEventListener('change', (event) => {
    if (event.target?.closest?.('#form_analytics_detailed_report') && AnalyticsState.detailed_report) {
        const form = document.getElementById('form_analytics_detailed_report');
        if (form && typeof form.requestSubmit === 'function') form.requestSubmit();
    }
});
document.addEventListener('input', (event) => {
    if (!event.target?.matches?.('#form_analytics_detailed_report input') || !AnalyticsState.detailed_report) return;
    clearTimeout(window.detailedReportRefreshTimer);
    window.detailedReportRefreshTimer = setTimeout(() => {
        const form = document.getElementById('form_analytics_detailed_report');
        if (form && typeof form.requestSubmit === 'function') form.requestSubmit();
    }, 350);
});

// ------------------------------------------------------------------
// EVENT DELEGATION
// Attach events to the document so they survive native router page reloads
// ------------------------------------------------------------------

document.addEventListener('submit', async (e) => {
    if (e.target && e.target.id && (e.target.id.startsWith('form_analytics_'))) {
        e.preventDefault();
        
        const formId = e.target.id;
        const reportType = formId.replace('form_analytics_', '');
        const btn = document.getElementById(`btn_export_analytics_${reportType}`);
        
        const formData = new FormData(e.target);
        const filters = Object.fromEntries(formData.entries());
        AnalyticsState.filters[reportType] = filters;

        try {
            if (typeof startProgress === 'function') startProgress({ title: "Generating Report", description: `Loading filtered ${reportType.replace(/_/g, " ")} data from the local database.`, kicker: "ANALYTICS REPORT" });
            
            // Backend call
            const data = await window.uniformManager.getAnalyticsData(reportType, filters);
            AnalyticsState[reportType] = data;
            
            // Render specific UI
            if (reportType === 'payroll_summary') {
                renderPayrollSummaryTable(data);
            } else if (reportType === 'detailed_report') {
                renderDetailedDeductionReport(data);
            } else {
                renderAnalytics(reportType, `content_analytics_${reportType}`, data);
            }
            
            if (btn) btn.disabled = false;
            if (typeof stopProgress === 'function') stopProgress();
            if (typeof toast === 'function') toast("Report generated successfully.");
        } catch (err) {
            if (typeof stopProgress === 'function') stopProgress();
            if (typeof showImportError === 'function') showImportError(err.message || "Failed to generate report.");
        }
    }
});

// Event Delegation for Export Buttons
document.addEventListener('click', async (e) => {
    if (e.target && e.target.id && (e.target.id.startsWith('btn_export_analytics_'))) {
        e.preventDefault();
        
        const btnId = e.target.id;
        const reportType = btnId.replace('btn_export_analytics_', '');
        const data = AnalyticsState[reportType];
        
        if (!data) {
            if (typeof toast === 'function') toast("No data to export.");
            return;
        }

        let config;

        // Custom Excel structure for Payroll Summary
        if (reportType === 'detailed_report') {
            if (!data.rows || !data.rows.length) { if (typeof toast === 'function') toast('No data to export.'); return; }
            const layout = window.buildDetailedReportWorksheet(data);
            config = {
                filename: `${String(data.reportTitle || 'Detailed_Deductions').replace(/[^a-z0-9_-]+/gi, '_')}.xlsx`,
                sheetName: 'Detailed Report', ...layout
            };
        } else if (reportType === 'payroll_summary') {
            if (!data.rows || !data.rows.length) {
                if (typeof toast === 'function') toast("No data to export.");
                return;
            }

            const items = data.items || [];
            const headers = ["Sr No", "Employee Code", "Employee Name", "Unit Name", "Payroll Month"];
            items.forEach(i => headers.push(i));
            headers.push("Total Deduction Amount (₹)");
            
            const rows = data.rows.map((r, index) => {
                const rowArr = [index + 1, r.employee_code, r.employee_name, r.unit, r.payroll_month];
                items.forEach(i => rowArr.push(r.items[i] || 0)); 
                rowArr.push(r.total_amount);
                return rowArr;
            });
            
            const filters = AnalyticsState.filters['payroll_summary'];
            const periodStr = (filters.month || filters.fy) ? `${filters.month || ''}_${filters.fy || ''}`.replace(/^_|_$/g, '') : 'All_Periods';

            config = {
                filename: `Payroll_Deduction_Summary_${periodStr}.xlsx`,
                sheetName: "Deduction Summary",
                reportTitle: `PAYROLL DEDUCTION SUMMARY - ${periodStr.replace('_', ' ').toUpperCase()}`,
                filtersUsed: filters,
                generatedDate: new Date().toISOString().replace('T', ' ').substring(0, 19),
                summary: {
                    "Total Employees Deducted": data.rows.length,
                    "Total Deduction Amount": `Rs. ${data.rows.reduce((sum, r) => sum + r.total_amount, 0).toFixed(2)}`
                },
                headers,
                data: rows
            };

        } else {
            // Standard Analytics Excel Export
            if (!data.table && !data.timeline) {
                if (typeof toast === 'function') toast("No data to export.");
                return;
            }

            const rawData = data.table || data.timeline;
            const headers = ["Issue Date", "FY", "Month", "Employee Code", "Employee Name", "Unit", "Item", "Quantity", "Rate", "Amount", "Status", "Remarks"];
            
            const rows = rawData.map(r => [
                r.issued_at ? r.issued_at.split('T')[0] : '', r.financial_year || '', r.issue_month || '',
                r.employee_code, r.employee_name, r.unit, r.item_name, r.quantity, r.rate, r.amount, r.decision_status, r.remarks
            ]);

            config = {
                filename: `Analytics_${reportType.toUpperCase()}_Report.xlsx`,
                sheetName: "Analytics Data",
                reportTitle: `${reportType.toUpperCase()} ANALYTICS REPORT`,
                filtersUsed: AnalyticsState.filters[reportType],
                generatedDate: new Date().toISOString().replace('T', ' ').substring(0, 19),
                summary: {
                    "Total Employees": data.summary.total_employees, "Total Quantity": data.summary.total_quantity_issued,
                    "Total Cost": data.summary.total_distribution_cost, "Recovery Amount": data.summary.total_recovery_amount
                },
                headers, data: rows
            };
        }

        try {
            if (typeof startProgress === 'function') startProgress({ title: "Exporting Report", description: "Preparing the selected report as an Excel workbook.", kicker: "LOCAL FILE EXPORT" });
            const res = await window.uniformManager.exportAnalyticsExcel(config);
            if (typeof stopProgress === 'function') stopProgress();
            if (!res.canceled && typeof toast === 'function') toast("Excel exported successfully.");
        } catch (err) {
            if (typeof stopProgress === 'function') stopProgress();
            if (typeof showImportError === 'function') showImportError("Export failed: " + err.message);
        }
    }
});

// PDF & Excel handlers for the standard Decision Registers
document.addEventListener('click', async (e) => {
    if (e.target && e.target.id && e.target.id.startsWith('btn_export_dr_')) {
        e.preventDefault();
        const actionType = e.target.id.endsWith('_pdf') ? 'pdf' : 'excel';
        const reportType = e.target.id.replace('btn_export_dr_', '').replace('_pdf', '').replace('_excel', '');
        
        const data = AnalyticsState[reportType]?.filteredDecisionRegister || [];
        if (!data.length) {
            if (typeof toast === 'function') toast("No data to export.");
            return;
        }

        const stats = AnalyticsState[reportType].filteredDecisionRegisterStats;
        const filters = AnalyticsState.filters[reportType] || {};
        const period = getReportPeriodString(reportType, filters);
        const titles = { monthly: 'MONTHLY', yearly: 'YEARLY', unit: 'UNIT', item: 'ITEM', employee: 'EMPLOYEE' };
        
        if (actionType === 'pdf') {
            const fit = (val, width) => {
                const text = String(val ?? "").replace(/\s+/g, " ").trim();
                return text.length > width ? text.slice(0, Math.max(0, width - 3)) + "..." : text.padEnd(width, " ");
            };

            const lines = [
                "UNIFORM MANAGER", `${titles[reportType]} REVIEW DECISION REGISTER - ${period.toUpperCase()}`,
                "=========================================================================================",
                "Total Deduct Cases : " + stats.deductCount,
                "Total Hold Cases   : " + stats.holdCount,
                "Total Waive Cases  : " + stats.waiveCount,
                "Total Recovery Amt : Rs. " + stats.recoveryAmt.toFixed(2),
                "Generated          : " + new Date().toISOString().replace('T', ' ').substring(0, 19),
                "",
                fit("Code", 10) + " " + fit("Name", 20) + " " + fit("Item", 16) + " " + fit("Qty", 6) + " " + fit("Dec.", 8) + " " + fit("Amt", 10) + " " + fit("Unit", 15),
                "-".repeat(88)
            ];

            data.forEach(r => {
                const amtStr = r.decision === 'Deduct' ? Number(r.deduction_amount || 0).toFixed(2) : "-";
                lines.push(fit(r.employee_code, 10) + " " + fit(r.employee_name, 20) + " " + fit(r.item_name, 16) + " " + fit(r.quantity, 6) + " " + fit(r.decision, 8) + " " + fit(amtStr, 10) + " " + fit(r.unit, 15));
            });

            const config = { filename: `${titles[reportType]}_Review_Decision_Register_${period.replace(/[^a-zA-Z0-9]/g, '_')}.pdf`, lines };

            try {
                if (typeof startProgress === 'function') startProgress({ title: "Exporting Decision Register", description: "Preparing the filtered register as a PDF document.", kicker: "LOCAL FILE EXPORT" });
                const res = await window.uniformManager.exportDecisionRegisterPdf(config);
                if (typeof stopProgress === 'function') stopProgress();
                if (!res.canceled && typeof toast === 'function') toast("PDF exported successfully.");
            } catch (err) {
                if (typeof stopProgress === 'function') stopProgress();
                if (typeof showImportError === 'function') showImportError("Export failed: " + err.message);
            }
        } else {
            const headers = ["Payroll Month", "Employee Code", "Employee Name", "Unit", "Item", "Quantity", "Decision", "Deduction Amount", "Review Date", "Approved By", "Remarks", "Current Status"];
            const rows = data.map(r => [
                `${getMonthNameLocal(r.issue_month)} ${r.issue_year}`,
                r.employee_code, r.employee_name, r.unit, r.item_name, r.quantity, r.decision,
                r.decision === 'Deduct' ? Number(r.deduction_amount || 0) : 0,
                r.review_date ? r.review_date.split('T')[0] : '',
                r.approved_by || '', r.remarks || '', r.current_status || ''
            ]);

            const config = {
                filename: `${titles[reportType]}_Review_Decision_Register_${period.replace(/[^a-zA-Z0-9]/g, '_')}.xlsx`,
                sheetName: "Decision Register",
                reportTitle: `${titles[reportType]} REVIEW DECISION REGISTER - ${period.toUpperCase()}`,
                filtersUsed: {
                    "Report Type": titles[reportType], "Target Filter": period,
                    "Employee Filter": document.getElementById(`dr_${reportType}_search_emp`)?.value || 'All',
                    "Unit Filter": document.getElementById(`dr_${reportType}_search_unit`)?.value || 'All',
                    "Item Filter": document.getElementById(`dr_${reportType}_search_item`)?.value || 'All',
                    "Decision Filter": document.getElementById(`dr_${reportType}_search_decision`)?.value || 'All',
                },
                generatedDate: new Date().toISOString().replace('T', ' ').substring(0, 19),
                summary: {
                    "Total Deduct Cases": stats.deductCount, "Total Hold Cases": stats.holdCount,
                    "Total Waive Cases": stats.waiveCount, "Total Recovery Amount": `Rs. ${stats.recoveryAmt.toFixed(2)}`
                },
                headers, data: rows
            };

            try {
                if (typeof startProgress === 'function') startProgress({ title: "Exporting Decision Register", description: "Preparing the filtered register as an Excel workbook.", kicker: "LOCAL FILE EXPORT" });
                const res = await window.uniformManager.exportAnalyticsExcel(config);
                if (typeof stopProgress === 'function') stopProgress();
                if (!res.canceled && typeof toast === 'function') toast("Excel exported successfully.");
            } catch (err) {
                if (typeof stopProgress === 'function') stopProgress();
                if (typeof showImportError === 'function') showImportError("Export failed: " + err.message);
            }
        }
    }
});

document.addEventListener('input', (e) => {
    if (e.target && e.target.id && e.target.id.startsWith('dr_') && e.target.id.includes('_search_')) {
        const type = e.target.id.split('_')[1];
        updateDecisionRegister(type);
    }
});

document.addEventListener('change', (e) => {
    if (e.target && e.target.id && e.target.id.startsWith('dr_') && e.target.id.includes('_search_')) {
        const type = e.target.id.split('_')[1];
        updateDecisionRegister(type);
    }
});
