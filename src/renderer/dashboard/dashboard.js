function render() {
  if (!state) return;
  document.getElementById("dbPath").textContent = state.dbPath || "Unknown";

  const now = new Date();
  const todayStr = now.toISOString().split('T')[0];
  const monthStr = todayStr.substring(0, 7);

  // Aggregating Stats
  const employees = state.employees || [];
  const activeEmployees = employees.filter(e => e.status === 'Active').length;
  const uniqueUnits = new Set(employees.map(e => String(e.unit || "").trim()).filter(Boolean)).size;

  const matrixRows = state.uniformIssueMatrix?.rows || [];
  const excessEmployees = matrixRows.filter(r => r.total_excess > 0 || r.entitlement_status === 'Excess').length;

  const imports = state.imports || [];
  const todayImports = imports.filter(i => (i.imported_at || "").startsWith(todayStr)).length;
  const monthImports = imports.filter(i => (i.imported_at || "").startsWith(monthStr)).length;

  const getChildStat = (dec) => {
     const stat = (state.childDecisionStats || []).find(s => s.decision === dec);
     return stat ? stat.count : 0;
  };
  
  const deductedCases = getChildStat('Deduct');
  const heldCount = getChildStat('Hold');
  const waivedCount = getChildStat('Waive');
  const recoveredTotal = (state.payrollBatches || []).reduce((sum, b) => sum + Number(b.total_recovery_amount || 0), 0);

  // DOM Card Updates
  document.getElementById("dashActiveEmployees").textContent = activeEmployees;
  document.getElementById("dashTotalEmployees").textContent = employees.length;
  document.getElementById("dashDistRows").textContent = state.uniformIssueMatrix?.totalRows ?? matrixRows.length;
  document.getElementById("dashExcessEmployees").textContent = excessEmployees;

  document.getElementById("dashPendingReviews").textContent = state.reviewPendingCount || 0;
  document.getElementById("dashTotalReviews").textContent = state.reviewTotalCount || 0;
  document.getElementById("dashHeldCases").textContent = heldCount;
  document.getElementById("dashWaivedCases").textContent = waivedCount;

  document.getElementById("dashDeductedCases").textContent = deductedCases;
  document.getElementById("dashRecovered").textContent = formatCompactMoney(recoveredTotal);

  document.getElementById("dashTodayImports").textContent = todayImports;
  document.getElementById("dashMonthImports").textContent = monthImports;

  document.getElementById("dashUnits").textContent = uniqueUnits;
  document.getElementById("dashInventoryItems").textContent = (state.items || []).length;
  document.getElementById("dashPolicies").textContent = (state.policies || []).length;

  // Delegated Panel Updates
  renderLatestImport();
  renderTopLists();

  // Rendering Other Sub-modules
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
  const dateStr = (latest.imported_at || "").replace("T", " ").substring(0, 19);

  box.innerHTML = `
    <strong style="font-size: 16px;">${escapeHtml(latest.file_name)}</strong>
    <p style="color: var(--muted); line-height: 1.6; margin-top: 8px;">
      Import Date: <b style="color: var(--ink);">${dateStr}</b> | Processing Time: <b style="color: var(--ink);">${latest.duration_ms || 0} ms</b><br/>
      Detected Sheet: <b style="color: var(--ink);">${escapeHtml(latest.selected_sheet)}</b><br/>
      Employees Imported: <b>${latest.inserted_count}</b> new, <b>${latest.updated_count}</b> updated, <b>${latest.skipped_count}</b> skipped.<br/>
      Distribution Rows / Item Entries Captured: <b>${issueCount}</b>.
    </p>
  `;
}

function renderTopLists() {
  // 1. Top 10 Units with highest excess
  const unitExcessMap = new Map();
  (state.uniformIssueMatrix?.rows || []).forEach(row => {
     const u = String(row.unit || "Unknown").trim();
     unitExcessMap.set(u, (unitExcessMap.get(u) || 0) + Number(row.total_excess || 0));
  });
  const topUnits = [...unitExcessMap.entries()]
      .filter(([_, qty]) => qty > 0)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10);
  renderHtml("topUnitsExcess", topUnits.map(([unit, qty]) => `<tr><td>${escapeHtml(unit)}</td><td>${qty}</td></tr>`).join(""), `<tr><td colspan="2" class="empty">No excess uniform data.</td></tr>`);

  // 2. Top 10 Most Issued Items
  const itemIssueMap = new Map();
  (state.uniformIssues || []).forEach(row => {
     if(Number(row.quantity) > 0) {
       const item = String(row.item_name || "Unknown").trim();
       itemIssueMap.set(item, (itemIssueMap.get(item) || 0) + Number(row.quantity || 0));
     }
  });
  const topItems = [...itemIssueMap.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10);
  renderHtml("topIssuedItems", topItems.map(([item, qty]) => `<tr><td>${escapeHtml(item)}</td><td>${qty}</td></tr>`).join(""), `<tr><td colspan="2" class="empty">No items issued yet.</td></tr>`);

  // 3. Top 10 Employees with highest recoveries
  const empRecoveryMap = new Map();
  // We can't use live state.salaryDeductions easily here, query batches or simplify. Omitted detailed historical mapping for dashboard.
  renderHtml("topEmployeesRecovery", `<tr><td colspan="2" class="empty">View recovery totals in archived reports.</td></tr>`);

  // 4. Most Common Excess Items (From Pending Reviews)
  const excessItemMap = new Map();
  (state.reviews || []).forEach(row => {
     if(row.status === 'Pending' && Number(row.pending_qty) > 0) {
        const item = String(row.item_name || "Unknown").trim();
        excessItemMap.set(item, (excessItemMap.get(item) || 0) + Number(row.pending_qty));
     }
  });
  const topExcessItems = [...excessItemMap.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10);
  renderHtml("topCommonExcess", topExcessItems.map(([item, qty]) => `<tr><td>${escapeHtml(item)}</td><td class="text-amber">${qty}</td></tr>`).join(""), `<tr><td colspan="2" class="empty">No pending excess items.</td></tr>`);
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

