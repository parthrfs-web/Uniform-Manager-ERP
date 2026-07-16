function text(value) {
  return value === null || value === undefined || value === "" ? "-" : String(value);
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[char]);
}

function normalizeSearch(value) {
  return String(value ?? "").toLowerCase().trim();
}

function includesSearch(values, query) {
  const search = normalizeSearch(query);
  if (!search) return true;
  return values.map((value) => text(value)).join(" ").toLowerCase().includes(search);
}

function sortByText(rows, getValue) {
  return [...rows].sort((a, b) => text(getValue(a)).localeCompare(text(getValue(b))));
}

function formatMoney(value, prefix = "Rs.") {
  return `${prefix} ${Number(value || 0).toFixed(2)}`;
}

function formatCompactMoney(value) {
  return `Rs. ${Number(value || 0).toFixed(2)}`;
}

function formatPeriod(row) {
  return text(row?.issue_period_label || (row?.issue_month && row?.issue_year ? `${row.issue_month}/${row.issue_year}` : ""));
}

function formatObject(value) {
  return escapeHtml(JSON.stringify(value, null, 2));
}

function monthName(month) {
  return ["", "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][Number(month)] || text(month);
}
