const path = require("path");
const crypto = require("crypto");
const XLSX = require("xlsx");

const GODOWN_PATTERNS = ["godown", "go down", "godown name"];
const EMP_CODE_PATTERNS = ["emp code", "emp. code", "employee code", "empcode", "emp_code", "emp id", "card no", "code", "emp no", "employee no"];
const SR_NO_PATTERNS = ["sr.no", "sr no", "s.no", "s no", "sl.no", "sl no", "serial no", "serial", "sr.", "s.r.", "s.r.no", "sr.no.", "sr#", "s#", "no."];
const EMP_NAME_PATTERNS = ["emp name", "emp. name", "employee name", "empname", "emp_name", "full name", "guard name", "staff name", "name"];
const FATHER_PATTERNS = ["father's name", "father name", "father", "f/name", "f name", "fathername", "father husband name", "father/husband name"];
const UNIT_PATTERNS = ["unit", "department", "client", "company", "location", "branch", "site", "place", "dept", "unit name"];
const MOBILE_PATTERNS = ["mobile", "mobile number", "phone", "phone number", "contact", "contact number"];
const DESIGNATION_PATTERNS = ["designation", "post", "rank", "duty", "job title"];
const MONTH_PATTERNS = ["month", "for month", "for month of", "month of", "issue month", "issued month", "issued on month", "deducted in month of", "payroll month"];
const DATE_PATTERNS = ["date", "date of distribution", "issue date", "issued date", "distribution date"];

const META_SKIP_PATTERNS = [
  "sr", "sr.", "s.no", "sl.no", "sno", "serial", "sr. no. in their reg.", "sr. no", "sr no",
  "sex", "gender", "lady", "male", "female",
  "date", "month", "date of distribution", "for month of", "deducted in month of", "issued on month",
  "attendance", "att", "present",
  "total", "sub total", "subtotal", "grand total", "tot", "rs. total", "rs total", "amount", "rs",
  "difference", "diff", "deducted", "deductions", "deduction", "salary", "payroll", "rate", "price", "value",
  "remarks", "remark", "note", "notes", "avg", "average",
  "opn. stock", "opn stock", "opening stock", "opn bal", "received", "given", "cls. stock", "cls stock",
  "closing stock", "inword", "stock summary", "deployment needed", "deploy", "deployment", "details",
  "unit can ask", "unit received", "vendor", "qty", "qty (pr)", "summary", "previous", "prv", "prev",
];

const BAD_SHEET_PATTERNS = ["deduction", "salary", "payroll", "recovery", "waive", "summary", "abstract", "report", "previous", "prv", "prev"];
const GOOD_SHEET_PATTERNS = ["distribution", "distribut", "issue", "issued", "stock distribution", "uniform distribution", "challan", "sheet3"];

function norm(value) {
  if (value === null || value === undefined) return "";
  return String(value).toLowerCase().trim().replace(/\s+/g, " ");
}

function employeeIdentityName(value) {
  return String(value || "").trim().replace(/\s+/g, " ").toUpperCase();
}

function isManualPlaceholderCode(value) {
  const code = employeeIdentityName(value);
  return code === "" || code === "LEFT" || code === "LIFT" || code === "NEW";
}

function buildEmployeeIdentityCode(employeeCode, employeeName) {
  const rawCode = String(employeeCode || "").trim();
  const code = employeeIdentityName(rawCode);
  if (!isManualPlaceholderCode(rawCode)) return rawCode;
  const name = employeeIdentityName(employeeName);
  return `${code}|${name}`;
}

function compact(value) {
  return norm(value).replace(/[^a-z0-9]+/g, "");
}

function matchesAny(header, patterns) {
  const n = norm(header);
  const c = compact(header);
  if (!n) return false;
  return patterns.some((pattern) => {
    const p = norm(pattern);
    const pc = compact(pattern);
    return n === p || n.startsWith(`${p} `) || n.endsWith(` ${p}`) || n.includes(p) || (pc && c === pc);
  });
}

function isMetaCol(header) {
  return matchesAny(header, META_SKIP_PATTERNS);
}

function rowHasData(row) {
  return Array.isArray(row) && row.some((cell) => {
    if (cell === null || cell === undefined) return false;
    return String(cell).trim() !== "";
  });
}

