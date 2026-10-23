const fs = require('fs');
const os = require('os');
const path = require('path');
const XLSX = require('xlsx');
const { createDatabase } = require('../src/main/database/database');
const { importWorkbook } = require('../src/main/import/smart-importer');
const annualPolicyCsv = require('../src/renderer/policies/annualPolicyCsv');

async function main() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'uniform-annual-policy-bulk-'));
  const workbookPath = path.join(directory, 'annual-policy-fixture.xlsx');
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([
    ['Emp Code', 'Name', 'Father Name', 'Unit', 'Godown', 'Month', 'Imported Coat', 'Imported Cap', 'No Quantity Item'],
    ['A001', 'Bulk Test One', 'Father One', 'UNIT-A', 'Store', 'Mar 2025', 1, 0, 0],
    ['A001', 'Bulk Test One', 'Father One', 'UNIT-B', 'Store', 'Apr 2025', 1, 0, 0],
    ['A002', 'Bulk Test Two', 'Father Two', 'UNIT-A', 'Store', 'Apr 2025', 0, 1, 0],
  ]), 'DISTRIBUTION');
  XLSX.writeFile(workbook, workbookPath);

  let db = await createDatabase(directory);
  importWorkbook(workbookPath, db);
  db.upsertItem({ item_code: 'ANNUAL-MASTER-ONLY', item_name: 'Master Only Coat', category: 'Uniform', size: 'Standard', cost: 0 });
  db.upsertAnnualPolicy({ item_name: 'Imported Coat', financial_year: 2024, allowed_quantity: 7 });
  db.upsertAnnualPolicy({ item_name: 'Imported Coat', financial_year: 2025, allowed_quantity: 4 });
  db.upsertPolicy({ unit: 'UNIT-A', item_name: 'Imported Cap', yearly_entitlement: 9, item_cost: 0 });
  db.recalculateReviews();

  let state = db.getState({ distributionLimit: 1000 });
  const applicableYears = state.entitlementOptions.annualFinancialYears;
  if (!applicableYears.includes(2024) || !applicableYears.includes(2025)) throw new Error('Financial-year options omitted historical distribution years.');
  const recognizedItems = state.entitlementOptions.items;
  for (const name of ['Imported Coat', 'Imported Cap', 'Master Only Coat', 'No Quantity Item']) {
    if (!recognizedItems.includes(name)) throw new Error(`Recognized item ${name} was not detected from master/import data.`);
    for (const year of applicableYears) {
      const policy = state.annualPolicies.find((row) => row.item_name === name && Number(row.financial_year) === year);
      if (!policy) throw new Error(`Missing automatically created annual policy: ${name}, FY ${year}.`);
      if ((name !== 'Imported Coat' || ![2024, 2025].includes(year)) && Number(policy.allowed_quantity) !== 0) {
        throw new Error(`New item policy ${name}, FY ${year} should default to 0.`);
      }
    }
  }
  const csvImport = annualPolicyCsv.validate('\uFEFF"Item","Allowed Quantity"\r\n"Imported Coat","6"\r\n"Imported Cap","8"\r\n', recognizedItems);
  if (csvImport.errors.length || csvImport.rows.length !== 2 || csvImport.rows[0].allowed_quantity !== '6') {
    throw new Error(`Annual policy CSV upload validation failed for a valid template: ${JSON.stringify(csvImport)}.`);
  }
  const duplicateCsv = annualPolicyCsv.validate('Item,Allowed Quantity\nImported Coat,1\nimported coat,2\n', recognizedItems);
  if (!duplicateCsv.errors.some((message) => /duplicate item/i.test(message))) throw new Error('Annual policy CSV upload did not flag duplicate items.');
  const invalidCsv = annualPolicyCsv.validate('Item,Allowed Quantity\nImported Cap,-1\n', recognizedItems);
  if (!invalidCsv.errors.some((message) => /non-negative whole number/i.test(message))) throw new Error('Annual policy CSV upload did not flag invalid quantities.');
  if (Number(state.annualPolicies.find((row) => row.item_name === 'Imported Coat' && Number(row.financial_year) === 2024).allowed_quantity) !== 7
      || Number(state.annualPolicies.find((row) => row.item_name === 'Imported Coat' && Number(row.financial_year) === 2025).allowed_quantity) !== 4) {
    throw new Error('Synchronization overwrote an existing annual quantity.');
  }

  const countBeforeRepeat = state.annualPolicies.length;
  db.ensureAnnualPoliciesForRecognizedItems();
  db.getState();
  state = db.getState();
  if (state.annualPolicies.length !== countBeforeRepeat) throw new Error('Repeated synchronization created duplicate annual policy rows.');

  let duplicateRejected = false;
  try {
    db.bulkUpdateAnnualPolicies({ financial_year: 2025, rows: [
      { item_name: 'Imported Cap', allowed_quantity: 2 },
      { item_name: 'imported cap', allowed_quantity: 3 },
    ] });
  } catch (error) { duplicateRejected = /duplicate item/i.test(error.message); }
  if (!duplicateRejected) throw new Error('Bulk update accepted duplicate item entries.');
  let invalidRejected = false;
  try { db.bulkUpdateAnnualPolicies({ financial_year: 2025, rows: [{ item_name: 'Imported Cap', allowed_quantity: -1 }] }); }
  catch (error) { invalidRejected = /non-negative whole number/i.test(error.message); }
  if (!invalidRejected) throw new Error('Bulk update accepted an invalid negative quantity.');

  const bulk = db.bulkUpdateAnnualPolicies({ financial_year: 2025, rows: [
    { item_name: 'Imported Coat', allowed_quantity: 2 },
    { item_name: 'Imported Cap', allowed_quantity: 3 },
    { item_name: 'Master Only Coat', allowed_quantity: 1 },
  ] });
  if (bulk.saved !== 3 || bulk.changed !== 3 || !bulk.recalculationRequired) throw new Error(`Bulk update did not report the saved changes correctly: ${JSON.stringify(bulk)}.`);
  db.recalculateReviews();
  state = db.getState({ distributionLimit: 1000 });
  const coat2025 = state.annualPolicies.find((row) => row.item_name === 'Imported Coat' && Number(row.financial_year) === 2025);
  const coat2024 = state.annualPolicies.find((row) => row.item_name === 'Imported Coat' && Number(row.financial_year) === 2024);
  if (Number(coat2025.allowed_quantity) !== 2 || Number(coat2024.allowed_quantity) !== 7) throw new Error('Bulk edit changed another financial year.');
  const coatIssues = state.uniformIssues.filter((row) => row.item_name === 'Imported Coat');
  const mar2025 = coatIssues.find((row) => Number(row.issue_month) === 3);
  const apr2025 = coatIssues.find((row) => Number(row.issue_month) === 4);
  if (!mar2025 || !apr2025 || Number(mar2025.excess_generated) !== 0 || Number(apr2025.excess_generated) !== 0) {
    throw new Error('Review calculations did not apply each financial year’s saved annual quantity.');
  }

  db = await createDatabase(directory);
  state = db.getState({ distributionLimit: 1000 });
  if (!state.annualPolicies.some((row) => row.item_name === 'Imported Cap' && Number(row.financial_year) === 2025 && Number(row.allowed_quantity) === 3)) {
    throw new Error('Bulk annual quantities did not persist after reopening the database.');
  }
  if (state.policies.find((row) => row.unit === 'UNIT-A' && row.item_name === 'Imported Cap')?.yearly_entitlement !== 9) {
    throw new Error('Annual bulk editing unexpectedly modified Unit-wise entitlements.');
  }

  console.log('Annual item policy synchronization and bulk update regression passed.');
  console.log('Verified historical/imported/master item discovery, zero defaults, saved quantity preservation, per-year isolation, idempotence, duplicate and range validation, multi-item update, recalculation, persistence, and Unit-wise separation.');
}

main().catch((error) => { console.error(error.stack || error); process.exitCode = 1; });
