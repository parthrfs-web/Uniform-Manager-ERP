const { contextBridge, ipcRenderer } = require("electron");

const safeInvoke = async (channel, ...args) => {
  if (channel === "app:chooseAndImportWorkbook" || channel === "app:previewImportSelectedSheet" || channel === "app:commitImport") {
    console.log("IPC sent", channel);
  }
  const result = await ipcRenderer.invoke(channel, ...args);
  if (result && !result.ok) {
    throw new Error(result.error || "IPC communication failed");
  }
  return result ? result.data : undefined;
};

contextBridge.exposeInMainWorld("uniformManager", {
  getState: (options) => safeInvoke("app:getState", options),
  chooseAndImportWorkbook: () => safeInvoke("app:chooseAndImportWorkbook"),
  previewImportSelectedSheet: (request) => safeInvoke("app:previewImportSelectedSheet", request),
  commitImport: (data) => safeInvoke("app:commitImport", data),
  onImportProgress: (callback) => ipcRenderer.on("import-progress", (_event, data) => callback(data)),
  getReviewQueueStage1: () => safeInvoke("app:getReviewQueueStage1"),
  getReviewQueueStage2: (code) => safeInvoke("app:getReviewQueueStage2", code),
  getReviewQueueStage3: (req) => safeInvoke("app:getReviewQueueStage3", req),
  upsertPolicy: (policy) => safeInvoke("app:upsertPolicy", policy),
  deletePolicy: (policyId) => safeInvoke("app:deletePolicy", policyId),
  recalculateReviews: () => safeInvoke("app:recalculateReviews"),
  upsertItem: (item) => safeInvoke("app:upsertItem", item),
  deleteItem: (itemId) => safeInvoke("app:deleteItem", itemId),
  updateReview: (action) => safeInvoke("app:updateReview", action),
  deleteReview: (reviewId) => safeInvoke("app:deleteReview", reviewId),
  updateDistributionRow: (record) => safeInvoke("app:updateDistributionRow", record),
  deleteDistributionRow: (key) => safeInvoke("app:deleteDistributionRow", key),
  openDeductionReport: (filePath) => safeInvoke("app:openDeductionReport", filePath),
  updateEmployee: (employee) => safeInvoke("app:updateEmployee", employee),
  deleteEmployee: (employeeCode) => safeInvoke("app:deleteEmployee", employeeCode),
  resetOperationalData: () => safeInvoke("app:resetOperationalData"),
  // Add this line inside the exposeInMainWorld block:
  exportExcel: (config) => safeInvoke("app:exportExcel", config),
});