function isSkipRow(row) {
  if (!rowHasData(row)) return true;
  for (const cell of row) {
    const value = norm(cell);
    if (!value) continue;
    if (["total", "grand total", "sub total", "subtotal"].includes(value)) return true;
  }
  return false;
}

function isSummaryContextValue(value) {
  const text = norm(value);
  if (!text) return false;
  return [
    "summary",
    "prv",
    "previous",
    "prev",
    "deduction",
    "salary",
    "payroll",
    "recovery",
    "waive",
  ].some((pattern) => text.includes(pattern));
}

function parseQuantity(value) {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  if (value === null || value === undefined) return 0;
  const text = String(value).trim();
  if (!text) return 0;
  const match = text.match(/-?\d+(?:\.\d+)?/);
  return match ? Number(match[0]) : 0;
}

const MONTH_NAMES = {
  jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3,
  apr: 4, april: 4, may: 5, jun: 6, june: 6, jul: 7, july: 7,
  aug: 8, august: 8, sep: 9, sept: 9, september: 9, oct: 10, october: 10,
  nov: 11, november: 11, dec: 12, december: 12,
};

function monthName(month) {
  return ["", "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][month] || "";
}

function excelSerialToDate(serial) {
  if (typeof serial !== "number" || !Number.isFinite(serial) || serial < 1000) return null;
  const date = new Date(Math.round((serial - 25569) * 86400 * 1000));
  if (date.getFullYear() < 2000 || date.getFullYear() > 2100) return null;
  return date;
}

function normalizeYear(yearText) {
  const year = Number(yearText);
  if (!Number.isFinite(year)) return null;
  if (year >= 2000 && year <= 2100) return year;
  if (year >= 0 && year <= 99) return 2000 + year;
  return null;
}

function parseIssuePeriod(value, fallback = {}) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    const month = value.getMonth() + 1;
    const year = value.getFullYear();
    return { issue_month: month, issue_year: year, issue_period_label: `${monthName(month)} ${year}` };
  }

  if (typeof value === "number") {
    if (Number.isInteger(value) && value >= 1 && value <= 12) {
      const year = fallback.issue_year || null;
      return { issue_month: value, issue_year: year, issue_period_label: `${monthName(value)}${year ? ` ${year}` : ""}` };
    }
    const date = excelSerialToDate(value);
    if (date) {
      const month = date.getMonth() + 1;
      const year = date.getFullYear();
      return { issue_month: month, issue_year: year, issue_period_label: `${monthName(month)} ${year}` };
    }
  }

  const text = value === null || value === undefined ? "" : String(value).trim();
  if (!text) return fallback;
  const clean = text.replace(/[._/]+/g, "-").replace(/\s+/g, " ").trim();
  const lower = clean.toLowerCase();
  
  const numericMonth = clean.match(/^(0?[1-9]|1[0-2])$/);
  if (numericMonth) {
    const month = Number(numericMonth[1]);
    const year = fallback.issue_year || null;
    return { issue_month: month, issue_year: year, issue_period_label: `${monthName(month)}${year ? ` ${year}` : ""}` };
  }
  
  const numericDate = clean.match(/\b(?:(\d{1,2})-(\d{1,2})-(20\d{2}|\d{2})|(20\d{2})-(\d{1,2})-(\d{1,2}))\b/);
  if (numericDate) {
    const month = Number(numericDate[2] || numericDate[5]);
    const year = normalizeYear(numericDate[3] || numericDate[4]);
    if (month >= 1 && month <= 12 && year) {
      return { issue_month: month, issue_year: year, issue_period_label: `${monthName(month)} ${year}` };
    }
  }
  
  const fiscal = lower.match(/\b(20\d{2})\s*[-–]\s*(\d{2}|20\d{2})\b/);
  const found = [];
  const monthRegex = /\b(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t|tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\b[\s-]*(\d{2,4})?/gi;
  let match;
  while ((match = monthRegex.exec(clean))) {
    const month = MONTH_NAMES[match[1].toLowerCase()];
    const year = normalizeYear(match[2]) || fallback.issue_year || (fiscal ? Number(fiscal[1]) : null);
    if (month) found.push({ month, year });
  }
  
  if (found.length) {
    const first = found[0];
    const label = found.map((entry) => `${monthName(entry.month)}${entry.year ? ` ${entry.year}` : ""}`).join(" - ");
    return { issue_month: first.month || null, issue_year: first.year || null, issue_period_label: label };
  }
  
  if (fiscal) {
    const start = Number(fiscal[1]);
    const end = typeof fiscal[2] === "string" && fiscal[2].length === 2 ? `20${fiscal[2]}` : fiscal[2];
    return { issue_month: null, issue_year: start, issue_period_label: `${start}-${end}` };
  }
  return { ...fallback, issue_period_label: text };
}

