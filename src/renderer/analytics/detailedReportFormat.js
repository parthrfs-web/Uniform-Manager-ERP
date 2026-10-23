(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) module.exports = factory();
  else root.buildDetailedReportWorksheet = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  function toExcelColumn(index) {
    let value = Number(index) + 1;
    let label = '';
    while (value > 0) {
      const remainder = (value - 1) % 26;
      label = String.fromCharCode(65 + remainder) + label;
      value = Math.floor((value - 1) / 26);
    }
    return label;
  }

  return function buildDetailedReportWorksheet(data) {
    const items = data.items || [];
    const headers = ['Sr.', 'Sr. No. in their Register', 'Code', 'Name', 'Father', 'Unit', 'For Month of', 'Deducted in Month of', ...items, 'Total'];
    const info = new Map((data.itemInfo || []).map((entry) => [entry.item, entry]));
    const makeMeta = (label, key) => {
      const row = Array(headers.length).fill('');
      row[7] = label;
      items.forEach((item, index) => { row[8 + index] = info.get(item)?.[key] ?? 'N/A'; });
      return row;
    };
    const worksheetRows = [
      [data.reportTitle || 'Detailed Deductions'],
      makeMeta('Max Supplied p.a.', 'max_supplied_pa'),
      makeMeta('Deduction Rate', 'deduction_rate'),
      makeMeta('Actual Rate', 'actual_rate'),
      headers,
      ...(data.rows || []).map((row) => [row.sr, row.register_serial ?? 'N/A', row.employee_code, row.employee_name, row.father_name, row.unit, row.for_month, row.deduction_month_display || 'N/A', ...items.map((item) => Number(row.items[item] || 0)), row.total]),
    ];
    return {
      headers,
      worksheetRows,
      columnWidths: [7, 16, 12, 28, 24, 18, 16, 19, ...items.map(() => 14), 16],
      freezePane: { xSplit: 8, ySplit: 5 },
      merges: [{ startRow: 0, startCol: 0, endRow: 0, endCol: headers.length - 1 }],
      autoFilter: `A5:${toExcelColumn(headers.length - 1)}${worksheetRows.length}`,
    };
  };
});
