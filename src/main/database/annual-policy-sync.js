const { normalizeEntitlementLabel, getEntitlementFinancialYear } = require('./entitlement-scope');

const DELETED_ANNUAL_POLICY_SETTING = 'deleted_annual_policy_keys';

function annualPolicyKey(itemName, financialYear) {
  return `${normalizeEntitlementLabel(itemName)}|${Number(financialYear)}`;
}

function getDeletedAnnualPolicies(all) {
  const setting = all('SELECT setting_value FROM app_settings WHERE setting_key = ?', [DELETED_ANNUAL_POLICY_SETTING])[0];
  let rows = [];
  try { rows = JSON.parse(setting?.setting_value || '[]'); } catch (_) { rows = []; }
  const deleted = new Map();
  (Array.isArray(rows) ? rows : []).forEach((row) => {
    const itemName = String(row?.item_name || '').trim();
    const financialYear = Number(row?.financial_year);
    if (!itemName || !Number.isInteger(financialYear) || financialYear < 1900 || financialYear > 9998) return;
    deleted.set(annualPolicyKey(itemName, financialYear), { item_name: itemName, financial_year: financialYear });
  });
  return deleted;
}

function writeDeletedAnnualPolicies({ db, all, now }, deleted) {
  db.run(`INSERT INTO app_settings (setting_key, setting_value, updated_at) VALUES (?, ?, ?)
    ON CONFLICT(setting_key) DO UPDATE SET setting_value = excluded.setting_value, updated_at = excluded.updated_at`,
  [DELETED_ANNUAL_POLICY_SETTING, JSON.stringify([...deleted.values()]), now()]);
}

function suppressAnnualPolicies(context, rows) {
  const { db, all, now } = context;
  const deleted = getDeletedAnnualPolicies(all);
  (rows || []).forEach((row) => {
    const itemName = String(row?.item_name || '').trim();
    const financialYear = Number(row?.financial_year);
    if (!itemName || !Number.isInteger(financialYear) || financialYear < 1900 || financialYear > 9998) return;
    deleted.set(annualPolicyKey(itemName, financialYear), { item_name: itemName, financial_year: financialYear });
  });
  writeDeletedAnnualPolicies({ db, all, now }, deleted);
}

function suppressAnnualPolicy(context, itemName, financialYear) {
  suppressAnnualPolicies(context, [{ item_name: itemName, financial_year: financialYear }]);
}

function restoreAnnualPolicy({ db, all, now }, itemName, financialYear) {
  const deleted = getDeletedAnnualPolicies(all);
  if (!deleted.delete(annualPolicyKey(itemName, financialYear))) return;
  writeDeletedAnnualPolicies({ db, all, now }, deleted);
}

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
  getDeletedAnnualPolicies(all).forEach((row) => names.push(row.item_name));

  const canonical = new Map();
  names.forEach((name) => {
    if (!name || isIgnoredIssueItemName(name)) return;
    const key = name.toLocaleLowerCase();
    const current = canonical.get(key);
    if (!current || name.localeCompare(current, undefined, { sensitivity: 'base' }) < 0) canonical.set(key, name);
  });
  return [...canonical.values()].sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }));
}

function findLegacyGeneratedAnnualDefaultIds(auditRows, policyRows) {
  const oldSyncRuns = (auditRows || []).filter((row) =>
    /^Added \d+ missing item\/year policy row\(s\) with allowed quantity 0\.$/.test(String(row.details || ''))
  ).map((row) => Date.parse(row.created_at)).filter(Number.isFinite);
  if (!oldSyncRuns.length) return [];
  return (policyRows || []).filter((row) => {
    if (Number(row.allowed_quantity) !== 0 || String(row.status || 'Active').trim().toLowerCase() !== 'active') return false;
    if (!row.created_at || row.created_at !== row.updated_at) return false;
    const createdAt = Date.parse(row.created_at);
    return Number.isFinite(createdAt) && oldSyncRuns.some((runAt) => runAt >= createdAt && runAt - createdAt <= 2000);
  }).map((row) => Number(row.id)).filter((id) => Number.isInteger(id) && id > 0);
}

