function setImporting(isImporting) {
  const button = document.getElementById("goImportBtn");
  if(button) {
    button.disabled = isImporting;
    button.textContent = isImporting ? "Importing..." : "Choose Excel Workbook";
    button.classList.toggle("is-loading", isImporting);
    button.setAttribute("aria-busy", String(isImporting));
  }
}

function showImportModal(inspection) {
  pendingInspection = inspection;
  selectedSheetName = inspection.candidates.find((candidate) => candidate.canImport)?.sheetName || null;
  document.getElementById("importModalSubtitle").textContent =
    `${inspection.fileName} - review all sheets before importing.`;
  renderSheetCandidates();
  document.getElementById("importModal").classList.add("show");
}

function hideImportModal() {
  document.getElementById("importModal").classList.remove("show");
}

function renderDetectedColumns(columns = {}) {
  const fieldLabels = {
    employee_code: "Employee Code",
    employee_name: "Employee Name",
    father_name: "Father's Name",
    unit: "Unit / Company",
    godown: "Godown",
    mobile_number: "Mobile Number",
    designation: "Designation",
  };
  const detected = Object.entries(fieldLabels)
    .filter(([key]) => columns[key])
    .map(([key, label]) => `<span class="sheet-field-chip"><b>${label}</b><span>${escapeHtml(columns[key])}</span></span>`);
  return detected.length ? detected.join("") : `<span class="sheet-empty-note">No employee fields detected</span>`;
}

