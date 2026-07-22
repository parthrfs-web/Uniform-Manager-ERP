let currentArchiveData = null;

function renderDeductions() {
    const records = state.livePayrollRecords || [];
    const deductions = records.filter(r => r.record_type === 'Deduct');
    const waives = records.filter(r => r.record_type === 'Waive');
    const holds = records.filter(r => r.record_type === 'Hold');
    const totalRecovery = deductions.reduce((sum, row) => sum + Number(row.amount || 0), 0);

    const exportButton = document.getElementById("exportLivePayrollBtn");
    if (exportButton) exportButton.disabled = records.length === 0;

    const container = document.getElementById("livePayrollRegisterContent");
    if (!container) return;

    container.innerHTML = `
        <div class="mini-stats" style="margin-bottom: 18px; grid-template-columns: repeat(4, 1fr);">
            <article><span>Payroll Register</span><strong style="font-size: 16px;">Live</strong></article>
            <article><span>Deduct Rows</span><strong style="font-size: 16px;">${deductions.length}</strong></article>
            <article><span>Waive / Hold Rows</span><strong style="font-size: 16px;">${waives.length} / ${holds.length}</strong></article>
            <article><span>Total Recovery</span><strong class="text-red" style="font-size: 16px;">${formatCompactMoney(totalRecovery)}</strong></article>
        </div>

        <div class="panel">
          <div style="margin-bottom: 15px;">
            <h3 style="margin: 0;">Salary Deduction Register</h3>
          </div>
          <div class="table-wrap">
            <table>
              <thead><tr><th>Code</th><th>Name</th><th>Item</th><th>Qty</th><th>Rate</th><th>Amount</th><th>Remarks</th></tr></thead>
              <tbody>
                ${deductions.map(row => `
                    <tr>
                        <td>${text(row.employee_code)}</td>
                        <td>${text(row.employee_name)}</td>
                        <td>${text(row.item_name)}</td>
                        <td>${text(row.quantity)}</td>
                        <td>${formatCompactMoney(row.rate)}</td>
                        <td class="text-red">${formatCompactMoney(row.amount)}</td>
                        <td class="reason">${text(row.remarks)}</td>
                    </tr>
                `).join('') || `<tr><td colspan="7" class="empty">No live deductions.</td></tr>`}
              </tbody>
            </table>
          </div>
        </div>

        <div class="panel">
          <div style="margin-bottom: 15px;">
            <h3 style="margin: 0;">Hold Register</h3>
          </div>
          <div class="table-wrap">
            <table>
              <thead><tr><th>Code</th><th>Name</th><th>Item</th><th>Qty</th><th>Remarks</th></tr></thead>
              <tbody>
                ${holds.map(row => `
                    <tr>
                        <td>${text(row.employee_code)}</td>
                        <td>${text(row.employee_name)}</td>
                        <td>${text(row.item_name)}</td>
                        <td>${text(row.quantity)}</td>
                        <td class="reason">${text(row.remarks)}</td>
                    </tr>
                `).join('') || `<tr><td colspan="5" class="empty">No live holds.</td></tr>`}
              </tbody>
            </table>
          </div>
        </div>

        <div class="panel">
          <div style="margin-bottom: 15px;">
            <h3 style="margin: 0;">Waive Register</h3>
          </div>
          <div class="table-wrap">
            <table>
              <thead><tr><th>Code</th><th>Name</th><th>Item</th><th>Qty</th><th>Remarks</th></tr></thead>
              <tbody>
                ${waives.map(row => `
                    <tr>
                        <td>${text(row.employee_code)}</td>
                        <td>${text(row.employee_name)}</td>
                        <td>${text(row.item_name)}</td>
                        <td>${text(row.quantity)}</td>
                        <td class="reason">${text(row.remarks)}</td>
                    </tr>
                `).join('') || `<tr><td colspan="5" class="empty">No live waives.</td></tr>`}
              </tbody>
            </table>
          </div>
        </div>
    `;

    renderArchiveManager();
    renderArchiveSnapshot();
}

window.resetPayrollArchiveView = function() {
    currentArchiveData = null;
    renderDeductions();
};

function archiveCreatedParts(value) {
    const textValue = String(value || "");
    if (!textValue) return { date: "-", time: "-" };
    const normalized = textValue.replace("T", " ");
    return {
        date: normalized.substring(0, 10) || "-",
        time: normalized.substring(11, 19) || "-",
    };
}

