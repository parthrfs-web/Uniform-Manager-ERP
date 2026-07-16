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