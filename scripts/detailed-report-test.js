const fs = require('fs');
const os = require('os');
const path = require('path');
const XLSX = require('xlsx');
const { createDatabase } = require('../src/main/database/database');
const { importWorkbook } = require('../src/main/import/smart-importer');
const buildDetailedReportWorksheet = require('../src/renderer/analytics/detailedReportFormat');
const { parseActualPriceFile } = require('../src/main/services/actual-price-import');

async function main() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'uniform-detailed-report-'));
  const csvPath = path.join(dir, 'actual-prices.csv');
  fs.writeFileSync(csvPath, 'Item,Actual Rate,Unit Name\nReport Coat,175,\n', 'utf8');
  const parsedActualPriceFile = parseActualPriceFile(csvPath);
  if (parsedActualPriceFile.rows[0].item_name !== 'Report Coat' || parsedActualPriceFile.rows[0].actual_price !== '175') throw new Error('CSV Actual Price parser did not map supported column header variations.');
  const priceWorkbookPath = path.join(dir, 'actual-prices.xlsx');
  const priceWorkbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(priceWorkbook, XLSX.utils.aoa_to_sheet([['Item Name', 'Actual Price'], ['Report Boots', 260]]), 'Prices');
  XLSX.writeFile(priceWorkbook, priceWorkbookPath);
  if (parseActualPriceFile(priceWorkbookPath).rows[0].actual_price !== '260') throw new Error('Excel Actual Price parser did not read the required template columns.');
  let badHeadersRejected = false;
  const badHeaderPath = path.join(dir, 'bad-headers.csv');
  fs.writeFileSync(badHeaderPath, 'Description,Value\nReport Coat,175\n', 'utf8');
  try { parseActualPriceFile(badHeaderPath); } catch (error) { badHeadersRejected = /Item Name and Actual Price/.test(error.message); }
  if (!badHeadersRejected) throw new Error('Actual Price parser accepted unrelated column headers.');
  const source = path.join(dir, 'report-fixture.xlsx');
  const workbook = XLSX.utils.book_new();
  const zeroQuantityItemNames = [...Array.from({ length: 48 }, (_, index) => `Imported Zero Item ${String(index + 1).padStart(2, '0')}`), 'I-Card', 'I Card'];
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([
    ['Emp Code', 'Name', 'Father Name', 'Unit', 'Godown', 'Month', 'Report Coat', 'Report Boots', ...zeroQuantityItemNames],
    ['DR001', 'Detailed Report Test', 'Parent Name', 'REPORT-UNIT', 'Store', 'Jan 2026', 6, 3, ...zeroQuantityItemNames.map(() => 0)],
  ]), 'DISTRIBUTION');
  XLSX.writeFile(workbook, source);

  const db = await createDatabase(dir);
  db.upsertItem({ item_code: 'REPORT-COAT', item_name: 'Report Coat', category: 'Uniform', size: 'M', cost: 150 });
  db.upsertItem({ item_code: 'REPORT-COAT-L', item_name: 'Report Coat', category: 'Uniform', size: 'L', cost: 160 });
  db.upsertItem({ item_code: 'REPORT-BOOTS', item_name: 'Report Boots', category: 'Uniform', size: 'M', cost: 250 });
  const priceRowsBeforeImport = db.getActualPriceData().prices.length;
  importWorkbook(source, db);
  const initialActualPrices = db.getActualPriceData();
  for (const itemName of ['Report Coat', 'Report Boots']) {
    if (Number(initialActualPrices.prices.find((row) => row.item_name === itemName)?.actual_price) !== 0) throw new Error(`Detected item ${itemName} did not receive an Actual Price default of 0.`);
  }
  if (initialActualPrices.prices.filter((row) => row.item_name.toLowerCase() === 'report coat').length !== 1) throw new Error('Actual Price defaulting created duplicate item rows.');
  const detectedZeroItems = initialActualPrices.items.filter((item) => zeroQuantityItemNames.some((expected) => expected.toLowerCase() === item.toLowerCase()));
  if (detectedZeroItems.length !== zeroQuantityItemNames.length || zeroQuantityItemNames.some((item) => Number(initialActualPrices.prices.find((row) => row.item_name.toLowerCase() === item.toLowerCase())?.actual_price) !== 0)) throw new Error(`Import failed to synchronize all ${zeroQuantityItemNames.length} recognized zero-quantity item columns.`);
  const addedPriceRows = initialActualPrices.prices.length - priceRowsBeforeImport;
  if (addedPriceRows !== zeroQuantityItemNames.length) throw new Error(`Expected ${zeroQuantityItemNames.length} imported Actual Price rows to be added, got ${addedPriceRows}.`);
  if (db.getState().items.some((row) => zeroQuantityItemNames.some((item) => item.toLowerCase() === row.item_name.toLowerCase()))) throw new Error('Imported item-price synchronization created inventory stock records.');
  if (!detectedZeroItems.includes('I-Card') || !detectedZeroItems.includes('I Card')) throw new Error('Punctuation-different item names were silently merged during import recognition.');
  const issueCountBeforeHeaderRefresh = db.getState().uniformIssues.length;
  const duplicateWithNewHeaderPath = path.join(dir, 'same-distribution-new-zero-item-column.xlsx');
  const duplicateWithNewHeader = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(duplicateWithNewHeader, XLSX.utils.aoa_to_sheet([
    ['Emp Code', 'Name', 'Father Name', 'Unit', 'Godown', 'Month', 'Report Coat', 'Report Boots', ...zeroQuantityItemNames, 'Future Zero Item'],
    ['DR001', 'Detailed Report Test', 'Parent Name', 'REPORT-UNIT', 'Store', 'Jan 2026', 6, 3, ...zeroQuantityItemNames.map(() => 0), 0],
  ]), 'DISTRIBUTION');
  XLSX.writeFile(duplicateWithNewHeader, duplicateWithNewHeaderPath);
  const duplicateHeaderImport = importWorkbook(duplicateWithNewHeaderPath, db);
  if (!duplicateHeaderImport.duplicate || db.getState().uniformIssues.length !== issueCountBeforeHeaderRefresh || Number(db.getActualPriceData().prices.find((row) => row.item_name === 'Future Zero Item')?.actual_price) !== 0) throw new Error('Duplicate import did not synchronize its newly detected item header without duplicating distribution records.');
  console.log('Repeated import check: new zero-quantity item header synchronized; distribution row count unchanged.');
  const savedReportCoatPrice = db.saveActualItemPrices([{ item_name: 'Report Coat', actual_price: 99 }]);
  if (savedReportCoatPrice.updated !== 1 || Number(db.getActualPriceData().prices.find((row) => row.item_name === 'Report Coat')?.actual_price) !== 99) throw new Error('Detected-item synchronization overwrote a saved Actual Price.');
  console.log(`Actual Price import synchronization: ${initialActualPrices.items.length} recognized catalog items; ${priceRowsBeforeImport} pre-existing price rows; ${addedPriceRows} missing zero-price rows repaired from imported columns; Report Coat price preservation verified.`);
  db.saveActualItemPrices([{ item_name: 'Report Coat', actual_price: 0 }]);
  const legacyWorkbookPath = path.join(dir, 'legacy-import-without-detected-items.xlsx');
  const legacyWorkbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(legacyWorkbook, XLSX.utils.aoa_to_sheet([
    ['Emp Code', 'Name', 'Unit', 'Legacy Backfill Only'],
    ['DRLEGACY', 'Legacy Backfill', 'REPORT-UNIT', 0],
  ]), 'DISTRIBUTION');
  XLSX.writeFile(legacyWorkbook, legacyWorkbookPath);
  db.recordImport({ fileName: path.basename(legacyWorkbookPath), filePath: legacyWorkbookPath, selectedSheet: 'DISTRIBUTION', importHash: 'legacy-import-fixture', totalRows: 1 });
  const legacyBackfill = db.getActualPriceData();
  if (!legacyBackfill.items.some((item) => item === 'Legacy Backfill Only') || Number(legacyBackfill.prices.find((row) => row.item_name === 'Legacy Backfill Only')?.actual_price) !== 0) throw new Error('Legacy import headers were not recovered and defaulted from their existing source workbook.');
  console.log('Legacy import backfill: recovered a previously unrecorded zero-quantity item header from the stored import path.');
  db.upsertPolicy({ unit: 'REPORT-UNIT', item_name: 'Report Coat', yearly_entitlement: 0, item_cost: 125 });
  db.upsertPolicy({ unit: 'REPORT-UNIT', item_name: 'Report Boots', yearly_entitlement: 0, item_cost: 200 });
  db.upsertAnnualPolicy({ item_name: 'Report Coat', financial_year: 2025, allowed_quantity: 4 });
  db.upsertAnnualPolicy({ item_name: 'Report Boots', financial_year: 2025, allowed_quantity: 2 });
  db.setReviewQueueCalculationMode('item_annual');
  db.recalculateReviews();

  const coat = db.getReviewQueueStage2('DR001').find((row) => row.item_name === 'Report Coat');
  const boots = db.getReviewQueueStage2('DR001').find((row) => row.item_name === 'Report Boots');
  if (!coat || !boots) throw new Error('Fixture review records were not generated.');
  db.updateReview({ id: coat.id, status: 'Completed', approved_by: 'Report Test', reason: 'Detailed report fixture', quantity_decisions: { deduct: 2, waive: 0, hold: 0 } });
  db.updateReview({ id: boots.id, status: 'Completed', approved_by: 'Report Test', reason: 'Excluded waived fixture', quantity_decisions: { deduct: 0, waive: 1, hold: 0 } });

  const options = db.getDetailedDeductionReportOptions();
  if (!options.financialYears.includes(2025) || !options.distributionMonths.includes(1) || !options.units.includes('REPORT-UNIT')) throw new Error('Detailed report filter options omitted persisted data.');
  const report = db.getDetailedDeductionReport({ employeeCode: 'DR001', financialYear: '2025', distributionMonth: '1' });
  if (report.items.length !== 1 || report.items[0] !== 'Report Coat') throw new Error(`Expected only actually deducted dynamic item, got ${report.items.join(', ')}.`);
  if (report.rows.length !== 1 || Number(report.rows[0].items['Report Coat']) !== 2) throw new Error('Report quantity was not derived from the finalized persisted allocation.');
  if (report.rows[0].for_month !== 'Jan 2026') throw new Error(`Distribution month was not preserved separately: ${report.rows[0].for_month}`);
  if (!String(report.rows[0].deduction_month_display).match(/^[A-Z][a-z]{2}-\d{2}$/)) throw new Error('Deduction record month was not derived from persisted deduction timestamp.');
  if (report.itemInfo[0].deduction_rate !== '125') throw new Error(`Expected persisted unit deduction rate 125, got ${report.itemInfo[0].deduction_rate}.`);
  if (report.itemInfo[0].actual_rate !== '0') throw new Error(`Expected an existing item without a saved price to default to Actual Rate 0, got ${report.itemInfo[0].actual_rate}.`);
  if (report.itemInfo[0].max_supplied_pa !== '4') throw new Error(`Expected annual limit 4, got ${report.itemInfo[0].max_supplied_pa}.`);
  if (Number(report.rows[0].total) !== 250) throw new Error(`Expected app calculation (2 x 125) = 250, got ${report.rows[0].total}.`);
  const excelLayout = buildDetailedReportWorksheet(report);
  const sheetRows = XLSX.utils.sheet_to_json(XLSX.utils.aoa_to_sheet(excelLayout.worksheetRows), { header: 1 });
  if (sheetRows[4][8] !== 'Report Coat' || sheetRows[4][sheetRows[4].length - 1] !== 'Total') throw new Error('Excel layout did not preserve dynamic item and final Total columns.');
  if (sheetRows[1][8] !== '4' || sheetRows[2][8] !== '125' || sheetRows[3][8] !== '0') throw new Error('Excel metadata rows did not match the on-screen item information.');
  if (sheetRows[5][8] !== 2 || sheetRows[5][9] !== 250 || excelLayout.freezePane.ySplit !== 5) throw new Error('Excel row quantities, amount, or frozen report header did not match the screen data.');
  if (excelLayout.autoFilter !== 'A5:J6') throw new Error(`Excel filter range did not cover the report table: ${excelLayout.autoFilter}`);
  const filtered = db.getDetailedDeductionReport({ employeeCode: 'nobody' });
  if (filtered.rows.length || filtered.items.length) throw new Error('Employee filter did not exclude unrelated records.');
  const beforePayrollAmount = Number(db.getState().salaryDeductions.find((row) => Number(row.review_id) === Number(coat.id))?.amount);
  const inventoryRows = db.getState().items.filter((row) => row.item_name === 'Report Coat');
  const inventoryCostsBefore = inventoryRows.map((row) => Number(row.cost));
  let invalidRateRejected = false;
  try { db.saveDetailedReportItemValues({ item_name: 'Report Coat', unit: 'REPORT-UNIT', financial_year: 2025, deduction_rate: -1 }); }
  catch (error) { invalidRateRejected = /non-negative/.test(error.message); }
  if (!invalidRateRejected) throw new Error('Detailed Report editor accepted a negative deduction rate.');
  const savedValues = db.saveDetailedReportItemValues({
    item_name: 'Report Coat', unit: 'REPORT-UNIT', financial_year: 2025,
    annual_limit: 5, unit_limit: 0, deduction_rate: 130, actual_price: 180,
  });
  if (Number(savedValues.unitPolicy.item_cost) !== 130 || Number(savedValues.annualPolicy.allowed_quantity) !== 5) throw new Error('Detailed Report editor did not persist deduction rate and annual limit to their existing policy records.');
  if (Number(savedValues.actualPrice.actual_price) !== 180) throw new Error('Detailed Report editor did not persist the independent Actual Price.');
  if (JSON.stringify(inventoryCostsBefore) !== JSON.stringify(db.getState().items.filter((row) => row.item_name === 'Report Coat').map((row) => Number(row.cost)))) throw new Error('Actual Price editing changed inventory item costs.');
  const actualOnlyEdit = db.saveDetailedReportItemValues({ item_name: 'Report Coat', unit: 'REPORT-UNIT', financial_year: 2025, actual_price: 181 });
  if (actualOnlyEdit.reviewCalculationsChanged || Number(actualOnlyEdit.unitPolicy.item_cost) !== 130) throw new Error('An informational Actual Price edit changed or requested recalculation of deduction policies.');
  db.saveDetailedReportItemValues({ item_name: 'Report Coat', unit: 'REPORT-UNIT', financial_year: 2025, actual_price: 180 });
  db.recalculateReviews();
  const editedReport = db.getDetailedDeductionReport({ employeeCode: 'DR001', financialYear: '2025', distributionMonth: '1' });
  if (editedReport.itemInfo[0].deduction_rate !== '130' || editedReport.itemInfo[0].max_supplied_pa !== '5') throw new Error('Saved rates or annual limit did not refresh in the report data.');
  if (editedReport.itemInfo[0].actual_rate !== '180' || editedReport.itemInfo[0].deduction_rate !== '130') throw new Error('Actual Price did not appear independently from the deduction rate in the report data.');
  const editedExport = buildDetailedReportWorksheet(editedReport);
  const editedSheetRows = XLSX.utils.sheet_to_json(XLSX.utils.aoa_to_sheet(editedExport.worksheetRows), { header: 1 });
  if (editedSheetRows[3][8] !== '180') throw new Error('Excel export Actual Price differs from the Detailed Report data.');
  const afterPayrollAmount = Number(db.getState().salaryDeductions.find((row) => Number(row.review_id) === Number(coat.id))?.amount);
  if (beforePayrollAmount !== afterPayrollAmount) throw new Error('Editing current policies rewrote a finalized payroll deduction amount.');
  const reviewsAfterEdit = db.getReviewQueueStage2('DR001').map((row) => row.id);
  db.recalculateReviews();
  const reviewsAfterRepeatedRecalc = db.getReviewQueueStage2('DR001').map((row) => row.id);
  if (JSON.stringify(reviewsAfterEdit) !== JSON.stringify(reviewsAfterRepeatedRecalc)) throw new Error('Repeated policy recalculation changed or duplicated existing review records.');
  const noInventorySource = path.join(dir, 'no-inventory-price-fixture.xlsx');
  const noInventoryWorkbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(noInventoryWorkbook, XLSX.utils.aoa_to_sheet([
    ['Emp Code', 'Name', 'Father Name', 'Unit', 'Godown', 'Month', 'Unstocked Jacket'],
    ['DR002', 'No Inventory Test', 'Parent Name', 'REPORT-UNIT', 'Store', 'Jan 2026', 1],
  ]), 'DISTRIBUTION');
  XLSX.writeFile(noInventoryWorkbook, noInventorySource);
  importWorkbook(noInventorySource, db);
  if (Number(db.getActualPriceData().prices.find((row) => row.item_name === 'Unstocked Jacket')?.actual_price) !== 0) throw new Error('A newly detected item did not receive the Actual Price default of 0.');
  db.upsertPolicy({ unit: 'REPORT-UNIT', item_name: 'Unstocked Jacket', yearly_entitlement: 0, item_cost: 44 });
  db.recalculateReviews();
  const noInventoryReview = db.getReviewQueueStage2('DR002').find((row) => row.item_name === 'Unstocked Jacket');
  if (!noInventoryReview) throw new Error('No-inventory test review was not generated.');
  db.updateReview({ id: noInventoryReview.id, status: 'Completed', approved_by: 'Report Test', reason: 'No inventory actual price fixture', quantity_decisions: { deduct: 1, waive: 0, hold: 0 } });
  const policyOnlyPrice = db.saveActualItemPrices([{ item_name: 'Unstocked Jacket', actual_price: 72 }]);
  if (policyOnlyPrice.inserted + policyOnlyPrice.updated !== 1 || Number(db.getActualPriceData().prices.find((row) => row.item_name === 'Unstocked Jacket')?.actual_price) !== 72 || db.getState().items.some((row) => row.item_name === 'Unstocked Jacket')) throw new Error('Actual Price entry without inventory created a fake stock item or failed to persist.');
  const noInventoryReport = db.getDetailedDeductionReport({ employeeCode: 'DR002', financialYear: '2025', distributionMonth: '1' });
  if (noInventoryReport.itemInfo[0]?.actual_rate !== '72') throw new Error('Detailed Report did not show the independently saved price for an item with no inventory record.');
  const bulkPreview = db.previewActualItemPrices([
    { item_name: 'Report Boots', actual_price: 51 }, { item_name: 'Unknown Item', actual_price: 10 },
    { item_name: 'Report Boots', actual_price: -1 }, { item_name: '', actual_price: 4 },
  ]);
  if (bulkPreview.valid_count !== 0 || bulkPreview.invalid_count !== 4 || !bulkPreview.rows.some((row) => /not in the existing item master/.test(row.error_message))) throw new Error('Actual Price import preview did not flag duplicate, unknown, missing, and negative rows.');
  const scopedPreview = db.previewActualItemPrices([{ item_name: 'Report Boots', actual_price: 50, unit: 'OTHER-UNIT' }]);
  if (scopedPreview.valid_count !== 0 || !/global per item/.test(scopedPreview.rows[0].error_message)) throw new Error('Unit-specific values were silently accepted for a global Actual Price.');
  const bulkResult = db.saveActualItemPrices([{ item_name: 'Report Boots', actual_price: 51 }, { item_name: 'Unknown Item', actual_price: 10 }]);
  if (bulkResult.updated !== 1 || bulkResult.rejected !== 1) throw new Error('Bulk Actual Price commit did not report the default row update and rejected row accurately.');
  const bulkUpdate = db.saveActualItemPrices([{ item_name: 'Report Coat', actual_price: 185 }]);
  if (bulkUpdate.updated !== 1 || Number(db.getDetailedDeductionReport({ employeeCode: 'DR001', financialYear: '2025', distributionMonth: '1' }).itemInfo[0].actual_rate) !== 185) throw new Error('Bulk Actual Price update did not refresh the Detailed Report value.');
  const reopenedDb = await createDatabase(dir);
  const reopenedState = reopenedDb.getState();
  const reopenedPolicy = reopenedState.policies.find((row) => row.unit === 'REPORT-UNIT' && row.item_name === 'Report Coat');
  const reopenedAnnual = reopenedState.annualPolicies.find((row) => row.item_name === 'Report Coat' && Number(row.financial_year) === 2025);
  if (Number(reopenedPolicy?.item_cost) !== 130 || Number(reopenedAnnual?.allowed_quantity) !== 5 || Number(reopenedDb.getActualPriceData().prices.find((row) => row.item_name === 'Report Coat')?.actual_price) !== 185) throw new Error('Detailed Report edited values did not persist after reopening the local database.');
  const reopenedActualPriceData = reopenedDb.getActualPriceData();
  if (zeroQuantityItemNames.some((item) => !reopenedActualPriceData.items.some((saved) => saved.toLowerCase() === item.toLowerCase()))) throw new Error('Recognized imported item names did not persist after reopening the database.');
  const html = fs.readFileSync(path.join(__dirname, '../src/renderer/index.html'), 'utf8');
  const styles = fs.readFileSync(path.join(__dirname, '../src/renderer/styles/styles.css'), 'utf8');
  if (!html.includes('id="bulkEditActualPrices"') || !html.includes('actual-price-table-scroll') || !styles.includes('.actual-price-table-scroll { max-height: 420px; overflow-y: auto; }')) throw new Error('Actual Prices bulk-edit control or section-specific vertical scrolling is missing.');
  console.log('Detailed report database validation passed.');
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
