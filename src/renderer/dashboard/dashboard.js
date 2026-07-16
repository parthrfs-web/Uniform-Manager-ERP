function render() {
  if (!state) return;
  document.getElementById("dbPath").textContent = state.dbPath || "Unknown";
  
  document.getElementById("employeeCount").textContent = Array.isArray(state.employees) ? state.employees.length : 0;
  document.getElementById("deductionTotal").textContent = `Rs. ${(Array.isArray(state.salaryDeductions) ? state.salaryDeductions : []).reduce((sum, row) => sum + Number(row.amount || 0), 0).toFixed(2)}`;
  
  const matrixRows = state.uniformIssueMatrix?.rows;
  document.getElementById("issueCount").textContent = state.uniformIssueMatrix?.totalRows ?? (Array.isArray(matrixRows) ? matrixRows.length : 0);
  
  const pendingReviews = Array.isArray(state.reviews) ? state.reviews.filter((r) => r.status === "Pending").length : 0;
  document.getElementById("reviewCount").textContent = state.reviewPendingCount ?? pendingReviews;

  renderLatestImport();
  renderEmployees();
  renderIssues();
  renderDeductions();
  renderReviews();
  renderPolicies();
  renderItems();
}

function renderLatestImport() {
  const latest = state.imports[0];
  const box = document.getElementById("lastImport");
  if (!latest) {
    box.className = "empty";
    box.textContent = "No workbook imported yet.";
    return;
  }
  box.className = "";
  const issueCount = Number(state.uniformIssueCount || state.uniformIssues.filter((row) => row.import_id === latest.id && Number(row.quantity || 0) > 0).length);
  box.innerHTML = `
    <strong>${text(latest.file_name)}</strong>
    <p>Detected sheet: <b>${text(latest.selected_sheet)}</b>. Employees inserted ${latest.inserted_count}, updated ${latest.updated_count}, skipped ${latest.skipped_count} from ${latest.total_rows} rows. Uniform item entries captured: ${issueCount}.</p>
  `;
}

document.getElementById("resetAcknowledge")?.addEventListener("change", (event) => {
  document.getElementById("resetDataBtn").disabled = !event.target.checked;
});

document.getElementById("resetDataBtn")?.addEventListener("click", async () => {
  if (!desktopApi) return showImportError("Works only in Desktop App.");
  try {
    const result = await window.uniformManager.resetOperationalData();
    if (result.canceled) {
      toast("Reset cancelled.");
      return;
    }
    state = await window.uniformManager.getState({ distributionLimit });
    document.getElementById("resetAcknowledge").checked = false;
    document.getElementById("resetDataBtn").disabled = true;
    render();
    setView("dashboard");
    toast("Imported data reset. You can import again now.");
  } catch (error) {
    showImportError(error.message || "Reset failed.");
  }
});