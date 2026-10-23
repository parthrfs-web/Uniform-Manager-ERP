const fs = require('fs');
const os = require('os');
const path = require('path');
const XLSX = require('xlsx');
const { createDatabase } = require('../src/main/database/database');
const { importWorkbook } = require('../src/main/import/smart-importer');
const { applyBulkPolicyChange, persistThenRecalculate } = require('../src/main/services/review-queue-updates');

async function main() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'uniform-auto-review-recalc-'));
  const workbookPath = path.join(dir, 'automatic-recalculation-fixture.xlsx');
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([
    ['Emp Code', 'Name', 'Father Name', 'Unit', 'Godown', 'Month', 'Critical Coat'],
    ['AUTO001', 'Pending Price Test', 'Parent', 'RECALC-UNIT', 'Store', 'Jan 2026', 3],
    ['AUTO002', 'Finalized Price Test', 'Parent', 'RECALC-UNIT', 'Store', 'Jan 2026', 3],
    ['AUTO003', 'Unrelated Unit Test', 'Parent', 'OTHER-UNIT', 'Store', 'Jan 2026', 2],
  ]), 'DISTRIBUTION');
  XLSX.writeFile(workbook, workbookPath);

  let db = await createDatabase(dir);
  db.upsertItem({ item_code: 'CRITICAL-COAT', item_name: 'Critical Coat', category: 'Uniform', size: 'M', cost: 300 });
  importWorkbook(workbookPath, db);
  db.upsertPolicy({ unit: 'RECALC-UNIT', item_name: 'Critical Coat', yearly_entitlement: 0, item_cost: 100 });
  db.upsertPolicy({ unit: 'OTHER-UNIT', item_name: 'Critical Coat', yearly_entitlement: 0, item_cost: 75 });
  db.upsertAnnualPolicy({ item_name: 'Critical Coat', financial_year: 2025, allowed_quantity: 0 });
  db.setReviewQueueCalculationMode('item_annual');
  await db.recalculateReviews();

  const pendingBefore = db.getReviewQueueStage2('AUTO001').find((row) => row.item_name === 'Critical Coat');
  const finalized = db.getReviewQueueStage2('AUTO002').find((row) => row.item_name === 'Critical Coat');
  const unrelatedBefore = db.getReviewQueueStage2('AUTO003').find((row) => row.item_name === 'Critical Coat');
  if (!pendingBefore || !finalized || !unrelatedBefore) throw new Error('Expected test review rows were not generated.');
  const pendingReviewId = Number(pendingBefore.id);
  const finalizedReviewId = Number(finalized.id);
  const unrelatedReviewId = Number(unrelatedBefore.id);
  db.updateReview({ id: finalizedReviewId, status: 'Completed', approved_by: 'Automatic Recalc Test', reason: 'Preserve history', quantity_decisions: { deduct: 3, waive: 0, hold: 0 } });
  const originalPayroll = db.getState().livePayrollRecords.find((row) => row.record_type === 'Deduct' && row.employee_code === 'AUTO002');
  if (!originalPayroll || Number(originalPayroll.amount) !== 300) throw new Error(`Unexpected initial persisted deduction amount: ${originalPayroll?.amount}`);

  await persistThenRecalculate(db, () => db.upsertAnnualPolicy({ item_name: 'Critical Coat', financial_year: 2025, allowed_quantity: 1 }), null);
  const afterAnnual = db.getReviewQueueStage2('AUTO001').find((row) => Number(row.id) === pendingReviewId);
  const afterFinalizedAnnual = db.getReviewQueueStage2('AUTO002').find((row) => Number(row.id) === finalizedReviewId);
  if (!afterAnnual || Number(afterAnnual.remaining_qty) !== 2) throw new Error('Annual policy save did not recalculate pending excess quantity.');
  if (!afterFinalizedAnnual || Number(afterFinalizedAnnual.sum_deduct) !== 3 || afterFinalizedAnnual.status !== 'Completed') throw new Error('Annual policy recalculation changed finalized quantities or status.');
  const payrollAfterAnnual = db.getState().livePayrollRecords.find((row) => row.record_type === 'Deduct' && row.employee_code === 'AUTO002');
  if (Number(payrollAfterAnnual?.amount) !== 300) throw new Error('Annual recalculation rewrote a finalized payroll amount.');

  const bulkResult = await applyBulkPolicyChange(db, {
    item_name: 'Critical Coat', update_price: true, new_price: 250,
    update_qty: false, units: ['RECALC-UNIT'],
  }, null);
  if (!bulkResult.recalculated || bulkResult.updated !== 1) throw new Error('Price-only bulk policy save did not trigger recalculation.');
  const afterPrice = db.getReviewQueueStage2('AUTO001').find((row) => Number(row.id) === pendingReviewId);
  const unaffected = db.getReviewQueueStage2('AUTO003').find((row) => Number(row.id) === unrelatedReviewId);
  if (!afterPrice || Number(afterPrice.remaining_qty) !== 2 || Number(afterPrice.live_rate) !== 250) throw new Error('Price-only update did not refresh the affected pending review rate.');
  if (!unaffected || Number(unaffected.remaining_qty) !== 1 || Number(unaffected.live_rate) !== 75) throw new Error('Bulk price update changed an unrelated unit rate or review quantity.');
  const pendingSummary = db.getReviewQueueStage1().find((row) => row.employee_code === 'AUTO001');
  if (Number(pendingSummary?.pending_item_count) !== 1 || Number(pendingSummary?.estimated_deduction) !== 500) throw new Error('Review Queue summary did not reflect the recalculated pending rate and total.');

  const historyCount = db.getState().reviews.length;
  const repeatedBulk = await applyBulkPolicyChange(db, {
    item_name: 'Critical Coat', update_price: true, new_price: 250,
    update_qty: false, units: ['RECALC-UNIT'],
  }, null);
  await db.recalculateReviews();
  if (repeatedBulk.recalculated || repeatedBulk.updated !== 0 || db.getState().reviews.length !== historyCount) throw new Error('An unchanged price was recalculated or review parents were duplicated.');
  const activePendingChildren = db.getReviewQueueStage2('AUTO001').find((row) => Number(row.id) === pendingReviewId).child_items.filter((child) => Number(child.remaining_quantity) > 0);
  if (activePendingChildren.length !== 1) throw new Error('Repeated recalculation duplicated the active pending quantity.');
  const finalizedRegisterRow = db.getState().livePayrollRecords.find((row) => row.record_type === 'Deduct' && row.employee_code === 'AUTO002');
  const finalizedPersistedRow = db.getState().salaryDeductions.find((row) => row.employee_code === 'AUTO002');
  if (Number(finalizedRegisterRow?.amount) !== 300 || Number(finalizedPersistedRow?.amount) !== 300) throw new Error('Price-only recalculation rewrote finalized payroll history.');

  db = await createDatabase(dir);
  const afterRestart = db.getReviewQueueStage2('AUTO001').find((row) => Number(row.id) === pendingReviewId);
  const finalizedAfterRestart = db.getReviewQueueStage2('AUTO002').find((row) => Number(row.id) === finalizedReviewId);
  if (!afterRestart || Number(afterRestart.live_rate) !== 250 || Number(afterRestart.remaining_qty) !== 2) throw new Error('Recalculated policy and pending review did not persist after restart.');
  if (!finalizedAfterRestart || Number(finalizedAfterRestart.sum_deduct) !== 3) throw new Error('Finalized decision did not persist after restart.');
  const payrollAfterRestart = db.getState().salaryDeductions.find((row) => row.employee_code === 'AUTO002');
  if (Number(payrollAfterRestart?.amount) !== 300) throw new Error('Finalized payroll amount changed after restart.');
  console.log('Automatic review recalculation regression passed (annual policy, price-only bulk update, summary refresh, unaffected unit, finalized payroll history, idempotence, restart).');
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
