function getTodayDateStr() {
    return new Date().toISOString().split('T')[0];
}

async function triggerExcelExport(reportType) {
    if (!state) return toast("Data is not loaded yet.");
    
    let config = { headers: [], data: [], sheetName: "", filename: "" };
    const dateStr = getTodayDateStr();

    switch (reportType) {
        case 'salaryDeduction':
            config.headers = ["Employee Code", "Employee Name", "Unit", "Item", "Quantity", "Rate", "Amount", "Decision Date", "Status"];
            config.data = (state.salaryDeductions || []).map(r => [
                r.employee_code, r.employee_name, r.unit, r.item_name, r.excess_qty, r.item_cost, r.amount, r.created_at?.split('T')[0], r.status
            ]);
            config.sheetName = "Deductions";
            config.filename = `Salary_Deduction_Register_${dateStr}.xlsx`;
            break;

        case 'pendingReview':
            const pending = (state.reviews || []).filter(r => r.status === 'Pending');
            config.headers = ["Employee Code", "Employee Name", "Unit", "Item", "Issued Qty", "Allowed Qty", "Pending Qty"];
            config.data = pending.map(r => [
                r.employee_code, r.employee_name, r.unit, r.item_name, r.issued_qty, r.allowed_qty || 0, r.excess_qty
            ]);
            config.sheetName = "Pending Reviews";
            config.filename = `Pending_Review_Register_${dateStr}.xlsx`;
            break;

        case 'waive':
            config.headers = ["Employee Code", "Employee Name", "Item", "Qty", "Reason", "Date"];
            config.data = (state.waiveRecords || []).map(r => [
                r.employee_code, r.employee_name, r.item_name, r.quantity || 0, r.reason, r.created_at?.split('T')[0]
            ]);
            config.sheetName = "Waived";
            config.filename = `Waive_Register_${dateStr}.xlsx`;
            break;

        case 'hold':
            config.headers = ["Employee Code", "Employee Name", "Item", "Qty", "Reason", "Date"];
            config.data = (state.holdRecords || []).map(r => [
                r.employee_code, r.employee_name, r.item_name, r.excess_qty, r.reason || r.remarks, (r.decided_at || r.created_at)?.split('T')[0]
            ]);
            config.sheetName = "Hold";
            config.filename = `Hold_Register_${dateStr}.xlsx`;
            break;

        case 'history':
            config.headers = ["Employee Code", "Employee Name", "Unit", "Godown", "Item", "Quantity", "Period", "Date Issued"];
            config.data = (state.uniformIssues || []).map(r => [
                r.employee_code, r.employee_name, r.unit, r.godown, r.item_name, r.quantity, r.issue_period_label, r.issued_at?.split('T')[0]
            ]);
            config.sheetName = "Employee History";
            config.filename = `Employee_History_${dateStr}.xlsx`;
            break;

        case 'unitSummary':
            config.headers = ["Unit", "Total Employees", "Total Items Issued", "Total Recoveries (Amount)"];
            const unitStats = {};
            (state.uniformIssueMatrix?.rows || []).forEach(r => {
                const u = r.unit || "Unknown";
                if (!unitStats[u]) unitStats[u] = { emp: new Set(), issued: 0, recovered: 0 };
                unitStats[u].emp.add(r.employee_code);
                unitStats[u].issued += Number(r.total_quantity || 0);
            });
            (state.salaryDeductions || []).forEach(d => {
                const u = d.unit || "Unknown";
                if (!unitStats[u]) unitStats[u] = { emp: new Set(), issued: 0, recovered: 0 };
                unitStats[u].recovered += Number(d.amount || 0);
            });
            config.data = Object.keys(unitStats).map(u => [
                u, unitStats[u].emp.size, unitStats[u].issued, unitStats[u].recovered
            ]);
            config.sheetName = "Unit Summary";
            config.filename = `Unit_Summary_${dateStr}.xlsx`;
            break;

        case 'itemSummary':
            config.headers = ["Item Name", "Issued Quantity", "Pending Quantity", "Recovered Quantity"];
            const itemStats = {};
            (state.items || []).forEach(i => itemStats[i.item_name] = { issued: 0, pending: 0, recovered: 0 });
            (state.uniformIssues || []).forEach(iss => {
                if (!itemStats[iss.item_name]) itemStats[iss.item_name] = { issued: 0, pending: 0, recovered: 0 };
                itemStats[iss.item_name].issued += Number(iss.quantity || 0);
            });
            (state.reviews || []).forEach(r => {
                if (r.status === 'Pending') {
                    if (!itemStats[r.item_name]) itemStats[r.item_name] = { issued: 0, pending: 0, recovered: 0 };
                    itemStats[r.item_name].pending += Number(r.excess_qty || 0);
                }
            });
            (state.salaryDeductions || []).forEach(d => {
                if (!itemStats[d.item_name]) itemStats[d.item_name] = { issued: 0, pending: 0, recovered: 0 };
                itemStats[d.item_name].recovered += Number(d.excess_qty || 0);
            });
            config.data = Object.keys(itemStats).map(i => [
                i, itemStats[i].issued, itemStats[i].pending, itemStats[i].recovered
            ]);
            config.sheetName = "Item Summary";
            config.filename = `Item_Summary_${dateStr}.xlsx`;
            break;
    }

    if (config.data.length === 0) {
        return toast("No data available for export.");
    }

    try {
        startProgress();
        const res = await window.uniformManager.exportExcel(config);
        stopProgress();
        if (!res.canceled) toast("Excel exported successfully to: " + res.filePath);
    } catch (err) {
        stopProgress();
        showImportError("Export failed: " + err.message);
    }
}

// Attach listeners to all Export buttons
document.addEventListener("click", (event) => {
    const exportBtn = event.target.closest("[data-export]");
    if (exportBtn) {
        triggerExcelExport(exportBtn.dataset.export);
    }
});