const AnalyticsState = {
    monthly: null,
    yearly: null,
    unit: null,
    item: null,
    employee: null,
    filters: {}
};

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
                <span style="font-size: 13px; text-overflow: ellipsis; overflow: hidden; white-space: nowrap;" title="${escapeHtml(d.label)}">${escapeHtml(d.label)}</span>
                <div style="background: #111821; height: 16px; border-radius: 4px; border: 1px solid var(--line); overflow: hidden;">
                    <div style="background: var(--blue); height: 100%; width: ${pct}%;"></div>
                </div>
                <span style="font-size: 13px; text-align: right;">${d[valueKey]}</span>
            </div>
        `;
    }).join('');

    return `
        <div class="panel flush" style="display: flex; flex-direction: column;">
            <div class="panel-heading"><h3>${title}</h3></div>
            <div style="padding: 18px; flex: 1; overflow: auto;">${bars}</div>
        </div>
    `;
}

function createVerticalTrendChart(title, data) {
    if (!data || !data.length) return `<div class="panel flush"><div class="panel-heading"><h3>${title}</h3></div><div style="padding: 24px;" class="empty">No trend data available.</div></div>`;
    
    const maxQty = Math.max(...data.map(d => Number(d.total_qty)), 1);
    
    const cols = data.map(d => {
        const mName = monthName(d.month_num).substring(0,3);
        const pctQty = (Number(d.total_qty) / maxQty) * 100;
        return `
            <div style="flex: 1; display: flex; flex-direction: column; justify-content: flex-end; align-items: center; gap: 8px;">
                <span style="font-size: 11px; color: var(--muted); transform: rotate(-45deg); margin-bottom: 4px;">${d.total_qty}</span>
                <div style="width: 100%; max-width: 32px; height: ${pctQty}%; background: var(--blue); border-radius: 4px 4px 0 0;" title="Qty: ${d.total_qty}"></div>
                <span style="font-size: 12px; border-top: 1px solid var(--line); padding-top: 8px; width: 100%; text-align: center;">${mName}</span>
            </div>
        `;
    }).join('');

    return `
        <div class="panel flush" style="margin-bottom: 24px;">
            <div class="panel-heading"><h3>${title}</h3></div>
            <div style="padding: 18px 24px 24px; height: 260px; display: flex; gap: 4px; align-items: flex-end; border-bottom: 1px solid var(--line);">
                ${cols}
            </div>
        </div>
    `;
}

function createDetailedTable(data) {
    if (!data || !data.length) return `<div class="panel flush"><div class="empty" style="padding: 24px;">No records match these filters.</div></div>`;
    
    const rows = data.map(r => {
        const badgeColor = r.decision_status === 'Deduct' ? 'text-red' : (r.decision_status === 'Waive' ? 'text-green' : (r.decision_status === 'Hold' ? 'text-blue' : (r.decision_status === 'Pending' ? 'text-amber' : '')));
        return `
            <tr>
                <td>${r.issued_at ? r.issued_at.split('T')[0] : '-'}</td>
                <td>${r.financial_year || '-'}/${r.issue_month ? String(r.issue_month).padStart(2,'0') : '-'}</td>
                <td>${escapeHtml(r.employee_code)}</td>
                <td>${escapeHtml(r.employee_name)}</td>
                <td>${escapeHtml(r.unit)}</td>
                <td>${escapeHtml(r.item_name)}</td>
                <td><strong>${r.quantity}</strong></td>
                <td>${formatCost(r.rate)}</td>
                <td>${formatCost(r.amount)}</td>
                <td class="${badgeColor}" style="font-weight: 600;">${r.decision_status}</td>
                <td class="reason">${escapeHtml(r.remarks || '-')}</td>
            </tr>
        `;
    }).join('');

    return `
        <div class="panel flush">
            <div class="panel-heading"><h3>Detailed Transactions</h3></div>
            <div class="table-wrap" style="max-height: 500px; overflow: auto;">
                <table>
                    <thead>
                        <tr>
                            <th>Issue Date</th><th>FY / MTH</th><th>Code</th><th>Name</th>
                            <th>Unit</th><th>Item</th><th>Qty</th><th>Rate</th>
                            <th>Total Amount</th><th>Status</th><th>Remarks</th>
                        </tr>
                    </thead>
                    <tbody>${rows}</tbody>
                </table>
            </div>
        </div>
    `;
}

// ------------------------------------------------------------------
// DECISION REGISTER LOGIC (Applied to all Analytics Reports)
// ------------------------------------------------------------------

function createDecisionRegisterHTML(type) {
    const pfx = `dr_${type}`;
    const titles = { monthly: 'MONTHLY', yearly: 'YEARLY', unit: 'UNIT', item: 'ITEM', employee: 'EMPLOYEE' };
    const title = `${titles[type]} REVIEW DECISION REGISTER`;
    
    return `
    <div class="panel flush" style="margin-top: 24px; display: flex; flex-direction: column;">
        <div class="panel-heading" style="display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid var(--line); padding-bottom: 16px;">
            <div>
                <h3 style="margin: 0 0 4px 0;">${title}</h3>
                <p style="margin: 0; color: var(--muted); font-size: 13px;">Automatic operational ledger of review decisions for this filter.</p>
            </div>
            <div style="display: flex; gap: 10px;">
                <button class="secondary" id="btn_export_${pfx}_pdf">Export PDF</button>
                <button class="secondary" id="btn_export_${pfx}_excel">Export Excel</button>
            </div>
        </div>
        <div class="mini-stats" style="margin: 18px 18px 0 18px; grid-template-columns: repeat(4, 1fr);" id="${pfx}_summary_cards"></div>
        <div style="margin: 18px; display: flex; gap: 10px; background: #111821; padding: 12px; border-radius: 6px; border: 1px solid var(--line);">
            <input type="text" id="${pfx}_search_code" placeholder="Employee Code" style="flex: 1;" />
            <input type="text" id="${pfx}_search_name" placeholder="Employee Name" style="flex: 1;" />
            <input type="text" id="${pfx}_search_unit" placeholder="Unit" style="flex: 1;" />
            <input type="text" id="${pfx}_search_item" placeholder="Item" style="flex: 1;" />
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
                    <tr>
                        <th>Payroll Month</th><th>Code</th><th>Name</th><th>Unit</th>
                        <th>Item</th><th>Qty</th><th>Decision</th><th>Ded Amount</th>
                        <th>Review Date</th><th>Approved By</th><th>Remarks</th><th>Current Status</th>
                    </tr>
                </thead>
                <tbody id="${pfx}_table_body"></tbody>
            </table>
        </div>
    </div>
    `;
}

function updateDecisionRegister(type) {
    const data = AnalyticsState[type]?.decisionRegister || [];
    const pfx = `dr_${type}`;
    const codeFilter = (document.getElementById(`${pfx}_search_code`)?.value || '').toLowerCase();
    const nameFilter = (document.getElementById(`${pfx}_search_name`)?.value || '').toLowerCase();
    const unitFilter = (document.getElementById(`${pfx}_search_unit`)?.value || '').toLowerCase();
    const itemFilter = (document.getElementById(`${pfx}_search_item`)?.value || '').toLowerCase();
    const decisionFilter = document.getElementById(`${pfx}_search_decision`)?.value || '';

    const filtered = data.filter(r => {
        if (codeFilter && !String(r.employee_code).toLowerCase().includes(codeFilter)) return false;
        if (nameFilter && !String(r.employee_name).toLowerCase().includes(nameFilter)) return false;
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
        const payrollMonth = `${monthName(r.issue_month)} ${r.issue_year}`;
        const badge = r.decision === 'Deduct' ? 'text-red' : (r.decision === 'Waive' ? 'text-green' : 'text-blue');
        return `
            <tr>
                <td>${payrollMonth}</td>
                <td>${escapeHtml(r.employee_code)}</td>
                <td>${escapeHtml(r.employee_name)}</td>
                <td>${escapeHtml(r.unit)}</td>
                <td>${escapeHtml(r.item_name)}</td>
                <td><strong>${r.quantity}</strong></td>
                <td class="${badge}" style="font-weight: 600;">${r.decision}</td>
                <td class="text-red">${r.decision === 'Deduct' ? formatCost(r.deduction_amount) : '-'}</td>
                <td>${dateStr}</td>
                <td>${escapeHtml(r.approved_by || '-')}</td>
                <td class="reason">${escapeHtml(r.remarks || '-')}</td>
                <td>${escapeHtml(r.current_status)}</td>
            </tr>
        `;
    }).join('') || `<tr><td colspan="12" class="empty" style="text-align: center; padding: 24px;">No review decisions match your filters.</td></tr>`;

    const bodyEl = document.getElementById(`${pfx}_table_body`);
    if (bodyEl) bodyEl.innerHTML = rowsHtml;

    AnalyticsState[type].filteredDecisionRegister = filtered;
    AnalyticsState[type].filteredDecisionRegisterStats = { deductCount, holdCount, waiveCount, recoveryAmt };
}

function bindDecisionRegisterEvents(type) {
    const pfx = `dr_${type}`;
    const inputs = [`${pfx}_search_code`, `${pfx}_search_name`, `${pfx}_search_unit`, `${pfx}_search_item`, `${pfx}_search_decision`];
    
    inputs.forEach(id => {
        const el = document.getElementById(id);
        if (el) el.addEventListener(id.includes('decision') ? 'change' : 'input', () => updateDecisionRegister(type));
    });

    document.getElementById(`btn_export_${pfx}_excel`)?.addEventListener('click', () => exportDecisionRegisterExcel(type));
    document.getElementById(`btn_export_${pfx}_pdf`)?.addEventListener('click', () => exportDecisionRegisterPdf(type));

    updateDecisionRegister(type);
}

function getReportPeriodString(type, filters) {
    if (type === 'monthly') return `${monthName(filters.month)} ${filters.fy}`;
    if (type === 'yearly') return `FY ${filters.fy}`;
    if (type === 'unit') return `${filters.unit} - FY ${filters.fy}`;
    if (type === 'item') return `${filters.item} - FY ${filters.fy}`;
    if (type === 'employee') return `${filters.employee}${filters.fy ? ' - FY ' + filters.fy : ''}`;
    return "ALL";
}

async function exportDecisionRegisterExcel(type) {
    const data = AnalyticsState[type]?.filteredDecisionRegister || [];
    if (!data.length) return toast("No data to export.");
    
    const filters = AnalyticsState.filters[type] || {};
    const period = getReportPeriodString(type, filters);
    const titles = { monthly: 'MONTHLY', yearly: 'YEARLY', unit: 'UNIT', item: 'ITEM', employee: 'EMPLOYEE' };

    const headers = ["Payroll Month", "Employee Code", "Employee Name", "Unit", "Item", "Quantity", "Decision", "Deduction Amount", "Review Date", "Approved By", "Remarks", "Current Status"];
    const rows = data.map(r => [
        `${monthName(r.issue_month)} ${r.issue_year}`,
        r.employee_code, r.employee_name, r.unit, r.item_name, r.quantity, r.decision,
        r.decision === 'Deduct' ? Number(r.deduction_amount || 0) : 0,
        r.review_date ? r.review_date.split('T')[0] : '',
        r.approved_by || '', r.remarks || '', r.current_status || ''
    ]);

    const stats = AnalyticsState[type].filteredDecisionRegisterStats;

    const config = {
        filename: `${titles[type]}_Review_Decision_Register_${period.replace(/[^a-zA-Z0-9]/g, '_')}.xlsx`,
        sheetName: "Decision Register",
        reportTitle: `${titles[type]} REVIEW DECISION REGISTER - ${period.toUpperCase()}`,
        filtersUsed: {
            "Report Type": titles[type],
            "Target Filter": period,
            "Employee Code Filter": document.getElementById(`dr_${type}_search_code`)?.value || 'All',
            "Employee Name Filter": document.getElementById(`dr_${type}_search_name`)?.value || 'All',
            "Unit Filter": document.getElementById(`dr_${type}_search_unit`)?.value || 'All',
            "Item Filter": document.getElementById(`dr_${type}_search_item`)?.value || 'All',
            "Decision Filter": document.getElementById(`dr_${type}_search_decision`)?.value || 'All',
        },
        generatedDate: new Date().toISOString().replace('T', ' ').substring(0, 19),
        summary: {
            "Total Deduct Cases": stats.deductCount,
            "Total Hold Cases": stats.holdCount,
            "Total Waive Cases": stats.waiveCount,
            "Total Recovery Amount": `Rs. ${stats.recoveryAmt.toFixed(2)}`
        },
        headers,
        data: rows
    };

    try {
        startProgress();
        const res = await window.uniformManager.exportAnalyticsExcel(config);
        stopProgress();
        if (!res.canceled) toast("Excel exported successfully.");
    } catch (err) {
        stopProgress();
        showImportError("Export failed: " + err.message);
    }
}

async function exportDecisionRegisterPdf(type) {
    const data = AnalyticsState[type]?.filteredDecisionRegister || [];
    if (!data.length) return toast("No data to export.");

    const stats = AnalyticsState[type].filteredDecisionRegisterStats;
    const filters = AnalyticsState.filters[type] || {};
    const period = getReportPeriodString(type, filters);
    const titles = { monthly: 'MONTHLY', yearly: 'YEARLY', unit: 'UNIT', item: 'ITEM', employee: 'EMPLOYEE' };
    const mainTitle = `${titles[type]} REVIEW DECISION REGISTER - ${period.toUpperCase()}`;

    const fit = (val, width) => {
        const text = String(val ?? "").replace(/\s+/g, " ").trim();
        return text.length > width ? text.slice(0, Math.max(0, width - 3)) + "..." : text.padEnd(width, " ");
    };

    const lines = [
        "UNIFORM MANAGER",
        mainTitle,
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
        lines.push(
            fit(r.employee_code, 10) + " " + fit(r.employee_name, 20) + " " + fit(r.item_name, 16) + " " + fit(r.quantity, 6) + " " + fit(r.decision, 8) + " " + fit(amtStr, 10) + " " + fit(r.unit, 15)
        );
    });

    const config = {
        filename: `${titles[type]}_Review_Decision_Register_${period.replace(/[^a-zA-Z0-9]/g, '_')}.pdf`,
        lines
    };

    try {
        startProgress();
        const res = await window.uniformManager.exportDecisionRegisterPdf(config);
        stopProgress();
        if (!res.canceled) toast("PDF exported successfully.");
    } catch (err) {
        stopProgress();
        showImportError("Export failed: " + err.message);
    }
}

// ------------------------------------------------------------------
// MAIN RENDERER
// ------------------------------------------------------------------

async function renderAnalytics(reportType, containerId, data) {
    const container = document.getElementById(containerId);
    if (!data) {
        container.innerHTML = `<div class="empty" style="padding: 24px; text-align: center;">Generate report to view data.</div>`;
        return;
    }

    let html = createSummaryCardsHTML(data.summary);

    if (reportType === 'monthly') {
        html += `<div style="display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 18px; margin-bottom: 24px;">
                    ${createHorizontalChart('Item Distribution', data.itemWise)}
                    ${createHorizontalChart('Top 10 Units', data.unitWise)}
                    ${createHorizontalChart('Top 10 Employees', data.topEmployees)}
                 </div>`;
    } 
    else if (reportType === 'yearly') {
        html += createVerticalTrendChart('Yearly Monthly Distribution Trend', data.monthlyTrend);
        html += `<div style="display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 18px; margin-bottom: 24px;">
                    ${createHorizontalChart('Item Distribution', data.itemWise)}
                    ${createHorizontalChart('Top Units', data.unitWise)}
                    ${createHorizontalChart('Top Employees', data.topEmployees)}
                 </div>`;
    } 
    else if (reportType === 'unit') {
        html += `<div style="display: grid; grid-template-columns: 1fr 1fr; gap: 18px; margin-bottom: 24px;">
                    ${createHorizontalChart('Item Breakdown', data.itemWise)}
                    ${createHorizontalChart('Top Employees', data.topEmployees)}
                 </div>`;
    } 
    else if (reportType === 'item') {
        html += createVerticalTrendChart('Item Specific Monthly Trend', data.monthlyTrend);
        html += `<div style="display: grid; grid-template-columns: 1fr 1fr; gap: 18px; margin-bottom: 24px;">
                    ${createHorizontalChart('Unit Consumption', data.unitWise)}
                    ${createHorizontalChart('Top Employees', data.topEmployees)}
                 </div>`;
    } 
    else if (reportType === 'employee') {
        html += `<div style="display: grid; grid-template-columns: 1fr; gap: 18px; margin-bottom: 24px;">
                    ${createHorizontalChart('Employee History Items', data.itemWise)}
                 </div>`;
    }

    html += createDetailedTable(data.table || data.timeline);
    
    // Automatically inject the respective Decision Register
    html += createDecisionRegisterHTML(reportType);
    
    container.innerHTML = html;

    // Attach local filter logic for the generated register
    bindDecisionRegisterEvents(reportType);
}

const setupAnalyticsForm = (reportType) => {
    const form = document.getElementById(`form_analytics_${reportType}`);
    const btn = document.getElementById(`btn_export_analytics_${reportType}`);
    
    if (form) {
        form.addEventListener('submit', async (e) => {
            e.preventDefault();
            const formData = new FormData(form);
            const filters = Object.fromEntries(formData.entries());
            AnalyticsState.filters[reportType] = filters;

            try {
                startProgress();
                const data = await window.uniformManager.getAnalyticsData(reportType, filters);
                AnalyticsState[reportType] = data;
                renderAnalytics(reportType, `content_analytics_${reportType}`, data);
                btn.disabled = false;
                stopProgress();
                toast("Analytics report generated.");
            } catch (err) {
                stopProgress();
                showImportError(err.message || "Failed to generate analytics.");
            }
        });
    }

    if (btn) {
        btn.addEventListener('click', async () => {
            const data = AnalyticsState[reportType];
            if (!data || !data.table && !data.timeline) return toast("No data to export.");

            const rawData = data.table || data.timeline;
            const headers = ["Issue Date", "FY", "Month", "Employee Code", "Employee Name", "Unit", "Item", "Quantity", "Rate", "Amount", "Status", "Remarks"];
            
            const rows = rawData.map(r => [
                r.issued_at ? r.issued_at.split('T')[0] : '',
                r.financial_year || '', r.issue_month || '',
                r.employee_code, r.employee_name, r.unit, r.item_name,
                r.quantity, r.rate, r.amount, r.decision_status, r.remarks
            ]);

            const config = {
                filename: `Analytics_${reportType.toUpperCase()}_Report.xlsx`,
                sheetName: "Analytics Data",
                reportTitle: `${reportType.toUpperCase()} ANALYTICS REPORT`,
                filtersUsed: AnalyticsState.filters[reportType],
                generatedDate: new Date().toISOString(),
                summary: {
                    "Total Employees": data.summary.total_employees,
                    "Total Quantity": data.summary.total_quantity_issued,
                    "Total Cost": data.summary.total_distribution_cost,
                    "Recovery Amount": data.summary.total_recovery_amount
                },
                headers,
                data: rows
            };

            try {
                startProgress();
                const res = await window.uniformManager.exportAnalyticsExcel(config);
                stopProgress();
                if (!res.canceled) toast("Analytics Excel exported successfully.");
            } catch (err) {
                stopProgress();
                showImportError("Export failed: " + err.message);
            }
        });
    }
};

['monthly', 'yearly', 'unit', 'item', 'employee'].forEach(setupAnalyticsForm);