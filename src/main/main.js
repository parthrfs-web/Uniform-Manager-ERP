const fs = require("fs");
const XLSX = require("xlsx");
const initSqlJs = require("sql.js");
const path = require("path");
const { fork } = require("child_process");
const { app, BrowserWindow, dialog, ipcMain, shell } = require("electron");
const { createDatabase } = require("./database/database");
const { exportToExcel, exportAnalyticsExcel, exportDecisionRegisterPdf } = require('./services/export-engine');
const { applyBulkPolicyChange, persistThenRecalculate } = require('./services/review-queue-updates');
const { buildValidatedImport } = require("./import/smart-importer");
const { parseActualPriceFile } = require("./services/actual-price-import");

let db;
let pendingImportCache = null; 

function createWindow() {
    const mainWindow = new BrowserWindow({
        width: 1200,
        height: 800,
        title: "Uniform Manager",
        
        // Icon path matching the build folder from package.json
        icon: path.join(__dirname, '../../build/icon.ico'), 
        
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            nodeIntegration: false,
            contextIsolation: true
        }
    });

    // YEH LINE MISSING THI! Iske bina app HTML load hi nahi karega.
    mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));
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
  const start = Date.now();
  const parsedRaw = await runImportWorker({ type: "parse-workbook", filePath: request.filePath, sheetName: request.sheetName });

  const parsed = parsedRaw || {};
  parsed.summary = parsed.summary || { totalRows: 0 };
  parsed.worksheetRows = Array.isArray(parsed.worksheetRows) ? parsed.worksheetRows : [];

  const allEmployees = db.getState().employees || [];
  const validated = buildValidatedImport(parsed, allEmployees);
  
  parsed.summary = { ...parsed.summary, ...validated.stats };

  pendingImportCache = {
      summary: parsed.summary,
      validEmployees: validated.validEmployees,
      validIssues: validated.validIssues,
      validationErrors: validated.validationErrors,
      reviews: validated.reviews,
      durationMs: Date.now() - start
  };

  return { 
      canceled: false, 
      preview: { 
          summary: parsed.summary, 
          validationErrors: validated.validationErrors 
      } 
  };
}));