function detectSheetPeriod(rows, headerRowIdx) {
  const safeRows = Array.isArray(rows) ? rows : [];
  for (let rowIdx = 0; rowIdx < Math.min(headerRowIdx, 8, safeRows.length); rowIdx += 1) {
    const safeRow = Array.isArray(safeRows[rowIdx]) ? safeRows[rowIdx] : [];
    for (const cell of safeRow) {
      const period = parseIssuePeriod(cell);
      if (period.issue_period_label) return period;
    }
  }
  return { issue_month: null, issue_year: null, issue_period_label: "" };
}

function detectRowPeriod(row) {
  const safeRow = Array.isArray(row) ? row : [];
  for (const cell of safeRow) {
    const period = parseIssuePeriod(cell);
    if (period.issue_period_label && (period.issue_month || period.issue_year)) return period;
  }
  return { issue_month: null, issue_year: null, issue_period_label: "" };
}

function getRows(sheet, limit = 10000) {
  if (!sheet) return [];
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "", blankrows: false });
  return Array.isArray(rows) ? rows.filter(rowHasData).slice(0, limit) : [];
}

function readWorkbook(filePath) {
  return XLSX.readFile(filePath, { cellDates: false, cellStyles: false, cellFormula: false, cellHTML: false, dense: true });
}

function findHeaderRow(rows) {
  const safeRows = Array.isArray(rows) ? rows : [];
  for (let rowIdx = 0; rowIdx < Math.min(20, safeRows.length); rowIdx += 1) {
    const row = safeRows[rowIdx];
    if (!Array.isArray(row)) continue;
    const hasEmpCode = row.some((cell) => matchesAny(cell, EMP_CODE_PATTERNS));
    const hasEmpName = row.some((cell) => matchesAny(cell, EMP_NAME_PATTERNS));
    const hasSrNo = row.some((cell) => matchesAny(cell, SR_NO_PATTERNS));
    const hasGodown = row.some((cell) => matchesAny(cell, GODOWN_PATTERNS));
    const hasUnit = row.some((cell) => matchesAny(cell, UNIT_PATTERNS));
    const signals = [hasEmpCode, hasEmpName, hasSrNo, hasGodown || hasUnit].filter(Boolean).length;
    if (signals >= 2) return { rowIdx, headers: row };
  }
  return null;
}

function detectColumns(headers) {
  const colMap = { empCodeIdx: -1, empNameIdx: -1, fatherIdx: -1, unitIdx: -1, godownIdx: -1, mobileIdx: -1, designationIdx: -1, monthIdx: -1, dateIdx: -1, srNoIdx: -1, itemCols: [] };
  const safeHeaders = Array.isArray(headers) ? headers : [];
  if (safeHeaders.length === 0) return colMap;

  const used = new Set();
  safeHeaders.forEach((header, idx) => {
    if (matchesAny(header, GODOWN_PATTERNS)) {
      colMap.godownIdx = idx;
      used.add(idx);
    }
  });

  safeHeaders.forEach((header, idx) => {
    if (used.has(idx)) return;
    const n = norm(header);
    if (!n) return;
    if (colMap.empCodeIdx === -1 && matchesAny(header, EMP_CODE_PATTERNS)) { colMap.empCodeIdx = idx; used.add(idx); } 
    else if (colMap.empNameIdx === -1 && matchesAny(header, EMP_NAME_PATTERNS)) { colMap.empNameIdx = idx; used.add(idx); } 
    else if (colMap.fatherIdx === -1 && matchesAny(header, FATHER_PATTERNS)) { colMap.fatherIdx = idx; used.add(idx); } 
    else if (colMap.mobileIdx === -1 && matchesAny(header, MOBILE_PATTERNS)) { colMap.mobileIdx = idx; used.add(idx); } 
    else if (colMap.designationIdx === -1 && matchesAny(header, DESIGNATION_PATTERNS)) { colMap.designationIdx = idx; used.add(idx); } 
    else if (matchesAny(header, MONTH_PATTERNS)) { colMap.monthIdx = idx; used.add(idx); } 
    else if (matchesAny(header, DATE_PATTERNS)) { colMap.dateIdx = idx; used.add(idx); } 
    else if (colMap.unitIdx === -1 && matchesAny(header, UNIT_PATTERNS)) { colMap.unitIdx = idx; used.add(idx); } 
    else if (colMap.srNoIdx === -1 && matchesAny(header, SR_NO_PATTERNS)) { colMap.srNoIdx = idx; used.add(idx); }
  });

  safeHeaders.forEach((header, idx) => {
    if (used.has(idx)) return;
    const name = header === null || header === undefined ? "" : String(header).trim();
    if (!name || norm(name).length < 2 || isMetaCol(name)) return;
    colMap.itemCols.push({ idx, name });
  });

  return colMap;
}

