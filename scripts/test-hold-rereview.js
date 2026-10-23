const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const XLSX = require('xlsx');
const { createDatabase } = require('../src/main/database/database');
const { importWorkbook } = require('../src/main/import/smart-importer');
const { nextCalendarCycle, localDateKey, millisecondsUntilNextLocalDay } = require('../src/main/database/hold-review-dates');

function assertCycle(date, expected) {
  assert.deepStrictEqual(nextCalendarCycle(date), expected);
}

(async () => {
  assertCycle(new Date(2026, 9, 1, 12), { year: 2026, month: 11 });
  assertCycle(new Date(2026, 9, 31, 23, 59), { year: 2026, month: 11 });
  assertCycle(new Date(2026, 11, 31, 12), { year: 2027, month: 1 });
  assertCycle(new Date(2024, 1, 29, 12), { year: 2024, month: 3 });
  assertCycle(new Date(2024, 1, 28, 12), { year: 2024, month: 3 });
  assert.strictEqual(localDateKey(new Date(2026, 9, 31, 23, 59)), '2026-10-31');
  assert(millisecondsUntilNextLocalDay(new Date(2024, 1, 29, 23, 59)) > 0);
  console.log('PASS: next-calendar-month scheduling covers month ends, leap day, and year rollover.');

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'uniform-hold-rereview-'));
  const workbookPath = path.join(tempDir, 'hold-review.xlsx');
  let db = await createDatabase(tempDir);
  db.upsertAnnualPolicy({ item_name: 'Coverall', financial_year: 2026, allowed_quantity: 0, status: 'Active' });
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([
    ['Employee Code', 'Employee Name', 'Father Name', 'Unit', 'Godown', 'Mobile', 'Issue Month', 'Coverall'],
    ['HOLD-001', 'Hold Workflow Employee', 'Audit Father', 'Hold Test Unit', 'Main Store', '', 'Oct 2026', 4],
  ]), 'Distribution');
  XLSX.writeFile(workbook, workbookPath);
  importWorkbook(workbookPath, db);

  let reviews = db.getReviewQueueStage2('HOLD-001');
  let review = reviews.find((row) => row.child_items?.length);
  assert(review, 'Expected imported excess to create a review record.');
  const reviewId = Number(review.id);
  const item = review.child_items[0];
  const heldQuantity = Number(item.remaining_quantity);
  assert(heldQuantity > 0, 'Expected a positive undecided quantity.');

  db.updateReview({
    id: reviewId,
    approved_by: 'Hold Workflow Test',
    reason: 'Automated hold workflow test',
    quantity_decisions: { deduct: 0, waive: 0, hold: heldQuantity },
  });
  assert.strictEqual(db.getState().salaryDeductions.length, 0, 'A hold must not create payroll recovery.');
  review = db.getReviewQueueStage2('HOLD-001').find((row) => Number(row.id) === reviewId);
  let savedItem = review.child_items.find((row) => Number(row.id) === Number(item.id));
  const initialHold = savedItem.hold_history.find((row) => row.event_type === 'Held');
  assert(initialHold, 'A new hold must persist a hold event.');
  const dueYear = Number(initialHold.due_year);
  const dueMonth = Number(initialHold.due_month);
  assert.deepStrictEqual(nextCalendarCycle(new Date(initialHold.created_at)), { year: dueYear, month: dueMonth });
  const dueDate = new Date(dueYear, dueMonth - 1, 1, 12);
  const beforeDueDate = new Date(dueYear, dueMonth - 2, 28, 12);
  assert.strictEqual(db.reopenDueHeldReviews(beforeDueDate), 0, 'A future hold must remain held.');

  db = await createDatabase(tempDir);
  review = db.getReviewQueueStage2('HOLD-001').find((row) => Number(row.id) === reviewId);
  savedItem = review.child_items.find((row) => Number(row.id) === Number(item.id));
  assert.strictEqual(Number(savedItem.held_quantity), heldQuantity, 'Hold quantity must persist across database restart.');
  const persistedHold = savedItem.hold_history.find((row) => row.event_type === 'Held');
  assert.strictEqual(Number(persistedHold.due_year), dueYear);
  assert.strictEqual(Number(persistedHold.due_month), dueMonth);
  assert.strictEqual(db.reopenDueHeldReviews(dueDate), heldQuantity, 'A due hold must reopen for review.');
  assert.strictEqual(db.reopenDueHeldReviews(dueDate), 0, 'Repeated reconciliation must be idempotent.');

  review = db.getReviewQueueStage2('HOLD-001').find((row) => Number(row.id) === reviewId);
  savedItem = review.child_items.find((row) => Number(row.id) === Number(item.id));
  assert.strictEqual(Number(savedItem.held_quantity), 0);
  assert.strictEqual(Number(savedItem.remaining_quantity), heldQuantity);
  assert.strictEqual(savedItem.hold_history.filter((row) => row.event_type === 'Reopened').reduce((sum, row) => sum + Number(row.quantity), 0), heldQuantity);

  const deducted = 1;
  const heldAgain = heldQuantity - deducted;
  assert(heldAgain > 0, 'Fixture should have enough quantity to exercise partial re-hold.');
  db.updateReview({
    id: reviewId,
    approved_by: 'Hold Workflow Test',
    reason: 'Partially deduct and re-hold remaining unit',
    quantity_decisions: { deduct: deducted, waive: 0, hold: heldAgain },
  });
  review = db.getReviewQueueStage2('HOLD-001').find((row) => Number(row.id) === reviewId);
  savedItem = review.child_items.find((row) => Number(row.id) === Number(item.id));
  assert.strictEqual(Number(savedItem.deducted_quantity), deducted);
  assert.strictEqual(Number(savedItem.held_quantity), heldAgain);
  const heldAgainEvent = savedItem.hold_history.find((row) => row.event_type === 'Held Again');
  assert(heldAgainEvent);
  assert.deepStrictEqual(nextCalendarCycle(new Date(heldAgainEvent.created_at)), { year: Number(heldAgainEvent.due_year), month: Number(heldAgainEvent.due_month) });

  db.resolveHeldQuantity({ reviewId, itemId: Number(item.id), quantity: 1, decision: 'Waive', reason: 'Resolve one held unit', resolvedBy: 'Hold Workflow Test' });
  review = db.getReviewQueueStage2('HOLD-001').find((row) => Number(row.id) === reviewId);
  savedItem = review.child_items.find((row) => Number(row.id) === Number(item.id));
  assert.strictEqual(Number(savedItem.deducted_quantity), 1);
  assert.strictEqual(Number(savedItem.waived_quantity), 1);
  assert.strictEqual(Number(savedItem.held_quantity), heldAgain - 1);
  assert(savedItem.hold_history.some((row) => row.event_type === 'Resolved' && row.decision === 'Waive'));
  assert.strictEqual(Number(savedItem.held_quantity), 2, 'Resolving one of three re-held units must preserve the other two.');
  assert.strictEqual(db.reopenDueHeldReviews(dueDate), 2, 'Only the outstanding two units from the later hold may reopen.');
  assert.strictEqual(db.reopenDueHeldReviews(dueDate), 0, 'Resolved quantities must not be reopened again.');
  review = db.getReviewQueueStage2('HOLD-001').find((row) => Number(row.id) === reviewId);
  savedItem = review.child_items.find((row) => Number(row.id) === Number(item.id));
  assert.strictEqual(Number(savedItem.deducted_quantity), 1);
  assert.strictEqual(Number(savedItem.waived_quantity), 1);
  assert.strictEqual(Number(savedItem.held_quantity), 0);
  assert.strictEqual(Number(savedItem.remaining_quantity), 2);
  const persistedState = db.getState();
  assert.strictEqual(persistedState.salaryDeductions.length, 1, 'The finalized deducted unit must have one active payroll record.');
  assert.strictEqual(persistedState.waiveRecords.length, 1, 'The waived unit must retain one active waiver record.');
  console.log('PASS: due hold survives restart, reopens once, and partial Deduct/Waive/Hold quantities retain their history.');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
