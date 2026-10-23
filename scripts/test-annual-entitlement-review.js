const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const XLSX = require('xlsx');
const initSqlJs = require('sql.js');
const { createDatabase } = require('../src/main/database/database');
const { importWorkbook } = require('../src/main/import/smart-importer');
const { findLegacyGeneratedAnnualDefaultIds } = require('../src/main/database/annual-policy-sync');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'uniform-annual-entitlement-'));
const periodHeaders = ['Employee Code', 'Employee Name', 'Father Name', 'Unit', 'Issue Month', 'Shirt', 'Pant'];
let fileIndex = 0;

function makeWorkbook(rows, name = `import-${++fileIndex}.xlsx`, headers = periodHeaders) {
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([headers, ...rows]), 'Distribution');
  const filePath = path.join(tmp, name);
  XLSX.writeFile(workbook, filePath);
  return filePath;
}

function importRows(db, rows, name, headers) {
  const filePath = makeWorkbook(rows, name, headers);
  return { result: importWorkbook(filePath, db), filePath };
}

function pendingItems(db, employeeCode) {
  return db.getReviewQueueStage2(employeeCode).flatMap((review) => review.child_items || [])
    .filter((item) => Number(item.remaining_quantity) > 0);
}

function assertNoPending(db, employeeCode, message) {
  assert.strictEqual(pendingItems(db, employeeCode).length, 0, message);
}

