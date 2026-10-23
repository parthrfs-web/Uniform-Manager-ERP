const fs = require('fs');
const os = require('os');
const path = require('path');
const XLSX = require('xlsx');
const { createDatabase } = require('../src/main/database/database');
const { importWorkbook } = require('../src/main/import/smart-importer');
const { persistThenRecalculate } = require('../src/main/services/review-queue-updates');

async function main() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'uniform-annual-refresh-'));
  const workbookPath = path.join(dir, 'shirt-fixture.xlsx');
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([
    ['Emp Code', 'Name', 'Father Name', 'Unit', 'Godown', 'Month', 'Shirt'],
    ['SHIRT001', 'Allowance Test', 'Parent', 'ALLOWANCE-UNIT', 'Store', 'Jan 2026', 2],
  ]), 'DISTRIBUTION');
  XLSX.writeFile(workbook, workbookPath);

  let db = await createDatabase(dir);
  importWorkbook(workbookPath, db);
  db.setReviewQueueCalculationMode('item_annual');
  db.upsertAnnualPolicy({ item_name: 'Shirt', financial_year: 2025, allowed_quantity: 1 });
  await db.recalculateReviews();

  let review = db.getReviewQueueStage2('SHIRT001').find((row) => row.item_name === 'Shirt');
  if (!review || Number(review.issued_qty) !== 2 || Number(review.allowed_qty) !== 1
      || Number(review.excess_qty) !== 1 || review.status !== 'Pending') {
    throw new Error(`Initial allowance state was incorrect: ${JSON.stringify(review)}`);
  }
  const reviewId = Number(review.id);

  await persistThenRecalculate(db, () => db.upsertAnnualPolicy({ item_name: 'Shirt', financial_year: 2025, allowed_quantity: 2 }), null);
  review = db.getReviewQueueStage2('SHIRT001').find((row) => Number(row.id) === reviewId);
  if (!review || Number(review.issued_qty) !== 2 || Number(review.allowed_qty) !== 2
      || Number(review.excess_qty) !== 0 || review.status !== 'Completed'
      || Number(review.remaining_qty) !== 0) {
    throw new Error(`Raised allowance left a stale card snapshot: ${JSON.stringify(review)}`);
  }

  db = await createDatabase(dir);
  review = db.getReviewQueueStage2('SHIRT001').find((row) => Number(row.id) === reviewId);
  if (!review || Number(review.issued_qty) !== 2 || Number(review.allowed_qty) !== 2
      || Number(review.excess_qty) !== 0 || review.status !== 'Completed') {
    throw new Error(`Updated card quantities did not persist after reopening the database: ${JSON.stringify(review)}`);
  }
  console.log('Annual allowance refresh regression passed (1→2 allowance, current issued/allowed/excess/status, stable review ID, persisted restart).');
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
