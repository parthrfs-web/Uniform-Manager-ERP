function setImporting(isImporting) {
  const button = document.getElementById("importBtn");
  button.disabled = isImporting;
  button.textContent = isImporting ? "Importing..." : "Import Excel";
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

function renderSheetCandidates() {
  const list = document.getElementById("sheetCandidates");
  const confirm = document.getElementById("confirmImportBtn");
  confirm.disabled = !selectedSheetName;
  list.innerHTML = pendingInspection.candidates.map((candidate, index) => {
    const checked = candidate.sheetName === selectedSheetName ? "checked" : "";
    const disabled = candidate.canImport ? "" : "disabled";
    const classes = [
      "candidate",
      candidate.sheetName === selectedSheetName ? "selected" : "",
      candidate.canImport ? "" : "disabled",
    ].filter(Boolean).join(" ");
    const reasons = candidate.reasons.length ? candidate.reasons.join("; ") : "No recognizable import pattern found.";
    const sample = candidate.sampleRows.length ? formatObject(candidate.sampleRows) : "No employee-like sample rows detected.";
    const items = candidate.itemColumns?.length ? candidate.itemColumns.map((item) => item.itemName).join(", ") : "No uniform item columns detected.";
    return `
      <article class="${classes}">
        <div class="candidate-top">
          <label class="candidate-title">
            <input type="radio" name="sheetCandidate" value="${escapeHtml(candidate.sheetName)}" ${checked} ${disabled} />
            <span>${index + 1}. ${escapeHtml(candidate.sheetName)}</span>
          </label>
          <div class="candidate-meta">
            Score ${candidate.score} | Rows ${candidate.likelyRows} | Header row ${candidate.headerRow || "-"}
          </div>
        </div>
        <div class="candidate-grid">
          <div>
            <strong>Detected Columns</strong>
          <pre>${formatObject(candidate.columns)}</pre>
          </div>
          <div>
            <strong>Sample Rows</strong>
            <pre>${sample}</pre>
          </div>
        </div>
        <p class="candidate-meta"><strong>Uniform item columns:</strong> ${escapeHtml(items)}</p>
        <p class="candidate-meta">${escapeHtml(reasons)}</p>
      </article>
    `;
  }).join("");
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

document.getElementById("importBtn")?.addEventListener("click", async () => {
  try {
    console.log("Import button clicked");
    clearImportError();
    if (!desktopApi) {
      showImportError("Excel import works only in the Electron desktop app.");
      return;
    }
    setImporting(true);
    toast("Analyzing workbook sheets before import.");
    const result = await window.uniformManager.chooseAndImportWorkbook();
    if (result.canceled) return;
    showImportModal(result.inspection);
    toast("Workbook analyzed. Please confirm the correct sheet.");
  } catch (error) {
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
    console.log("Import preview requested");
    setImporting(true);
    document.getElementById("confirmImportBtn").disabled = true;
    toast(`Validating sheet ${selectedSheetName}...`);
    
    const result = await window.uniformManager.previewImportSelectedSheet({
      filePath: pendingInspection.filePath,
      sheetName: selectedSheetName,
    });
    
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
    console.log("Import commit requested");
    setImporting(true);
    document.getElementById("commitImportBtn").disabled = true;
    
    document.getElementById("importPreviewModal").classList.remove("show");
    
    startProgress();
    
    const result = await window.uniformManager.commitImport(currentPreviewData);
    
    state = await window.uniformManager.getState({ distributionLimit });
    
    stopProgress();
    render();
    currentPreviewData = null;
    console.log("Import finished");
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
    const modal = document.getElementById("progressModal");
    if (modal && !modal.classList.contains("show")) {
      startProgress();
    }
    const statusEl = document.getElementById("progressStatus");
    if (statusEl && data.status) statusEl.textContent = data.status;
    
    const barEl = document.getElementById("progressBar");
    if (barEl && data.progress !== undefined) barEl.style.width = `${data.progress}%`;
    
    const pctEl = document.getElementById("progressPercent");
    if (pctEl && data.progress !== undefined) pctEl.textContent = `${Math.floor(data.progress)}%`;
  });
}

document.getElementById("goImportBtn")?.addEventListener("click", (e) => {
  e.preventDefault();
  setView("import");
});