(async () => {
  assert.deepStrictEqual(findLegacyGeneratedAnnualDefaultIds(
    [{ details: 'Added 144 missing item/year policy row(s) with allowed quantity 0.', created_at: '2026-10-22T06:09:01.701Z' }],
    [
      { id: 1, status: 'Active', allowed_quantity: 0, created_at: '2026-10-22T06:09:01.685Z', updated_at: '2026-10-22T06:09:01.685Z' },
      { id: 2, status: 'Active', allowed_quantity: 0, created_at: '2026-10-22T06:09:01.685Z', updated_at: '2026-10-22T06:09:02.000Z' },
      { id: 3, status: 'Active', allowed_quantity: 1, created_at: '2026-10-22T06:09:01.685Z', updated_at: '2026-10-22T06:09:01.685Z' },
      { id: 4, status: 'Active', allowed_quantity: 0, created_at: '2026-10-22T06:09:01.685Z', updated_at: '2026-10-22T06:09:01.685Z' },
    ]
  ), [1, 4], 'Only zero rows directly correlated with the legacy sync audit should be reclassified.');

  const migrationDir = fs.mkdtempSync(path.join(os.tmpdir(), 'uniform-annual-policy-migration-'));
  await createDatabase(migrationDir);
  const SQL = await initSqlJs();
  const migrationPath = path.join(migrationDir, 'uniform-manager.sqlite');
  const legacyDb = new SQL.Database(fs.readFileSync(migrationPath));
  legacyDb.run(`INSERT INTO annual_policies (item_name, financial_year, allowed_quantity, status, created_at, updated_at)
    VALUES ('Legacy Generated', 2025, 0, 'Active', '2026-10-22T06:09:01.685Z', '2026-10-22T06:09:01.685Z')`);
  legacyDb.run(`INSERT INTO annual_policies (item_name, financial_year, allowed_quantity, status, created_at, updated_at)
    VALUES ('Legacy Manual Zero', 2025, 0, 'Active', '2026-10-22T06:09:01.685Z', '2026-10-22T06:09:01.900Z')`);
  legacyDb.run(`INSERT INTO annual_policies (item_name, financial_year, allowed_quantity, status, created_at, updated_at)
    VALUES ('Legacy Nonzero', 2025, 2, 'Active', '2026-10-22T06:09:01.685Z', '2026-10-22T06:09:01.685Z')`);
  legacyDb.run(`INSERT INTO audit_log (action, details, created_at)
    VALUES ('Annual Item Policies Synchronized', 'Added 1 missing item/year policy row(s) with allowed quantity 0.', '2026-10-22T06:09:01.701Z')`);
  fs.writeFileSync(migrationPath, Buffer.from(legacyDb.export()));
  legacyDb.close();
  const migratedDb = await createDatabase(migrationDir);
  const migratedPolicies = migratedDb.getState().annualPolicies;
  const fy2025Policy = (name) => migratedPolicies.find((row) => row.item_name === name && Number(row.financial_year) === 2025);
  assert.strictEqual(fy2025Policy('Legacy Generated').status, 'Unconfigured');
  assert.strictEqual(Number(fy2025Policy('Legacy Generated').allowed_quantity), 0);
  assert.strictEqual(fy2025Policy('Legacy Manual Zero').status, 'Active');
  assert.strictEqual(fy2025Policy('Legacy Nonzero').status, 'Active');

  const db = await createDatabase(tmp);
  db.upsertAnnualPolicy({ item_name: 'Shirt', financial_year: 2025, allowed_quantity: 2, status: 'Active' });
  db.upsertAnnualPolicy({ item_name: 'Pant', financial_year: 2025, allowed_quantity: 2, status: 'Active' });

  // A and B: annual item entitlements are shared across units; shirt and pant are independent.
  importRows(db, [['EMP-1', 'Employee One', 'Father One', 'Unit A', 'Apr 2025', 1, 1]], 'unit-a.xlsx');
  assertNoPending(db, 'EMP-1', 'One shirt and one pant within their allowances must not be reviewed.');
  importRows(db, [['EMP-1', 'Employee One', 'Father One', 'Unit B', 'May 2025', 1, 0]], 'unit-b.xlsx');
  assertNoPending(db, 'EMP-1', 'One shirt from each of two units must total the shared allowance of two.');
  assert.strictEqual(db.getState().uniformIssueCount, 3);

  // C: the third shirt, from another unit, is the only genuine excess.
  importRows(db, [['EMP-1', 'Employee One', 'Father One', 'Unit B', 'Jun 2025', 1, 0]], 'unit-b-third.xlsx');
  const excessReview = db.getReviewQueueStage2('EMP-1').find((review) => Number(review.remaining_qty) > 0);
  assert(excessReview, 'The third shirt must create a review.');
  assert.strictEqual(Number(excessReview.issued_qty), 3, 'Annual-mode card total must include issued quantities from every unit.');
  assert.strictEqual(Number(excessReview.allowed_qty), 2);
  assert.strictEqual(Number(excessReview.excess_qty), 1);
  assert.strictEqual(pendingItems(db, 'EMP-1').reduce((sum, item) => sum + Number(item.remaining_quantity), 0), 1);
  assert(!db.getReviewQueueStage2('EMP-1').some((review) => review.item_name === 'Pant' && Number(review.remaining_qty) > 0));
  const pendingChildId = Number(pendingItems(db, 'EMP-1')[0].id);
  db.recalculateReviews();
  assert.strictEqual(pendingItems(db, 'EMP-1').length, 1, 'Repeated recalculation must not duplicate active pending quantities.');
  assert.strictEqual(Number(pendingItems(db, 'EMP-1')[0].id), pendingChildId, 'Unchanged pending review IDs should be preserved.');

  // H: identical source workbook is rejected by the persisted import hash.
  const duplicate = importWorkbook(path.join(tmp, 'unit-b-third.xlsx'), db);
  assert.strictEqual(duplicate.duplicate, true);
  assert.strictEqual(db.getState().uniformIssueCount, 4, 'Duplicate import must not count the same distribution twice.');

  // E: an unknown annual allowance is not treated as zero or as confirmed excess.
  db.upsertItem({ item_code: 'CAP', item_name: 'Cap', cost: 0 });
  importRows(db, [['EMP-3', 'Employee Three', 'Father Three', 'Unit C', 'Apr 2025', 0, 0, 1]], 'missing-policy.xlsx', [...periodHeaders, 'Cap']);
  assertNoPending(db, 'EMP-3', 'A missing annual policy must not create a confirmed excess review.');
  const missingPolicy = db.getState().annualPolicies.find((row) => row.item_name === 'Cap' && Number(row.financial_year) === 2025);
  assert(missingPolicy && Number(missingPolicy.allowed_quantity) === 0 && missingPolicy.status === 'Unconfigured', 'Automatically synchronized annual rows must remain explicitly unconfigured.');
  const missingSuggestion = db.getState().missingPolicySuggestions.find((row) => row.item_name === 'Cap' && Number(row.financial_year) === 2025);
  assert(missingSuggestion, 'Missing annual policy must remain visible to policy management.');
  db.createAnnualPolicyFromSuggestion({ item_name: 'Cap', financial_year: 2025, allowed_quantity: 1 }, missingSuggestion);
  db.recalculateReviews();
  assertNoPending(db, 'EMP-3', 'Configuring the suggested annual policy must not create a false review.');

  // Period labels that contain a financial-year range resolve to its start year.
  importRows(db, [['EMP-10', 'Employee Ten', 'Father Ten', 'Unit K', '2025-26', 1, 0]], 'fiscal-period.xlsx');
  assertNoPending(db, 'EMP-10', 'A 2025-26 distribution must use the FY 2025 annual allowance.');

  // F: whitespace/case-normalized unit/item policy lookup and unit-wise behavior.
  db.setReviewQueueCalculationMode('unit_wise');
  db.upsertPolicy({ unit: 'Unit D', item_name: 'Shirt', yearly_entitlement: 1, item_cost: 0 });
  importRows(db, [['EMP-4', 'Employee Four', 'Father Four', '  unit   d  ', 'Apr 2025', 2, 0]], 'normalized-policy.xlsx');
  const normalizedReview = db.getReviewQueueStage2('EMP-4').find((review) => Number(review.remaining_qty) > 0);
  assert(normalizedReview, 'Normalized unit/item policy should match the imported issue.');
  assert.strictEqual(Number(normalizedReview.excess_qty), 1);
  importRows(db, [['EMP-5', 'Employee Five', 'Father Five', 'Unit E', 'Apr 2025', 1, 0]], 'unit-policy-missing.xlsx');
  assertNoPending(db, 'EMP-5', 'Missing unit-wise policy must not silently mean an allowance of zero.');

  // C / combined: intersect policy sources without adding overlapping excess quantities.
  db.setReviewQueueCalculationMode('combined');
  db.upsertAnnualPolicy({ item_name: 'Shirt', financial_year: 2025, allowed_quantity: 2, status: 'Active' });
  db.upsertPolicy({ unit: 'Unit F', item_name: 'Shirt', yearly_entitlement: 2, item_cost: 0 });
  importRows(db, [['EMP-6', 'Employee Six', 'Father Six', 'Unit F', 'Apr 2025', 2, 0], ['EMP-6', 'Employee Six', 'Father Six', 'Unit G', 'May 2025', 1, 0]], 'combined-overlap.xlsx');
  const combinedReview = db.getReviewQueueStage2('EMP-6').find((review) => Number(review.remaining_qty) > 0);
  assert(combinedReview, 'Combined mode should review the global annual excess.');
  assert.strictEqual(Number(combinedReview.excess_qty), 1, 'Overlapping unit and annual excess must not be added together.');

  // G: remove an invalid pending remainder safely; preserve its history.
  db.setReviewQueueCalculationMode('item_annual');
  db.upsertAnnualPolicy({ item_name: 'Shirt', financial_year: 2025, allowed_quantity: 2, status: 'Active' });
  importRows(db, [['EMP-7', 'Employee Seven', 'Father Seven', 'Unit H', 'Apr 2025', 3, 0]], 'stale-pending.xlsx');
  let stale = db.getReviewQueueStage2('EMP-7').find((review) => Number(review.remaining_qty) > 0);
  assert(stale, 'Fixture must create a pending excess before policy correction.');
  const staleId = Number(stale.id);
  db.upsertAnnualPolicy({ item_name: 'Shirt', financial_year: 2025, allowed_quantity: 3, status: 'Active' });
  db.recalculateReviews();
  stale = db.getReviewQueueStage2('EMP-7').find((review) => Number(review.id) === staleId);
  assert(stale, 'Recalculation must retain the historical review parent.');
  assert.strictEqual(Number(stale.remaining_qty), 0);
  assert.strictEqual(stale.status, 'Completed');
  assert(stale.child_items.length === 0, 'Invalid undecided child must be inactive while its record remains stored.');
  const staleAudit = db.getState().reviews.find((review) => Number(review.id) === staleId);
  assert(staleAudit, 'Historical review remains accessible after pending excess is invalidated.');

  // Preserve finalized allocations and payroll history when policy changes.
  db.upsertAnnualPolicy({ item_name: 'Shirt', financial_year: 2025, allowed_quantity: 2, status: 'Active' });
  db.upsertPolicy({ unit: 'Unit I', item_name: 'Shirt', yearly_entitlement: 1, item_cost: 100 });
  importRows(db, [['EMP-8', 'Employee Eight', 'Father Eight', 'Unit I', 'Apr 2025', 3, 0]], 'finalized-history.xlsx');
  const finalized = db.getReviewQueueStage2('EMP-8').find((review) => Number(review.remaining_qty) > 0);
  assert(finalized);
  db.updateReview({ id: finalized.id, approved_by: 'Regression Test', reason: 'Preserve payroll audit', quantity_decisions: { deduct: 1, waive: 0, hold: 0 } });
  const deductionCount = db.getState().salaryDeductions.filter((row) => row.employee_code === 'EMP-8').length;
  assert.strictEqual(deductionCount, 1);
  const originalDeductionAmount = Number(db.getState().salaryDeductions.find((row) => row.employee_code === 'EMP-8').amount);
  assert.strictEqual(originalDeductionAmount, 100);
  db.upsertAnnualPolicy({ item_name: 'Shirt', financial_year: 2025, allowed_quantity: 4, status: 'Active' });
  db.recalculateReviews();
  const preserved = db.getReviewQueueStage2('EMP-8').find((review) => Number(review.id) === Number(finalized.id));
  assert.strictEqual(Number(preserved.sum_deduct), 1);
  const preservedDeductions = db.getState().salaryDeductions.filter((row) => row.employee_code === 'EMP-8');
  assert.strictEqual(preservedDeductions.length, deductionCount);
  assert.strictEqual(Number(preservedDeductions[0].amount), originalDeductionAmount);

  // I: employee and item scopes stay independent. Test J's decision behavior is also covered by the held-workflow test.
  importRows(db, [['EMP-9', 'Employee Nine', 'Father Nine', 'Unit J', 'Apr 2025', 1, 1]], 'independent-employee.xlsx');
  assertNoPending(db, 'EMP-9', 'Other employees and items must not inherit another employee’s excess.');

  // Financial years have independent allowance balances.
  db.upsertAnnualPolicy({ item_name: 'Shirt', financial_year: 2025, allowed_quantity: 1, status: 'Active' });
  db.upsertAnnualPolicy({ item_name: 'Shirt', financial_year: 2026, allowed_quantity: 1, status: 'Active' });
  importRows(db, [
    ['EMP-11', 'Employee Eleven', 'Father Eleven', 'Unit K', 'Apr 2025', 1, 0],
    ['EMP-11', 'Employee Eleven', 'Father Eleven', 'Unit K', 'Apr 2026', 1, 0],
  ], 'independent-years.xlsx');
  assertNoPending(db, 'EMP-11', 'A new financial year must receive its independent annual allowance.');

  // Decreasing a saved allowance recalculates only the genuine new excess.
  db.upsertAnnualPolicy({ item_name: 'Shirt', financial_year: 2025, allowed_quantity: 2, status: 'Active' });
  importRows(db, [['EMP-12', 'Employee Twelve', 'Father Twelve', 'Unit L', 'Apr 2025', 2, 0]], 'decrease-policy.xlsx');
  assertNoPending(db, 'EMP-12', 'Quantity within the original allowance should not be pending.');
  db.upsertAnnualPolicy({ item_name: 'Shirt', financial_year: 2025, allowed_quantity: 1, status: 'Active' });
  db.recalculateReviews();
  assert.strictEqual(pendingItems(db, 'EMP-12').reduce((sum, item) => sum + Number(item.remaining_quantity), 0), 1);

  // Held allocations remain held across ordinary entitlement recalculation.
  db.upsertAnnualPolicy({ item_name: 'Shirt', financial_year: 2025, allowed_quantity: 0, status: 'Active' });
  importRows(db, [['EMP-13', 'Employee Thirteen', 'Father Thirteen', 'Unit M', 'Apr 2025', 1, 0]], 'hold-preservation.xlsx');
  const heldReview = db.getReviewQueueStage2('EMP-13').find((review) => Number(review.remaining_qty) > 0);
  assert(heldReview);
  db.updateReview({ id: heldReview.id, approved_by: 'Regression Test', reason: 'Preserve hold', quantity_decisions: { deduct: 0, waive: 0, hold: 1 } });
  db.recalculateReviews();
  const preservedHold = db.getReviewQueueStage2('EMP-13').find((review) => Number(review.id) === Number(heldReview.id));
  assert.strictEqual(Number(preservedHold.sum_hold), 1);
  assert.strictEqual(preservedHold.status, 'Held');

  const reopened = await createDatabase(tmp);
  const persistedReview = reopened.getReviewQueueStage2('EMP-8').find((review) => Number(review.id) === Number(finalized.id));
  assert(persistedReview, 'Review decision history must persist after reopening the database.');
  assert.strictEqual(Number(persistedReview.sum_deduct), 1);
  console.log('PASS: annual entitlement, cross-unit accumulation, missing policies, normalization, stale pending cleanup, duplicate import, combined overlap, and decision persistence.');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