function parseSheet(sheet, sheetName) {
  const rows = getRows(sheet);
  const header = findHeaderRow(rows);
  if (!header) return { sheetName, rows: [], header: null, parsedRows: [], skipped: 0, info: `${sheetName} (no header)`, score: 0 };

  const colMap = detectColumns(header.headers);
  
  const sheetPeriod = detectSheetPeriod(rows, header.rowIdx);
  const hasIdentity = colMap.empCodeIdx !== -1 || colMap.empNameIdx !== -1;
  
  if (!hasIdentity) {
    return { sheetName, rows: [], header: { ...header, colMap }, parsedRows: [], skipped: 0, info: `${sheetName} (no identity columns)`, score: 0 };
  }

  if (!colMap.itemCols.length) {
    return { sheetName, rows: [], header: { ...header, colMap }, parsedRows: [], skipped: 0, info: `${sheetName} (no uniform item columns)`, score: 0 };
  }

  const parsedRows = [];
  let skipped = 0;
  let totalIssuesCount = 0;
  let currentSectionPeriod = sheetPeriod;

  for (let rowIdx = header.rowIdx + 1; rowIdx < rows.length; rowIdx += 1) {
    const row = rows[rowIdx];
    if (!Array.isArray(row)) continue;
    if (isSkipRow(row)) continue;

    let employeeCode = colMap.empCodeIdx !== -1 && row[colMap.empCodeIdx] !== undefined ? String(row[colMap.empCodeIdx]).trim() : "";
    const employeeName = colMap.empNameIdx !== -1 && row[colMap.empNameIdx] !== undefined ? String(row[colMap.empNameIdx]).trim() : "";
    const itemEntries = [];
    colMap.itemCols.forEach((column) => {
      const quantity = parseQuantity(row[column.idx]);
      if (quantity > 0) itemEntries.push({ itemName: column.name, quantity });
    });
    const rowPeriod = detectRowPeriod(row);
    if (rowPeriod.issue_period_label && (!employeeName || !employeeCode) && itemEntries.length === 0) {
      currentSectionPeriod = rowPeriod;
      continue;
    }
    
    // Agar dono code aur name blank hain, toh strictly skip kardo
    if (!employeeCode && !employeeName) continue;
    if (["sr", "total", "grand total", "sub total", "name", "emp code", "sr no", "sr."].includes(employeeCode.toLowerCase())) continue;

    // Apply strict fallback for invalid employee codes. Blank manual rows get a name-qualified identity below.
    if (employeeCode && ["#ref!", "#n/a", "na", "n/a", "-", "null", "undefined"].includes(employeeCode.toLowerCase())) {
      employeeCode = "Unknown";
    }
    employeeCode = buildEmployeeIdentityCode(employeeCode, employeeName);

    const primaryUnit = colMap.unitIdx !== -1 && row[colMap.unitIdx] !== undefined ? String(row[colMap.unitIdx]).trim() : "";
    const godown = colMap.godownIdx !== -1 && row[colMap.godownIdx] !== undefined ? String(row[colMap.godownIdx]).trim() : "";
    if (isSummaryContextValue(primaryUnit) || isSummaryContextValue(godown)) continue;
    
    const rawMonth = colMap.monthIdx !== -1 ? row[colMap.monthIdx] : "";
    const rawDate = colMap.dateIdx !== -1 ? row[colMap.dateIdx] : "";
    
    let issuePeriod = {};
    if (rawMonth || rawDate) {
      const monthPeriod = parseIssuePeriod(rawMonth, currentSectionPeriod);
      const datePeriod = parseIssuePeriod(rawDate, currentSectionPeriod);
      issuePeriod = monthPeriod.issue_period_label ? monthPeriod : datePeriod;
    }

    if (!issuePeriod.issue_period_label) {
      issuePeriod = currentSectionPeriod;
    }

    const worksheetRow = {
      source_row: rowIdx + 1,
      employee_code: employeeCode,
      employee_name: employeeName || `Row ${rowIdx + 1}`,
      father_name: colMap.fatherIdx !== -1 && row[colMap.fatherIdx] !== undefined ? String(row[colMap.fatherIdx]).trim() : "",
      unit: primaryUnit,
      godown: godown,
      mobile_number: colMap.mobileIdx !== -1 && row[colMap.mobileIdx] !== undefined ? String(row[colMap.mobileIdx]).trim() : "",
      designation: colMap.designationIdx !== -1 && row[colMap.designationIdx] !== undefined ? String(row[colMap.designationIdx]).trim() : "",
      status: "Active",
      issue_month: issuePeriod.issue_month || null,
      issue_year: issuePeriod.issue_year || null,
      issue_period_label: issuePeriod.issue_period_label || "",
      items: itemEntries
    };

    parsedRows.push(worksheetRow);
    totalIssuesCount += itemEntries.length;
  }

  const safeHeaders = Array.isArray(header.headers) ? header.headers : [];
  const sheetText = `${sheetName} ${safeHeaders.join(" ")}`;
  const badPenalty = BAD_SHEET_PATTERNS.reduce((sum, pattern) => sum + (norm(sheetText).includes(pattern) ? 8 : 0), 0);
  const goodBonus = GOOD_SHEET_PATTERNS.reduce((sum, pattern) => sum + (norm(sheetName).includes(pattern) ? 4 : 0), 0);
  const score = parsedRows.length + totalIssuesCount + (colMap.godownIdx !== -1 ? 20 : 0) + goodBonus - badPenalty;

  return {
    sheetName,
    rows,
    header: { ...header, colMap },
    parsedRows,
    skipped,
    info: `${sheetName}: ${parsedRows.length} employees, ${totalIssuesCount} item entries`,
    score,
  };
}

