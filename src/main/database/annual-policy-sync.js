function getRecognizedAnnualItems(all, isIgnoredIssueItemName) {
  const names = all(`
    SELECT TRIM(item_name) AS item_name FROM uniform_items
    UNION SELECT TRIM(item_name) AS item_name FROM uniform_issues
    UNION SELECT TRIM(item_name) AS item_name FROM unit_policies
    UNION SELECT TRIM(item_name) AS item_name FROM annual_policies
  `).map((row) => String(row.item_name || '').trim());

  // Import metadata is only used for detected item headers saved by the
  // validated importer. Employee fields and arbitrary workbook columns never
  // enter this set.
  all("SELECT detected_items FROM imports WHERE TRIM(COALESCE(detected_items, '')) <> ''").forEach((row) => {
    try {
      const detected = JSON.parse(row.detected_items || '[]');
      if (Array.isArray(detected)) detected.forEach((name) => names.push(String(name || '').trim()));
    } catch (_) {
      // Ignore malformed legacy import metadata; issue and item-master rows remain authoritative.
    }
  });

  const canonical = new Map();
  names.forEach((name) => {
    if (!name || isIgnoredIssueItemName(name)) return;
    const key = name.toLocaleLowerCase();
    const current = canonical.get(key);
    if (!current || name.localeCompare(current, undefined, { sensitivity: 'base' }) < 0) canonical.set(key, name);
  });
  return [...canonical.values()].sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }));
}

function ensureAnnualPoliciesForRecognizedItems({ db, all, scalar, save, audit, now, isIgnoredIssueItemName }) {
  const items = getRecognizedAnnualItems(all, isIgnoredIssueItemName);
  const current = new Date();
  const currentFinancialYear = current.getMonth() >= 3 ? current.getFullYear() : current.getFullYear() - 1;
  const years = new Set([currentFinancialYear]);
  all('SELECT financial_year FROM annual_policies').forEach((row) => years.add(Number(row.financial_year)));
  all(`SELECT DISTINCT CASE WHEN COALESCE(issue_month, 0) >= 4 THEN CAST(issue_year AS INTEGER)
                    ELSE CAST(issue_year AS INTEGER) - 1 END AS financial_year
        FROM uniform_issues WHERE issue_year IS NOT NULL`).forEach((row) => {
    const year = Number(row.financial_year);
    if (Number.isInteger(year) && year >= 1900 && year <= 9998) years.add(year);
  });
  const validYears = [...years].filter((year) => Number.isInteger(year) && year >= 1900 && year <= 9998);
  if (!items.length || !validYears.length) return { inserted: 0, items: items.length, years: validYears };

  const countBefore = Number(scalar('SELECT COUNT(*) FROM annual_policies') || 0);
  const statement = db.prepare(`INSERT OR IGNORE INTO annual_policies
    (item_name, financial_year, allowed_quantity, status, created_at, updated_at)
    VALUES (?, ?, 0, 'Active', ?, ?)`);
  db.run('BEGIN TRANSACTION');
  try {
    items.forEach((itemName) => validYears.forEach((financialYear) => {
      statement.run([itemName, financialYear, now(), now()]);
    }));
    db.run('COMMIT');
  } catch (error) {
    db.run('ROLLBACK');
    throw error;
  } finally {
    statement.free();
  }
  const inserted = Math.max(0, Number(scalar('SELECT COUNT(*) FROM annual_policies') || 0) - countBefore);

  if (inserted > 0) {
    audit('Annual Item Policies Synchronized', `Added ${inserted} missing item/year policy row(s) with allowed quantity 0.`, {
      entityType: 'Annual Policy', entityId: 'recognized-items',
      remarks: 'Existing item/year policy quantities were preserved; synchronization is idempotent.',
    });
    save();
  }
  return { inserted, items: items.length, years: validYears };
}

module.exports = { getRecognizedAnnualItems, ensureAnnualPoliciesForRecognizedItems };
