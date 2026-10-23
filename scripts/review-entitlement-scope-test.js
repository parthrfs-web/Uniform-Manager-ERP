const fs = require('fs');
const os = require('os');
const path = require('path');
const XLSX = require('xlsx');
const { createDatabase } = require('../src/main/database/database');
const { importWorkbook } = require('../src/main/import/smart-importer');

async function main() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'uniform-review-scope-'));
  const workbookPath = path.join(dir, 'scope-fixture.xlsx');
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([
    ['Emp Code', 'Name', 'Father Name', 'Unit', 'Godown', 'Month', 'Pant', 'Shirt'],
    ['11290', 'Vivek Kumar Singh', 'Parent', 'AMNS-PORT', 'Store', 'Apr 2026', 1, 0],
    ['11290', 'Vivek Kumar Singh', 'Parent', 'L&T', 'Store', 'May 2026', 1, 1],
  ]), 'DISTRIBUTION');
  XLSX.writeFile(workbook, workbookPath);

  const db = await createDatabase(dir);
  importWorkbook(workbookPath, db);
  db.setReviewQueueCalculationMode('item_annual');
  db.upsertAnnualPolicy({ item_name: 'Pant', financial_year: 2026, allowed_quantity: 1 });
  db.upsertAnnualPolicy({ item_name: 'Shirt', financial_year: 2026, allowed_quantity: 0 });
  db.recalculateReviews();

  let pant = db.getReviewQueueStage2('11290').find((row) => row.item_name === 'Pant' && row.unit === 'L&T');
  if (!pant || pant.issued_qty !== 2 || pant.allowed_qty !== 1 || pant.excess_qty !== 1
      || pant.history_items.reduce((sum, row) => sum + Number(row.quantity), 0) !== 2
      || pant.history_items.length !== 2
      || !pant.history_items.some((row) => row.unit === 'AMNS-PORT')
      || !pant.history_items.some((row) => row.unit === 'L&T')) {
    throw new Error(`Annual transfer scope did not reconcile: ${JSON.stringify(pant)}`);
  }
  const pantReviewId = Number(pant.id);
  db.updateReview({ id: pantReviewId, status: 'Completed', approved_by: 'Scope Test', reason: 'Preserve finalized allocation', quantity_decisions: { deduct: 1, waive: 0, hold: 0 } });
  const payrollBeforeRecalculation = db.getState().salaryDeductions.filter((row) => Number(row.review_id) === pantReviewId && row.is_active);
  db.recalculateReviewsForEmployee('11290');
  pant = db.getReviewQueueStage2('11290').find((row) => Number(row.id) === pantReviewId);
  if (!pant || Number(pant.sum_deduct) !== 1 || Number(pant.remaining_qty) !== 0) throw new Error('Recalculation changed the finalized Pant decision or remaining quantity.');

  let shirt = db.getReviewQueueStage2('11290').find((row) => row.item_name === 'Shirt' && row.unit === 'L&T');
  if (!shirt || Number(shirt.allowed_qty) !== 0 || Number(shirt.excess_qty) !== 1 || shirt.status !== 'Pending') throw new Error('Shirt baseline review did not match its zero allowance.');
  const shirtReviewId = Number(shirt.id);
  db.upsertAnnualPolicy({ item_name: 'Shirt', financial_year: 2026, allowed_quantity: 2 });
  db.recalculateReviewsForEmployee('11290');
  shirt = db.getReviewQueueStage2('11290').find((row) => Number(row.id) === shirtReviewId);
  if (!shirt || Number(shirt.issued_qty) !== 1 || Number(shirt.allowed_qty) !== 2 || Number(shirt.excess_qty) !== 0
      || shirt.status !== 'Completed' || Number(shirt.remaining_qty) !== 0 || Number(shirt.sum_deduct) !== 0) {
    throw new Error(`L&T/Shirt completed row did not refresh consistently: ${JSON.stringify(shirt)}`);
  }

  db.setReviewQueueCalculationMode('unit_wise');
  db.upsertPolicy({ unit: 'AMNS-PORT', item_name: 'Pant', yearly_entitlement: 1, item_cost: 100 });
  db.upsertPolicy({ unit: 'L&T', item_name: 'Pant', yearly_entitlement: 1, item_cost: 100 });
  db.recalculateReviewsForEmployee('11290');
  pant = db.getReviewQueueStage2('11290').find((row) => row.item_name === 'Pant' && row.unit === 'L&T');
  if (!pant || Number(pant.issued_qty) !== 1 || Number(pant.allowed_qty) !== 1
      || Number(pant.excess_qty) !== 1 || pant.history_items.length !== 1) {
    throw new Error(`Unit-wise transfer scope did not remain unit-specific: ${JSON.stringify(pant)}`);
  }
  const parentCountBeforeRepeat = db.getState().reviews.filter((row) => row.employee_code === '11290' && row.item_name === 'Pant').length;
  db.recalculateReviewsForEmployee('11290');
  const parentCountAfterRepeat = db.getState().reviews.filter((row) => row.employee_code === '11290' && row.item_name === 'Pant').length;
  if (parentCountAfterRepeat !== parentCountBeforeRepeat) {
    throw new Error(`Repeated employee recalculation duplicated a review parent (${parentCountBeforeRepeat} → ${parentCountAfterRepeat}).`);
  }
  const persistedDeduct = db.getState().salaryDeductions.find((row) => Number(row.review_id) === pantReviewId && row.is_active);
  if (JSON.stringify(payrollBeforeRecalculation) !== JSON.stringify(db.getState().salaryDeductions.filter((row) => Number(row.review_id) === pantReviewId && row.is_active))) {
    throw new Error(`Finalized payroll history changed during scope recalculation: before=${JSON.stringify(payrollBeforeRecalculation)} after=${JSON.stringify(persistedDeduct)}`);
  }

  console.log('Review entitlement scope regression passed (two-unit FY annual reconciliation, scoped history, preserved deduction, current Shirt completed snapshot, Unit-wise transfer scope, idempotent recalculation).');
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
