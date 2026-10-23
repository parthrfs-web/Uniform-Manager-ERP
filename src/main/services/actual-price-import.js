const path = require('path');
const XLSX = require('xlsx');

function parseActualPriceFile(filePath) {
  const extension = path.extname(String(filePath || '')).toLowerCase();
  if (!['.xlsx', '.xls', '.csv'].includes(extension)) throw new Error('Choose an Excel workbook or CSV file.');
  let workbook;
  try { workbook = XLSX.readFile(filePath, { cellDates: false }); }
  catch (error) { throw new Error(`Could not read the selected Excel/CSV file: ${error.message || error}`); }
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) throw new Error('The selected file contains no worksheet or CSV data.');
  const matrix = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { header: 1, defval: '', raw: false });
  if (!matrix.length) throw new Error('The selected file has no header row.');
  const normalize = (value) => String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const headers = matrix[0].map(normalize);
  const findHeader = (accepted) => headers.findIndex((header) => accepted.includes(header));
  const itemIndex = findHeader(['item name', 'item', 'uniform item']);
  const priceIndex = findHeader(['actual price', 'actual rate', 'price']);
  const unitIndex = findHeader(['unit name', 'unit', 'client']);
  if (itemIndex < 0 || priceIndex < 0) throw new Error('Required columns not found. Include clearly labelled Item Name and Actual Price columns.');
  const rows = matrix.slice(1).map((cells, index) => ({
    row_number: index + 2,
    item_name: cells[itemIndex],
    actual_price: cells[priceIndex],
    unit: unitIndex >= 0 ? cells[unitIndex] : '',
  })).filter((row) => row.item_name !== '' || row.actual_price !== '' || row.unit !== '');
  if (!rows.length) throw new Error('The selected file has headers but no price rows.');
  return { sheetName, rows };
}

module.exports = { parseActualPriceFile };