function renderSampleRows(rows = []) {
  const fields = [
    ["employee_code", "Employee Code"],
    ["employee_name", "Employee Name"],
    ["father_name", "Father's Name"],
    ["unit", "Unit / Company"],
    ["godown", "Godown"],
  ];
  const visibleFields = fields.filter(([key]) => rows.some((row) => row?.[key] !== undefined && row?.[key] !== null && row[key] !== ""));
  if (!rows.length || !visibleFields.length) return `<p class="sheet-empty-note">No employee sample rows detected for this worksheet.</p>`;
  return `<div class="sheet-sample-wrap"><table class="sheet-sample-table"><thead><tr>${visibleFields.map(([, label]) => `<th>${label}</th>`).join("")}</tr></thead><tbody>${rows.slice(0, 5).map((row) => `<tr>${visibleFields.map(([key]) => `<td>${escapeHtml(row?.[key] ?? "—")}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`;
}

function renderSheetCandidates() {
  const list = document.getElementById("sheetCandidates");
  const confirm = document.getElementById("confirmImportBtn");
  confirm.disabled = !selectedSheetName;
  const candidates = Array.isArray(pendingInspection?.candidates) ? pendingInspection.candidates : [];
  list.innerHTML = candidates.map((candidate, index) => {
    const checked = candidate.sheetName === selectedSheetName ? "checked" : "";
    const disabled = candidate.canImport ? "" : "disabled";
    const classes = [
      "candidate",
      candidate.sheetName === selectedSheetName ? "selected" : "",
      candidate.canImport ? "" : "disabled",
    ].filter(Boolean).join(" ");
    const reasons = Array.isArray(candidate.reasons) ? candidate.reasons : [];
    const warnings = reasons.filter((reason) => /^(WARNING|ERROR):/i.test(reason));
    const status = candidate.canImport ? "Ready to import" : "Not recognized as a distribution sheet";
    const itemColumns = Array.isArray(candidate.itemColumns) ? candidate.itemColumns : [];
    const items = itemColumns.length
      ? itemColumns.map((item) => `<span class="sheet-item-chip">${escapeHtml(item.itemName)}</span>`).join("")
      : `<span class="sheet-empty-note">No uniform item columns detected</span>`;
    return `
      <article class="${classes} sheet-candidate">
        <div class="candidate-top">
          <label class="candidate-title">
            <input type="radio" name="sheetCandidate" value="${escapeHtml(candidate.sheetName)}" ${checked} ${disabled} />
            <span>${index + 1}. ${escapeHtml(candidate.sheetName)}</span>
          </label>
          <div class="sheet-status ${candidate.canImport ? "ready" : "unavailable"}">${status}</div>
        </div>
        <div class="sheet-facts">
          <div><span>Match score</span><strong>${escapeHtml(candidate.score ?? 0)}</strong></div>
          <div><span>Employee rows</span><strong>${escapeHtml(candidate.likelyRows ?? 0)}</strong></div>
          <div><span>Item columns</span><strong>${itemColumns.length}</strong></div>
          <div><span>Header row</span><strong>${escapeHtml(candidate.headerRow ?? "Not found")}</strong></div>
        </div>
        <section class="sheet-detail-block">
          <h4>Detected employee fields</h4>
          <div class="sheet-field-list">${renderDetectedColumns(candidate.columns)}</div>
        </section>
        <section class="sheet-detail-block">
          <h4>Detected uniform items <span>${itemColumns.length}</span></h4>
          <div class="sheet-item-list">${items}</div>
        </section>
        <section class="sheet-detail-block">
          <h4>Sample employee rows</h4>
          ${renderSampleRows(Array.isArray(candidate.sampleRows) ? candidate.sampleRows : [])}
        </section>
        ${warnings.length ? `<section class="sheet-warnings"><strong>Review these notes</strong><ul>${warnings.map((warning) => `<li>${escapeHtml(warning.replace(/^(WARNING|ERROR):\s*/i, ""))}</li>`).join("")}</ul></section>` : ""}
        ${!candidate.canImport && reasons.length ? `<p class="sheet-unavailable-reason">${escapeHtml(reasons.find((reason) => !/^(WARNING|ERROR):/i.test(reason)) || "This worksheet does not contain recognizable employee distribution data.")}</p>` : ""}
      </article>
    `;
  }).join("") || `<div class="sheet-empty-note sheet-no-candidates">No worksheets were found in this workbook.</div>`;
}

function renderHistory() {
  const historyEl = document.getElementById("importHistory");
  if (historyEl && state.imports) {
    historyEl.innerHTML = state.imports.map((row) => `
      <div class="history-item">
        <strong>${text(row.file_name)}</strong>
        <span>${text(row.imported_at)} | Sheet ${text(row.selected_sheet)} | Status: ${text(row.status)}</span>
        <span style="display:block; margin-top:4px;">Rows: ${row.total_rows} total | ${row.inserted_count} new | ${row.updated_count} updated | <b style="color:var(--red)">${row.failed_count} failed</b> | <b style="color:var(--amber)">${row.duplicate_count} dupes</b></span>
        <span style="display:block; margin-top:4px;">Generated ${row.generated_reviews} reviews in ${row.duration_ms}ms</span>
      </div>
    `).join("") || `<div class="empty">No imports yet.</div>`;
  }

  const auditEl = document.getElementById("auditLog");
  if (auditEl && state.audit) {
    auditEl.innerHTML = state.audit.map((row) => `
      <div class="history-item">
        <strong>${text(row.action)}</strong>
        <span>${text(row.created_at)} | ${text(row.details)}</span>
      </div>
    `).join("");
  }
}

// ISSUE 1 FIX: Page button now strictly owns the actual import execution.
document.getElementById("goImportBtn")?.addEventListener("click", async (e) => {
  e.preventDefault();
  try {
    clearImportError();
    if (!desktopApi) {
      showImportError("Excel import works only in the Electron desktop app.");
      return;
    }
    setImporting(true);
    toast("Analyzing workbook sheets before import.");
    const result = await window.uniformManager.chooseAndImportWorkbook();
    stopProgress();
    if (result.canceled) return;
    showImportModal(result.inspection);
    toast("Workbook analyzed. Please confirm the correct sheet.");
  } catch (error) {
    stopProgress();
    const message = error.message || "Import failed.";
    showImportError(message);
    toast("Import failed. Details are shown on the dashboard.");
  } finally {
    setImporting(false);
  }
});

document.getElementById("closeImportModal")?.addEventListener("click", hideImportModal);

document.getElementById("sheetCandidates")?.addEventListener("change", (event) => {
  if (event.target.name !== "sheetCandidate") return;
  selectedSheetName = event.target.value;
  renderSheetCandidates();
});

document.getElementById("confirmImportBtn")?.addEventListener("click", async () => {
  if (!pendingInspection || !selectedSheetName) return;
  try {
    setImporting(true);
    document.getElementById("confirmImportBtn").disabled = true;
    toast(`Validating sheet ${selectedSheetName}...`);
    
    startProgress({ title: "Validating Records", description: "Checking the selected worksheet against application import rules.", kicker: "WORKBOOK VALIDATION" });
    const result = await window.uniformManager.previewImportSelectedSheet({
      filePath: pendingInspection.filePath,
      sheetName: selectedSheetName,
    });
    stopProgress();
    
    currentPreviewData = result.preview;
    hideImportModal();
    
    document.getElementById("previewTotal").textContent = currentPreviewData.summary.totalWorksheetRows;
    document.getElementById("previewValid").textContent = currentPreviewData.summary.validWorksheetRows;
    document.getElementById("previewErrors").textContent = currentPreviewData.summary.invalidWorksheetRows;
    document.getElementById("previewDuplicates").textContent = currentPreviewData.summary.duplicateWorksheetRows;
    document.getElementById("previewIssues").textContent = currentPreviewData.summary.generatedIssues;
    
    document.getElementById("previewErrorRows").innerHTML = currentPreviewData.validationErrors.map(e => `
        <tr><td>${e.row}</td><td>${escapeHtml(e.employee_code)}</td><td>${escapeHtml(e.employee_name)}</td><td class="reason">${escapeHtml(e.reason)}</td></tr>
    `).join("") || `<tr><td colspan="4" class="empty">No validation errors found on worksheet.</td></tr>`;
    
    document.getElementById("importPreviewModal").classList.add("show");
  } catch (error) {
    stopProgress();
    showImportError(error.message || "Preview failed.");
    toast("Preview failed.");
  } finally {
    setImporting(false);
    document.getElementById("confirmImportBtn").disabled = !selectedSheetName;
  }
});

document.getElementById("cancelPreviewBtn")?.addEventListener("click", () => {
  currentPreviewData = null;
  document.getElementById("importPreviewModal").classList.remove("show");
});

document.getElementById("commitImportBtn")?.addEventListener("click", async () => {
  if (!currentPreviewData) return;
  try {
    setImporting(true);
    document.getElementById("commitImportBtn").disabled = true;
    
    document.getElementById("importPreviewModal").classList.remove("show");
    
    startProgress({ title: "Importing Uniform Records", description: "Saving validated employees and distributions, then calculating review quantities.", kicker: "DATABASE IMPORT" });
    
    const result = await window.uniformManager.commitImport(currentPreviewData);
    
    state = await window.uniformManager.getState({ distributionLimit });
    if (typeof window.refreshActualPriceData === 'function') await window.refreshActualPriceData();
    
    stopProgress();
    render();
    currentPreviewData = null;
    toast(result.summary.duplicate ? "Duplicate import hash detected. Discarded." : "Import completed successfully.");
  } catch (error) {
    stopProgress();
    showImportError(error.message || "Import failed.");
  } finally {
    setImporting(false);
    document.getElementById("commitImportBtn").disabled = false;
  }
});

if (window.uniformManager && window.uniformManager.onImportProgress) {
  window.uniformManager.onImportProgress((data) => {
    if (data.operationTitle || !progressActive) startProgress({
      title: data.operationTitle || "Processing Request",
      description: data.operationDescription || "Working with your local application data.",
      kicker: data.operationKicker || "SYSTEM TASK",
      immediate: true,
    });
    updateProgress(data);
  });
}
