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
  getHeldRecords: () => safeInvoke("app:getHeldRecords"),
  onHeldQuantitiesReopened: (callback) => {
    const listener = (_event, data) => callback(data);
    ipcRenderer.on("review:held-quantities-reopened", listener);
    return () => ipcRenderer.removeListener("review:held-quantities-reopened", listener);
  },
  reviewHeldNow: (payload) => safeInvoke("app:reviewHeldNow", payload),
  upsertPolicy: (policy) => safeInvoke("app:upsertPolicy", policy),
  deletePolicy: (policyId) => safeInvoke("app:deletePolicy", policyId),
  upsertAnnualPolicy: (policy) => safeInvoke("app:upsertAnnualPolicy", policy),
  bulkUpdateAnnualPolicies: (payload) => safeInvoke("app:bulkUpdateAnnualPolicies", payload),
  createAnnualPolicyFromSuggestion: (payload) => safeInvoke("app:createAnnualPolicyFromSuggestion", payload),
  deleteAnnualPolicy: (policyId) => safeInvoke("app:deleteAnnualPolicy", policyId),
  setReviewQueueCalculationMode: (mode) => safeInvoke("app:setReviewQueueCalculationMode", mode),
  bulkUpdatePolicy: (payload) => safeInvoke("app:bulkUpdatePolicy", payload),
  saveDetailedReportItemValues: (payload) => safeInvoke("app:saveDetailedReportItemValues", payload),
  getActualPriceData: () => safeInvoke("app:getActualPriceData"),
  chooseActualPriceImport: () => safeInvoke("app:chooseActualPriceImport"),
  saveActualItemPrices: (rows) => safeInvoke("app:saveActualItemPrices", rows),
  exportActualPrices: (kind) => safeInvoke("app:exportActualPrices", kind),
  recalculateReviews: () => safeInvoke("app:recalculateReviews"),
  archiveCurrentPayrollRegister: (payload) => safeInvoke("app:archiveCurrentPayrollRegister", payload),
  getPayrollArchiveData: (archiveId) => safeInvoke("app:getPayrollArchiveData", archiveId),
  renamePayrollArchive: (payload) => safeInvoke("app:renamePayrollArchive", payload),
  deletePayrollArchiveById: (archiveId) => safeInvoke("app:deletePayrollArchiveById", archiveId),
  exportPayrollArchivePdf: (archiveId) => safeInvoke("app:exportPayrollArchivePdf", archiveId),
  deleteAllPayrollArchives: () => safeInvoke("app:deleteAllPayrollArchives"),
  upsertItem: (item) => safeInvoke("app:upsertItem", item),
  deleteItem: (itemId) => safeInvoke("app:deleteItem", itemId),
  updateReview: (action) => safeInvoke("app:updateReview", action),
  correctDecision: (payload) => safeInvoke("app:correctDecision", payload),
  resolveHeldQuantity: (payload) => safeInvoke("app:resolveHeldQuantity", payload),
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
  resetItemsAndPolicies: () => safeInvoke("app:resetItemsAndPolicies"),
  backupDatabase: () => safeInvoke("app:backupDatabase"),
  restoreDatabase: () => safeInvoke("app:restoreDatabase"),
  exportExcel: (config) => safeInvoke("app:exportExcel", config),
  
  exportAnalyticsExcel: (config) => safeInvoke("app:exportAnalyticsExcel", config),
  exportDecisionRegisterPdf: (config) => safeInvoke("app:exportDecisionRegisterPdf", config),
  getAnalyticsData: (reportType, filters) => safeInvoke("app:getAnalyticsData", { reportType, filters })
});