function analyzeWorkbook(workbook) {
  if (!workbook || !Array.isArray(workbook.SheetNames)) return [];

  return workbook.SheetNames
    .map((sheetName) => {
      const parsed = parseSheet(workbook.Sheets[sheetName], sheetName);
      const header = parsed.header;
      
      const columns = header ? {
        employee_code: header.colMap.empCodeIdx !== -1 ? String(header.headers[header.colMap.empCodeIdx] || "") : "",
        employee_name: header.colMap.empNameIdx !== -1 ? String(header.headers[header.colMap.empNameIdx] || "") : "",
        father_name: header.colMap.fatherIdx !== -1 ? String(header.headers[header.colMap.fatherIdx] || "") : "",
        unit: header.colMap.unitIdx !== -1 ? String(header.headers[header.colMap.unitIdx] || "") : "",
        godown: header.colMap.godownIdx !== -1 ? String(header.headers[header.colMap.godownIdx] || "") : "",
        mobile_number: header.colMap.mobileIdx !== -1 ? String(header.headers[header.colMap.mobileIdx] || "") : "",
        designation: header.colMap.designationIdx !== -1 ? String(header.headers[header.colMap.designationIdx] || "") : "",
      } : {};

      const reasons = [parsed.info];
      if (header && header.colMap.unitIdx !== -1) reasons.push("Unit detected as Unit / Company");
      if (header && header.colMap.godownIdx !== -1) reasons.push("Godown detected as Godown");

      return {
        sheetName,
        rows: Array.isArray(parsed.rows) ? parsed.rows : [],
        parsed,
        header,
        likelyRows: Array.isArray(parsed.parsedRows) ? parsed.parsedRows.length : 0,
        score: parsed.score || 0,
        columns,
        itemColumns: header && Array.isArray(header.colMap.itemCols) ? header.colMap.itemCols.map((column) => ({ index: column.idx, itemName: column.name })) : [],
        sampleRows: Array.isArray(parsed.parsedRows) ? parsed.parsedRows.slice(0, 5).map((row) => ({
          employee_code: row.employee_code,
          employee_name: row.employee_name,
          father_name: row.father_name,
          unit: row.unit,
          godown: row.godown,
        })) : [],
        reasons,
      };
    })
    .sort((a, b) => b.score - a.score);
}

