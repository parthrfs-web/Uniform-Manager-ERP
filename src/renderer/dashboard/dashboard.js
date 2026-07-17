function render() {
  if (!state) return;
  document.getElementById("dbPath").textContent = state.dbPath || "Unknown";
  
  document.getElementById("dashPendingReviews").textContent = state.reviewPendingCount || 0;
  
  const heldCount = (state.reviews || []).filter(r => r.status === 'Held' || r.status === 'Hold').length;
  document.getElementById("dashHeldCases").textContent = heldCount;
  
  const waivedCount = (state.waiveRecords || []).length;
  document.getElementById("dashWaivedCases").textContent = waivedCount;
  
  document.getElementById("dashTotalReviews").textContent = state.reviewTotalCount || 0;
  
  const todayStr = new Date().toISOString().split('T')[0];
  const todayImports = (state.imports || []).filter(i => (i.imported_at || "").startsWith(todayStr)).length;
  document.getElementById("dashTodayImports").textContent = todayImports;
  
  document.getElementById("dashEmployees").textContent = Array.isArray(state.employees) ? state.employees.length : 0;
  
  const matrixRows = state.uniformIssueMatrix?.rows;
  document.getElementById("dashDistRows").textContent = state.uniformIssueMatrix?.totalRows ?? (Array.isArray(matrixRows) ? matrixRows.length : 0);
  
  const recoveredTotal = (state.salaryDeductions || []).reduce((sum, row) => sum + Number(row.amount || 0), 0);
  document.getElementById("dashRecovered").textContent = `Rs. ${recoveredTotal.toFixed(2)}`;

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

// ====== MODULE 10: BACKUP & RESTORE ======

document.getElementById("backupDbBtn")?.addEventListener("click", async () => {
  if (!desktopApi) return showImportError("Works only in Desktop App.");
  try {
    startProgress();
    document.getElementById("progressStatus").textContent = "Creating database backup...";
    const result = await window.uniformManager.backupDatabase();
    stopProgress();
    
    if (result && !result.canceled) {
      toast("Database backup created successfully.");
    } else {
      toast("Backup creation cancelled.");
    }
  } catch (error) {
    stopProgress();
    showImportError("Backup failed: " + error.message);
  }
});

document.getElementById("restoreDbBtn")?.addEventListener("click", async () => {
  if (!desktopApi) return showImportError("Works only in Desktop App.");
  
  const confirmMsg = "Are you sure you want to restore from a backup?\n\nWARNING: This will completely overwrite your current database. All unsaved changes and current data will be permanently lost.\n\nThe application will automatically restart after restoration completes.";
  if (!confirm(confirmMsg)) return;

  try {
    startProgress();
    document.getElementById("progressStatus").textContent = "Validating and restoring backup data...";
    const result = await window.uniformManager.restoreDatabase();
    
    // Note: If restoration is successful, app automatically kills process and relaunches.
    if (result && result.canceled) {
      stopProgress();
      toast("Restore operation cancelled.");
    }
  } catch (error) {
    stopProgress();
    showImportError("Restore failed: " + error.message);
  }
});

// =========================================

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