function reclassifyLegacyGeneratedAnnualDefaults({ db, all, save, audit, now }) {
  const auditRows = all("SELECT details, created_at FROM audit_log WHERE action = 'Annual Item Policies Synchronized'");
  if (!auditRows.length) return 0;
  const policyRows = all("SELECT id, allowed_quantity, status, created_at, updated_at FROM annual_policies WHERE allowed_quantity = 0 AND lower(trim(COALESCE(status, 'Active'))) = 'active'");
  const ids = findLegacyGeneratedAnnualDefaultIds(auditRows, policyRows);
  if (!ids.length) return 0;
  db.run('BEGIN TRANSACTION');
  try {
    ids.forEach((id) => db.run("UPDATE annual_policies SET status = 'Unconfigured' WHERE id = ? AND allowed_quantity = 0 AND lower(trim(COALESCE(status, 'Active'))) = 'active'", [id]));
    db.run('COMMIT');
  } catch (error) {
    db.run('ROLLBACK');
    throw error;
  }
  audit('Legacy Default Annual Policies Reclassified', `Marked ${ids.length} audit-verified generated zero-quantity annual policy row(s) as Unconfigured.`, {
    entityType: 'Annual Policy', entityId: 'recognized-items',
    remarks: `No quantities or decision records were changed. Source audit match was limited to generated rows created within 2 seconds before their prior synchronization audit at ${now()}.`,
  });
  save();
  return ids.length;
}

function ensureAnnualPoliciesForRecognizedItems({ db, all, scalar, save, audit, now, isIgnoredIssueItemName }) {
  const reclassified = reclassifyLegacyGeneratedAnnualDefaults({ db, all, save, audit, now });
  const items = getRecognizedAnnualItems(all, isIgnoredIssueItemName);
  const current = new Date();
  const currentFinancialYear = current.getMonth() >= 3 ? current.getFullYear() : current.getFullYear() - 1;
  const years = new Set([currentFinancialYear]);
  all('SELECT financial_year FROM annual_policies').forEach((row) => years.add(Number(row.financial_year)));
  all('SELECT issue_month, issue_year, issue_period_label FROM uniform_issues WHERE issue_year IS NOT NULL OR TRIM(COALESCE(issue_period_label, \'\')) <> \'\'')
    .forEach((row) => {
    const year = getEntitlementFinancialYear(row);
    if (Number.isInteger(year) && year >= 1900 && year <= 9998) years.add(year);
  });
  const validYears = [...years].filter((year) => Number.isInteger(year) && year >= 1900 && year <= 9998);
  if (!items.length || !validYears.length) return { inserted: 0, reclassified, items: items.length, years: validYears };

  const countBefore = Number(scalar('SELECT COUNT(*) FROM annual_policies') || 0);
  const deletedPolicies = getDeletedAnnualPolicies(all);
  const existingKeys = new Set(all('SELECT item_name, financial_year FROM annual_policies')
    .map((row) => `${normalizeEntitlementLabel(row.item_name)}|${Number(row.financial_year)}`));
  const statement = db.prepare(`INSERT OR IGNORE INTO annual_policies
    (item_name, financial_year, allowed_quantity, status, created_at, updated_at)
    VALUES (?, ?, 0, 'Unconfigured', ?, ?)`);
  db.run('BEGIN TRANSACTION');
  try {
    items.forEach((itemName) => validYears.forEach((financialYear) => {
      const key = `${normalizeEntitlementLabel(itemName)}|${Number(financialYear)}`;
      if (deletedPolicies.has(key)) return;
      if (existingKeys.has(key)) return;
      statement.run([itemName, financialYear, now(), now()]);
      existingKeys.add(key);
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
    audit('Annual Item Policies Synchronized', `Added ${inserted} missing item/year policy row(s) with allowed quantity 0, awaiting configuration.`, {
      entityType: 'Annual Policy', entityId: 'recognized-items',
      remarks: 'Default rows are marked Unconfigured and are not treated as an allowance. Existing item/year policy quantities and statuses were preserved; synchronization is idempotent.',
    });
    save();
  }
  return { inserted, reclassified, items: items.length, years: validYears };
}

module.exports = {
  getRecognizedAnnualItems,
  ensureAnnualPoliciesForRecognizedItems,
  findLegacyGeneratedAnnualDefaultIds,
  getDeletedAnnualPolicies,
  suppressAnnualPolicy,
  suppressAnnualPolicies,
  restoreAnnualPolicy,
};
