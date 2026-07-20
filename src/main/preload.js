const { contextBridge, ipcRenderer } = require("electron");

const safeInvoke = async (channel, ...args) => {
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
  generatePayrollBatch: (payload) => safeInvoke("app:generatePayrollBatch", payload),
  getPayrollBatchData: (batchId) => safeInvoke("app:getPayrollBatchData", batchId),
  deletePayrollArchive: () => safeInvoke("app:deletePayrollArchive"),
  upsertItem: (item) => safeInvoke("app:upsertItem", item),
  deleteItem: (itemId) => safeInvoke("app:deleteItem", itemId),
  updateReview: (action) => safeInvoke("app:updateReview", action),
  deleteReview: (reviewId) => safeInvoke("app:deleteReview", reviewId),
  updateDistributionRow: (record) => safeInvoke("app:updateDistributionRow", record),
  deleteDistributionRow: (key) => safeInvoke("app:deleteDistributionRow", key),
  updateUniformIssue: (issue) => safeInvoke("app:updateUniformIssue", issue),
  deleteUniformIssue: (id) => safeInvoke("app:deleteUniformIssue", id),
  bulkDeleteUniformIssues: (ids) => safeInvoke("app:bulkDeleteUniformIssues", ids),
  openDeductionReport: (filePath) => safeInvoke("app:openDeductionReport", filePath),
  updateEmployee: (employee) => safeInvoke("app:updateEmployee", employee),
  deleteEmployee: (employeeCode) => safeInvoke("app:deleteEmployee", employeeCode),
  resetOperationalData: () => safeInvoke("app:resetOperationalData"),
  backupDatabase: () => safeInvoke("app:backupDatabase"),
  restoreDatabase: () => safeInvoke("app:restoreDatabase"),
  exportExcel: (config) => safeInvoke("app:exportExcel", config),
});