let payrollArchiveDeleteStep = 1;
const payrollArchiveDeletePhrase = "DELETE PAYROLL ARCHIVE";

function closePayrollArchiveDeleteModal() {
  const modal = document.getElementById("deletePayrollArchiveModal");
  if (modal) modal.classList.remove("show");
  const input = document.getElementById("deletePayrollArchiveConfirmInput");
  if (input) input.value = "";
}

function renderPayrollArchiveDeleteStep(step) {
  payrollArchiveDeleteStep = step;
  const modal = document.getElementById("deletePayrollArchiveModal");
  const title = document.getElementById("deletePayrollArchiveTitle");
  const message = document.getElementById("deletePayrollArchiveMessage");
  const inputWrap = document.getElementById("deletePayrollArchiveConfirmWrap");
  const input = document.getElementById("deletePayrollArchiveConfirmInput");
  const confirmButton = document.getElementById("confirmPayrollArchiveDeleteBtn");
  if (!modal || !title || !message || !inputWrap || !input || !confirmButton) return;

  input.value = "";
  inputWrap.style.display = "none";
  confirmButton.disabled = false;

  if (step === 1) {
    title.textContent = "Delete Payroll Archive";
    message.textContent = "You are about to permanently delete ALL archived payroll reports.\n\nThis action cannot be undone.";
    confirmButton.textContent = "Continue";
  } else if (step === 2) {
    title.textContent = "Final Warning";
    message.textContent = "This will permanently delete every archived payroll batch, archived payroll report, archived deduction register, archived waiver register and archived hold register.\n\nHistorical payroll records will no longer be available.\n\nThis action is irreversible.";
    confirmButton.textContent = "I Understand";
  } else {
    title.textContent = "Type to Confirm";
    message.textContent = "To permanently delete the Payroll Archive,\n\ntype exactly\n\nDELETE PAYROLL ARCHIVE";
    inputWrap.style.display = "block";
    confirmButton.textContent = "Delete Forever";
    confirmButton.disabled = true;
    setTimeout(() => input.focus(), 0);
  }

  modal.classList.add("show");
}

document.getElementById("deletePayrollArchiveBtn")?.addEventListener("click", () => {
  if (!desktopApi) return showImportError("Works only in Desktop App.");
  if (!state?.payrollBatches || state.payrollBatches.length === 0) {
    toast("No archived payroll reports found.");
    return;
  }
  renderPayrollArchiveDeleteStep(1);
});

document.getElementById("deletePayrollArchiveConfirmInput")?.addEventListener("input", (event) => {
  const confirmButton = document.getElementById("confirmPayrollArchiveDeleteBtn");
  if (confirmButton) confirmButton.disabled = event.target.value !== payrollArchiveDeletePhrase;
});

document.getElementById("cancelPayrollArchiveDeleteTop")?.addEventListener("click", closePayrollArchiveDeleteModal);
document.getElementById("cancelPayrollArchiveDeleteBtn")?.addEventListener("click", closePayrollArchiveDeleteModal);

document.getElementById("confirmPayrollArchiveDeleteBtn")?.addEventListener("click", async () => {
  if (payrollArchiveDeleteStep < 3) {
    renderPayrollArchiveDeleteStep(payrollArchiveDeleteStep + 1);
    return;
  }

  try {
    startProgress();
    const statusEl = document.getElementById("progressStatus");
    if (statusEl) statusEl.textContent = "Deleting payroll archive...";
    const result = await window.uniformManager.deletePayrollArchive();
    state = result.state || await window.uniformManager.getState({ distributionLimit });
    closePayrollArchiveDeleteModal();
    if (window.resetPayrollArchiveView) window.resetPayrollArchiveView();
    render();
    setView("deductions");
    stopProgress();
    toast(result.deleted ? "Payroll Archive deleted successfully." : "No archived payroll reports found.");
  } catch (error) {
    stopProgress();
    showImportError(error.message || "Payroll Archive deletion failed.");
  }
});
