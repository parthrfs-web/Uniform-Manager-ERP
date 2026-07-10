const path = require("path");
const { fork } = require("child_process");
const { app, BrowserWindow, dialog, ipcMain, shell } = require("electron");
const { createDatabase } = require("./services/database");

let db;

function createWindow() {
  const win = new BrowserWindow({
    width: 1280, height: 820, minWidth: 1100, minHeight: 720,
    title: "Uniform Manager",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true, nodeIntegration: false,
    },
  });
  win.loadFile(path.join(__dirname, "../renderer/index.html"));
}

app.whenReady().then(async () => {
  db = await createDatabase(app.getPath("userData"));
  createWindow();
  app.on("activate", () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});

app.on("window-all-closed", () => { if (process.platform !== "darwin") app.quit(); });

const handleSafe = async (fn) => {
  try { 
    const data = await fn(); 
    return { ok: true, data }; 
  } catch (error) { 
    return { ok: false, error: error.message || "An unexpected IPC error occurred." }; 
  }
};

ipcMain.handle("app:getState", (_event, options = {}) => handleSafe(() => db.getState(options)));

function runImportWorker(message) {
  return new Promise((resolve, reject) => {
    const worker = fork(path.join(__dirname, "services/import-worker.js"), [], { stdio: ["ignore", "ignore", "ignore", "ipc"] });
    const timeout = setTimeout(() => { worker.kill(); reject(new Error("Import timed out.")); }, 900000);
    
    worker.once("message", (msg) => { 
      clearTimeout(timeout); 
      worker.kill(); 
      if (msg.ok) resolve(msg.parsed || msg.inspection || {}); 
      else reject(new Error(msg.error?.message || "Worker Failed")); 
    });
    
    worker.once("error", (err) => { clearTimeout(timeout); reject(err); });
    worker.once("exit", (code) => { if (code !== 0 && code !== null) { clearTimeout(timeout); reject(new Error(`Worker exited: ${code}`)); } });
    
    worker.send(message);
  });
}

ipcMain.handle("app:chooseAndImportWorkbook", () => handleSafe(async () => {
  const result = await dialog.showOpenDialog({
    title: "Import Employee Master",
    filters: [{ name: "Excel Workbooks", extensions: ["xlsx", "xls", "xlsm", "xlsb", "csv"] }],
    properties: ["openFile"],
  });
  
  if (!result || result.canceled || !Array.isArray(result.filePaths) || result.filePaths.length === 0) {
      return { canceled: true };
  }
  
  const inspectionRaw = await runImportWorker({ type: "inspect-workbook", filePath: result.filePaths[0] });
  const inspection = inspectionRaw || {};
  inspection.candidates = Array.isArray(inspection.candidates) ? inspection.candidates : [];

  return { canceled: false, inspection };
}));

// YEH MAIN MODULE 3 VALIDATION FLOW HAI
ipcMain.handle("app:previewImportSelectedSheet", (_event, request) => handleSafe(async () => {
  const start = Date.now();
  const parsedRaw = await runImportWorker({ type: "parse-workbook", filePath: request.filePath, sheetName: request.sheetName });

  const parsed = parsedRaw || {};
  parsed.summary = parsed.summary || { totalRows: 0 };
  parsed.headerReport = parsed.headerReport || {};
  
  // Ab safe parsed rows ka use yaha aayega
  parsed.worksheetRows = Array.isArray(parsed.worksheetRows) ? parsed.worksheetRows : [];

  const validationErrors = [];
  const validIssues = [];
  const validEmployees = [];
  
  let totalWorksheetRows = parsed.worksheetRows.length;
  let validWorksheetRows = 0;
  let invalidWorksheetRows = 0;
  let duplicateWorksheetRows = 0;
  let generatedIssuesCount = 0;

  for (const row of parsed.worksheetRows) {
    let error = null;
    
    // Yaha jo Date missing ka error aaya tha, ab wo theek chalega kyunki issue_month pass kiya gaya hai.
    if (!row.employee_code) error = "Employee Code missing";
    else if (!row.employee_name) error = "Employee Name missing";
    else if (!row.unit) error = "Unit not found";
    else if (!row.issue_month && !row.issue_period_label) error = "Distribution Date missing";

    if (error) {
      validationErrors.push({ row: row.source_row || "-", employee_code: row.employee_code || "-", employee_name: row.employee_name || "-", reason: error });
      invalidWorksheetRows++;
      continue;
    }

    let allItemsDuplicate = true;
    let rowIssues = [];
    const items = Array.isArray(row.items) ? row.items : [];

    for (const item of items) {
      const issue = {
        employee_code: row.employee_code, employee_name: row.employee_name,
        unit: row.unit, godown: row.godown, item_name: item.itemName, quantity: item.quantity,
        issue_month: row.issue_month, issue_year: row.issue_year, issue_period_label: row.issue_period_label,
        source_sheet: parsed.summary.selectedSheet, source_row: row.source_row
      };

      if (typeof db.isDuplicateIssue === 'function' && !db.isDuplicateIssue(issue)) {
        allItemsDuplicate = false;
        rowIssues.push(issue);
      } else if (typeof db.isDuplicateIssue !== 'function') {
        allItemsDuplicate = false;
        rowIssues.push(issue);
      }
    }

    if (items.length > 0 && allItemsDuplicate) {
      duplicateWorksheetRows++;
      validationErrors.push({ row: row.source_row || "-", employee_code: row.employee_code, employee_name: row.employee_name, reason: "Duplicate Distribution" });
    } else {
      validWorksheetRows++;
      validEmployees.push({
        employee_code: row.employee_code, employee_name: row.employee_name, father_name: row.father_name,
        unit: row.unit, godown: row.godown, mobile_number: row.mobile_number, designation: row.designation, status: "Active"
      });
      for (const issue of rowIssues) validIssues.push(issue);
      generatedIssuesCount += rowIssues.length;
    }
  }

  parsed.summary.totalWorksheetRows = totalWorksheetRows;
  parsed.summary.validWorksheetRows = validWorksheetRows;
  parsed.summary.invalidWorksheetRows = invalidWorksheetRows;
  parsed.summary.duplicateWorksheetRows = duplicateWorksheetRows;
  parsed.summary.generatedIssues = generatedIssuesCount;
  
  parsed.validationErrors = validationErrors;
  parsed.validIssues = validIssues;
  parsed.validEmployees = validEmployees;
  parsed.durationMs = Date.now() - start;

  return { canceled: false, preview: parsed };
}));

// YEH OLD LEGACY FLOW KO BHI SUPPORT KAREGA (Just in case you click a legacy button)
ipcMain.handle("app:importSelectedSheet", (_event, request) => handleSafe(async () => {
  const parsedRaw = await runImportWorker({ type: "parse-workbook", filePath: request.filePath, sheetName: request.sheetName });
  
  const parsed = parsedRaw || {};
  parsed.summary = parsed.summary || { totalRows: 0 };
  parsed.employees = Array.isArray(parsed.employees) ? parsed.employees : [];
  parsed.reviews = Array.isArray(parsed.reviews) ? parsed.reviews : [];
  parsed.uniformIssues = Array.isArray(parsed.uniformIssues) ? parsed.uniformIssues : [];

  if (parsed.summary.importHash && typeof db.hasImportHash === 'function' && db.hasImportHash(parsed.summary.importHash)) {
    parsed.summary.duplicate = true; 
    parsed.summary.inserted = 0; 
    parsed.summary.updated = 0; 
    parsed.summary.skipped = parsed.summary.totalRows || 0;
    return { canceled: false, summary: parsed.summary, state: db.getState() };
  }

  const saveResult = db.bulkUpsertEmployees(parsed.employees);
  parsed.summary.inserted = saveResult.inserted || 0;
  parsed.summary.updated = saveResult.updated || 0;
  
  if (typeof db.bulkCreateReviews === 'function') db.bulkCreateReviews(parsed.reviews);

  const importId = db.recordImport(parsed.summary);
  db.bulkCreateUniformIssues(parsed.uniformIssues, importId);
  db.ensureDefaultPoliciesForImport(importId);
  
  if (typeof db.updateImportReviewsCount === 'function') {
    const generated = db.evaluateEntitlementsForImport(importId);
    db.updateImportReviewsCount(importId, generated);
  } else {
    db.evaluateEntitlementsForImport(importId);
  }

  return { canceled: false, summary: parsed.summary, state: db.getState() };
}));

ipcMain.handle("app:commitImport", (_event, previewData) => handleSafe(async () => {
  const start = Date.now();
  
  const safeData = previewData || {};
  safeData.summary = safeData.summary || {};
  const validEmployees = Array.isArray(safeData.validEmployees) ? safeData.validEmployees : [];
  const validIssues = Array.isArray(safeData.validIssues) ? safeData.validIssues : [];
  const validationErrors = Array.isArray(safeData.validationErrors) ? safeData.validationErrors : [];
  const reviews = Array.isArray(safeData.reviews) ? safeData.reviews : [];

  if (safeData.summary.importHash && typeof db.hasImportHash === 'function' && db.hasImportHash(safeData.summary.importHash)) {
    safeData.summary.duplicate = true; 
    safeData.summary.inserted = 0; 
    safeData.summary.updated = 0; 
    safeData.summary.skipped = safeData.summary.totalWorksheetRows || 0;
    return { canceled: false, summary: safeData.summary, state: db.getState() };
  }

  const saveResult = db.bulkUpsertEmployees(validEmployees);
  safeData.summary.inserted = saveResult.inserted || 0;
  safeData.summary.updated = saveResult.updated || 0;
  safeData.summary.durationMs = (safeData.durationMs || 0) + (Date.now() - start);
  safeData.summary.failedCount = validationErrors.length;
  safeData.summary.duplicateCount = safeData.summary.duplicateWorksheetRows || 0;
  safeData.summary.validationErrors = validationErrors;

  if (typeof db.bulkCreateReviews === 'function') db.bulkCreateReviews(reviews);

  const importId = db.recordImport(safeData.summary);
  db.bulkCreateUniformIssues(validIssues, importId);
  db.ensureDefaultPoliciesForImport(importId);
  
  if (typeof db.updateImportReviewsCount === 'function') {
    const generated = db.evaluateEntitlementsForImport(importId);
    db.updateImportReviewsCount(importId, generated);
  } else {
    db.evaluateEntitlementsForImport(importId);
  }

  return { canceled: false, summary: safeData.summary, state: db.getState() };
}));

ipcMain.handle("app:getReviewQueueStage1", () => handleSafe(() => db.getReviewQueueStage1()));
ipcMain.handle("app:getReviewQueueStage2", (_event, code) => handleSafe(() => db.getReviewQueueStage2(code)));
ipcMain.handle("app:getReviewQueueStage3", (_event, req) => handleSafe(() => db.getReviewQueueStage3(req.code, req.item)));
ipcMain.handle("app:upsertPolicy", (_event, policy) => handleSafe(() => { db.upsertPolicy(policy); return db.getState(); }));
ipcMain.handle("app:deletePolicy", (_event, policyId) => handleSafe(() => { db.deletePolicy(policyId); return db.getState(); }));
ipcMain.handle("app:recalculateReviews", () => handleSafe(() => { const generated = db.recalculateReviews(); return { generated, state: db.getState() }; }));
ipcMain.handle("app:upsertItem", (_event, item) => handleSafe(() => { db.upsertItem(item); return db.getState(); }));
ipcMain.handle("app:deleteItem", (_event, itemId) => handleSafe(() => { db.deleteItem(itemId); return db.getState(); }));
ipcMain.handle("app:updateReview", (_event, action) => handleSafe(() => { db.updateReview(action); return db.getState(); }));
ipcMain.handle("app:deleteReview", (_event, reviewId) => handleSafe(() => { db.deleteReview(reviewId); return db.getState(); }));
ipcMain.handle("app:updateDistributionRow", (_event, record) => handleSafe(() => { db.updateDistributionRow(record); db.recalculateReviews(); return db.getState(); }));
ipcMain.handle("app:deleteDistributionRow", (_event, key) => handleSafe(() => { db.deleteDistributionRow(key); db.recalculateReviews(); return db.getState(); }));
ipcMain.handle("app:openDeductionReport", (_event, filePath) => handleSafe(async () => { if (!filePath) throw new Error("No report path provided."); const result = await shell.openPath(filePath); if (result) throw new Error(result); return true; }));
ipcMain.handle("app:updateEmployee", (_event, employee) => handleSafe(() => { db.updateEmployee(employee); return db.getState(); }));
ipcMain.handle("app:deleteEmployee", (_event, employeeCode) => handleSafe(() => { db.deleteEmployee(employeeCode); return db.getState(); }));
ipcMain.handle("app:resetOperationalData", () => handleSafe(async () => {
  const result = await dialog.showMessageBox(BrowserWindow.getFocusedWindow(), { type: "warning", buttons: ["Cancel", "Yes, Reset"], defaultId: 0, cancelId: 0, title: "Reset", message: "Confirm reset?", noLink: true });
  if (result.response !== 1) return { canceled: true, state: db.getState() };
  db.resetOperationalData(); return { canceled: false, state: db.getState() };
}));