function buildParsedImport(filePath, candidate) {
  const safeParsedRows = Array.isArray(candidate.parsed?.parsedRows) ? candidate.parsed.parsedRows : [];
  
  const employees = [];
  const uniformIssues = [];
  
  safeParsedRows.forEach(row => {
    employees.push({
      source_row: row.source_row,
      employee_code: row.employee_code,
      employee_name: row.employee_name,
      father_name: row.father_name,
      unit: row.unit,
      godown: row.godown,
      mobile_number: row.mobile_number,
      designation: row.designation,
      status: row.status
    });
    
    if (Array.isArray(row.items)) {
      row.items.forEach(item => {
        uniformIssues.push({
          employee_code: row.employee_code,
          employee_name: row.employee_name,
          unit: row.unit,
          godown: row.godown,
          item_name: item.itemName,
          quantity: item.quantity,
          source_sheet: candidate.sheetName,
          source_row: row.source_row,
          issue_month: row.issue_month,
          issue_year: row.issue_year,
          issue_period_label: row.issue_period_label
        });
      });
    }
  });

  const summary = {
    fileName: path.basename(filePath) || "",
    filePath: filePath || "",
    selectedSheet: candidate.sheetName || "",
    importHash: "",
    totalRows: safeParsedRows.length,
    inserted: 0,
    updated: 0,
    skipped: candidate.parsed?.skipped || 0,
  };

  summary.importHash = crypto
    .createHash("sha256")
    .update(JSON.stringify({ sheet: candidate.sheetName || "", employees, uniformIssues }))
    .digest("hex");

  return { summary, employees, reviews: [], uniformIssues, worksheetRows: safeParsedRows, headerReport: candidate.columns || {} };
}

function parseCandidate(filePath, selectedSheetName = null) {
  const workbook = readWorkbook(filePath);
  const candidates = analyzeWorkbook(workbook);
  
  const detected = selectedSheetName
    ? candidates.find((candidate) => candidate.sheetName === selectedSheetName)
    : candidates.find((candidate) => Array.isArray(candidate.parsed?.parsedRows) && candidate.parsed.parsedRows.length > 0);

  if (!detected || !Array.isArray(detected.parsed?.parsedRows) || detected.parsed.parsedRows.length === 0) {
    throw new Error(
      selectedSheetName
        ? `The selected sheet "${selectedSheetName}" does not look like a distribution sheet.`
        : "No distribution sheet was found with employee rows."
    );
  }

  const parsed = buildParsedImport(filePath, detected);
  console.log("Workbook parsed");
  return parsed;
}

function inspectWorkbook(filePath) {
  const workbook = readWorkbook(filePath);
  const candidates = analyzeWorkbook(workbook);
  
  return {
    fileName: path.basename(filePath) || "",
    filePath: filePath || "",
    candidates: Array.isArray(candidates) ? candidates.map((candidate) => ({
      sheetName: candidate.sheetName || "",
      canImport: Boolean(Array.isArray(candidate.parsed?.parsedRows) && candidate.parsed.parsedRows.length > 0),
      score: Number((candidate.score || 0).toFixed(2)),
      likelyRows: Number(candidate.likelyRows || 0),
      headerRow: candidate.header ? candidate.header.rowIdx + 1 : null,
      columns: candidate.columns || {},
      itemColumns: Array.isArray(candidate.itemColumns) ? candidate.itemColumns : [],
      sampleRows: Array.isArray(candidate.sampleRows) ? candidate.sampleRows : [],
      reasons: Array.isArray(candidate.reasons) ? candidate.reasons : [],
    })) : [],
  };
}

