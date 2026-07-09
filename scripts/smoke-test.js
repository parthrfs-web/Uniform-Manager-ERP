const fs = require("fs");
const os = require("os");
const path = require("path");
const XLSX = require("xlsx");
const { createDatabase } = require("../src/main/services/database");
const { importWorkbook, inspectWorkbook } = require("../src/main/services/smart-importer");

(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "uniform-manager-test-"));
  const db = await createDatabase(tmp);
  const workbookPath = path.join(tmp, "employee-master.xlsx");
  const workbook = XLSX.utils.book_new();
  const wrongSheet = XLSX.utils.aoa_to_sheet([["Random", "Sheet"], ["No", "Data"]]);
  const masterSheet = XLSX.utils.aoa_to_sheet([
    ["Employee Code", "Employee Name", "Father Name", "Unit", "Godown", "Mobile", "Shirt", "Pant"],
    ["E001", "Ravi Sharma", "Mohan Sharma", "Reliance", "Main Store", "9999999999", 1, 1],
    ["E002", "Amit Patel", "Suresh Patel", "AMNS", "Gate Store", "", 1, 0],
  ]);
  XLSX.utils.book_append_sheet(workbook, wrongSheet, "Notes");
  XLSX.utils.book_append_sheet(workbook, masterSheet, "July Staff Data");
  XLSX.writeFile(workbook, workbookPath);

  const summary = importWorkbook(workbookPath, db);
  const state = db.getState();

  if (summary.selectedSheet !== "July Staff Data") throw new Error("Smart sheet detection failed.");
  if (state.employees.length !== 2) throw new Error("Employee import failed.");
  if (state.items.length === 0) throw new Error("Default item master was not created.");
  if (!fs.existsSync(db.dbPath)) throw new Error("SQLite file was not persisted.");

  const genericHeaderPath = path.join(tmp, "generic-name-header.xlsx");
  const genericHeaderWorkbook = XLSX.utils.book_new();
  const genericHeaderSheet = XLSX.utils.aoa_to_sheet([
    ["Code", "Name", "Father Name", "Unit Name", "Godown Name", "Mobile", "Shirt"],
    ["G001", "Sandeep Singh", "Ramesh Singh", "Main Store", "Reliance", "9000000001", 1],
  ]);
  XLSX.utils.book_append_sheet(genericHeaderWorkbook, genericHeaderSheet, "Distribution");
  XLSX.writeFile(genericHeaderWorkbook, genericHeaderPath);
  importWorkbook(genericHeaderPath, db);
  const genericEmployee = db.getState().employees.find((row) => row.employee_code === "G001");
  if (!genericEmployee) throw new Error("Generic Name header employee was not imported.");
  if (genericEmployee.employee_name !== "Sandeep Singh") throw new Error("Generic Name header mapped employee name incorrectly.");
  if (genericEmployee.father_name !== "Ramesh Singh") throw new Error("Father Name was incorrectly mapped from employee name.");
  if (genericEmployee.unit !== "Main Store") throw new Error("Unit Name was not used as Unit / Company.");
  if (genericEmployee.godown !== "Reliance") throw new Error("Godown Name was not kept as Godown.");

  const policyWorkbookPath = path.join(tmp, "missing-policy-recalc.xlsx");
  const policyWorkbook = XLSX.utils.book_new();
  const policySheet = XLSX.utils.aoa_to_sheet([
    ["Employee Code", "Employee Name", "Father Name", "Unit", "Godown", "Month", "Helmet Red"],
    ["P100", "Policy Test", "Policy Father", "NEW TEST UNIT", "REAL GODOWN", "Apr 2025", 1],
  ]);
  XLSX.utils.book_append_sheet(policyWorkbook, policySheet, "Distribution");
  XLSX.writeFile(policyWorkbook, policyWorkbookPath);
  const policyDb = await createDatabase(fs.mkdtempSync(path.join(os.tmpdir(), "uniform-manager-policy-")));
  importWorkbook(policyWorkbookPath, policyDb);
  let policyState = policyDb.getState();
  const defaultPolicy = policyState.policies.find((row) => row.unit === "NEW TEST UNIT" && row.item_name === "Helmet Red");
  if (!defaultPolicy || Number(defaultPolicy.yearly_entitlement) !== 0) {
    throw new Error("Import did not auto-create default unit/item policy with allowed qty 0.");
  }
  if (policyState.missingPolicySuggestions.some((row) => row.unit === "NEW TEST UNIT" && row.item_name === "Helmet Red")) {
    throw new Error("Auto-created policy should prevent missing-policy suggestions for imported unit/item.");
  }
  if (!policyState.reviews.some((row) => row.unit === "NEW TEST UNIT" && row.item_name === "Helmet Red" && Number(row.allowed_qty) === 0)) {
    throw new Error("Auto-created default policy did not produce allowed-0 entitlement review.");
  }
  policyDb.upsertPolicy({
    unit: "NEW TEST UNIT",
    item_name: "Helmet Red",
    yearly_entitlement: 1,
    item_cost: 250,
  });
  const regeneratedReviews = policyDb.recalculateReviews();
  policyState = policyDb.getState();
  if (regeneratedReviews !== 0) {
    throw new Error("Policy recalculation generated reviews even though entitlement covered the issue.");
  }
  if (policyState.reviews.some((row) => row.status === "Pending" && row.unit === "NEW TEST UNIT" && row.item_name === "Helmet Red")) {
    throw new Error("Policy recalculation did not clear stale pending reviews after entitlement was raised.");
  }

  db.upsertItem({
    item_code: "TEST-CAP",
    item_name: "Test Cap",
    category: "Uniform",
    size: "Free",
    cost: 100,
    available_stock: 50,
    minimum_stock: 10,
    status: "Active",
  });
  let itemState = db.getState();
  const testItem = itemState.items.find((row) => row.item_code === "TEST-CAP");
  if (!testItem) throw new Error("Item create failed.");
  db.upsertItem({ ...testItem, available_stock: 25, minimum_stock: 20 });
  itemState = db.getState();
  if (Number(itemState.items.find((row) => row.item_code === "TEST-CAP").available_stock) !== 25) {
    throw new Error("Item edit failed.");
  }

  const largeWorkbookPath = path.join(tmp, "large-employee-master.xlsx");
  const largeWorkbook = XLSX.utils.book_new();
  const largeRows = [["Emp No", "Staff Name", "Father/Husband Name", "Unit Name", "Godown Name", "Contact Number", "Shirt"]];
  for (let index = 1; index <= 3000; index += 1) {
    largeRows.push([
      `L${String(index).padStart(5, "0")}`,
      `Employee ${index}`,
      `Father ${index}`,
      index % 2 ? "Reliance" : "AMNS",
      "Main Store",
      `90000${String(index).padStart(5, "0")}`,
      1,
    ]);
  }
  XLSX.utils.book_append_sheet(largeWorkbook, XLSX.utils.aoa_to_sheet(largeRows), "Unknown Sheet Name");
  XLSX.writeFile(largeWorkbook, largeWorkbookPath);
  const startedAt = Date.now();
  const largeSummary = importWorkbook(largeWorkbookPath, db);
  const elapsedMs = Date.now() - startedAt;
  if (largeSummary.inserted !== 3000) throw new Error("Large employee import failed.");
  if ((db.getState().uniformIssueMatrix.totalRows || 0) < 3000) {
    throw new Error("Distribution Register did not build from all imported rows.");
  }
  if (elapsedMs > 15000) throw new Error(`Large import was too slow: ${elapsedMs}ms`);
  db.resetOperationalData();

  const mixedWorkbookPath = path.join(tmp, "stock-distribution-report.xlsx");
  const mixedWorkbook = XLSX.utils.book_new();
  const deductionRows = [["Employee Code", "Employee Name", "Unit", "Deduction Amount", "Payroll Month"]];
  for (let index = 1; index <= 135; index += 1) {
    deductionRows.push([`D${index}`, `Deduction Employee ${index}`, "Reliance", 500, "July"]);
  }
  const distributionRows = [["Emp No", "Staff Name", "Father/Husband Name", "Unit Name", "Godown Name", "SR. NO. IN THEIR REG.", "MONTH", "Shirt", "Pant", "Shoes", "TOTAL QTY"]];
  for (let index = 1; index <= 200; index += 1) {
    distributionRows.push([
      `X${String(index).padStart(4, "0")}`,
      `Distribution Employee ${index}`,
      `Father ${index}`,
      "Reliance",
      "SATISH SHARMA",
      index % 10 === 0 ? 17 : 0,
      index % 5 === 0 ? 45931 : 2024,
      index === 1 ? 5 : 2,
      2,
      index % 3 ? 1 : 0,
      2024,
    ]);
  }
  XLSX.utils.book_append_sheet(mixedWorkbook, XLSX.utils.aoa_to_sheet(deductionRows), "DEDUCTION");
  XLSX.utils.book_append_sheet(mixedWorkbook, XLSX.utils.aoa_to_sheet(distributionRows), "DISTRIBUTION");
  XLSX.writeFile(mixedWorkbook, mixedWorkbookPath);
  const inspection = inspectWorkbook(mixedWorkbookPath);
  if (!inspection.candidates || !inspection.candidates.length) {
    throw new Error("Workbook inspection did not return sheet candidates.");
  }
  if (!inspection.candidates.some((candidate) => candidate.sheetName === "DISTRIBUTION" && candidate.canImport)) {
    throw new Error("Workbook inspection did not identify DISTRIBUTION as importable.");
  }
  if (inspection.candidates.some((candidate) => candidate.sheetName === "DEDUCTION" && candidate.canImport)) {
    throw new Error("Deduction sheet without uniform item columns was incorrectly marked importable.");
  }
  const summaryOnlyWorkbookPath = path.join(tmp, "previous-year-summary.xlsx");
  const summaryOnlyWorkbook = XLSX.utils.book_new();
  const summaryOnlyRows = [
    ["Employee Code", "Name", "Father Name", "Unit", "Godown", "Mobile", "Designation"],
    ["S001", "SANDEEP SINGH", "", "", "Summary of Prv Yr", "", ""],
    ["S002", "RAJESH KUMAR BIKRAM SINGH", "", "", "DEDUCTION OF PRV YR", "", ""],
  ];
  XLSX.utils.book_append_sheet(summaryOnlyWorkbook, XLSX.utils.aoa_to_sheet(summaryOnlyRows), "Summary of Prv Yr");
  XLSX.writeFile(summaryOnlyWorkbook, summaryOnlyWorkbookPath);
  const summaryInspection = inspectWorkbook(summaryOnlyWorkbookPath);
  if (summaryInspection.candidates.some((candidate) => candidate.canImport)) {
    throw new Error("Previous-year summary sheet was incorrectly marked importable.");
  }
  const mixedBadRowsPath = path.join(tmp, "distribution-with-summary-lines.xlsx");
  const mixedBadRowsWorkbook = XLSX.utils.book_new();
  const mixedBadRows = [
    ["Emp Code", "Name", "Father Name", "Unit", "Godown", "Pant", "Shirt"],
    ["8962", "SANDEEP SINGH", "BAL KRISHAN SINGH", "Summary of Prv Yr", "Summary of Prv Yr", 1, 1],
    ["245", "PARMESHWAR SHIVKUMAR BANJAREE", "Shiv Kumar Banjare", "MY YARD", "SATISH JI", 1, 1],
    ["5373", "RAJESH KUMAR BIKRAM SINGH", "BIKRAMA SINGH", "POWER", "SATISH JI", 1, 1],
    ["5394", "BHARAT KUMAR BHARTI", "MIKHU (BHIKHU)", "PLANT-B", "SATISH SHARMA", 1, 1],
  ];
  XLSX.utils.book_append_sheet(mixedBadRowsWorkbook, XLSX.utils.aoa_to_sheet(mixedBadRows), "DISTRIBUTION");
  XLSX.writeFile(mixedBadRowsWorkbook, mixedBadRowsPath);
  const mixedBadDb = await createDatabase(fs.mkdtempSync(path.join(os.tmpdir(), "uniform-manager-bad-row-test-")));
  importWorkbook(mixedBadRowsPath, mixedBadDb);
  const mixedBadState = mixedBadDb.getState();
  if (mixedBadState.employees.some((employee) => /summary|prv|deduction/i.test(`${employee.unit} ${employee.godown}`))) {
    throw new Error("Rows with previous-year summary/deduction unit values were imported as employees.");
  }
  if (mixedBadState.employees.some((employee) => employee.employee_code === "8962")) {
    throw new Error("Summary of Prv Yr employee row was not skipped.");
  }
  if (!mixedBadState.employees.some((employee) => employee.employee_code === "245" && employee.unit === "MY YARD" && employee.godown === "SATISH JI")) {
    throw new Error("Valid rows were not preserved while filtering summary rows.");
  }
  const periodWorkbookPath = path.join(tmp, "monthly-periods.xlsx");
  const periodWorkbook = XLSX.utils.book_new();
  const periodRows = [
    ["Emp Code", "Name", "Father Name", "Unit", "Godown", "Month", "Pant", "Shirt"],
    ["P001", "Period One", "Father One", "Reliance", "SATISH SHARMA", "Dec-2025", 1, 1],
    ["P001", "Period One", "Father One", "Reliance", "SATISH SHARMA", "Jan-2026", 1, 0],
    ["P002", "Fiscal Row", "Father Two", "Reliance", "SATISH SHARMA", "2024-2025", 1, 0],
    ["P003", "Period Excess", "Father Three", "Reliance", "SATISH SHARMA", "Dec-2025", 0, 5],
  ];
  XLSX.utils.book_append_sheet(periodWorkbook, XLSX.utils.aoa_to_sheet(periodRows), "DISTRIBUTION");
  XLSX.writeFile(periodWorkbook, periodWorkbookPath);
  const periodDb = await createDatabase(fs.mkdtempSync(path.join(os.tmpdir(), "uniform-manager-period-test-")));
  importWorkbook(periodWorkbookPath, periodDb);
  const periodState = periodDb.getState();
  if (!periodState.uniformIssues.some((row) => row.employee_code === "P001" && row.issue_month === 12 && row.issue_year === 2025)) {
    throw new Error("Dec-2025 was not stored as December 2025.");
  }
  if (!periodState.uniformIssues.some((row) => row.employee_code === "P001" && row.issue_month === 1 && row.issue_year === 2026)) {
    throw new Error("Jan-2026 was not stored as January 2026.");
  }
  if (!periodState.uniformIssues.some((row) => row.employee_code === "P002" && row.issue_period_label === "2024-2025")) {
    throw new Error("Fiscal period label 2024-2025 was not preserved.");
  }
  if (periodState.uniformIssueMatrix.rows.filter((row) => row.employee_code === "P001").length !== 2) {
    throw new Error("Distribution Register did not split the same employee into monthly rows.");
  }
  const p001Rows = periodState.uniformIssueMatrix.rows.filter((row) => row.employee_code === "P001");
  if (p001Rows[0]?.issue_month !== 1 || p001Rows[0]?.issue_year !== 2026) {
    throw new Error("Distribution Register did not sort recent monthly data first.");
  }
  const periodReview = periodState.reviews.find((row) => row.employee_code === "P003" && row.item_name === "Shirt");
  if (!periodReview || periodReview.issue_month !== 12 || periodReview.issue_year !== 2025) {
    throw new Error("Review Queue did not preserve the period that caused excess.");
  }
  periodDb.updateReview({
    id: periodReview.id,
    status: "Deduct",
    approved_by: "Test Manager",
    reason: "Monthly excess test.",
    remarks: "Period should appear on deduction.",
  });
  const periodDeduction = periodDb.getState().salaryDeductions.find((row) => row.employee_code === "P003");
  if (!periodDeduction || periodDeduction.issue_month !== 12 || periodDeduction.issue_year !== 2025) {
    throw new Error("Salary deduction did not preserve review period.");
  }

  const sectionPeriodPath = path.join(tmp, "section-periods.xlsx");
  const sectionPeriodWorkbook = XLSX.utils.book_new();
  const sectionPeriodRows = [
    ["For the Month of Aug-2025"],
    ["Emp Code", "Name", "Father Name", "Unit", "Godown", "Shirt"],
    ["SP001", "Section One", "Father One", "Reliance", "A", 1],
    ["For the Month of Sep-2025"],
    ["SP002", "Section Two", "Father Two", "Reliance", "A", 1],
    ["For the Month of Oct-2025"],
    ["SP003", "Section Three", "Father Three", "Reliance", "A", 1],
  ];
  XLSX.utils.book_append_sheet(sectionPeriodWorkbook, XLSX.utils.aoa_to_sheet(sectionPeriodRows), "Distribution");
  XLSX.writeFile(sectionPeriodWorkbook, sectionPeriodPath);
  const sectionPeriodDb = await createDatabase(fs.mkdtempSync(path.join(os.tmpdir(), "uniform-manager-section-periods-")));
  importWorkbook(sectionPeriodPath, sectionPeriodDb);
  const sectionRows = sectionPeriodDb.getState().uniformIssueMatrix.rows;
  if (!sectionRows.some((row) => row.employee_code === "SP001" && row.issue_month === 8 && row.issue_year === 2025)) {
    throw new Error("Section period Aug-2025 was not applied to following employee rows.");
  }
  if (!sectionRows.some((row) => row.employee_code === "SP002" && row.issue_month === 9 && row.issue_year === 2025)) {
    throw new Error("Section period Sep-2025 was not applied to following employee rows.");
  }
  if (!sectionRows.some((row) => row.employee_code === "SP003" && row.issue_month === 10 && row.issue_year === 2025)) {
    throw new Error("Section period Oct-2025 was not applied to following employee rows.");
  }

  const numericMonthPath = path.join(tmp, "numeric-month-column.xlsx");
  const numericMonthWorkbook = XLSX.utils.book_new();
  const numericMonthRows = [
    ["For the Month of Aug-2025"],
    ["Emp Code", "Name", "Father Name", "Unit", "Godown", "MONTH", "Shirt"],
    ["NM001", "Numeric Four", "Father Four", "Reliance", "A", 4, 1],
    ["NM002", "Numeric Five", "Father Five", "Reliance", "A", "5", 1],
    ["NM003", "Numeric Date", "Father Date", "Reliance", "A", "15-06-2025", 1],
    ["NM004", "Text Date Apr", "Father Apr", "Reliance", "A", "01-Apr-25", 1],
  ];
  XLSX.utils.book_append_sheet(numericMonthWorkbook, XLSX.utils.aoa_to_sheet(numericMonthRows), "Distribution");
  XLSX.writeFile(numericMonthWorkbook, numericMonthPath);
  const numericMonthDb = await createDatabase(fs.mkdtempSync(path.join(os.tmpdir(), "uniform-manager-numeric-months-")));
  importWorkbook(numericMonthPath, numericMonthDb);
  const numericMonthRowsImported = numericMonthDb.getState().uniformIssueMatrix.rows;
  if (!numericMonthRowsImported.some((row) => row.employee_code === "NM001" && row.issue_month === 4 && row.issue_year === 2025)) {
    throw new Error("Numeric MONTH value 4 did not import as Apr 2025.");
  }
  if (!numericMonthRowsImported.some((row) => row.employee_code === "NM002" && row.issue_month === 5 && row.issue_year === 2025)) {
    throw new Error("String MONTH value 5 did not import as May 2025.");
  }
  if (!numericMonthRowsImported.some((row) => row.employee_code === "NM003" && row.issue_month === 6 && row.issue_year === 2025)) {
    throw new Error("Date value in MONTH column did not import as Jun 2025.");
  }
  if (!numericMonthRowsImported.some((row) => row.employee_code === "NM004" && row.issue_month === 4 && row.issue_year === 2025)) {
    throw new Error("Text date value 01-Apr-25 in MONTH column did not import as Apr 2025.");
  }

  const shiftWorkbookPath = path.join(tmp, "unit-shift-policy.xlsx");
  const shiftWorkbook = XLSX.utils.book_new();
  const shiftRows = [
    ["Emp Code", "Name", "Father Name", "Unit", "Godown", "Month", "Shirt"],
    ["S001", "Shift Guard", "Father Shift", "Reliance", "Store A", "Apr 2025", 2],
    ["S001", "Shift Guard", "Father Shift", "AMNS", "Store B", "May 2025", 3],
  ];
  XLSX.utils.book_append_sheet(shiftWorkbook, XLSX.utils.aoa_to_sheet(shiftRows), "DISTRIBUTION");
  XLSX.writeFile(shiftWorkbook, shiftWorkbookPath);
  const shiftDb = await createDatabase(fs.mkdtempSync(path.join(os.tmpdir(), "uniform-manager-shift-test-")));
  importWorkbook(shiftWorkbookPath, shiftDb);
  shiftDb.upsertPolicy({ unit: "Reliance", item_name: "Shirt", yearly_entitlement: 2, item_cost: 100 });
  shiftDb.upsertPolicy({ unit: "AMNS", item_name: "Shirt", yearly_entitlement: 3, item_cost: 100 });
  shiftDb.recalculateReviews();
  const shiftState = shiftDb.getState();
  if (shiftState.reviews.some((row) => row.employee_code === "S001" && row.item_name === "Shirt" && row.status === "Pending")) {
    throw new Error("Employee unit shift did not apply the policy for each issue unit.");
  }

  const mixedSummary = importWorkbook(mixedWorkbookPath, db);
  if (mixedSummary.selectedSheet !== "DISTRIBUTION") {
    throw new Error(`Expected DISTRIBUTION sheet, selected ${mixedSummary.selectedSheet}`);
  }
  const duplicateSummary = importWorkbook(mixedWorkbookPath, db);
  if (!duplicateSummary.duplicate || duplicateSummary.inserted !== 0) {
    throw new Error("Duplicate import was not blocked before saving rows.");
  }
  const issueState = db.getState();
  if (issueState.uniformIssues.length === 0) throw new Error("Uniform item quantities were not imported.");
  if (!issueState.uniformIssues.some((row) => row.item_name === "Shirt" && Number(row.quantity) === 2)) {
    throw new Error("Shirt issue quantity was not imported.");
  }
  if (!issueState.uniformIssueMatrix.items.includes("Shirt")) {
    throw new Error("Employee uniform issue matrix did not include Shirt column.");
  }
  const lateItemWorkbookPath = path.join(tmp, "late-item-columns.xlsx");
  const lateItemWorkbook = XLSX.utils.book_new();
  const lateHeaders = [
    "Emp Code", "Name", "Father Name", "Unit", "Godown", "Pant", "Shirt", "Mon. Cap",
    "I-Card", "I-Card Cover", "Pagdi", "Helmet Green", "Helmet Blue", "Helmet White",
    "Helmet Yellow", "Helmet V-Guard", "Helmet Red", "Dangri Lk-9 Blue",
  ];
  const lateRows = [lateHeaders];
  for (let index = 1; index <= 100; index += 1) {
    lateRows.push([
      `LI${String(index).padStart(3, "0")}`,
      `Late Item ${index}`,
      `Father ${index}`,
      "Reliance",
      "SATISH SHARMA",
      index === 100 ? 1 : 0,
      0,
      0,
      0,
      index === 100 ? 1 : 0,
      0,
      index === 100 ? 1 : 0,
      0,
      0,
      0,
      0,
      index === 100 ? 1 : 0,
      index === 100 ? 1 : 0,
    ]);
  }
  XLSX.utils.book_append_sheet(lateItemWorkbook, XLSX.utils.aoa_to_sheet(lateRows), "DISTRIBUTION");
  XLSX.writeFile(lateItemWorkbook, lateItemWorkbookPath);
  const lateItemDb = await createDatabase(fs.mkdtempSync(path.join(os.tmpdir(), "uniform-manager-late-items-")));
  importWorkbook(lateItemWorkbookPath, lateItemDb);
  const lateItems = lateItemDb.getState().uniformIssueMatrix.items;
  ["I-Card Cover", "Helmet Green", "Helmet Red", "Dangri Lk-9 Blue"].forEach((itemName) => {
    if (!lateItems.includes(itemName)) {
      throw new Error(`Late/after-cap item column was missing: ${itemName}`);
    }
  });
  if (lateItemDb.getState().uniformIssues.some((row) => Number(row.quantity || 0) <= 0)) {
    throw new Error("Zero-quantity item rows were saved to the distribution register.");
  }
  const matrixItems = issueState.uniformIssueMatrix.items;
  if (matrixItems.indexOf("Shirt") > matrixItems.indexOf("Pant") || matrixItems.indexOf("Pant") > matrixItems.indexOf("Shoes")) {
    throw new Error("Distribution Register item columns did not follow workbook order.");
  }
  const firstMixedRow = issueState.uniformIssueMatrix.rows.find((row) => row.employee_code === "X0001");
  if (!firstMixedRow) {
    throw new Error("Distribution Register employee rows did not include imported employee.");
  }
  const firstDistributionRow = firstMixedRow;
  if (firstDistributionRow.entitlements.Shirt.allowed !== 2 || firstDistributionRow.entitlements.Shirt.status !== "Excess") {
    throw new Error("Distribution Register did not compare issued quantity against client entitlement.");
  }
  if (firstDistributionRow.entitlement_status !== "Excess" || Number(firstDistributionRow.total_excess || 0) <= 0) {
    throw new Error("Distribution Register did not flag employee excess entitlement status.");
  }
  if (!issueState.uniformIssueMatrix.rows.some((row) => Number(row.quantities.Shirt || 0) > 0)) {
    throw new Error("Employee uniform issue matrix did not include Shirt quantity.");
  }
  if (issueState.uniformIssueMatrix.items.some((item) => String(item).toLowerCase() === "month")) {
    throw new Error("Month column was incorrectly imported as a uniform item.");
  }
  const badMatrixColumns = issueState.uniformIssueMatrix.items.map((item) => String(item).toLowerCase());
  if (badMatrixColumns.some((item) => item.includes("sr no") || item.includes("total"))) {
    throw new Error("Serial/total columns were incorrectly imported as uniform items.");
  }
  if (issueState.uniformIssues.some((row) => /month|sr\.?\s*no|total/i.test(String(row.item_name)))) {
    throw new Error("Non-item columns were saved as uniform issue rows.");
  }
  if (!issueState.reviews.some((row) => String(row.reason).includes("entitlement exceeded"))) {
    throw new Error("Excess uniform issue was not sent to review queue.");
  }
  if (issueState.reviews.some((row) => row.unit === "SATISH SHARMA")) {
    throw new Error("Review Queue used Godown as Unit.");
  }
  if (issueState.reviews.some((row) => row.employee_code === "X0002" && row.item_name === "Pant")) {
    throw new Error("OK employee/item was incorrectly sent to review queue.");
  }
  const structuredReview = issueState.reviews.find((row) => row.item_name === "Shirt" && Number(row.excess_qty) > 0);
  if (!structuredReview || Number(structuredReview.issued_qty) <= Number(structuredReview.allowed_qty)) {
    throw new Error("Review Queue did not store structured issued/allowed/excess quantities.");
  }
  if (!issueState.reviews.some((row) => row.category === "Excess Entitlement")) {
    throw new Error("Review queue did not categorize excess entitlement records.");
  }
  if (!issueState.reviewSummary["Excess Entitlement"]?.pending) {
    throw new Error("Review summary did not count pending excess entitlement records.");
  }
  const excessReview = issueState.reviews.find((row) => String(row.reason).includes("entitlement exceeded"));
  db.updateReview({
    id: excessReview.id,
    status: "Deduct",
    approved_by: "Test Manager",
    reason: "Excess uniform issued beyond client entitlement.",
    remarks: "Marked for payroll deduction review.",
  });
  let financeState = db.getState();
  if (!financeState.salaryDeductions.some((row) => Number(row.review_id) === Number(excessReview.id) && Number(row.amount) > 0)) {
    throw new Error("Deduct review action did not create a salary deduction record.");
  }
  const deductionRecord = financeState.salaryDeductions.find((row) => Number(row.review_id) === Number(excessReview.id));
  if (!deductionRecord.pdf_path || !fs.existsSync(deductionRecord.pdf_path)) {
    throw new Error("Deduct review action did not generate a local PDF report.");
  }
  const pdfContent = fs.readFileSync(deductionRecord.pdf_path, "utf8");
  [
    "UNIFORM MANAGER",
    "SALARY DEDUCTION REPORT",
    "EMPLOYEE DETAILS",
    "APPROVAL DETAILS",
    "ITEM-WISE DEDUCTION BREAKDOWN",
    "TOTAL DEDUCTION AMOUNT",
    "EMPLOYEE UNIFORM ISSUE HISTORY",
    "Approved By    : Test Manager",
    "Employee Signature",
  ].forEach((expectedText) => {
    if (!pdfContent.includes(expectedText)) {
      throw new Error(`Salary deduction PDF did not include required report section: ${expectedText}`);
    }
  });
  if (!pdfContent.includes("Shirt") || !pdfContent.includes("Rs.")) {
    throw new Error("Salary deduction PDF did not include item breakdown and amount.");
  }
  if (!financeState.reviewDecisions.some((row) => Number(row.review_id) === Number(excessReview.id) && row.approved_by === "Test Manager")) {
    throw new Error("Review decision audit record was not created for deduction.");
  }
  const waiveCandidate = financeState.reviews.find((row) => row.status === "Pending" && Number(row.id) !== Number(excessReview.id));
  if (waiveCandidate) {
    db.updateReview({
      id: waiveCandidate.id,
      status: "Waived",
      approved_by: "Test Manager",
      reason: "Management approved waive off.",
      remarks: "Waived during smoke test.",
    });
    financeState = db.getState();
    if (!financeState.waiveRecords.some((row) => Number(row.review_id) === Number(waiveCandidate.id))) {
      throw new Error("Waive review action did not create a waive record.");
    }
  }
  const holdCandidate = db.getState().reviews.find((row) => row.status === "Pending");
  if (holdCandidate) {
    db.updateReview({
      id: holdCandidate.id,
      status: "Hold",
      approved_by: "Test Manager",
      reason: "Waiting for office confirmation.",
      remarks: "Held by test.",
    });
    if (!db.getState().reviews.some((row) => Number(row.id) === Number(holdCandidate.id) && row.status === "Hold")) {
      throw new Error("Hold review action did not keep the excess unresolved.");
    }
  }
  db.resetOperationalData();
  const resetState = db.getState();
  if (resetState.employees.length !== 0) throw new Error("Reset did not clear employees.");
  if (resetState.imports.length !== 0) throw new Error("Reset did not clear import history.");
  if (resetState.reviews.length !== 0) throw new Error("Reset did not clear review queue.");
  if (resetState.uniformIssues.length !== 0) throw new Error("Reset did not clear uniform issues.");
  if (resetState.salaryDeductions.length !== 0) throw new Error("Reset did not clear deduction records.");
  if (resetState.policies.length === 0) throw new Error("Reset should keep unit policies.");
  const policy = resetState.policies[0];
  db.upsertPolicy({
    id: policy.id,
    unit: "Edited Unit",
    item_name: "Edited Item",
    yearly_entitlement: 7,
    item_cost: 777,
  });
  const editedPolicy = db.getState().policies.find((row) => row.id === policy.id);
  if (!editedPolicy || editedPolicy.unit !== "Edited Unit" || editedPolicy.item_cost !== 777) {
    throw new Error("Policy edit did not update the selected row.");
  }
  db.deletePolicy(policy.id);
  if (db.getState().policies.some((row) => row.id === policy.id)) {
    throw new Error("Policy delete did not remove the selected row.");
  }

  console.log("Smoke test passed.");
  console.log(`Large import: ${largeSummary.inserted} rows in ${elapsedMs}ms`);
  console.log(`Database: ${db.dbPath}`);
})();
