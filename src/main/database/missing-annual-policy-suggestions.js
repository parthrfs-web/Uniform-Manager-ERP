const { createHash } = require('crypto');
const { normalizeEntitlementLabel, getEntitlementFinancialYear } = require('./entitlement-scope');

/**
 * Missing-policy suggestions come from recognized persisted distributions,
 * not from fabricated excess review rows. This keeps an unknown allowance
 * visible to policy management without treating it as a zero allowance.
 */
module.exports = function getMissingAnnualPolicySuggestions({ all, scalar, normalizeLabel, isIgnoredIssueItemName }) {
  const configuredMode = scalar("SELECT setting_value FROM app_settings WHERE setting_key = 'review_queue_calculation_mode'");
  const mode = ["item_annual", "unit_wise", "combined"].includes(configuredMode) ? configuredMode : "item_annual";
  if (mode === 'unit_wise') return [];

  const activePolicies = new Set(all("SELECT item_name, financial_year FROM annual_policies WHERE lower(trim(COALESCE(status, 'Active'))) = 'active'")
    .map((policy) => `${normalizeEntitlementLabel(policy.item_name)}|${Number(policy.financial_year)}`));
  const canonicalItems = new Map();
  all(`SELECT TRIM(item_name) AS item_name FROM (
      SELECT item_name FROM uniform_items UNION SELECT item_name FROM uniform_issues
    ) ORDER BY lower(trim(item_name)), item_name`).forEach((row) => {
    const key = normalizeEntitlementLabel(row.item_name);
    if (key && !canonicalItems.has(key)) canonicalItems.set(key, row.item_name);
  });
  const sourceRows = all(`
    SELECT ui.id AS uniform_issue_id, ui.employee_code, e.employee_name, ui.item_name,
           ui.quantity, ui.issue_month, ui.issue_year, ui.issue_period_label
    FROM uniform_issues ui
    JOIN employees e ON trim(e.employee_code) = trim(ui.employee_code)
    WHERE COALESCE(ui.quantity, 0) > 0
    ORDER BY lower(trim(ui.item_name)), ui.employee_code, ui.id
  `);

  const missing = sourceRows.filter((row) => {
    if (isIgnoredIssueItemName(row.item_name)) return false;
    const financialYear = getEntitlementFinancialYear(row);
    if (!Number.isInteger(financialYear) || financialYear < 1900 || financialYear > 9998) return false;
    return !activePolicies.has(`${normalizeEntitlementLabel(row.item_name)}|${financialYear}`);
  });
  const suggestions = new Map();
  missing.forEach((row) => {
    const financialYear = getEntitlementFinancialYear(row);
    const canonicalItem = canonicalItems.get(normalizeEntitlementLabel(row.item_name)) || String(row.item_name || '').trim();
    const itemKey = normalizeLabel(canonicalItem);
    const key = `${itemKey}|${financialYear}`;
    if (!suggestions.has(key)) suggestions.set(key, {
      item_name: canonicalItem, financial_year: financialYear, unit: 'All Units',
      _employees: new Map(), _qualifyingRows: [],
    });
    const suggestion = suggestions.get(key);
    const employeeCode = String(row.employee_code || '').trim();
    const employeeName = String(row.employee_name || '').trim();
    if (employeeCode && employeeName) suggestion._employees.set(employeeCode, { employee_code: employeeCode, employee_name: employeeName });
    suggestion._qualifyingRows.push({
      uniform_issue_id: Number(row.uniform_issue_id), employee_code: employeeCode,
      quantity: Number(row.quantity || 0),
    });
  });

  return [...suggestions.values()].map((suggestion) => {
    const employees = [...suggestion._employees.values()].sort((a, b) =>
      a.employee_code.localeCompare(b.employee_code, undefined, { numeric: true }) || a.employee_name.localeCompare(b.employee_name));
    const sample = employees[0];
    const fingerprintRows = [...suggestion._qualifyingRows].sort((a, b) => a.uniform_issue_id - b.uniform_issue_id);
    return {
      item_name: suggestion.item_name, financial_year: suggestion.financial_year, unit: suggestion.unit,
      case_count: employees.length, sample_employee_code: sample?.employee_code || '', sample_employee_name: sample?.employee_name || '',
      suggestion_fingerprint: createHash('sha256').update(JSON.stringify(fingerprintRows)).digest('hex'),
    };
  }).filter((suggestion) => suggestion.case_count > 0)
    .sort((a, b) => b.financial_year - a.financial_year || a.item_name.localeCompare(b.item_name));
};
