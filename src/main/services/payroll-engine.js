const XLSX = require('xlsx');

function generatePayrollWorkbook(data) {
  // data is expected to be an array of objects from the payroll_deductions table
  const ws = XLSX.utils.json_to_sheet(data);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "PayrollRegister");
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
}

function groupPayrollByEmployee(records) {
  const grouped = {};
  records.forEach(r => {
    if (!grouped[r.employee_code]) {
      grouped[r.employee_code] = {
        name: r.employee_name,
        unit: r.unit,
        items: [],
        total: 0
      };
    }
    grouped[r.employee_code].items.push(r);
    grouped[r.employee_code].total += r.amount;
  });
  return grouped;
}

module.exports = { generatePayrollWorkbook, groupPayrollByEmployee };