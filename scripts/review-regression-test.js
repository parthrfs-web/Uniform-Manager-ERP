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
  db.upsertAnnualPolicy({ item_name: "Pant", financial_year: 2025, allowed_quantity: 0 });
  db.upsertAnnualPolicy({ item_name: "Shirt", financial_year: 2025, allowed_quantity: 0 });
  db.upsertAnnualPolicy({ item_name: "Pant", financial_year: 2026, allowed_quantity: 0 });
  db.upsertAnnualPolicy({ item_name: "Shirt", financial_year: 2026, allowed_quantity: 0 });
  db.recalculateReviews();
  const entitlementOptions = db.getState({ distributionLimit: 1000 }).entitlementOptions;
  if (!entitlementOptions.units.includes("PETRONET") || !entitlementOptions.units.includes("L&T")) throw new Error("Entitlement unit options omitted persisted distribution units.");
  if (!entitlementOptions.annualFinancialYears.includes(2025) || !entitlementOptions.annualFinancialYears.includes(2026)) throw new Error("Annual financial-year options omitted policy years supported by persisted records.");
  const optionsDb = await createDatabase(fs.mkdtempSync(path.join(os.tmpdir(), "uniform-entitlement-options-")));
  optionsDb.upsertItem({ item_code: "PICKER-COAT", item_name: "Picker Coat", category: "Uniform", size: "M", cost: 75 });
  optionsDb.upsertPolicy({ unit: "PICKER-UNIT", item_name: "Picker Coat", yearly_entitlement: 1, item_cost: 75 });
  optionsDb.upsertAnnualPolicy({ item_name: "Picker Coat", financial_year: 2024, allowed_quantity: 2 });
  const masterOptions = optionsDb.getState().entitlementOptions;
  if (!masterOptions.items.includes("Picker Coat") || masterOptions.items.filter((item) => item.toLowerCase() === "picker coat").length !== 1) throw new Error("Entitlement item options did not provide distinct real item-master records.");
  if (!masterOptions.units.includes("PICKER-UNIT") || !masterOptions.annualFinancialYears.includes(2024)) throw new Error("Entitlement options omitted persisted unit or annual-policy financial-year values.");

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

  const annualBook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(annualBook, XLSX.utils.aoa_to_sheet([
    ["Emp Code", "Name", "Father Name", "Unit", "Godown", "Month", "Annual Shirt", "Unconfigured Pant"],
    ["A100", "Annual Allocation", "Father", "UNIT-A", "Store", "Apr 2025", 1, 1],
    ["A100", "Annual Allocation", "Father", "UNIT-B", "Store", "May 2025", 2, 0],
    ["A100", "Annual Allocation", "Father", "UNIT-C", "Store", "Jun 2025", 3, 0],
    ["A200", "Separate Employee", "Father", "UNIT-A", "Store", "Apr 2025", 2, 0],
  ]), "DISTRIBUTION");
  const annualBookPath = path.join(tempDir, "annual-allocation-fixture.xlsx");
  XLSX.writeFile(annualBook, annualBookPath);
  importWorkbook(annualBookPath, db);
  db.upsertItem({ item_code: "UNCONFIG-PANT", item_name: "Unconfigured Pant", category: "Uniform", size: "Standard", cost: 0 });
  for (const unit of ["UNIT-A", "UNIT-B", "UNIT-C"]) db.upsertPolicy({ unit, item_name: "Annual Shirt", yearly_entitlement: 0, item_cost: 100 });
  db.upsertAnnualPolicy({ item_name: "Annual Shirt", financial_year: 2025, allowed_quantity: 2 });
  db.recalculateReviews();
  const annualIssues = db.getState({ distributionLimit: 1000 }).uniformIssues.filter((row) => row.employee_code === "A100" && row.item_name === "Annual Shirt").sort((a, b) => a.id - b.id);
  const annualAllocations = annualIssues.map((row) => [Number(row.entitlement_consumed), Number(row.excess_generated)]);
  if (JSON.stringify(annualAllocations) !== JSON.stringify([[1, 0], [1, 1], [0, 3]])) throw new Error(`Annual entitlement did not allocate oldest-first across units: ${JSON.stringify(annualAllocations)}.`);
  const annualPending = db.getState().reviews.filter((row) => row.employee_code === "A100" && row.item_name === "Annual Shirt" && Number(row.pending_qty) > 0);
  if (annualPending.length !== 2 || annualPending.reduce((sum, row) => sum + Number(row.pending_qty), 0) !== 4) throw new Error(`Global annual allowance did not leave only the excess quantity pending across unit records: ${JSON.stringify(annualPending.map(({ unit, pending_qty, status }) => ({ unit, pending_qty, status })))}`);
  const unconfiguredIssue = db.getState({ distributionLimit: 1000 }).uniformIssues.find((row) => row.employee_code === "A100" && row.item_name === "Unconfigured Pant");
  if (!unconfiguredIssue || Number(unconfiguredIssue.entitlement_consumed) !== 0 || Number(unconfiguredIssue.excess_generated) !== 1) throw new Error("Missing annual policy did not classify the issue as excess.");
  const missingAnnualPolicy = db.getState().annualPolicies.find((row) => row.item_name === "Unconfigured Pant" && Number(row.financial_year) === 2025 && Number(row.allowed_quantity) === 0);
  const annualSuggestionOptions = db.getState().entitlementOptions;
  if (!missingAnnualPolicy || !annualSuggestionOptions.items.includes(missingAnnualPolicy.item_name) || !annualSuggestionOptions.annualFinancialYears.includes(Number(missingAnnualPolicy.financial_year))) throw new Error("Imported item was not automatically provisioned as a selectable annual policy for its financial year.");
  const annualHistory = db.getReviewQueueStage2("A100").find((row) => row.item_name === "Annual Shirt").history_items;
  if (!annualHistory.some((row) => String(row.remarks).includes("Within Entitlement")) || !annualHistory.some((row) => String(row.remarks).includes("Excess"))) throw new Error("Annual entitlement classifications were not exposed in review history.");
  const separateEmployeeIssue = db.getState({ distributionLimit: 1000 }).uniformIssues.find((row) => row.employee_code === "A200" && row.item_name === "Annual Shirt");
  if (!separateEmployeeIssue || Number(separateEmployeeIssue.entitlement_consumed) !== 2 || Number(separateEmployeeIssue.excess_generated) !== 0) throw new Error("Annual item limit was not independently applied per employee.");
  if (db.getState().reviewQueueCalculationMode !== "item_annual") throw new Error("Fresh database did not default to Item-wise Annual mode.");
  db.upsertPolicy({ unit: "UNIT-A", item_name: "Annual Shirt", yearly_entitlement: 2, item_cost: 100 });
  db.upsertPolicy({ unit: "UNIT-B", item_name: "Annual Shirt", yearly_entitlement: 0, item_cost: 100 });
  db.upsertPolicy({ unit: "UNIT-C", item_name: "Annual Shirt", yearly_entitlement: 0, item_cost: 100 });
  const annualUnitBReview = db.getState().reviews.find((row) => row.employee_code === "A100" && row.unit === "UNIT-B" && row.item_name === "Annual Shirt");
  if (!annualUnitBReview) throw new Error("Annual mode did not create the expected unit-specific pending review.");
  db.updateReview({ id: annualUnitBReview.id, status: "Completed", approved_by: "Mode Test", reason: "Mode change preservation", quantity_decisions: { deduct: 1, waive: 0, hold: 0 } });
  db.setReviewQueueCalculationMode("unit_wise");
  db.recalculateReviews();
  let modeState = db.getState();
  let unitPending = modeState.reviews.filter((row) => row.employee_code === "A100" && row.item_name === "Annual Shirt").reduce((sum, row) => sum + Number(row.pending_qty || 0), 0);
  if (modeState.reviewQueueCalculationMode !== "unit_wise" || unitPending !== 4) throw new Error(`Unit-wise mode did not use its existing per-unit allowance semantics (pending ${unitPending}).`);
  if (!modeState.entitlementClassificationHistory.some((row) => row.employee_code === "A100" && row.unit === "UNIT-B" && row.calculation_mode === "item_annual" && Number(row.entitlement_consumed) === 1 && Number(row.excess_generated) === 1)) throw new Error("Switching modes did not preserve the previous annual classification history.");
  const previousModeHistory = db.getReviewQueueStage2("A100").find((row) => row.item_name === "Annual Shirt")?.history_items || [];
  if (!previousModeHistory.some((row) => String(row.remarks).includes("Previous Item-wise Annual"))) throw new Error("Previous mode classifications were not exposed in review history.");
  const retainedDeduction = modeState.salaryDeductions.find((row) => row.review_id === annualUnitBReview.id && row.is_active);
  if (!retainedDeduction || Number(retainedDeduction.amount) !== 100) throw new Error("Switching modes changed or duplicated a finalized payroll deduction.");
  db.setReviewQueueCalculationMode("combined");
  db.recalculateReviews();
  modeState = db.getState();
  const combinedRows = modeState.reviews.filter((row) => row.employee_code === "A100" && row.item_name === "Annual Shirt");
  const combinedPending = combinedRows.reduce((sum, row) => sum + Number(row.pending_qty || 0), 0);
  if (modeState.reviewQueueCalculationMode !== "combined" || combinedPending !== 4 || combinedRows.filter((row) => Number(row.pending_qty || 0) > 0).length !== 2) throw new Error("Combined mode added overlapping annual/unit excess or generated duplicate unit reviews.");
  db.setReviewQueueCalculationMode("item_annual");
  db.recalculateReviews();
  modeState = db.getState();
  const annualAfterSwitch = modeState.reviews.filter((row) => row.employee_code === "A100" && row.item_name === "Annual Shirt").reduce((sum, row) => sum + Number(row.pending_qty || 0), 0);
  if (annualAfterSwitch !== 3 || modeState.salaryDeductions.filter((row) => row.review_id === annualUnitBReview.id && row.is_active).length !== 1) throw new Error("Switching back to annual mode did not preserve finalized decisions without duplicate deductions.");
  db = await createDatabase(tempDir);
  const persistedAnnualState = db.getState({ distributionLimit: 1000 });
  const persistedAnnualIssue = persistedAnnualState.uniformIssues.find((row) => row.employee_code === "A100" && row.item_name === "Annual Shirt" && row.unit === "UNIT-B");
  if (!persistedAnnualState.annualPolicies.some((policy) => policy.item_name === "Annual Shirt" && Number(policy.financial_year) === 2025 && Number(policy.allowed_quantity) === 2) || !persistedAnnualIssue || Number(persistedAnnualIssue.excess_generated) !== 1 || persistedAnnualState.reviewQueueCalculationMode !== "item_annual") throw new Error("Annual policy allocation or selected calculation mode did not persist after reopening the database.");

  let reviews = db.getReviewQueueStage2("R001").filter((row) => row.item_name === "Pant");
  const unitQty = new Map(reviews.map((row) => [row.unit, [Number(row.issued_qty), Number(row.allowed_qty), Number(row.excess_qty)]]));
  for (const unit of units) {
    const values = unitQty.get(unit);
    if (!values || values[0] !== 8 || values[1] !== 0 || values[2] !== 2) throw new Error(`Incorrect annual-scope review values for ${unit}.`);
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
  db.upsertAnnualPolicy({ item_name: "Shirt", financial_year: 2025, allowed_quantity: 1 });
  db.recalculateReviews();
  const shirtAfter = db.getState().reviews.find((row) => row.employee_code === "R001" && row.item_name === "Shirt" && row.unit === "AMNS-PORT");
  if (!shirtAfter || Number(shirtAfter.allowed_qty) !== 1 || Number(shirtAfter.excess_qty) !== 1) throw new Error(`Recalculation did not use updated item-wide annual Shirt entitlement: ${JSON.stringify(shirtAfter && { allowed_qty: shirtAfter.allowed_qty, excess_qty: shirtAfter.excess_qty, pending_qty: shirtAfter.pending_qty, status: shirtAfter.status })}.`);

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

  // Recalculation must preserve a finalized child beside another still-pending child.
  const splitBook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(splitBook, XLSX.utils.aoa_to_sheet([
    ["Emp Code", "Name", "Father Name", "Unit", "Godown", "Month", "Pant"],
    ["R010", "Mixed Recalculation", "Father", "RECALC-MIX", "Store", "Jan 2026", 1],
    ["R010", "Mixed Recalculation", "Father", "RECALC-MIX", "Store", "Feb 2026", 1],
  ]), "DISTRIBUTION");
  const splitPath = path.join(tempDir, "mixed-recalculation-fixture.xlsx");
  XLSX.writeFile(splitBook, splitPath);
  importWorkbook(splitPath, db);
  db.upsertPolicy({ unit: "RECALC-MIX", item_name: "Pant", yearly_entitlement: 0, item_cost: 100 });
  db.recalculateReviews();
  let mixedParent = db.getReviewQueueStage2("R010").find((row) => row.unit === "RECALC-MIX" && row.item_name === "Pant");
  if (!mixedParent || mixedParent.child_items.length !== 2) throw new Error("Mixed recalculation fixture did not group both distribution records.");
  const [finalizedChild, pendingChild] = mixedParent.child_items;
  db.updateReview({
    id: mixedParent.id,
    status: "Completed",
    approved_by: "Regression Test",
    reason: "Partial parent decision",
    issue_decisions: [
      { id: finalizedChild.id, decision: "Deduct" },
      { id: pendingChild.id, decision: "Pending" },
    ],
  });
  db.recalculateReviews();
  mixedParent = db.getReviewQueueStage2("R010").find((row) => row.id === mixedParent.id);
  const mixedActive = mixedParent.child_items.filter((row) => Number(row.is_active ?? 1) === 1);
  const preservedFinalized = mixedActive.find((row) => Number(row.id) === Number(finalizedChild.id));
  const regeneratedPending = mixedActive.filter((row) => row.decision === "Pending");
  if (!preservedFinalized || Number(preservedFinalized.deducted_quantity) !== 1 || regeneratedPending.length !== 1 || Number(regeneratedPending[0].quantity) !== 1) throw new Error(`Recalculation did not preserve finalized quantities while replacing only the undecided remainder: ${JSON.stringify(mixedParent.child_items.map((row) => ({ id: row.id, quantity: row.quantity, decision: row.decision, deduct: row.deducted_quantity })))}`);
  if (mixedParent.status !== "Pending" || Number(mixedParent.remaining_qty) !== 1) throw new Error("Mixed parent status or remaining quantity changed after recalculation.");
  if (db.getState().salaryDeductions.filter((row) => row.review_id === mixedParent.id && row.is_active).length !== 1) throw new Error("Recalculation duplicated or removed the finalized payroll deduction.");
  db.recalculateReviews();
  mixedParent = db.getReviewQueueStage2("R010").find((row) => row.id === mixedParent.id);
  if (mixedParent.child_items.filter((row) => row.decision === "Pending").length !== 1) throw new Error("Repeated recalculation duplicated the active pending quantity.");

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

  const monthlyDir = fs.mkdtempSync(path.join(os.tmpdir(), "uniform-monthly-hold-regression-"));
  const monthlyBook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(monthlyBook, XLSX.utils.aoa_to_sheet([
    ["Emp Code", "Name", "Father Name", "Unit", "Godown", "Month", "Pant"],
    ["H001", "Monthly Hold", "Father", "HOLD-EARLY", "Store", "Jan 2026", 1],
    ["H001", "Monthly Hold", "Father", "HOLD-DUE", "Store", "Jan 2026", 1],
  ]), "DISTRIBUTION");
  const monthlyPath = path.join(monthlyDir, "monthly-hold-fixture.xlsx");
  XLSX.writeFile(monthlyBook, monthlyPath);
  let monthlyDb = await createDatabase(monthlyDir);
  importWorkbook(monthlyPath, monthlyDb);
  for (const unit of ["HOLD-EARLY", "HOLD-DUE"]) monthlyDb.upsertPolicy({ unit, item_name: "Pant", yearly_entitlement: 0, item_cost: 125 });
  monthlyDb.recalculateReviews();
  const monthlyReviews = monthlyDb.getReviewQueueStage2("H001").filter((row) => ["HOLD-EARLY", "HOLD-DUE"].includes(row.unit));
  if (monthlyReviews.length !== 2) throw new Error("Monthly hold fixture did not create one review per unit.");
  for (const review of monthlyReviews) monthlyDb.updateReview({ id: review.id, status: "Completed", approved_by: "Regression Test", reason: "Initial temporary hold", quantity_decisions: { deduct: 0, waive: 0, hold: 1 } });
  let heldRows = monthlyDb.getHeldRecords().filter((row) => row.employee_code === "H001");
  if (heldRows.length !== 2 || heldRows.some((row) => Number(row.held_quantity) !== 1)) throw new Error("Initial hold records or outstanding held quantities were not persisted by unit.");
  const early = heldRows.find((row) => row.unit === "HOLD-EARLY");
  const dueLater = heldRows.find((row) => row.unit === "HOLD-DUE");
  monthlyDb.reviewHeldNow({ reviewId: early.review_id, itemId: early.item_id, quantity: 1, employeeCode: "H001", actor: "Regression Test" });
  let earlyReview = monthlyDb.getReviewQueueStage2("H001").find((row) => row.id === early.review_id);
  const earlyChild = earlyReview.child_items.find((item) => item.id === early.item_id);
  if (Number(earlyReview.sum_hold) !== 0 || Number(earlyReview.remaining_qty) !== 1 || !earlyChild.previously_held) throw new Error("Review Now did not reopen exactly the selected held quantity with its history intact.");
  monthlyDb.updateReview({ id: early.review_id, status: "Completed", approved_by: "Regression Test", reason: "Early hold review", issue_decisions: [{ id: early.item_id, quantity: 1, decision: "Pending", allocations: { Deduct: 0, Waive: 1, Hold: 0 } }] });
  earlyReview = monthlyDb.getReviewQueueStage2("H001").find((row) => row.id === early.review_id);
  if (Number(earlyReview.sum_waive) !== 1 || earlyReview.status !== "Completed" || monthlyDb.getHeldRecords().some((row) => row.item_id === early.item_id)) throw new Error("Early review did not resolve the selected held quantity as a waiver exactly once.");
  const otherUnitBefore = monthlyDb.getHeldRecords().find((row) => row.item_id === dueLater.item_id);
  if (!otherUnitBefore || Number(otherUnitBefore.held_quantity) !== 1) throw new Error("Review Now changed a different unit's held record.");
  monthlyDb.resolveHeldQuantity({ reviewId: dueLater.review_id, itemId: dueLater.item_id, quantity: 1, decision: "Hold", reason: "Renew temporary hold", resolvedBy: "Regression Test" });
  const renewed = monthlyDb.getHeldRecords().find((row) => row.item_id === dueLater.item_id);
  if (!renewed || Number(renewed.held_quantity) !== 1) throw new Error("Hold Again did not preserve the held quantity.");
  monthlyDb.save();
  const cycleDb = new SQL.Database(fs.readFileSync(monthlyDb.dbPath));
  cycleDb.run("UPDATE review_hold_events SET due_month = 1, due_year = 2000 WHERE event_type IN ('Held', 'Held Again')");
  fs.writeFileSync(monthlyDb.dbPath, Buffer.from(cycleDb.export()));
  monthlyDb = await createDatabase(monthlyDir);
  const dueReview = monthlyDb.getReviewQueueStage2("H001").find((row) => row.id === dueLater.review_id);
  const dueChild = dueReview.child_items.find((item) => item.id === dueLater.item_id);
  if (Number(dueReview.sum_hold) !== 0 || Number(dueReview.remaining_qty) !== 1 || !dueChild.previously_held || dueReview.status !== "Pending") throw new Error("Monthly cycle did not reopen the renewed held quantity for review.");
  if (monthlyDb.getHeldRecords().some((row) => row.item_id === dueLater.item_id)) throw new Error("A due held record remained on the active Held Records page after monthly release.");
  const issueCountBeforeRecalc = monthlyDb.getState().uniformIssues.filter((row) => row.employee_code === "H001").length;
  monthlyDb.recalculateReviews();
  monthlyDb.recalculateReviews();
  const dueAfterRepeatedRecalc = monthlyDb.getReviewQueueStage2("H001").find((row) => row.id === dueLater.review_id);
  if (Number(dueAfterRepeatedRecalc.remaining_qty) !== 1 || dueAfterRepeatedRecalc.child_items.filter((row) => row.previously_held).length !== 1) throw new Error("Repeated recalculation duplicated or lost the monthly re-review quantity.");
  if (monthlyDb.getState().uniformIssues.filter((row) => row.employee_code === "H001").length !== issueCountBeforeRecalc) throw new Error("Monthly hold re-review created a duplicate distribution record.");
  const restarted = await createDatabase(monthlyDir);
  const persistedMonthly = restarted.getReviewQueueStage2("H001").find((row) => row.id === dueLater.review_id);
  if (Number(persistedMonthly.remaining_qty) !== 1 || Number(persistedMonthly.sum_waive) !== 0 || persistedMonthly.status !== "Pending") throw new Error("Monthly re-review state did not persist after restart.");
  console.log("Review regression tests passed (validation, mixed allocations, scoped units, payroll/waiver/correction reporting, recalculation, persistence, legacy migration, early hold review, Hold Again, monthly reopen idempotence).");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
