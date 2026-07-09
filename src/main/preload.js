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
  importSelectedSheet: (request) => safeInvoke("app:importSelectedSheet", request),
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
});