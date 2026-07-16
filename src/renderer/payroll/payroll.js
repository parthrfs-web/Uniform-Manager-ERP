function renderDeductions() {
  renderTableRows("deductionRows", state.salaryDeductions, (row) => `
    <tr>
      <td>${text(row.created_at)}</td>
      <td>${text(row.employee_code)}</td>
      <td>${text(row.employee_name)}</td>
      <td>${text(row.unit)}</td>
      <td>${formatPeriod(row)}</td>
      <td>${formatCompactMoney(row.amount)}</td>
      <td class="reason">${text(row.reason)}</td>
      <td class="reason">
        ${row.pdf_path ? `
          <div class="report-cell">
            <button data-open-report="${escapeHtml(row.pdf_path)}">Open PDF</button>
            <span>${escapeHtml(row.pdf_path)}</span>
          </div>
        ` : "-"}
      </td>
    </tr>
  `, "No salary deductions created yet. Use Deduct From Salary in Review Queue.", 8);

  renderTableRows("waiveRows", state.waiveRecords, (row) => `
    <tr>
      <td>${text(row.created_at)}</td>
      <td>#${text(row.review_id)}</td>
      <td>${text(row.employee_code)}</td>
      <td>${text(row.employee_name)}</td>
      <td>${text(row.unit)}</td>
      <td>${text(row.remarks)}</td>
      <td class="reason">${text(row.reason)}</td>
    </tr>
  `, "No waive records created yet. Use Waive in Review Queue.", 7);
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
