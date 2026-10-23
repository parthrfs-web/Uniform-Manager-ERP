const { createHash } = require('crypto');

/**
 * Build missing annual-policy suggestions from the same persisted child
 * records that drive the active Review Queue. Parent review status and
 * cached employee names are intentionally not treated as authoritative.
 */
module.exports = function getMissingAnnualPolicySuggestions({ all, scalar, normalizeLabel, isIgnoredIssueItemName }) {
  const configuredMode = scalar("SELECT setting_value FROM app_settings WHERE setting_key = 'review_queue_calculation_mode'");
  const mode = ["item_annual", "unit_wise", "combined"].includes(configuredMode) ? configuredMode : "item_annual";
  if (mode === "unit_wise") return [];

  const qualifyingRows = all(`
    SELECT DISTINCT
      (SELECT MIN(TRIM(i.item_name)) FROM uniform_items i
       WHERE lower(TRIM(i.item_name)) = lower(TRIM(ui.item_name))) AS item_name,
      CASE WHEN COALESCE(ui.issue_month, 0) >= 4 THEN CAST(ui.issue_year AS INTEGER)
           ELSE CAST(ui.issue_year AS INTEGER) - 1 END AS financial_year,
      TRIM(e.employee_code) AS employee_code,
      TRIM(e.employee_name) AS employee_name,
      rqi.id AS review_queue_item_id,
      ui.id AS uniform_issue_id,
      MAX(0, COALESCE(rqi.quantity, 0) - COALESCE(rqi.deducted_quantity, 0)
          - COALESCE(rqi.waived_quantity, 0) - COALESCE(rqi.held_quantity, 0)) AS remaining_quantity
    FROM review_queue_items rqi
    JOIN review_queue rq
      ON rq.id = rqi.review_queue_id
     AND TRIM(rq.employee_code) = TRIM(rqi.employee_code)
     AND lower(TRIM(COALESCE(rq.item_name, ''))) = lower(TRIM(rqi.item_name))
    JOIN uniform_issues ui
      ON ui.id = rqi.uniform_issue_id
     AND TRIM(ui.employee_code) = TRIM(rqi.employee_code)
     AND lower(TRIM(ui.item_name)) = lower(TRIM(rqi.item_name))
    JOIN employees e ON TRIM(e.employee_code) = TRIM(rqi.employee_code)
    WHERE COALESCE(rqi.is_active, 1) = 1
      AND COALESCE(rqi.quantity, 0) - COALESCE(rqi.deducted_quantity, 0)
          - COALESCE(rqi.waived_quantity, 0) - COALESCE(rqi.held_quantity, 0) > 0
      AND COALESCE(ui.quantity, 0) > 0
      AND ui.issue_year IS NOT NULL
      AND EXISTS (SELECT 1 FROM uniform_items i
                  WHERE lower(TRIM(i.item_name)) = lower(TRIM(ui.item_name)))
      AND NOT EXISTS (SELECT 1 FROM annual_policies ap
                      WHERE lower(TRIM(ap.item_name)) = lower(TRIM(ui.item_name))
                        AND ap.financial_year = CASE WHEN COALESCE(ui.issue_month, 0) >= 4
                                                   THEN CAST(ui.issue_year AS INTEGER)
                                                   ELSE CAST(ui.issue_year AS INTEGER) - 1 END
                        AND lower(COALESCE(ap.status, 'Active')) = 'active')
    ORDER BY 2 DESC, lower(TRIM(ui.item_name)), 3, 4
  `).filter((row) => {
    const year = Number(row.financial_year);
    return !isIgnoredIssueItemName(row.item_name)
      && Number.isInteger(year) && year >= 1900 && year <= 9998
      && String(row.employee_code || '').trim() && String(row.employee_name || '').trim();
  });

  const suggestions = new Map();
  qualifyingRows.forEach((row) => {
    const itemKey = normalizeLabel(row.item_name);
    const financialYear = Number(row.financial_year);
    const key = `${itemKey}|${financialYear}`;
    if (!suggestions.has(key)) {
      suggestions.set(key, {
        item_name: row.item_name,
        financial_year: financialYear,
        unit: 'All Units',
        _employees: new Map(),
        _qualifyingRows: [],
      });
    }
    const suggestion = suggestions.get(key);
    suggestion._employees.set(String(row.employee_code).trim(), {
      employee_code: String(row.employee_code).trim(),
      employee_name: String(row.employee_name).trim(),
    });
    suggestion._qualifyingRows.push({
      review_queue_item_id: Number(row.review_queue_item_id),
      uniform_issue_id: Number(row.uniform_issue_id),
      employee_code: String(row.employee_code).trim(),
      employee_name: String(row.employee_name).trim(),
      remaining_quantity: Number(row.remaining_quantity),
    });
  });

  return [...suggestions.values()].map((suggestion) => {
    const employees = [...suggestion._employees.values()].sort((a, b) =>
      a.employee_code.localeCompare(b.employee_code, undefined, { numeric: true })
      || a.employee_name.localeCompare(b.employee_name)
    );
    const sample = employees[0];
    return {
      item_name: suggestion.item_name,
      financial_year: suggestion.financial_year,
      unit: suggestion.unit,
      case_count: employees.length,
      sample_employee_code: sample?.employee_code || '',
      sample_employee_name: sample?.employee_name || '',
      suggestion_fingerprint: createHash('sha256').update(JSON.stringify(suggestion._qualifyingRows
        .sort((a, b) => a.review_queue_item_id - b.review_queue_item_id))).digest('hex'),
    };
  }).sort((a, b) => b.financial_year - a.financial_year || a.item_name.localeCompare(b.item_name));
};

