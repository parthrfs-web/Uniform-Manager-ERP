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
  
  const getReviewStat = (dec) => {
     const stat = (state.reviewDecisionStats || []).find(s => s.decision === dec);
     return stat ? stat.count : 0;
  };
  
  const deductedCases = getReviewStat('Deducted');
  const heldCount = getReviewStat('Held');
  const waivedCount = getReviewStat('Waived');

  const recoveredTotal = (state.salaryDeductions || []).reduce((sum, row) => sum + Number(row.amount || 0), 0);

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
  const configuredAnnualPolicies = (state.annualPolicies || []).filter((policy) =>
    String(policy.status || "Active").trim().toLowerCase() === "active"
  ).length;
  document.getElementById("dashPolicies").textContent = (state.policies || []).length + configuredAnnualPolicies;

  // Delegated Panel Updates
  renderLatestImport();
  renderTopLists();
  renderDashboardAnalytics();

  // Rendering Other Sub-modules
  renderEmployees();
  renderIssues();
  renderDeductions();
  renderReviews();
  renderPolicies();
  renderItems();
}

let dashboardActivityRefreshAttempted = false;

function renderDashboardAnalytics() {
  const activityHost = document.getElementById("dashboardDistributionChart");
  const reviewHost = document.getElementById("dashboardReviewChart");
  if (activityHost) {
    if (!Array.isArray(state.dashboardDistributionActivity)) {
      activityHost.innerHTML = '<div class="dashboard-chart-empty">Refreshing distribution activity…</div>';
      if (!dashboardActivityRefreshAttempted && window.uniformManager?.getState) {
        dashboardActivityRefreshAttempted = true;
        const distributionLimit = window.distributionLimit || 1000;
        window.uniformManager.getState({ distributionLimit }).then((freshState) => {
          if (freshState) state = freshState;
          renderDashboardAnalytics();
        }).catch(() => {
          activityHost.innerHTML = '<div class="dashboard-chart-empty">Distribution activity could not be loaded. Reopen the Dashboard to refresh its data.</div>';
        });
      } else if (dashboardActivityRefreshAttempted) {
        activityHost.innerHTML = '<div class="dashboard-chart-empty">Distribution activity data was not returned by the current application session. Restart the application to refresh it.</div>';
      }
      return;
    }
    const rows = (state.dashboardDistributionActivity || []).slice(-12);
    if (!rows.length) {
      activityHost.innerHTML = '<div class="dashboard-chart-empty">No dated distribution records are available yet.</div>';
    } else {
      const width = 720;
      const height = 224;
      const left = 44;
      const right = 12;
      const top = 14;
      const bottom = 36;
      const plotWidth = width - left - right;
      const plotHeight = height - top - bottom;
      const maxValue = Math.max(1, ...rows.map((row) => Number(row.issued_quantity || 0)));
      const ceiling = Math.ceil(maxValue / 5) * 5 || maxValue;
      const points = rows.map((row, index) => {
        const x = left + (rows.length === 1 ? plotWidth / 2 : index * plotWidth / (rows.length - 1));
        const y = top + plotHeight - Number(row.issued_quantity || 0) / ceiling * plotHeight;
        return { x, y, row };
      });
      const line = points.map((point, index) => `${index ? "L" : "M"}${point.x.toFixed(1)},${point.y.toFixed(1)}`).join(" ");
      const area = `${line} L${points[points.length - 1].x.toFixed(1)},${(top + plotHeight).toFixed(1)} L${points[0].x.toFixed(1)},${(top + plotHeight).toFixed(1)} Z`;
      const ticks = [0, ceiling / 2, ceiling].map((value) => {
        const y = top + plotHeight - value / ceiling * plotHeight;
        return `<g><line x1="${left}" x2="${width - right}" y1="${y.toFixed(1)}" y2="${y.toFixed(1)}" class="chart-gridline"/><text x="${left - 9}" y="${(y + 4).toFixed(1)}" text-anchor="end" class="chart-axis-label">${Math.round(value).toLocaleString()}</text></g>`;
      }).join("");
      const labels = points.map(({ x, row }) => {
        const [year, month] = String(row.period).split("-").map(Number);
        const label = Number.isInteger(year) && Number.isInteger(month)
          ? new Date(year, month - 1, 1).toLocaleDateString(undefined, { month: "short", year: "2-digit" })
          : String(row.period);
        return `<text x="${x.toFixed(1)}" y="${height - 9}" text-anchor="middle" class="chart-axis-label">${escapeHtml(label)}</text>`;
      }).join("");
      const dots = points.map(({ x, y, row }) => `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="3.5" class="chart-point"><title>${escapeHtml(row.period)}: ${Number(row.issued_quantity || 0).toLocaleString()} issued</title></circle>`).join("");
      const total = rows.reduce((sum, row) => sum + Number(row.issued_quantity || 0), 0);
      activityHost.innerHTML = `<div class="chart-summary"><strong>${total.toLocaleString()}</strong><span>units across ${rows.length} recorded month${rows.length === 1 ? "" : "s"}</span></div><svg viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" aria-label="Monthly distribution issued quantity for the 12 most recent months with records">${ticks}<path d="${area}" class="chart-area"/><path d="${line}" class="chart-line"/>${dots}${labels}</svg>`;
    }
  }

  if (reviewHost) {
    const values = state.dashboardReviewQuantities || {};
    const rows = [
      { label: "Pending review", value: Number(values.pending_quantity || 0), color: "pending" },
      { label: "Deducted", value: Number(values.deducted_quantity || 0), color: "deducted" },
      { label: "Waived", value: Number(values.waived_quantity || 0), color: "waived" },
      { label: "Held", value: Number(values.held_quantity || 0), color: "held" },
    ];
    const total = rows.reduce((sum, row) => sum + row.value, 0);
    if (!total) {
      reviewHost.innerHTML = '<div class="dashboard-chart-empty">No review quantities have been recorded.</div>';
    } else {
      reviewHost.innerHTML = `<div class="review-total"><strong>${total.toLocaleString()}</strong><span>review quantities</span></div><div class="review-breakdown">${rows.map((row) => {
        const share = row.value / total * 100;
        return `<div class="review-breakdown-row"><div class="review-breakdown-label"><span><i class="review-dot ${row.color}"></i>${row.label}</span><strong>${row.value.toLocaleString()}</strong></div><div class="review-track"><span class="review-fill ${row.color}" style="width:${share.toFixed(2)}%"></span></div></div>`;
      }).join("")}</div>`;
    }
  }
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
  (state.salaryDeductions || []).forEach(row => {
    const key = `${row.employee_code} - ${row.employee_name}`;
    empRecoveryMap.set(key, (empRecoveryMap.get(key) || 0) + Number(row.amount || 0));
  });
  const topRecovery = [...empRecoveryMap.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10);
  renderHtml("topEmployeesRecovery", topRecovery.map(([employee, amount]) => `<tr><td>${escapeHtml(employee)}</td><td>${formatCompactMoney(amount)}</td></tr>`).join(""), `<tr><td colspan="2" class="empty">No live recoveries yet.</td></tr>`);

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

let itemsAndPoliciesResetStep = 1;
const itemsAndPoliciesResetPhrase = "RESET ITEMS AND POLICIES";

function closeItemsAndPoliciesResetModal() {
  const modal = document.getElementById("resetItemsAndPoliciesModal");
  if (modal) modal.classList.remove("show");
  const input = document.getElementById("resetItemsAndPoliciesConfirmInput");
  if (input) input.value = "";
}

function renderItemsAndPoliciesResetStep(step) {
  itemsAndPoliciesResetStep = step;
  const modal = document.getElementById("resetItemsAndPoliciesModal");
  const title = document.getElementById("resetItemsAndPoliciesTitle");
  const message = document.getElementById("resetItemsAndPoliciesMessage");
  const inputWrap = document.getElementById("resetItemsAndPoliciesConfirmWrap");
  const input = document.getElementById("resetItemsAndPoliciesConfirmInput");
  const confirmButton = document.getElementById("confirmItemsAndPoliciesResetBtn");
  if (!modal || !title || !message || !inputWrap || !input || !confirmButton) return;

  input.value = "";
  inputWrap.style.display = "none";
  confirmButton.disabled = false;

  if (step === 1) {
    title.textContent = "Reset Items & Policies";
    message.textContent = "This will permanently delete every Inventory Item and every Unit Policy. Annual Item Entitlements and Actual Item Prices will be kept.\n\nOperational employee data will NOT be deleted.";
    confirmButton.textContent = "Continue";
  } else if (step === 2) {
    title.textContent = "Final Warning";
    message.textContent = "After deleting inventory items and unit policies, Annual Item Entitlements and Actual Item Prices will remain saved.\n\nAutomatic entitlement calculations may stop until new master data is created.\n\nOnly continue if you are preparing the application for a new company.";
    confirmButton.textContent = "I Understand";
  } else {
    title.textContent = "Type To Confirm";
    message.textContent = "Type exactly\n\nRESET ITEMS AND POLICIES";
    inputWrap.style.display = "block";
    confirmButton.textContent = "Reset";
    confirmButton.disabled = true;
    setTimeout(() => input.focus(), 0);
  }

  modal.classList.add("show");
}

document.getElementById("resetItemsAndPoliciesBtn")?.addEventListener("click", () => {
  if (!desktopApi) return showImportError("Works only in Desktop App.");
  renderItemsAndPoliciesResetStep(1);
});

document.getElementById("resetItemsAndPoliciesConfirmInput")?.addEventListener("input", (event) => {
  const confirmButton = document.getElementById("confirmItemsAndPoliciesResetBtn");
  if (confirmButton) confirmButton.disabled = event.target.value !== itemsAndPoliciesResetPhrase;
});

document.getElementById("cancelItemsAndPoliciesResetTop")?.addEventListener("click", closeItemsAndPoliciesResetModal);
document.getElementById("cancelItemsAndPoliciesResetBtn")?.addEventListener("click", closeItemsAndPoliciesResetModal);

document.getElementById("confirmItemsAndPoliciesResetBtn")?.addEventListener("click", async () => {
  if (itemsAndPoliciesResetStep < 3) {
    renderItemsAndPoliciesResetStep(itemsAndPoliciesResetStep + 1);
    return;
  }

  try {
    const result = await window.uniformManager.resetItemsAndPolicies();
    state = result.state || await window.uniformManager.getState({ distributionLimit });
    closeItemsAndPoliciesResetModal();
    render();
    toast(`Items and Policies reset. Cleared ${Number(result.deletedAnnualPolicies) || 0} annual entitlement(s).`);
  } catch (error) {
    showImportError(error.message || "Items and Policies reset failed.");
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
    message.textContent = "This will permanently delete every saved payroll register archive, including archived deduction, waiver and hold registers.\n\nHistorical payroll archive records will no longer be available.\n\nThis action is irreversible.";
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
  if (!state?.payrollArchives || state.payrollArchives.length === 0) {
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
    const result = await window.uniformManager.deleteAllPayrollArchives();
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
