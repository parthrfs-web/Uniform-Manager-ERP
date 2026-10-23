(function attachAnnualPolicyCsv(root, factory) {
  const api = factory();
  root.AnnualPolicyCsv = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
})(typeof window === 'undefined' ? globalThis : window, function createAnnualPolicyCsv() {
  function rowsFromCsv(textValue) {
    const rows = [];
    let row = [], field = '', quoted = false;
    const source = String(textValue || '').replace(/^\uFEFF/, '');
    for (let index = 0; index < source.length; index += 1) {
      const char = source[index];
      if (quoted) {
        if (char === '"' && source[index + 1] === '"') { field += '"'; index += 1; }
        else if (char === '"') quoted = false;
        else field += char;
      } else if (char === '"') quoted = true;
      else if (char === ',') { row.push(field); field = ''; }
      else if (char === '\n' || char === '\r') {
        if (char === '\r' && source[index + 1] === '\n') index += 1;
        row.push(field); field = '';
        if (row.some((cell) => String(cell).trim())) rows.push(row);
        row = [];
      } else field += char;
    }
    if (field || row.length) { row.push(field); if (row.some((cell) => String(cell).trim())) rows.push(row); }
    return rows;
  }

  function validate(textValue, recognizedItems) {
    const parsed = rowsFromCsv(textValue);
    if (parsed.length < 2) return { rows: [], errors: ['The CSV needs a header row and at least one item quantity row.'] };
    const header = parsed[0].map((cell) => String(cell).trim().toLowerCase().replace(/[_-]+/g, ' '));
    const itemColumn = header.findIndex((name) => ['item', 'item name', 'uniform item'].includes(name));
    const quantityColumn = header.findIndex((name) => ['allowed quantity', 'quantity'].includes(name));
    if (itemColumn < 0 || quantityColumn < 0) return { rows: [], errors: ['CSV headers must include Item and Allowed Quantity. Download the template for the correct format.'] };

    const known = new Map((recognizedItems || []).map((item) => [String(item).trim().toLocaleLowerCase(), String(item).trim()]));
    const seen = new Set();
    const rows = [];
    const errors = [];
    parsed.slice(1).forEach((cells, index) => {
      const itemValue = String(cells[itemColumn] || '').trim();
      const key = itemValue.toLocaleLowerCase();
      const quantityText = String(cells[quantityColumn] ?? '').trim();
      const quantity = quantityText === '' ? NaN : Number(quantityText);
      const rowNumber = index + 2;
      if (!key || !known.has(key)) { errors.push(`Row ${rowNumber}: item “${itemValue || 'blank'}” is not in the recognized item list.`); return; }
      if (seen.has(key)) { errors.push(`Row ${rowNumber}: duplicate item “${known.get(key)}”.`); return; }
      if (!Number.isInteger(quantity) || quantity < 0) { errors.push(`Row ${rowNumber}: Allowed Quantity must be a non-negative whole number.`); return; }
      seen.add(key);
      rows.push({ item_name: known.get(key), allowed_quantity: String(quantity) });
    });
    return { rows, errors };
  }

  return { validate, rowsFromCsv };
});