ipcMain.handle("app:commitImport", async (event) => {
  try {
    const result = await (async () => {
      await yieldEventLoop();
      
      const start = Date.now();
      const safeData = pendingImportCache;

      if (!safeData) {
        throw new Error("Session expired or cache lost. Please select and preview the Excel sheet again.");
      }

      if (safeData.validationErrors.some(e => e.reason.includes("CRITICAL AUDIT FAILURE"))) {
        pendingImportCache = null;
        throw new Error(safeData.validationErrors.find(e => e.reason.includes("CRITICAL AUDIT FAILURE")).reason);
      }

      event.sender.send("import-progress", { progress: 2, status: "Checking for duplicate imports..." });
      await yieldEventLoop();

      if (safeData.summary.importHash && typeof db.hasImportHash === 'function' && db.hasImportHash(safeData.summary.importHash)) {
        if (typeof db.syncDuplicateImportDetectedItems === 'function') db.syncDuplicateImportDetectedItems(safeData.summary.importHash, safeData.summary.detectedItems || []);
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

ipcMain.handle("app:backupDatabase", async () => handleSafe(async () => {
  db.save();
  
  const now = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  const dateStr = `${now.getFullYear()}-${pad(now.getMonth()+1)}-${pad(now.getDate())}`;
  const timeStr = `${pad(now.getHours())}-${pad(now.getMinutes())}`;
  const defaultName = `UniformManager_Backup_${dateStr}_${timeStr}.db`;

  const result = await dialog.showSaveDialog({
    title: 'Backup Database',
    defaultPath: defaultName,
    filters: [{ name: 'Database Files', extensions: ['db', 'sqlite'] }]
  });

  if (result.canceled || !result.filePath) return { canceled: true };

  fs.copyFileSync(db.dbPath, result.filePath);
  return { canceled: false, filePath: result.filePath };
}));

ipcMain.handle("app:restoreDatabase", async () => handleSafe(async () => {
  const result = await dialog.showOpenDialog({
    title: 'Restore Database',
    filters: [{ name: 'Database Files', extensions: ['db', 'sqlite'] }],
    properties: ['openFile']
  });

  if (result.canceled || !result.filePaths || result.filePaths.length === 0) {
    return { canceled: true };
  }

  const filePath = result.filePaths[0];

  const buffer = Buffer.alloc(16);
  const fd = fs.openSync(filePath, 'r');
  fs.readSync(fd, buffer, 0, 16, 0);
  fs.closeSync(fd);

  if (buffer.toString('utf8', 0, 15) !== 'SQLite format 3') {
    throw new Error("Invalid backup file. The selected file is not a valid SQLite database.");
  }

  const SQL = await initSqlJs();
  let tempDb;
  try {
    const fileBuffer = fs.readFileSync(filePath);
    tempDb = new SQL.Database(fileBuffer);
    const stmt = tempDb.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='employees'");
    if (!stmt.step()) {
      throw new Error("Invalid backup structure. Core application tables are missing.");
    }
    stmt.free();
  } catch (err) {
    throw new Error("Corrupted or incompatible backup file: " + err.message);
  } finally {
    if (tempDb) tempDb.close();
  }

  fs.copyFileSync(filePath, db.dbPath);
  app.relaunch();
  app.exit(0);

  return { canceled: false };
}));

ipcMain.handle("app:getReviewQueueStage1", () => handleSafe(() => db.getReviewQueueStage1()));
ipcMain.handle("app:getReviewQueueStage2", async (_event, code) => handleSafe(async () => {
  // Refresh just this employee against current policies before returning the
  // review cards and modal data. This updates stale snapshots without running
  // a full-database recalculation on every review session.
  await db.recalculateReviewsForEmployee(code);
  return db.getReviewQueueStage2(code);
}));
ipcMain.handle("app:getReviewQueueStage3", (_event, req) => handleSafe(() => db.getReviewQueueStage3(req)));
ipcMain.handle("app:getHeldRecords", () => handleSafe(() => db.getHeldRecords()));
ipcMain.handle("app:reviewHeldNow", (_event, payload) => handleSafe(() => db.reviewHeldNow(payload)));

ipcMain.handle("app:recalculateReviews", async (event) => handleSafe(async () => {
   const generated = await db.recalculateReviews(buildProgressCb(event, "Recalculating review queue"));
   return { generated, state: db.getState() };
}));

ipcMain.handle("app:archiveCurrentPayrollRegister", async (_event, payload) => handleSafe(async () => {
    const archiveId = db.archiveCurrentPayrollRegister(payload);
    return { archiveId, state: db.getState() };
}));

ipcMain.handle("app:getPayrollArchiveData", async (_event, archiveId) => handleSafe(async () => {
    return db.getPayrollArchiveData(archiveId);
}));

ipcMain.handle("app:renamePayrollArchive", async (_event, payload) => handleSafe(async () => {
    db.renamePayrollArchive(payload);
    return db.getState();
}));

ipcMain.handle("app:deletePayrollArchiveById", async (_event, archiveId) => handleSafe(async () => {
    db.deletePayrollArchiveById(archiveId);
    return db.getState();
}));

ipcMain.handle("app:exportPayrollArchivePdf", async (event, archiveId) => handleSafe(async () => {
    const archive = db.getPayrollArchiveData(archiveId).archive;
    const safeName = String(archive.payroll_month || "Payroll_Archive").replace(/[^a-z0-9_-]+/gi, "_");
    const result = await dialog.showSaveDialog(BrowserWindow.fromWebContents(event.sender), {
        title: "Export Payroll Archive PDF",
        defaultPath: `${safeName}.pdf`,
        filters: [{ name: "PDF", extensions: ["pdf"] }],
    });
    if (result.canceled || !result.filePath) return { canceled: true };
    db.buildPayrollArchivePdf(archiveId, result.filePath);
    return { canceled: false, filePath: result.filePath };
}));

ipcMain.handle("app:deleteAllPayrollArchives", async () => handleSafe(async () => {
    const result = db.deleteAllPayrollArchives();
    return { ...result, state: db.getState() };
}));

ipcMain.handle("app:upsertPolicy", async (event, policy) => handleSafe(async () => {
  const { generated, state } = await persistThenRecalculate(db, () => db.upsertPolicy(policy), buildProgressCb(event, "Updating Review Queue"));
  return { generated, state };
}));
ipcMain.handle("app:deletePolicy", async (event, policyId) => handleSafe(async () => {
  const { generated, state } = await persistThenRecalculate(db, () => db.deletePolicy(policyId), buildProgressCb(event, "Updating Review Queue"));
  return { generated, state };
}));
ipcMain.handle("app:upsertAnnualPolicy", async (event, policy) => handleSafe(async () => {
  const beforeState = db.getState();
  const previous = policy?.id
    ? beforeState.annualPolicies.find((row) => Number(row.id) === Number(policy.id))
    : beforeState.annualPolicies.find((row) => String(row.item_name).trim().toLowerCase() === String(policy?.item_name || '').trim().toLowerCase()
      && Number(row.financial_year) === Number(policy?.financial_year));
  const saved = db.upsertAnnualPolicy(policy);
  const changed = previous
    ? String(previous.item_name).toLowerCase() !== String(saved.item_name).toLowerCase()
      || Number(previous.financial_year) !== Number(saved.financial_year)
      || Number(previous.allowed_quantity) !== Number(saved.allowed_quantity)
      || String(previous.status || 'Active').toLowerCase() !== String(saved.status || 'Active').toLowerCase()
    : Number(saved.allowed_quantity) > 0;
  const generated = changed ? await db.recalculateReviews(buildProgressCb(event, "Updating Review Queue")) : 0;
  return { generated, state: db.getState() };
}));
ipcMain.handle("app:bulkUpdateAnnualPolicies", async (event, payload) => handleSafe(async () => {
  const result = db.bulkUpdateAnnualPolicies(payload);
  const generated = result.recalculationRequired
    ? await db.recalculateReviews(buildProgressCb(event, "Updating Review Queue"))
    : 0;
  return { ...result, generated, state: db.getState() };
}));
ipcMain.handle("app:createAnnualPolicyFromSuggestion", async (event, payload) => handleSafe(async () => {
  const { generated, state } = await persistThenRecalculate(db,
    () => db.createAnnualPolicyFromSuggestion(payload?.policy || {}, payload?.expected || {}),
    buildProgressCb(event, "Updating Review Queue"));
  return { generated, state };
}));
ipcMain.handle("app:deleteAnnualPolicy", async (event, policyId) => handleSafe(async () => {
  const { generated, state } = await persistThenRecalculate(db, () => db.deleteAnnualPolicy(policyId), buildProgressCb(event, "Updating Review Queue"));
  return { generated, state };
}));
ipcMain.handle("app:setReviewQueueCalculationMode", async (event, mode) => handleSafe(async () => {
  const { generated, state } = await persistThenRecalculate(db, () => db.setReviewQueueCalculationMode(mode), buildProgressCb(event, "Updating Review Queue"));
  return { generated, state };
}));
ipcMain.handle("app:bulkUpdatePolicy", async (event, payload) => handleSafe(async () =>
  applyBulkPolicyChange(db, payload, buildProgressCb(event, "Updating Review Queue"))
));
ipcMain.handle("app:saveDetailedReportItemValues", async (event, payload) => handleSafe(async () => {
  const result = db.saveDetailedReportItemValues(payload);
  let generated = 0;
  if (result.reviewCalculationsChanged) {
    try {
      generated = await db.recalculateReviews(buildProgressCb(event, "Updating Review Queue"));
    } catch (error) {
      throw new Error(`Item values were saved, but Review Queue recalculation failed: ${error.message || error}`);
    }
  }
  return { ...result, generated, state: db.getState() };
}));
ipcMain.handle("app:getActualPriceData", () => handleSafe(() => db.getActualPriceData()));
ipcMain.handle("app:chooseActualPriceImport", () => handleSafe(async () => {
  const selection = await dialog.showOpenDialog({
    title: "Import Actual Item Prices",
    filters: [{ name: "Excel or CSV", extensions: ["xlsx", "xls", "csv"] }],
    properties: ["openFile"],
  });
  if (selection.canceled || !selection.filePaths?.[0]) return { canceled: true };
  const filePath = selection.filePaths[0];
  const parsed = parseActualPriceFile(filePath);
  return { canceled: false, fileName: path.basename(filePath), preview: db.previewActualItemPrices(parsed.rows) };
}));
ipcMain.handle("app:saveActualItemPrices", (_event, rows) => handleSafe(() => db.saveActualItemPrices(rows)));
ipcMain.handle("app:exportActualPrices", async (event, kind) => {
  try {
    const data = db.getActualPriceData();
    const template = kind === "template";
    const headers = ["Item Name", "Actual Price"];
    const rows = template ? data.items.map((item) => [item, ""]) : data.prices.map((price) => [price.item_name, Number(price.actual_price)]);
    const window = BrowserWindow.fromWebContents(event.sender);
    const result = await dialog.showSaveDialog(window, {
      title: template ? "Download Actual Price Template" : "Export Actual Item Prices",
      defaultPath: template ? "actual-item-prices-template.xlsx" : "actual-item-prices.xlsx",
      filters: [{ name: "Excel or CSV", extensions: ["xlsx", "csv"] }],
    });
    if (result.canceled || !result.filePath) return { ok: true, data: { canceled: true } };
    const sheet = XLSX.utils.aoa_to_sheet([headers, ...rows]);
    sheet["!cols"] = [{ wch: 32 }, { wch: 18 }];
    if (path.extname(result.filePath).toLowerCase() === ".csv") fs.writeFileSync(result.filePath, XLSX.utils.sheet_to_csv(sheet), "utf8");
    else { const workbook = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(workbook, sheet, "Actual Prices"); XLSX.writeFile(workbook, result.filePath); }
    return { ok: true, data: { canceled: false, filePath: result.filePath, rowCount: rows.length } };
  } catch (error) { return { ok: false, error: error.message || "Could not export Actual Prices." }; }
});
ipcMain.handle("app:upsertItem", (_event, item) => handleSafe(() => { db.upsertItem(item); return db.getState(); }));
ipcMain.handle("app:deleteItem", (_event, itemId) => handleSafe(() => { db.deleteItem(itemId); return db.getState(); }));
ipcMain.handle("app:updateReview", (_event, action) => handleSafe(() => { db.updateReview(action); return db.getState(); }));
ipcMain.handle("app:correctDecision", (_event, payload) => handleSafe(() => { db.correctDecision(payload); return db.getState(); }));
ipcMain.handle("app:resolveHeldQuantity", (_event, payload) => handleSafe(() => { db.resolveHeldQuantity(payload); return db.getState(); }));
ipcMain.handle("app:deleteReview", (_event, reviewId) => handleSafe(() => { db.deleteReview(reviewId); return db.getState(); }));

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

ipcMain.handle("app:updateUniformIssue", (_event, issue) => handleSafe(() => { db.updateUniformIssue(issue); return db.getState(); }));
ipcMain.handle("app:deleteUniformIssue", (_event, id) => handleSafe(() => { db.deleteUniformIssue(id); return db.getState(); }));
ipcMain.handle("app:bulkDeleteUniformIssues", (_event, ids) => handleSafe(() => { db.bulkDeleteUniformIssues(ids); return db.getState(); }));

ipcMain.handle("app:openDeductionReport", (_event, filePath) => handleSafe(async () => { if (!filePath) throw new Error("No report path provided."); const result = await shell.openPath(filePath); if (result) throw new Error(result); return true; }));
ipcMain.handle("app:updateEmployee", (_event, employee) => handleSafe(() => { db.updateEmployee(employee); return db.getState(); }));
ipcMain.handle("app:deleteEmployee", (_event, employeeCode) => handleSafe(() => { db.deleteEmployee(employeeCode); return db.getState(); }));
ipcMain.handle("app:resetOperationalData", () => handleSafe(async () => {
  const result = await dialog.showMessageBox(BrowserWindow.getFocusedWindow(), { type: "warning", buttons: ["Cancel", "Yes, Reset"], defaultId: 0, cancelId: 0, title: "Reset", message: "Confirm reset?", noLink: true });
  if (result.response !== 1) return { canceled: true, state: db.getState() };
  db.resetOperationalData(); return { canceled: false, state: db.getState() };
}));
ipcMain.handle("app:resetItemsAndPolicies", () => handleSafe(() => {
  const result = db.resetItemsAndPolicies();
  return { ...result, state: db.getState() };
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

ipcMain.handle("app:exportAnalyticsExcel", async (event, config) => {
    try {
        const win = BrowserWindow.fromWebContents(event.sender);
        const result = await exportAnalyticsExcel(win, config);
        return { ok: true, data: result };
    } catch (error) {
        return { ok: false, error: error.message };
    }
});

ipcMain.handle("app:exportDecisionRegisterPdf", async (event, config) => {
    try {
        const win = BrowserWindow.fromWebContents(event.sender);
        const result = await exportDecisionRegisterPdf(win, config);
        return { ok: true, data: result };
    } catch (error) {
        return { ok: false, error: error.message };
    }
});

// ROUTING HOOK FOR THE NEW REPORT
ipcMain.handle("app:getAnalyticsData", async (_event, request) => handleSafe(() => {
    const { reportType, filters } = request;
    if (reportType === 'detailed_report') return db.getDetailedDeductionReport(filters || {});
    if (reportType === 'detailed_report_options') return db.getDetailedDeductionReportOptions();
    if (reportType === 'payroll_summary') return db.getPayrollSummaryAnalytics(filters);
    if (reportType === 'monthly') return db.getMonthlyAnalytics(filters);
    if (reportType === 'yearly') return db.getYearlyAnalytics(filters);
    if (reportType === 'unit') return db.getUnitWiseAnalytics(filters);
    if (reportType === 'item') return db.getItemWiseAnalytics(filters);
    if (reportType === 'employee') return db.getEmployeeWiseAnalytics(filters);
    throw new Error("Invalid report type");
}));
