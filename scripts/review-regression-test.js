const fs = require("fs");
const os = require("os");
const path = require("path");
const XLSX = require("xlsx");
const initSqlJs = require("sql.js");
const { createDatabase } = require("../src/main/database/database");
const { importWorkbook } = require("../src/main/import/smart-importer");

async function main() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "uniform-review-regression-"));
  const workbookPath = path.join(tempDir, "review-fixture.xlsx");
  const workbook = XLSX.utils.book_new();
  const rows = [
    ["Emp Code", "Name", "Father Name", "Unit", "Godown", "Month", "Pant", "Shirt"],
    ["R001", "Review Regression", "Father", "PETRONET", "Store", "Jan 2026", 2, 0],
    ["R001", "Review Regression", "Father", "L&T", "Store", "Jan 2026", 2, 0],
    ["R001", "Review Regression", "Father", "AMNS-PORT", "Store", "Jan 2026", 2, 2],
    ["R001", "Review Regression", "Father", "RAYZON", "Store", "Jan 2026", 2, 0],
    ["R002", "Three Unit Test", "Father", "TEST-3", "Store", "Jan 2026", 3, 0],
  ];
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(rows), "DISTRIBUTION");
  XLSX.writeFile(workbook, workbookPath);

  let db = await createDatabase(tempDir);
  importWorkbook(workbookPath, db);
  const units = ["PETRONET", "L&T", "AMNS-PORT", "RAYZON"];
  for (const unit of units) {
    db.upsertPolicy({ unit, item_name: "Pant", yearly_entitlement: 0, item_cost: 100 });
    db.upsertPolicy({ unit, item_name: "Shirt", yearly_entitlement: 0, item_cost: 50 });
  }
  db.upsertPolicy({ unit: "TEST-3", item_name: "Pant", yearly_entitlement: 0, item_cost: 100 });
  db.recalculateReviews();

  const statusFixtures = [
    { code: "S001", unit: "STATUS-D4", issued: 4, allocation: { deduct: 4, waive: 0, hold: 0 }, expected: "Completed" },
    { code: "S002", unit: "STATUS-W4", issued: 4, allocation: { deduct: 0, waive: 4, hold: 0 }, expected: "Completed" },
    { code: "S003", unit: "STATUS-MIX", issued: 4, allocation: { deduct: 2, waive: 2, hold: 0 }, expected: "Completed" },
    { code: "S004", unit: "STATUS-HOLD", issued: 6, allocation: { deduct: 3, waive: 2, hold: 1 }, expected: "Held" },
    { code: "S005", unit: "STATUS-PEND", issued: 4, allocation: null, expected: "Pending" },
    { code: "S006", unit: "STATUS-HOLD-PARTIAL", issued: 4, allocation: { deduct: 1, waive: 1, hold: 2 }, expected: "Held" },
    { code: "S007", unit: "STATUS-SESSION-A", issued: 2, allocation: null, expected: "Pending" },
    { code: "S007", unit: "STATUS-SESSION-B", issued: 2, allocation: null, expected: "Pending" },
  ];
  const statusRows = [["Emp Code", "Name", "Father Name", "Unit", "Godown", "Month", "Pant"]];
  for (const fixture of statusFixtures) statusRows.push([fixture.code, fixture.code, "Father", fixture.unit, "Store", "Jan 2026", fixture.issued]);
  const statusWorkbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(statusWorkbook, XLSX.utils.aoa_to_sheet(statusRows), "DISTRIBUTION");
  const statusWorkbookPath = path.join(tempDir, "status-fixtures.xlsx");
  XLSX.writeFile(statusWorkbook, statusWorkbookPath);
  importWorkbook(statusWorkbookPath, db);
  for (const fixture of statusFixtures) db.upsertPolicy({ unit: fixture.unit, item_name: "Pant", yearly_entitlement: 0, item_cost: 100 });
  db.recalculateReviews();
  for (const fixture of statusFixtures) {
    const review = db.getReviewQueueStage2(fixture.code).find((row) => row.item_name === "Pant");
    if (!review) throw new Error(`Missing status fixture ${fixture.code}.`);
    if (fixture.allocation) db.updateReview({ id: review.id, status: "Completed", approved_by: "Regression Test", reason: "Status rule", quantity_decisions: fixture.allocation });
  }
  for (const fixture of statusFixtures) {
    const review = db.getState().reviews.find((row) => row.employee_code === fixture.code && row.item_name === "Pant");
    if (review?.status !== fixture.expected) throw new Error(`${fixture.code} expected ${fixture.expected} status; got ${review?.status}.`);
  }
  const partialHold = db.getReviewQueueStage2("S006").find((row) => row.item_name === "Pant");
  const partialHoldChild = partialHold.child_items.find((child) => Number(child.held_quantity) > 0);
  const heldPageRow = db.getHeldRecords().find((row) => row.employee_code === "S006" && row.item_name === "Pant");
  if (!heldPageRow || Number(heldPageRow.original_excess_qty) !== 4 || Number(heldPageRow.deducted_quantity) !== 1 || Number(heldPageRow.waived_quantity) !== 1 || Number(heldPageRow.held_quantity) !== 2) throw new Error("Held Records query did not return the persisted allocation amounts.");
  db.resolveHeldQuantity({ reviewId: partialHold.id, itemId: partialHoldChild.id, quantity: 1, decision: "Deduct", reason: "Partial hold release", resolvedBy: "Regression Test" });
  let afterPartialHold = db.getReviewQueueStage2("S006").find((row) => row.id === partialHold.id);
  if (Number(afterPartialHold.sum_deduct) !== 2 || Number(afterPartialHold.sum_waive) !== 1 || Number(afterPartialHold.sum_hold) !== 1 || afterPartialHold.status !== "Held") throw new Error("Partial hold release changed unrelated quantities or lost remaining hold status.");
  const deductionAfterRelease = db.getState().salaryDeductions.find((row) => row.review_id === partialHold.id && row.is_active);
  if (!deductionAfterRelease || Number(deductionAfterRelease.amount) !== 200) throw new Error("Hold release did not recalculate recovery amount from total deducted quantity.");
  let duplicateHoldReleaseRejected = false;
  try { db.resolveHeldQuantity({ reviewId: partialHold.id, itemId: partialHoldChild.id, quantity: 2, decision: "Waive", reason: "Over held amount", resolvedBy: "Regression Test" }); }
  catch (error) { duplicateHoldReleaseRejected = /Only 1 held units remain/.test(error.message); }
  if (!duplicateHoldReleaseRejected) throw new Error("Hold resolution allowed processing more than the remaining held quantity.");
  const siblingUnitHeld = db.getHeldRecords().filter((row) => row.employee_code === "S006" && row.unit === "STATUS-HOLD-PARTIAL");
  if (siblingUnitHeld.length !== 1 || Number(siblingUnitHeld[0].held_quantity) !== 1) throw new Error("Resolving one held transaction unexpectedly changed a sibling unit record.");
  const partialHoldHistory = db.getState().correctionHistory.filter((row) => row.employee_code === "S006" && row.old_decision === "Hold");
  if (!partialHoldHistory.some((row) => Number(row.old_quantity) === 1 && row.new_decision === "Deduct")) throw new Error("Hold resolution did not preserve quantity-level correction history.");
  db.resolveHeldQuantity({ reviewId: partialHold.id, itemId: partialHoldChild.id, quantity: 1, decision: "Waive", reason: "Finish hold release", resolvedBy: "Regression Test" });
  afterPartialHold = db.getReviewQueueStage2("S006").find((row) => row.id === partialHold.id);
  if (Number(afterPartialHold.sum_hold) !== 0 || afterPartialHold.status !== "Completed") throw new Error("Fully resolved hold did not transition to Completed.");
  if (db.getHeldRecords().some((row) => row.review_id === partialHold.id && row.item_id === partialHoldChild.id)) throw new Error("A fully resolved hold remains in the active Held Records query.");
  if (!db.getState().correctionHistory.some((row) => row.employee_code === "S006" && row.old_decision === "Hold")) throw new Error("Resolved held record is missing from correction history.");
  const pendingStage1 = db.getReviewQueueStage1();
  if (pendingStage1.some((row) => ["S001", "S002", "S003", "S004"].includes(row.employee_code))) throw new Error("Fully allocated completed/held cases remain in the active Review Queue.");
  if (!pendingStage1.some((row) => row.employee_code === "S005")) throw new Error("A genuinely pending review was removed from the active Review Queue.");
  let sessionReviews = db.getReviewQueueStage2("S007").filter((row) => row.item_name === "Pant");
  if (sessionReviews.length !== 2) throw new Error("Review session fixture did not produce multiple pending items.");
  for (const sessionReview of sessionReviews) {
    db.updateReview({ id: sessionReview.id, status: "Completed", approved_by: "Regression Test", reason: "Session decision", quantity_decisions: { deduct: 2, waive: 0, hold: 0 } });
    const persisted = db.getReviewQueueStage2("S007").find((row) => row.id === sessionReview.id);
    if (Number(persisted.sum_deduct) !== 2 || Number(persisted.remaining_qty) !== 0) throw new Error("A review session decision did not persist exactly once.");
  }
  sessionReviews = db.getReviewQueueStage2("S007").filter((row) => row.item_name === "Pant");
  if (sessionReviews.some((row) => Number(row.remaining_qty) > 0) || db.getReviewQueueStage1().some((row) => row.employee_code === "S007")) throw new Error("Completed review session did not reduce the employee pending count.");
  const legacyWhistle = db.getReviewQueueStage2("S001").find((row) => row.item_name === "Pant");
  db.updateReview({ id: legacyWhistle.id, status: "Pending" });
  const reopenedWhistle = db.getReviewQueueStage2("S001").find((row) => row.item_name === "Pant");
  if (!reopenedWhistle || Number(reopenedWhistle.remaining_qty) !== 4 || Number(reopenedWhistle.sum_deduct) !== 0) throw new Error("Reverting to pending did not reopen quantity without erasing historical records.");
  db.updateReview({ id: reopenedWhistle.id, status: "Completed", approved_by: "Regression Test", reason: "Restore test allocation", quantity_decisions: { deduct: 4, waive: 0, hold: 0 } });
  const persistedSessionAfterRestart = db.getReviewQueueStage2("S007").filter((row) => row.item_name === "Pant");
  if (persistedSessionAfterRestart.length !== 2 || persistedSessionAfterRestart.some((row) => Number(row.sum_deduct) !== 2 || Number(row.remaining_qty) !== 0)) throw new Error("Review session decisions did not persist after reopening the database.");

  let reviews = db.getReviewQueueStage2("R001").filter((row) => row.item_name === "Pant");
  const unitQty = new Map(reviews.map((row) => [row.unit, [Number(row.issued_qty), Number(row.allowed_qty), Number(row.excess_qty)]]));
  for (const unit of units) {
    const values = unitQty.get(unit);
    if (!values || values[0] !== 2 || values[1] !== 0 || values[2] !== 2) throw new Error(`Incorrect review values for ${unit}.`);
  }
  const selected = reviews.find((row) => row.unit === "AMNS-PORT");
  if (!selected || !selected.child_items?.length) throw new Error("AMNS-PORT review did not retain transaction child IDs.");
  const anotherReview = reviews.find((row) => row.unit === "PETRONET");
  let rejectedForeignChild = false;
  try {
    db.updateReview({
      id: selected.id,
      status: "Completed",
      approved_by: "Regression Test",
      reason: "Cross-review guard",
      issue_decisions: [{ id: anotherReview.child_items[0].id, decision: "Deduct", quantity: 1 }],
    });
  } catch (error) {
    rejectedForeignChild = /does not belong/.test(error.message);
  }
  if (!rejectedForeignChild) throw new Error("Backend accepted a transaction child belonging to another review.");
  const invalidReview = db.getReviewQueueStage2("R002").find((row) => row.item_name === "Pant");
  for (const invalidAllocation of [{ deduct: 1, waive: 0, hold: 1 }, { deduct: 4, waive: 0, hold: 0 }, { deduct: -1, waive: 4, hold: 0 }, { deduct: 1.5, waive: 1, hold: 0.5 }]) {
    let rejected = false;
    let message = "";
    try {
      db.updateReview({ id: invalidReview.id, status: "Completed", approved_by: "Regression Test", reason: "Validation test", quantity_decisions: invalidAllocation });
    } catch (error) { rejected = true; message = error.message; }
    if (!rejected) throw new Error("Backend accepted incomplete or excessive decision quantities.");
    if (invalidAllocation.deduct === 1 && invalidAllocation.hold === 1 && !message.includes("1 excess quantity remains undecided")) throw new Error("Under-allocation did not explain the undecided quantity.");
  }
  db.updateReview({ id: invalidReview.id, status: "Completed", approved_by: "Regression Test", reason: "Three way allocation", quantity_decisions: { deduct: 1, waive: 1, hold: 1 } });
  const selectedDecisionCountBefore = db.getState().salaryDeductions.filter((row) => row.review_id === selected.id).length;
  db.updateReview({
    id: selected.id,
    status: "Completed",
    approved_by: "Regression Test",
    reason: "Regression decision",
    quantity_decisions: { deduct: 1, waive: 1, hold: 0 },
  });

  let state = db.getState();
  const amnsRows = state.reviews.filter((row) => row.employee_code === "R001" && row.item_name === "Pant" && row.unit === "AMNS-PORT");
  if (amnsRows.length !== 1 || amnsRows[0].status !== "Completed") throw new Error("Selected AMNS-PORT mixed review was not completed.");
  for (const unit of ["PETRONET", "L&T", "RAYZON"]) {
    if (!state.reviews.some((row) => row.employee_code === "R001" && row.item_name === "Pant" && row.unit === unit && row.status === "Pending")) {
      throw new Error(`Saving AMNS-PORT unexpectedly affected ${unit}.`);
    }
  }
  const persistedDeduction = state.salaryDeductions.find((row) => row.review_id === selected.id);
  if (!persistedDeduction || Number(persistedDeduction.amount) !== 100) throw new Error("Recovery amount did not use only the deducted quantity at the stored item price.");
  if (!state.waiveRecords.some((row) => row.review_id === selected.id && row.is_active && Number(row.quantity) === 1)) throw new Error("Waived quantity was not recorded accurately.");
  const reopenedStage2 = db.getReviewQueueStage2("R001").find((row) => row.id === selected.id);
  if (Number(reopenedStage2.sum_deduct) !== 1 || Number(reopenedStage2.sum_waive) !== 1 || Number(reopenedStage2.remaining_qty) !== 0) throw new Error("Reopening the review did not show saved allocation totals and remaining quantity.");
  if (state.salaryDeductions.filter((row) => row.review_id === selected.id).length !== selectedDecisionCountBefore + 1) throw new Error("Duplicate decision save generated duplicate payroll deductions.");
  let duplicateRejected = false;
  try { db.updateReview({ id: selected.id, status: "Completed", approved_by: "Regression Test", reason: "Duplicate", quantity_decisions: { deduct: 1, waive: 1, hold: 0 } }); }
  catch (error) { duplicateRejected = true; }
  if (!duplicateRejected) throw new Error("Backend allowed the same completed decision to be saved twice.");
  if (!state.livePayrollRecords.some((row) => row.record_type === "Deduct" && row.employee_code === "R001" && Number(row.quantity) === 1)) throw new Error("Payroll Register did not show only the deducted quantity.");
  const payrollAnalytics = db.getPayrollSummaryAnalytics({}).rows.find((row) => row.employee_code === "R001");
  if (!payrollAnalytics || Number(payrollAnalytics.total_amount) !== 100) throw new Error("Payroll Deduction Summary did not reflect the deducted quantity only.");
  db.getMonthlyAnalytics({});
  if (!state.correctionCentreRecords.some((row) => row.allocation_decision === "Waive" && row.employee_code === "R001" && Number(row.quantity) === 1)) throw new Error("Correction Centre did not retain the waived allocation.");
  const holdAllocation = state.correctionCentreRecords.find((row) => row.employee_code === "R002" && row.allocation_decision === "Hold");
  if (!holdAllocation) throw new Error("Three-way allocation did not appear in the Correction Centre.");
  state = db.correctDecision({ itemId: holdAllocation.id, newDecision: "Waive", reason: "Regression correction", correctedBy: "Regression Test" });
  state = db.getState();
  if (!state.correctionHistory.some((row) => row.old_decision === "Hold" && row.new_decision === "Waive")) throw new Error("Correction History did not preserve the allocation correction.");

  const shirtBefore = state.reviews.find((row) => row.employee_code === "R001" && row.item_name === "Shirt" && row.unit === "AMNS-PORT");
  if (!shirtBefore || Number(shirtBefore.excess_qty) !== 2) throw new Error("Shirt fixture did not start with expected excess.");
  db.upsertPolicy({ unit: "AMNS-PORT", item_name: "Shirt", yearly_entitlement: 1, item_cost: 50 });
  db.recalculateReviews();
  const shirtAfter = db.getState().reviews.find((row) => row.employee_code === "R001" && row.item_name === "Shirt" && row.unit === "AMNS-PORT");
  if (!shirtAfter || Number(shirtAfter.allowed_qty) !== 1 || Number(shirtAfter.excess_qty) !== 1) throw new Error("Recalculation did not use updated AMNS-PORT Shirt entitlement.");

  const countBeforeSecondRecalc = db.getState().reviews.length;
  db.recalculateReviews();
  state = db.getState();
  if (state.reviews.length !== countBeforeSecondRecalc) throw new Error("Repeated recalculation created duplicate review records.");
  if (state.reviews.find((row) => row.id === selected.id)?.status !== "Completed") throw new Error("Recalculation did not preserve the saved review decision.");

  db = await createDatabase(tempDir);
  state = db.getState();
  const persistedHoldResolution = db.getReviewQueueStage2("S006").find((row) => row.id === partialHold.id);
  if (!persistedHoldResolution || Number(persistedHoldResolution.sum_hold) !== 0 || Number(persistedHoldResolution.sum_deduct) !== 2 || Number(persistedHoldResolution.sum_waive) !== 2 || persistedHoldResolution.status !== "Completed") throw new Error("Hold resolution did not persist after reopening the database.");
  if (state.reviews.find((row) => row.id === selected.id)?.status !== "Completed") throw new Error("Saved decision did not persist after reopening the database.");
  if (state.reviewDecisions.filter((row) => row.review_id === selected.id && row.is_active).length !== 1) throw new Error("Review decision was duplicated.");

  const legacyDir = fs.mkdtempSync(path.join(os.tmpdir(), "uniform-review-legacy-migration-"));
  const SQL = await initSqlJs();
  const legacyDb = new SQL.Database();
  legacyDb.run(`CREATE TABLE review_queue (id INTEGER PRIMARY KEY, employee_code TEXT, employee_name TEXT, unit TEXT, item_name TEXT, issue_month INTEGER, issue_year INTEGER, issue_period_label TEXT, issued_qty REAL, allowed_qty REAL, excess_qty REAL, item_cost REAL, estimated_amount REAL, reason TEXT, status TEXT, remarks TEXT, created_at TEXT, decided_at TEXT)`);
  legacyDb.run(`CREATE TABLE review_queue_items (id INTEGER PRIMARY KEY, review_queue_id INTEGER, uniform_issue_id INTEGER, employee_code TEXT, item_name TEXT, issue_date TEXT, quantity REAL, decision TEXT, remarks TEXT, reviewed_by TEXT, reviewed_at TEXT, created_at TEXT, is_active INTEGER, is_corrected INTEGER)`);
  legacyDb.run(`CREATE TABLE corrections (id INTEGER PRIMARY KEY, review_queue_item_id INTEGER, old_decision TEXT, new_decision TEXT, reason TEXT, corrected_by TEXT, created_at TEXT)`);
  legacyDb.run(`INSERT INTO review_queue VALUES (1, 'L001', 'Legacy Employee', 'Legacy Unit', 'Pant', 1, 2026, 'Jan 2026', 2, 0, 2, 100, 200, 'Legacy excess', 'Deducted', '', '2026-01-01', '2026-01-02')`);
  legacyDb.run(`INSERT INTO review_queue_items VALUES (1, 1, 10, 'L001', 'Pant', '2026-01-01', 2, 'Deduct', '', 'Legacy Manager', '2026-01-02', '2026-01-01', 1, 0)`);
  fs.writeFileSync(path.join(legacyDir, "uniform-manager.sqlite"), Buffer.from(legacyDb.export()));
  const migratedDb = await createDatabase(legacyDir);
  const migrated = migratedDb.getReviewQueueStage2("L001").find((row) => row.id === 1);
  if (!migrated || Number(migrated.sum_deduct) !== 2 || Number(migrated.child_items[0].deducted_quantity) !== 2) throw new Error("Backward-compatible migration did not preserve and backfill a historical deduction.");
  console.log("Review regression tests passed (validation, mixed allocations, scoped units, payroll/waiver/correction reporting, recalculation, persistence, legacy migration).");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
