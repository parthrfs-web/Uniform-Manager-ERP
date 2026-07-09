const path = require("path");
const { fork } = require("child_process");
const { app, BrowserWindow, dialog, ipcMain, shell } = require("electron");
const { createDatabase } = require("./services/database");

let db;

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 1100,
    minHeight: 720,
    title: "Uniform Manager",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  win.loadFile(path.join(__dirname, "../renderer/index.html"));
}

app.whenReady().then(async () => {
  db = await createDatabase(app.getPath("userData"));
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

// IPC Error Handling Wrapper (Module 2 Requirement)
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
    const worker = fork(path.join(__dirname, "services/import-worker.js"), [], {
      stdio: ["ignore", "ignore", "ignore", "ipc"],
    });

    const timeout = setTimeout(() => {
      worker.kill();
      reject(new Error("Import took more than 15 minutes and was stopped. Please try saving the workbook as a fresh .xlsx file, or import a smaller employee master workbook."));
    }, 900000);

    worker.once("message", (message) => {
      clearTimeout(timeout);
      worker.kill();
      if (message.ok) resolve(message.parsed || message.inspection);
      else reject(new Error(message.error?.message || "Import failed."));
    });

    worker.once("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });

    worker.once("exit", (code) => {
      if (code !== 0 && code !== null) {
        clearTimeout(timeout);
        reject(new Error(`Import worker stopped unexpectedly with code ${code}.`));
      }
    });

    worker.send(message);
  });
}

ipcMain.handle("app:chooseAndImportWorkbook", () => handleSafe(async () => {
  const result = await dialog.showOpenDialog({
    title: "Import Employee Master Excel Workbook",
    filters: [
      { name: "Excel Workbooks", extensions: ["xlsx", "xls", "xlsm", "xlsb", "csv"] },
      { name: "All Files", extensions: ["*"] },
    ],
    properties: ["openFile"],
  });

  if (result.canceled || !result.filePaths.length) return { canceled: true };
  const inspection = await runImportWorker({ type: "inspect-workbook", filePath: result.filePaths[0] });
  return { canceled: false, inspection };
}));

ipcMain.handle("app:importSelectedSheet", (_event, request) => handleSafe(async () => {
  const parsed = await runImportWorker({
    type: "parse-workbook",
    filePath: request.filePath,
    sheetName: request.sheetName,
  });
  if (db.hasImportHash(parsed.summary.importHash)) {
    parsed.summary.duplicate = true;
    parsed.summary.inserted = 0;
    parsed.summary.updated = 0;
    parsed.summary.skipped = parsed.summary.totalRows;
    return { canceled: false, summary: parsed.summary, state: db.getState() };
  }
  const saveResult = db.bulkUpsertEmployees(parsed.employees);
  parsed.summary.inserted = saveResult.inserted;
  parsed.summary.updated = saveResult.updated;
  db.bulkCreateReviews(parsed.reviews);
  const importId = db.recordImport(parsed.summary);
  db.bulkCreateUniformIssues(parsed.uniformIssues || [], importId);
  db.ensureDefaultPoliciesForImport(importId);
  db.evaluateEntitlementsForImport(importId);
  const summary = parsed.summary;
  return { canceled: false, summary, state: db.getState() };
}));

ipcMain.handle("app:upsertPolicy", (_event, policy) => handleSafe(() => {
  db.upsertPolicy(policy);
  return db.getState();
}));

ipcMain.handle("app:deletePolicy", (_event, policyId) => handleSafe(() => {
  db.deletePolicy(policyId);
  return db.getState();
}));

ipcMain.handle("app:recalculateReviews", () => handleSafe(() => {
  const generated = db.recalculateReviews();
  return { generated, state: db.getState() };
}));

ipcMain.handle("app:upsertItem", (_event, item) => handleSafe(() => {
  db.upsertItem(item);
  return db.getState();
}));

ipcMain.handle("app:deleteItem", (_event, itemId) => handleSafe(() => {
  db.deleteItem(itemId);
  return db.getState();
}));

ipcMain.handle("app:updateReview", (_event, action) => handleSafe(() => {
  db.updateReview(action);
  return db.getState();
}));

ipcMain.handle("app:deleteReview", (_event, reviewId) => handleSafe(() => {
  db.deleteReview(reviewId);
  return db.getState();
}));

ipcMain.handle("app:updateDistributionRow", (_event, record) => handleSafe(() => {
  db.updateDistributionRow(record);
  db.recalculateReviews();
  return db.getState();
}));

ipcMain.handle("app:deleteDistributionRow", (_event, key) => handleSafe(() => {
  db.deleteDistributionRow(key);
  db.recalculateReviews();
  return db.getState();
}));

ipcMain.handle("app:openDeductionReport", (_event, filePath) => handleSafe(async () => {
  if (!filePath) throw new Error("No report path was provided.");
  const result = await shell.openPath(filePath);
  if (result) throw new Error(result);
  return true;
}));

ipcMain.handle("app:updateEmployee", (_event, employee) => handleSafe(() => {
  db.updateEmployee(employee);
  return db.getState();
}));

ipcMain.handle("app:deleteEmployee", (_event, employeeCode) => handleSafe(() => {
  db.deleteEmployee(employeeCode);
  return db.getState();
}));

ipcMain.handle("app:resetOperationalData", () => handleSafe(async () => {
  const result = await dialog.showMessageBox(BrowserWindow.getFocusedWindow(), {
    type: "warning",
    buttons: ["Cancel", "Yes, Reset Imported Data"],
    defaultId: 0,
    cancelId: 0,
    title: "Reset Imported Data",
    message: "Final confirmation: reset imported operational data?",
    detail: "This will delete imported Employees, Distribution Register rows, Import History, and Review Queue records from this PC.\n\nUnit Policies and Item settings will be kept.\n\nThis action cannot be undone unless you already created a backup.",
    noLink: true,
  });

  if (result.response !== 1) {
    return { canceled: true, state: db.getState() };
  }

  db.resetOperationalData();
  return { canceled: false, state: db.getState() };
}));