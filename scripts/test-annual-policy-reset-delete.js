const fs = require('fs');
const os = require('os');
const path = require('path');
const XLSX = require('xlsx');
const { createDatabase } = require('../src/main/database/database');
const { importWorkbook } = require('../src/main/import/smart-importer');

function writeWorkbook(filePath, itemName, employeeCode) {
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([
    ['Emp Code', 'Name', 'Father Name', 'Unit', 'Godown', 'Month', itemName],
    [employeeCode, `Employee ${employeeCode}`, 'Test Parent', 'TEST-UNIT', 'Store', 'Apr 2026', 1],
  ]), 'DISTRIBUTION');
  XLSX.writeFile(workbook, filePath);
}

async function main() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'uniform-annual-policy-delete-reset-'));
  const firstWorkbook = path.join(directory, 'first-import.xlsx');
  const secondWorkbook = path.join(directory, 'second-import.xlsx');
  writeWorkbook(firstWorkbook, 'Shirt', 'DEL001');

  let db = await createDatabase(directory);
  importWorkbook(firstWorkbook, db);
  db.upsertAnnualPolicy({ item_name: 'Shirt', financial_year: 2026, allowed_quantity: 4 });
  let state = db.getState({ distributionLimit: 1000 });
  let shirtPolicy = state.annualPolicies.find((row) => row.item_name === 'Shirt' && Number(row.financial_year) === 2026);
  if (!shirtPolicy || Number(shirtPolicy.allowed_quantity) !== 4) throw new Error('Test setup failed to persist the configured Shirt policy.');

  const deletion = db.deleteAnnualPolicy(shirtPolicy.id);
  if (!deletion?.deleted) throw new Error('Individual annual policy deletion did not report success.');
  await db.recalculateReviews();
  state = db.getState({ distributionLimit: 1000 });
  if (state.annualPolicies.some((row) => row.item_name === 'Shirt' && Number(row.financial_year) === 2026)) {
    throw new Error('Deleted annual policy was recreated during the immediate persisted-state refresh.');
  }

  db = await createDatabase(directory);
  state = db.getState({ distributionLimit: 1000 });
  if (state.annualPolicies.some((row) => row.item_name === 'Shirt' && Number(row.financial_year) === 2026)) {
    throw new Error('Deleted annual policy returned after reopening the database.');
  }

  db.upsertAnnualPolicy({ item_name: 'Shirt', financial_year: 2026, allowed_quantity: 2 });
  state = db.getState({ distributionLimit: 1000 });
  shirtPolicy = state.annualPolicies.find((row) => row.item_name === 'Shirt' && Number(row.financial_year) === 2026);
  if (!shirtPolicy || Number(shirtPolicy.allowed_quantity) !== 2) throw new Error('Explicitly saving a deleted policy did not restore it.');
  db.upsertItem({ item_code: 'SHIRT-MASTER', item_name: 'Shirt', category: 'Uniform', size: 'Standard', cost: 0 });
  db.upsertPolicy({ unit: 'TEST-UNIT', item_name: 'Shirt', yearly_entitlement: 2, item_cost: 10 });
  db.saveActualItemPrices([{ item_name: 'Shirt', actual_price: 250 }]);
  const issueCountBeforeReset = state.uniformIssues.length;
  const importCountBeforeReset = state.imports.length;

  const reset = db.resetItemsAndPolicies();
  if (!reset.deletedAnnualPolicies) throw new Error('Reset did not report clearing annual policy rows.');
  await db.recalculateReviews();
  state = db.getState({ distributionLimit: 1000 });
  if (state.annualPolicies.length !== 0) throw new Error(`Reset left ${state.annualPolicies.length} annual policy row(s) visible.`);
  if (state.policies.length !== 0) throw new Error('Reset unexpectedly retained unit-wise policies.');
  if (state.uniformIssues.length !== issueCountBeforeReset || state.imports.length !== importCountBeforeReset) {
    throw new Error('Reset modified distribution or import history outside its scope.');
  }
  const prices = db.getActualPriceData();
  if (Number(prices.prices.find((row) => row.item_name === 'Shirt')?.actual_price) !== 250) {
    throw new Error('Reset modified the independent Actual Item Price.');
  }

  db = await createDatabase(directory);
  state = db.getState({ distributionLimit: 1000 });
  if (state.annualPolicies.length !== 0) throw new Error('Cleared annual policies returned after reopening the database.');

  const newItemName = 'New Imported Uniform Glove';
  writeWorkbook(secondWorkbook, newItemName, 'DEL002');
  importWorkbook(secondWorkbook, db);
  state = db.getState({ distributionLimit: 1000 });
  const newItemDefault = state.annualPolicies.find((row) => row.item_name === newItemName && Number(row.financial_year) === 2026);
  if (!newItemDefault || Number(newItemDefault.allowed_quantity) !== 0) {
    throw new Error(`A genuinely newly imported item did not receive its documented zero-quantity annual default. Items=${JSON.stringify(state.entitlementOptions.items)} Policies=${JSON.stringify(state.annualPolicies)}`);
  }
  if (state.annualPolicies.some((row) => row.item_name === 'Shirt' && Number(row.financial_year) === 2026)) {
    throw new Error('A previously deleted Shirt policy was recreated while importing a new item.');
  }

  console.log('Annual policy deletion and reset regression passed.');
  console.log('Verified explicit delete persistence across refresh/restart, explicit policy re-save, reset clearing annual and unit policies, preserved imports/distributions/actual prices, and default policy creation for a newly imported item.');
}

main().catch((error) => { console.error(error.stack || error); process.exitCode = 1; });