function renderArchiveManager() {
    const container = document.getElementById("payrollArchiveManager");
    if (!container) return;

    const archives = state.payrollArchives || [];
    container.innerHTML = `
        <div class="panel">
          <div class="panel-title-row">
            <h3>Archive Manager</h3>
          </div>
          <div class="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Archive Name</th>
                  <th>Created Date</th>
                  <th>Created Time</th>
                  <th>Total Employees</th>
                  <th>Total Deduction</th>
                  <th>Status</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                ${archives.map(archive => {
                    const created = archiveCreatedParts(archive.created_at);
                    return `
                      <tr>
                        <td>${text(archive.payroll_month)}</td>
                        <td>${text(created.date)}</td>
                        <td>${text(created.time)}</td>
                        <td>${text(archive.total_employees || 0)}</td>
                        <td class="text-red">${formatCompactMoney(archive.total_deduction || archive.total_recovery_amount || 0)}</td>
                        <td><span class="badge">${text(archive.status || "Archived")}</span></td>
                        <td>
                          <button type="button" data-open-archive="${archive.id}">Open</button>
                          <button type="button" data-export-archive-pdf="${archive.id}">PDF</button>
                          <button type="button" data-export-archive-excel="${archive.id}">Excel</button>
                          <button type="button" data-rename-archive="${archive.id}">Rename</button>
                          <button type="button" class="danger" data-delete-archive="${archive.id}">Delete</button>
                        </td>
                      </tr>
                    `;
                }).join("") || `<tr><td colspan="7" class="empty">No payroll register archives saved yet.</td></tr>`}
              </tbody>
            </table>
          </div>
        </div>
    `;
}

function renderArchiveSnapshot() {
    const container = document.getElementById("payrollArchiveContent");
    if (!container) return;

    if (!currentArchiveData) {
        const archiveCount = (state.payrollArchives || []).length;
        container.innerHTML = `
            <div class="panel" style="padding: 24px; text-align: center; color: var(--muted);">
                ${archiveCount > 0 ? 'Open an archive from Archive Manager to view its read-only snapshot.' : 'No payroll register archives saved yet.'}
            </div>
        `;
        return;
    }

    const records = currentArchiveData.records || [];
    const deductions = records.filter(r => r.record_type === 'Deduct');
    const waives = records.filter(r => r.record_type === 'Waive');
    const holds = records.filter(r => r.record_type === 'Hold');

    container.innerHTML = `
        <div class="mini-stats" style="margin-bottom: 18px; grid-template-columns: repeat(4, 1fr);">
            <article><span>Archive Name</span><strong style="font-size: 16px;">${escapeHtml(currentArchiveData.archive.payroll_month)}</strong></article>
            <article><span>Archived At</span><strong style="font-size: 16px;">${escapeHtml((currentArchiveData.archive.created_at || '').replace('T', ' ').substring(0, 19))}</strong></article>
            <article><span>Total Rows</span><strong style="font-size: 16px;">${records.length}</strong></article>
            <article><span>Total Recovery</span><strong class="text-red" style="font-size: 16px;">${formatCompactMoney(currentArchiveData.archive.total_recovery_amount)}</strong></article>
        </div>

        <div class="panel">
          <div style="margin-bottom: 15px;">
            <h3 style="margin: 0;">Archived Salary Deduction Register</h3>
          </div>
          <div class="table-wrap">
            <table>
              <thead><tr><th>Code</th><th>Name</th><th>Item</th><th>Qty</th><th>Rate</th><th>Amount</th><th>Remarks</th></tr></thead>
              <tbody>
                ${deductions.map(row => `
                    <tr>
                        <td>${text(row.employee_code)}</td>
                        <td>${text(row.employee_name)}</td>
                        <td>${text(row.item_name)}</td>
                        <td>${text(row.quantity)}</td>
                        <td>${formatCompactMoney(row.rate)}</td>
                        <td class="text-red">${formatCompactMoney(row.amount)}</td>
                        <td class="reason">${text(row.remarks)}</td>
                    </tr>
                `).join('') || `<tr><td colspan="7" class="empty">No archived deductions.</td></tr>`}
              </tbody>
            </table>
          </div>
        </div>

        <div class="panel">
          <div style="margin-bottom: 15px;">
            <h3 style="margin: 0;">Archived Hold Register</h3>
          </div>
          <div class="table-wrap">
            <table>
              <thead><tr><th>Code</th><th>Name</th><th>Item</th><th>Qty</th><th>Remarks</th></tr></thead>
              <tbody>
                ${holds.map(row => `
                    <tr>
                        <td>${text(row.employee_code)}</td>
                        <td>${text(row.employee_name)}</td>
                        <td>${text(row.item_name)}</td>
                        <td>${text(row.quantity)}</td>
                        <td class="reason">${text(row.remarks)}</td>
                    </tr>
                `).join('') || `<tr><td colspan="5" class="empty">No archived holds.</td></tr>`}
              </tbody>
            </table>
          </div>
        </div>

        <div class="panel">
          <div style="margin-bottom: 15px;">
            <h3 style="margin: 0;">Archived Waive Register</h3>
          </div>
          <div class="table-wrap">
            <table>
              <thead><tr><th>Code</th><th>Name</th><th>Item</th><th>Qty</th><th>Remarks</th></tr></thead>
              <tbody>
                ${waives.map(row => `
                    <tr>
                        <td>${text(row.employee_code)}</td>
                        <td>${text(row.employee_name)}</td>
                        <td>${text(row.item_name)}</td>
                        <td>${text(row.quantity)}</td>
                        <td class="reason">${text(row.remarks)}</td>
                    </tr>
                `).join('') || `<tr><td colspan="5" class="empty">No archived waives.</td></tr>`}
              </tbody>
            </table>
          </div>
        </div>
    `;
}

