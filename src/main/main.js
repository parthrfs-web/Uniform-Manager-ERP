const path = require("path");
const { fork } = require("child_process");
const { app, BrowserWindow, dialog, ipcMain, shell } = require("electron");
const { createDatabase } = require("./database/database");
const { exportToExcel } = require('./services/export-engine');

let db;
let pendingImportCache = null; 

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
    console.error("IPC Error:", error);
    return { ok: false, error: error.message || "An unexpected error occurred." }; 
  }
};

const yieldEventLoop = () => new Promise(resolve => setTimeout(resolve, 0));

const buildProgressCb = (event, title = "Processing") => (importId, idx, totalImports, processed, totalRows) => {
   const baseProg = ((idx - 1) / totalImports) * 100;
   const subProg = totalRows > 0 ? (processed / totalRows) * (100 / totalImports) : 0;
   event.sender.send("import-progress", { progress: baseProg + subProg, status: `${title} (${idx}/${totalImports}): ${processed}/${totalRows} rows...` });
};

ipcMain.handle("app:getState", (_event, options = {}) => handleSafe(() => db.getState(options)));

function runImportWorker(message) {
  return new Promise((resolve, reject) => {
    const worker = fork(path.join(__dirname, "import/import-worker.js"), [], { stdio: ["ignore", "inherit", "inherit", "ipc"] });
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
  console.log("Import IPC received");
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

ipcMain.handle("app:previewImportSelectedSheet", (_event, request) => handleSafe(async () => {
  console.log("Import preview IPC received");
  const start = Date.now();
  const parsedRaw = await runImportWorker({ type: "parse-workbook", filePath: request.filePath, sheetName: request.sheetName });

  const parsed = parsedRaw || {};
  parsed.summary = parsed.summary || { totalRows: 0 };
  parsed.worksheetRows = Array.isArray(parsed.worksheetRows) ? parsed.worksheetRows : [];

  const validationErrors = [];
  const validIssues = [];
  const validEmployees = [];
  const generatedReviews = [];
  
  let totalWorksheetRows = parsed.worksheetRows.length;
  let validWorksheetRows = 0;
  let invalidWorksheetRows = 0;
  let duplicateWorksheetRows = 0;
  let generatedIssuesCount = 0;

  for (const row of parsed.worksheetRows) {
    let error = null;
    
    if (!row.employee_code) error = "Employee Code missing";
    else if (!row.employee_name) error = "Employee Name missing";

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
      allItemsDuplicate = false;
      rowIssues.push(issue);
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
      if (!row.unit) {
        generatedReviews.push({ employee_code: row.employee_code, employee_name: row.employee_name, unit: "", reason: "Unit Missing" });
      }
      for (const issue of rowIssues) validIssues.push(issue);
      generatedIssuesCount += rowIssues.length;
    }
  }

  parsed.summary.totalWorksheetRows = totalWorksheetRows;
  parsed.summary.validWorksheetRows = validWorksheetRows;
  parsed.summary.invalidWorksheetRows = invalidWorksheetRows;
  parsed.summary.duplicateWorksheetRows = duplicateWorksheetRows;
  parsed.summary.generatedIssues = generatedIssuesCount;

  pendingImportCache = {
      summary: parsed.summary,
      validEmployees,
      validIssues,
      validationErrors,
      reviews: generatedReviews,
      durationMs: Date.now() - start
  };

  return { 
      canceled: false, 
      preview: { 
          summary: parsed.summary, 
          validationErrors: validationErrors 
      } 
  };
}));

ipcMain.handle("app:commitImport", async (event) => {
  console.log("Import commit IPC received");
  try {
    const result = await (async () => {
      await yieldEventLoop();
      
      const start = Date.now();
      const safeData = pendingImportCache;

      if (!safeData) {
        throw new Error("Session expired or cache lost. Please select and preview the Excel sheet again.");
      }

      event.sender.send("import-progress", { progress: 2, status: "Checking for duplicate imports..." });
      await yieldEventLoop();

      if (safeData.summary.importHash && typeof db.hasImportHash === 'function' && db.hasImportHash(safeData.summary.importHash)) {
        safeData.summary.duplicate = true; 
        safeData.summary.inserted = 0; 
        safeData.summary.updated = 0; 
        safeData.summary.skipped = safeData.summary.totalWorksheetRows || 0;
        pendingImportCache = null; 
        return { canceled: false, summary: safeData.summary, state: db.getState() };
      }

      let inserted = 0;
      let updated = 0;
      const empCount = safeData.validEmployees.length;
      const EMP_CHUNK = 250;
      for (let i = 0; i < empCount; i += EMP_CHUNK) {
        const chunk = safeData.validEmployees.slice(i, i + EMP_CHUNK);
        const res = db.bulkUpsertEmployees(chunk);
        inserted += res.inserted || 0;
        updated += res.updated || 0;
        
        const progress = 5 + (30 * (Math.min(i + EMP_CHUNK, empCount) / Math.max(empCount, 1)));
        event.sender.send("import-progress", { progress, status: `Importing employees (${Math.min(i + EMP_CHUNK, empCount)}/${empCount})...` });
        await yieldEventLoop();
      }
      safeData.summary.inserted = inserted;
      safeData.summary.updated = updated;

      const revCount = safeData.reviews.length;
      if (revCount > 0) {
        const REV_CHUNK = 250;
        for (let i = 0; i < revCount; i += REV_CHUNK) {
          const chunk = safeData.reviews.slice(i, i + REV_CHUNK);
          if (typeof db.bulkCreateReviews === 'function') db.bulkCreateReviews(chunk);
          const progress = 35 + (5 * (Math.min(i + REV_CHUNK, revCount) / revCount));
          event.sender.send("import-progress", { progress, status: `Logging basic reviews (${Math.min(i + REV_CHUNK, revCount)}/${revCount})...` });
          await yieldEventLoop();
        }
      }

      event.sender.send("import-progress", { progress: 40, status: "Saving import metadata..." });
      await yieldEventLoop();
      
      const importId = db.recordImport(safeData.summary);

      const issCount = safeData.validIssues.length;
      if (issCount > 0) {
        const ISS_CHUNK = 500;
        for (let i = 0; i < issCount; i += ISS_CHUNK) {
          const chunk = safeData.validIssues.slice(i, i + ISS_CHUNK);
          db.bulkCreateUniformIssues(chunk, importId);
          const progress = 40 + (35 * (Math.min(i + ISS_CHUNK, issCount) / issCount));
          event.sender.send("import-progress", { progress, status: `Importing uniform issues (${Math.min(i + ISS_CHUNK, issCount)}/${issCount})...` });
          await yieldEventLoop();
        }
      }

      event.sender.send("import-progress", { progress: 75, status: "Configuring unit policies..." });
      await yieldEventLoop();
      db.ensureDefaultPoliciesForImport(importId);
      
      event.sender.send("import-progress", { progress: 80, status: "Generating review queue... (this may take a moment)" });
      await yieldEventLoop();
      
      if (typeof db.updateImportReviewsCount === 'function') {
        const generated = await db.evaluateEntitlementsForImport(importId, (processed, total) => {
             const subProgress = 80 + (15 * (processed / total));
             event.sender.send("import-progress", { progress: subProgress, status: `Calculating entitlements (${processed}/${total})...` });
        });
        db.updateImportReviewsCount(importId, generated);
      } else {
        await db.evaluateEntitlementsForImport(importId);
      }

      event.sender.send("import-progress", { progress: 95, status: "Finalizing and saving database..." });
      await yieldEventLoop();

      safeData.summary.durationMs = (safeData.durationMs || 0) + (Date.now() - start);
      safeData.summary.failedCount = safeData.validationErrors.length;
      safeData.summary.duplicateCount = safeData.summary.duplicateWorksheetRows || 0;
      console.log("Import committed");

      pendingImportCache = null;
      event.sender.send("import-progress", { progress: 100, status: "Complete!" });
      await yieldEventLoop();
      
      return { canceled: false, summary: safeData.summary, state: db.getState() };
    })();
    return { ok: true, data: result };
  } catch (error) {
    return { ok: false, error: error.message || "An unexpected error occurred." };
  }
});

ipcMain.handle("app:getReviewQueueStage1", () => handleSafe(() => db.getReviewQueueStage1()));
ipcMain.handle("app:getReviewQueueStage2", (_event, code) => handleSafe(() => db.getReviewQueueStage2(code)));

ipcMain.handle("app:getReviewQueueStage3", async (_event, req) => {
  try {
    const data = await db.getReviewQueueStage3(req);
    return { ok: true, data };
  } catch (error) {
    console.error("\n====== IPC EXCEPTION: app:getReviewQueueStage3 ======");
    console.error("Payload received:", req);
    console.error("Stack trace:", error.stack);
    console.error("=====================================================\n");
    return { ok: false, error: error.message }; 
  }
});

// MODULE 5F: Ensure chunking runs safely to unblock event loop
ipcMain.handle("app:recalculateReviews", async (event) => handleSafe(async () => {
   const generated = await db.recalculateReviews(buildProgressCb(event, "Recalculating review queue"));
   return { generated, state: db.getState() };
}));

ipcMain.handle("app:upsertPolicy", (_event, policy) => handleSafe(() => { db.upsertPolicy(policy); return db.getState(); }));
ipcMain.handle("app:deletePolicy", (_event, policyId) => handleSafe(() => { db.deletePolicy(policyId); return db.getState(); }));
ipcMain.handle("app:upsertItem", (_event, item) => handleSafe(() => { db.upsertItem(item); return db.getState(); }));
ipcMain.handle("app:deleteItem", (_event, itemId) => handleSafe(() => { db.deleteItem(itemId); return db.getState(); }));
ipcMain.handle("app:updateReview", (_event, action) => handleSafe(() => { db.updateReview(action); return db.getState(); }));
ipcMain.handle("app:deleteReview", (_event, reviewId) => handleSafe(() => { db.deleteReview(reviewId); return db.getState(); }));

// MODULE 5F: Any manual edits that cause recalculation now await the chunked routine natively
ipcMain.handle("app:updateDistributionRow", async (event, record) => handleSafe(async () => { 
    db.updateDistributionRow(record); 
    await db.recalculateReviews(buildProgressCb(event, "Updating records")); 
    return db.getState(); 
}));

ipcMain.handle("app:deleteDistributionRow", async (event, key) => handleSafe(async () => { 
    db.deleteDistributionRow(key); 
    await db.recalculateReviews(buildProgressCb(event, "Deleting records")); 
    return db.getState(); 
}));

ipcMain.handle("app:openDeductionReport", (_event, filePath) => handleSafe(async () => { if (!filePath) throw new Error("No report path provided."); const result = await shell.openPath(filePath); if (result) throw new Error(result); return true; }));
ipcMain.handle("app:updateEmployee", (_event, employee) => handleSafe(() => { db.updateEmployee(employee); return db.getState(); }));
ipcMain.handle("app:deleteEmployee", (_event, employeeCode) => handleSafe(() => { db.deleteEmployee(employeeCode); return db.getState(); }));
ipcMain.handle("app:resetOperationalData", () => handleSafe(async () => {
  const result = await dialog.showMessageBox(BrowserWindow.getFocusedWindow(), { type: "warning", buttons: ["Cancel", "Yes, Reset"], defaultId: 0, cancelId: 0, title: "Reset", message: "Confirm reset?", noLink: true });
  if (result.response !== 1) return { canceled: true, state: db.getState() };
  db.resetOperationalData(); return { canceled: false, state: db.getState() };
}));

ipcMain.handle("app:exportExcel", async (event, config) => {
    try {
        const win = BrowserWindow.fromWebContents(event.sender);
        const result = await exportToExcel(win, config);
        return { ok: true, data: result };
    } catch (error) {
        return { ok: false, error: error.message };
    }
});