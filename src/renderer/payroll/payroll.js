function renderDeductions() {
  // 1. Deduction Register
  renderTableRows("deductionRows", state.salaryDeductions, (row) => `
    <tr>
      <td>${text(row.created_at).split('T')[0]}</td>
      <td>${text(row.employee_code)}</td>
      <td>${text(row.employee_name)}</td>
      <td>${text(row.unit)}</td>
      <td>${text(row.item_name)}</td>
      <td>${text(row.excess_qty)}</td>
      <td>${formatCompactMoney(row.item_cost)}</td>
      <td>${formatCompactMoney(row.amount)}</td>
      <td>${formatPeriod(row)}</td>
      <td><span class="badge Deducted">${text(row.status)}</span></td>
      <td class="reason">
        ${row.pdf_path ? `
          <div class="report-cell">
            <button data-open-report="${escapeHtml(row.pdf_path)}">Open PDF</button>
            <span>${escapeHtml(row.pdf_path)}</span>
          </div>
        ` : "-"}
      </td>
    </tr>
  `, "No salary deductions generated. Use Deduct in Review Queue.", 11);

  // 2. Hold Register
  renderTableRows("holdRows", state.holdRecords, (row) => `
    <tr>
      <td>${text(row.decided_at || row.created_at).split('T')[0]}</td>
      <td>${text(row.employee_code)}</td>
      <td>${text(row.employee_name)}</td>
      <td>${text(row.unit)}</td>
      <td>${text(row.item_name)}</td>
      <td>${text(row.excess_qty)}</td>
      <td class="reason">${text(row.remarks || row.reason)}</td>
      <td>
        <button data-review="${row.id}" data-status="Pending" class="secondary">Reopen to Pending</button>
      </td>
    </tr>
  `, "No records currently on hold.", 8);

  // 3. Waive Register
  renderTableRows("waiveRows", state.waiveRecords, (row) => `
    <tr>
      <td>${text(row.created_at).split('T')[0]}</td>
      <td>${text(row.employee_code)}</td>
      <td>${text(row.employee_name)}</td>
      <td>${text(row.unit)}</td>
      <td>${text(row.item_name)}</td>
      <td class="reason">${text(row.reason)}</td>
      <td class="reason">${text(row.remarks)}</td>
    </tr>
  `, "No waive records found.", 7);
}

document.addEventListener("click", async (event) => {
  const openReportButton = event.target.closest("[data-open-report]");
  if (openReportButton) {
    try {
      await window.uniformManager.openDeductionReport(openReportButton.dataset.openReport);
      toast("Opening deduction report.");
    } catch (error) {
      showImportError(error.message || "Could not open deduction report.");
    }
    return;
  }
});

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

document.addEventListener("click", (event) => {
    const exportBtn = event.target.closest("[data-export]");
    if (exportBtn) {
        triggerExcelExport(exportBtn.dataset.export);
    }
});