async function openArchive(archiveId) {
    if (!archiveId) {
        currentArchiveData = null;
        renderArchiveSnapshot();
        return;
    }
    try {
        startProgress();
        currentArchiveData = await window.uniformManager.getPayrollArchiveData(archiveId);
        stopProgress();
        renderArchiveSnapshot();
    } catch(err) {
        stopProgress();
        showImportError(err.message);
    }
}

window.openArchiveRegisterModal = function() {
    document.getElementById("archiveRegisterForm").reset();
    document.getElementById("archiveRegisterModal").classList.add("show");
};

window.closeArchiveRegisterModal = function() {
    document.getElementById("archiveRegisterModal").classList.remove("show");
};

document.getElementById("archiveRegisterForm")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const payload = {
        archive_name: fd.get("archive_name")
    };
    try {
        startProgress();
        const res = await window.uniformManager.archiveCurrentPayrollRegister(payload);
        state = res.state;
        currentArchiveData = await window.uniformManager.getPayrollArchiveData(res.archiveId);
        
        closeArchiveRegisterModal();
        stopProgress();
        render();
        renderArchiveSnapshot();
        toast("Payroll register archived successfully.");
    } catch(err) {
        stopProgress();
        showImportError(err.message);
    }
});

function getTodayDateStr() {
    return new Date().toISOString().split('T')[0];
}

