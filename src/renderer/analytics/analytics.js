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
    container.innerHTML = html;
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