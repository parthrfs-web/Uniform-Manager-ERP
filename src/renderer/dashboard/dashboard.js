function render() {
  if (!state) return;
  document.getElementById("dbPath").textContent = state.dbPath || "Unknown";

  const now = new Date();
  const todayStr = now.toISOString().split('T')[0];
  const monthStr = todayStr.substring(0, 7);

  const employees = state.employees || [];
  const activeEmployees = employees.filter(e => e.status === 'Active').length;
  const uniqueUnits = new Set(employees.map(e => String(e.unit || "").trim()).filter(Boolean)).size;

  const matrixRows = state.uniformIssueMatrix?.rows || [];
  const excessEmployees = matrixRows.filter(r => r.total_excess > 0 || r.entitlement_status === 'Excess').length;

  const imports = state.imports || [];
  const todayImports = imports.filter(i => (i.imported_at || "").startsWith(todayStr)).length;
  const monthImports = imports.filter(i => (i.imported_at || "").startsWith(monthStr)).length;

  const salaryDeductions = state.salaryDeductions || [];
  const recoveredTotal = salaryDeductions.reduce((sum, row) => sum + Number(row.amount || 0), 0);
  const deductedCases = salaryDeductions.length;

  const heldCount = (state.reviews || []).filter(r => r.status === 'Held' || r.status === 'Hold').length;
  const waivedCount = (state.waiveRecords || []).length;

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

  renderLatestImport();
  renderTopLists();
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

  const empRecoveryMap = new Map();
  (state.salaryDeductions || []).forEach(row => {
     if(Number(row.amount) > 0) {
       const label = `${row.employee_code} - ${row.employee_name}`;
       empRecoveryMap.set(label, (empRecoveryMap.get(label) || 0) + Number(row.amount || 0));
     }
  });
  const topRecoveries = [...empRecoveryMap.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10);
  renderHtml("topEmployeesRecovery", topRecoveries.map(([emp, amt]) => `<tr><td>${escapeHtml(emp)}</td><td>${formatCompactMoney(amt)}</td></tr>`).join(""), `<tr><td colspan="2" class="empty">No recoveries yet.</td></tr>`);

  const excessItemMap = new Map();
  (state.reviews || []).forEach(row => {
     if(row.status === 'Pending' && Number(row.excess_qty) > 0) {
        const item = String(row.item_name || "Unknown").trim();
        excessItemMap.set(item, (excessItemMap.get(item) || 0) + Number(row.excess_qty));
     }
  });
  const topExcessItems = [...excessItemMap.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10);
  renderHtml("topCommonExcess", topExcessItems.map(([item, qty]) => `<tr><td>${escapeHtml(item)}</td><td class="text-amber">${qty}</td></tr>`).join(""), `<tr><td colspan="2" class="empty">No pending excess items.</td></tr>`);
}

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
    
    if (result && result.canceled) {
      stopProgress();
      toast("Restore operation cancelled.");
    }
  } catch (error) {
    stopProgress();
    showImportError("Restore failed: " + error.message);
  }
});

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