function buildValidatedImport(parsed) {
  const validEmployees = [];
  const validIssues = [];
  const validationErrors = [];
  const reviews = [];
  let validWorksheetRows = 0;
  let invalidWorksheetRows = 0;
  let duplicateWorksheetRows = 0;
  let generatedIssues = 0;

  const worksheetRows = Array.isArray(parsed.worksheetRows) ? parsed.worksheetRows : [];
  for (const row of worksheetRows) {
    let error = null;

    if (!row.employee_code) error = "Employee Code missing";
    else if (!row.employee_name) error = "Employee Name missing";

    if (error) {
      validationErrors.push({
        row: row.source_row || "-",
        employee_code: row.employee_code || "-",
        employee_name: row.employee_name || "-",
        reason: error,
      });
      invalidWorksheetRows += 1;
      continue;
    }

    const rowIssues = [];
    const items = Array.isArray(row.items) ? row.items : [];
    for (const item of items) {
      rowIssues.push({
        employee_code: row.employee_code,
        employee_name: row.employee_name,
        unit: row.unit,
        godown: row.godown,
        item_name: item.itemName,
        quantity: item.quantity,
        issue_month: row.issue_month,
        issue_year: row.issue_year,
        issue_period_label: row.issue_period_label,
        source_sheet: parsed.summary.selectedSheet,
        source_row: row.source_row,
      });
    }

    if (items.length > 0 && rowIssues.length === 0) {
      duplicateWorksheetRows += 1;
      validationErrors.push({
        row: row.source_row || "-",
        employee_code: row.employee_code,
        employee_name: row.employee_name,
        reason: "Duplicate Distribution",
      });
      continue;
    }

    validWorksheetRows += 1;
    validEmployees.push({
      employee_code: row.employee_code,
      employee_name: row.employee_name,
      father_name: row.father_name,
      unit: row.unit,
      godown: row.godown,
      mobile_number: row.mobile_number,
      designation: row.designation,
      status: "Active",
    });

    if (!row.unit) {
      reviews.push({
        employee_code: row.employee_code,
        employee_name: row.employee_name,
        unit: "",
        reason: "Unit Missing",
      });
    }

    validIssues.push(...rowIssues);
    generatedIssues += rowIssues.length;
  }

  return {
    validEmployees,
    validIssues,
    validationErrors,
    reviews,
    stats: {
      totalWorksheetRows: worksheetRows.length,
      validWorksheetRows,
      invalidWorksheetRows,
      duplicateWorksheetRows,
      generatedIssues,
    },
  };
}

function importWorkbook(filePath, db) {
  const start = Date.now();
  const parsed = parseCandidate(filePath);
  const validated = buildValidatedImport(parsed);
  const summary = {
    ...parsed.summary,
    ...validated.stats,
  };

  if (summary.importHash && typeof db.hasImportHash === "function" && db.hasImportHash(summary.importHash)) {
    return {
      ...summary,
      duplicate: true,
      inserted: 0,
      updated: 0,
      skipped: summary.totalWorksheetRows || summary.totalRows || 0,
    };
  }

  const employeeResult = db.bulkUpsertEmployees(validated.validEmployees);
  summary.inserted = employeeResult.inserted || 0;
  summary.updated = employeeResult.updated || 0;

  if (validated.reviews.length && typeof db.bulkCreateReviews === "function") {
    db.bulkCreateReviews(validated.reviews);
  }

  const importId = db.recordImport(summary);
  db.bulkCreateUniformIssues(validated.validIssues, importId);

  if (typeof db.ensureDefaultPoliciesForImport === "function") {
    db.ensureDefaultPoliciesForImport(importId);
  }

  if (typeof db.evaluateEntitlementsForImport === "function") {
    const generatedReviews = db.evaluateEntitlementsForImport(importId);
    summary.generatedReviews = Number(generatedReviews || 0);
    if (typeof db.updateImportReviewsCount === "function") {
      db.updateImportReviewsCount(importId, summary.generatedReviews);
    }
  }

  summary.durationMs = Date.now() - start;
  summary.failedCount = validated.validationErrors.length;
  summary.duplicateCount = summary.duplicateWorksheetRows || 0;
  return summary;
}

module.exports = { parseCandidate, inspectWorkbook, importWorkbook };