async function triggerExcelExport(reportType) {
    if (!state) return toast("Data is not loaded yet.");
    
    let config = { headers: [], data: [], sheetName: "", filename: "" };
    const dateStr = getTodayDateStr();

    if (reportType === 'livePayroll') {
        const records = state.livePayrollRecords || [];
        config.headers = ["Record Type", "Employee Code", "Employee Name", "Item", "Quantity", "Rate", "Amount", "Remarks"];
        config.data = records.map(r => [
            r.record_type, r.employee_code, r.employee_name, r.item_name, r.quantity, r.rate, r.amount, r.remarks
        ]);
        config.sheetName = "Live Payroll Register";
        config.filename = `Live_Payroll_Register_${dateStr}.xlsx`;
    } else if (reportType === 'archivePayroll') {
        if (!currentArchiveData) return toast("Open an archive first.");
        const records = currentArchiveData.records || [];
        config.headers = ["Record Type", "Employee Code", "Employee Name", "Item", "Quantity", "Rate", "Amount", "Remarks"];
        config.data = records.map(r => [
            r.record_type, r.employee_code, r.employee_name, r.item_name, r.quantity, r.rate, r.amount, r.remarks
        ]);
        config.sheetName = "Payroll Archive";
        config.filename = `Payroll_Archive_${String(currentArchiveData.archive.payroll_month || dateStr).replace(/[^a-z0-9_-]+/gi, "_")}.xlsx`;
    } else if (reportType === 'pendingReview') {
        const pending = (state.reviews || []).filter(r => r.status === 'Pending');
        config.headers = ["Employee Code", "Employee Name", "Unit", "Item", "Issued Qty", "Allowed Qty", "Pending Qty"];
        config.data = pending.map(r => [
            r.employee_code, r.employee_name, r.unit, r.item_name, r.issued_qty, r.allowed_qty || 0, r.pending_qty
        ]);
        config.sheetName = "Pending Reviews";
        config.filename = `Pending_Review_Register_${dateStr}.xlsx`;
    } else if (reportType === 'history') {
        config.headers = ["Employee Code", "Employee Name", "Unit", "Godown", "Item", "Quantity", "Period", "Date Issued"];
        config.data = (state.uniformIssues || []).map(r => [
            r.employee_code, r.employee_name, r.unit, r.godown, r.item_name, r.quantity, r.issue_period_label, r.issued_at?.split('T')[0]
        ]);
        config.sheetName = "Employee History";
        config.filename = `Employee_History_${dateStr}.xlsx`;
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

    const openBtn = event.target.closest("[data-open-archive]");
    if (openBtn) {
        openArchive(openBtn.dataset.openArchive);
    }

    const exportPdfBtn = event.target.closest("[data-export-archive-pdf]");
    if (exportPdfBtn) {
        exportArchivePdf(exportPdfBtn.dataset.exportArchivePdf);
    }

    const exportExcelBtn = event.target.closest("[data-export-archive-excel]");
    if (exportExcelBtn) {
        exportArchiveExcel(exportExcelBtn.dataset.exportArchiveExcel);
    }

    const renameBtn = event.target.closest("[data-rename-archive]");
    if (renameBtn) {
        renameArchive(renameBtn.dataset.renameArchive);
    }

    const deleteBtn = event.target.closest("[data-delete-archive]");
    if (deleteBtn) {
        deleteArchive(deleteBtn.dataset.deleteArchive);
    }
});

async function ensureArchiveLoaded(archiveId) {
    if (!currentArchiveData || String(currentArchiveData.archive.id) !== String(archiveId)) {
        currentArchiveData = await window.uniformManager.getPayrollArchiveData(archiveId);
    }
    return currentArchiveData;
}

async function exportArchivePdf(archiveId) {
    try {
        startProgress();
        const res = await window.uniformManager.exportPayrollArchivePdf(archiveId);
        stopProgress();
        if (!res.canceled) toast("PDF exported successfully to: " + res.filePath);
    } catch (err) {
        stopProgress();
        showImportError("PDF export failed: " + err.message);
    }
}

async function exportArchiveExcel(archiveId) {
    try {
        currentArchiveData = await ensureArchiveLoaded(archiveId);
        renderArchiveSnapshot();
        await triggerExcelExport("archivePayroll");
    } catch (err) {
        showImportError("Excel export failed: " + err.message);
    }
}

async function renameArchive(archiveId) {
    const archive = (state.payrollArchives || []).find(row => String(row.id) === String(archiveId));
    const currentName = archive?.payroll_month || "";
    const archiveName = prompt("Archive Name", currentName);
    if (archiveName === null) return;
    const trimmedName = archiveName.trim();
    if (!trimmedName) return toast("Archive name is required.");

    try {
        startProgress();
        state = await window.uniformManager.renamePayrollArchive({ id: archiveId, archive_name: trimmedName });
        if (currentArchiveData && String(currentArchiveData.archive.id) === String(archiveId)) {
            currentArchiveData.archive.payroll_month = trimmedName;
        }
        stopProgress();
        render();
        toast("Archive renamed.");
    } catch (err) {
        stopProgress();
        showImportError("Archive rename failed: " + err.message);
    }
}

async function deleteArchive(archiveId) {
    const archive = (state.payrollArchives || []).find(row => String(row.id) === String(archiveId));
    const label = archive?.payroll_month || `Archive #${archiveId}`;
    if (!confirm(`Delete archive "${label}"?\n\nThe Live Register will not be affected.`)) return;

    try {
        startProgress();
        state = await window.uniformManager.deletePayrollArchiveById(archiveId);
        if (currentArchiveData && String(currentArchiveData.archive.id) === String(archiveId)) {
            currentArchiveData = null;
        }
        stopProgress();
        render();
        toast("Archive deleted. Live Register was not changed.");
    } catch (err) {
        stopProgress();
        showImportError("Archive delete failed: " + err.message);
    }
}
