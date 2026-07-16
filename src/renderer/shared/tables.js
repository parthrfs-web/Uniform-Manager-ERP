function emptyTableRow(colspan, message) {
  return `<tr><td colspan="${Number(colspan || 1)}" class="empty">${escapeHtml(message || "No records found.")}</td></tr>`;
}

function renderTableRows(target, rows, rowTemplate, emptyMessage, colspan) {
  const element = typeof target === "string" ? document.getElementById(target) : target;
  if (!element) return;
  const safeRows = Array.isArray(rows) ? rows : [];
  element.innerHTML = safeRows.map(rowTemplate).join("") || emptyTableRow(colspan, emptyMessage);
}

function renderHtml(target, html, emptyHtml = "") {
  const element = typeof target === "string" ? document.getElementById(target) : target;
  if (!element) return;
  element.innerHTML = html || emptyHtml;
}
