const path = require("path");
const crypto = require("crypto");
const XLSX = require("xlsx");

const IDENTITY_PATTERNS = {
  empCode: ["emp code", "emp. code", "employee code", "empcode", "emp_code", "emp id", "card no", "code", "emp no", "employee no"],
  empName: ["emp name", "emp. name", "employee name", "empname", "emp_name", "full name", "guard name", "staff name", "name"],
  father: ["father's name", "father name", "father", "f/name", "f name", "fathername", "father husband name", "father/husband name"],
  unit: ["unit", "department", "client", "company", "location", "branch", "site", "place", "dept", "unit name"],
  godown: ["godown", "go down", "godown name"],
  mobile: ["mobile", "mobile number", "phone", "phone number", "contact", "contact number"],
  designation: ["designation", "post", "rank", "duty", "job title"],
  month: ["month", "for month", "for month of", "month of", "issue month", "issued month", "issued on month", "deducted in month of", "payroll month"],
  date: ["date", "date of distribution", "issue date", "issued date", "distribution date"],
  srNo: ["sr.no", "sr no", "s.no", "s no", "sl.no", "sl no", "serial no", "serial", "sr.", "s.r.", "s.r.no", "sr.no.", "sr#", "s#", "no."]
};

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
  "unit can ask", "unit received", "vendor", "qty", "qty (pr)", "summary", "previous", "prv", "prev"
];

const BAD_SHEET_PATTERNS = ["deduction", "salary", "payroll", "recovery", "waive", "summary", "abstract", "report", "previous", "prv", "prev"];
const GOOD_SHEET_PATTERNS = ["distribution", "distribut", "issue", "issued", "stock distribution", "uniform distribution", "challan", "sheet3"];

function normalizeString(value) {
  if (value === null || value === undefined) return "";
  return String(value).trim().replace(/\s+/g, " ");
}

function normalizeHeader(value) {
  return normalizeString(value).toLowerCase();
}

function compact(value) {
  return normalizeHeader(value).replace(/[^a-z0-9]+/g, "");
}

function matchesAny(header, patterns) {
  const n = normalizeHeader(header);
  const c = compact(header);
  if (!n) return false;
  return patterns.some((pattern) => {
    const p = normalizeHeader(pattern);
    const pc = compact(pattern);
    if (!p) return false;
    return n === p || n.startsWith(`${p} `) || n.endsWith(` ${p}`) || n.includes(` ${p} `) || (pc && c === pc);
  });
}

function isMetaCol(header) {
  const n = normalizeHeader(header);
  const c = compact(header);
  if (!n) return false;
  if (/\b(deduction|deductions|deducted|amount|salary|payroll|rate|price|value)\b/.test(n)) return true;
  return META_SKIP_PATTERNS.some((pattern) => {
    const p = normalizeHeader(pattern);
    const pc = compact(pattern);
    if (!p) return false;
    return n === p || (pc && c === pc);
  });
}

function rowHasData(row) {
  return Array.isArray(row) && row.some((cell) => cell !== null && cell !== undefined && String(cell).trim() !== "");
}

function isSkipRow(row) {
  if (!rowHasData(row)) return true;
  for (const cell of row) {
    const value = normalizeHeader(cell);
    if (!value) continue;
    if (["total", "grand total", "sub total", "subtotal"].includes(value)) return true;
  }
  return false;
}

function isSummaryContextValue(value) {
  const text = normalizeHeader(value);
  if (!text) return false;
  const words = text.split(/\s+/);
  return ["summary", "prv", "previous", "prev", "deduction", "salary", "payroll", "recovery", "waive"].some(pattern => words.includes(pattern));
}

function parseQuantity(value) {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  if (value === null || value === undefined || value === "") return 0;
  const text = String(value).trim();
  if (!text) return 0;
  const match = text.match(/^-?\d+(?:\.\d+)?/);
  const qty = match ? Number(match[0]) : 0;
  return Number.isNaN(qty) ? 0 : qty;
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
  for (let rowIdx = 0; rowIdx < Math.min(headerRowIdx, 8, rows.length); rowIdx += 1) {
    for (const cell of rows[rowIdx]) {
      const period = parseIssuePeriod(cell);
      if (period.issue_period_label) return period;
    }
  }
  return { issue_month: null, issue_year: null, issue_period_label: "" };
}

function detectRowPeriod(row) {
  for (const cell of row) {
    const period = parseIssuePeriod(cell);
    if (period.issue_period_label && (period.issue_month || period.issue_year)) return period;
  }
  return { issue_month: null, issue_year: null, issue_period_label: "" };
}

function getRows(sheet) {
  if (!sheet) return [];
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "", blankrows: false });
  return Array.isArray(rows) ? rows.filter(rowHasData) : [];
}

function readWorkbook(filePath) {
  return XLSX.readFile(filePath, { cellDates: false, cellStyles: false, cellFormula: false, cellHTML: false, dense: true });
}

function findHeaderRow(rows) {
  for (let rowIdx = 0; rowIdx < Math.min(20, rows.length); rowIdx += 1) {
    const row = rows[rowIdx];
    if (!Array.isArray(row)) continue;
    const signals = [
      row.some((cell) => matchesAny(cell, IDENTITY_PATTERNS.empCode)),
      row.some((cell) => matchesAny(cell, IDENTITY_PATTERNS.empName)),
      row.some((cell) => matchesAny(cell, IDENTITY_PATTERNS.srNo)),
      row.some((cell) => matchesAny(cell, IDENTITY_PATTERNS.godown) || matchesAny(cell, IDENTITY_PATTERNS.unit))
    ].filter(Boolean).length;
    if (signals >= 2) return { rowIdx, headers: row.map(h => normalizeString(h)) };
  }
  return null;
}

function detectColumns(headers, warnings) {
  const colMap = { empCodeIdx: -1, empNameIdx: -1, fatherIdx: -1, unitIdx: -1, godownIdx: -1, mobileIdx: -1, designationIdx: -1, monthIdx: -1, dateIdx: -1, srNoIdx: -1, itemCols: [] };
  const used = new Set();
  const duplicateCheck = new Set();

  headers.forEach((header, idx) => {
    if (matchesAny(header, IDENTITY_PATTERNS.godown)) { colMap.godownIdx = idx; used.add(idx); }
  });

  headers.forEach((header, idx) => {
    if (used.has(idx)) return;
    const n = normalizeHeader(header);
    if (!n) return;
    
    if (colMap.empCodeIdx === -1 && matchesAny(header, IDENTITY_PATTERNS.empCode)) { colMap.empCodeIdx = idx; used.add(idx); } 
    else if (colMap.empNameIdx === -1 && matchesAny(header, IDENTITY_PATTERNS.empName)) { colMap.empNameIdx = idx; used.add(idx); } 
    else if (colMap.fatherIdx === -1 && matchesAny(header, IDENTITY_PATTERNS.father)) { colMap.fatherIdx = idx; used.add(idx); } 
    else if (colMap.mobileIdx === -1 && matchesAny(header, IDENTITY_PATTERNS.mobile)) { colMap.mobileIdx = idx; used.add(idx); } 
    else if (colMap.designationIdx === -1 && matchesAny(header, IDENTITY_PATTERNS.designation)) { colMap.designationIdx = idx; used.add(idx); } 
    else if (matchesAny(header, IDENTITY_PATTERNS.month)) { colMap.monthIdx = idx; used.add(idx); } 
    else if (matchesAny(header, IDENTITY_PATTERNS.date)) { colMap.dateIdx = idx; used.add(idx); } 
    else if (colMap.unitIdx === -1 && matchesAny(header, IDENTITY_PATTERNS.unit)) { colMap.unitIdx = idx; used.add(idx); } 
    else if (colMap.srNoIdx === -1 && matchesAny(header, IDENTITY_PATTERNS.srNo)) { colMap.srNoIdx = idx; used.add(idx); }
  });

  headers.forEach((header, idx) => {
    if (used.has(idx)) return;
    const name = normalizeString(header);
    if (!name || name.length < 2 || isMetaCol(name)) return;
    
    const compactName = compact(name);
    if (duplicateCheck.has(compactName)) {
        warnings.push(`Duplicate item header detected and ignored: ${name}`);
        return;
    }
    
    duplicateCheck.add(compactName);
    colMap.itemCols.push({ idx, name });
  });

  return colMap;
}

function buildEmployeeIdentity(empCode, employeeName, fatherName) {
    const c = normalizeString(empCode).toUpperCase().replace(/\s+/g, ' ');
    const n = normalizeString(employeeName).toUpperCase().replace(/\s+/g, ' ');
    const f = normalizeString(fatherName).toUpperCase().replace(/\s+/g, ' ');
    return `${c}|${n}|${f}`;
}

function normalizeIdentityPart(value) {
  return normalizeString(value).toUpperCase().replace(/\s+/g, " ");
}

function isPlaceholderEmployeeCode(value) {
  const code = normalizeIdentityPart(value);
  return !code || ["NEW", "LEFT", "LIFT", "BLANK"].includes(code);
}

function placeholderIdentityKey(placeholderCode, employeeName, fatherName) {
  return [
    normalizeIdentityPart(placeholderCode) || "BLANK",
    normalizeIdentityPart(employeeName),
    normalizeIdentityPart(fatherName),
  ].join("|");
}

function nextGeneratedEmployeeCode(usedCodes) {
  let next = 1;
  for (const code of usedCodes) {
    const match = String(code || "").trim().toUpperCase().match(/^EMP(\d{6,})$/);
    if (match) next = Math.max(next, Number(match[1]) + 1);
  }

  let candidate = "";
  do {
    candidate = `EMP${String(next).padStart(6, "0")}`;
    next += 1;
  } while (usedCodes.has(candidate));

  usedCodes.add(candidate);
  return candidate;
}

function parseSheet(sheet, sheetName) {
  const rows = getRows(sheet);
  const header = findHeaderRow(rows);
  const warnings = [];
  const errors = [];
  
  if (!header) {
      return { sheetName, rows: [], header: null, parsedRows: [], skipped: 0, info: `${sheetName} (no header)`, score: 0, warnings, errors, expectedMetrics: {} };
  }

  const colMap = detectColumns(header.headers, warnings);
  const sheetPeriod = detectSheetPeriod(rows, header.rowIdx);
  const hasIdentity = colMap.empCodeIdx !== -1 || colMap.empNameIdx !== -1;
  
  if (!hasIdentity) {
    return { sheetName, rows: [], header: { ...header, colMap }, parsedRows: [], skipped: 0, info: `${sheetName} (no identity columns)`, score: 0, warnings, errors, expectedMetrics: {} };
  }

  if (!colMap.itemCols.length) {
    return { sheetName, rows: [], header: { ...header, colMap }, parsedRows: [], skipped: 0, info: `${sheetName} (no uniform item columns)`, score: 0, warnings, errors, expectedMetrics: {} };
  }

  const parsedRows = [];
  let skipped = 0;
  
  let expectedTotalQuantity = 0;
  let expectedTotalIssues = 0;
  const uniqueExpectedEmployees = new Set();
  
  let currentSectionPeriod = sheetPeriod;
  const duplicateRowSet = new Set();

  for (let rowIdx = header.rowIdx + 1; rowIdx < rows.length; rowIdx += 1) {
    const row = rows[rowIdx];
    if (!Array.isArray(row) || isSkipRow(row)) {
        skipped++;
        continue;
    }

    const rawCodeText = colMap.empCodeIdx !== -1 ? normalizeString(row[colMap.empCodeIdx]) : "";
    const rawNameText = colMap.empNameIdx !== -1 ? normalizeString(row[colMap.empNameIdx]) : "";
    const rawFatherText = colMap.fatherIdx !== -1 ? normalizeString(row[colMap.fatherIdx]) : "";
    
    const rowPeriod = detectRowPeriod(row);
    if (rowPeriod.issue_period_label && !rawNameText && !rawCodeText) {
      currentSectionPeriod = rowPeriod;
      skipped++;
      continue;
    }
    
    if (!rawCodeText && !rawNameText) {
        skipped++;
        continue;
    }
    if (["SR", "TOTAL", "GRAND TOTAL", "SUB TOTAL", "NAME", "EMP CODE", "SR NO", "SR."].includes(rawCodeText.toUpperCase())) {
        skipped++;
        continue;
    }

    const primaryUnit = colMap.unitIdx !== -1 ? normalizeString(row[colMap.unitIdx]) : "";
    const godown = colMap.godownIdx !== -1 ? normalizeString(row[colMap.godownIdx]) : "";
    
    if (isSummaryContextValue(primaryUnit) || isSummaryContextValue(godown)) {
        skipped++;
        continue;
    }

    const internalId = buildEmployeeIdentity(rawCodeText, rawNameText, rawFatherText);
    uniqueExpectedEmployees.add(internalId);

    let issuePeriod = {};
    const rawMonth = colMap.monthIdx !== -1 ? row[colMap.monthIdx] : "";
    const rawDate = colMap.dateIdx !== -1 ? row[colMap.dateIdx] : "";
    
    if (rawMonth || rawDate) {
      const monthPeriod = parseIssuePeriod(rawMonth, currentSectionPeriod);
      const datePeriod = parseIssuePeriod(rawDate, currentSectionPeriod);
      issuePeriod = monthPeriod.issue_period_label ? monthPeriod : datePeriod;
    }
    if (!issuePeriod.issue_period_label) issuePeriod = currentSectionPeriod;

    const itemEntries = [];
    let rowQuantitySum = 0;

    colMap.itemCols.forEach((column) => {
      const quantity = parseQuantity(row[column.idx]);
      if (quantity > 0) {
          itemEntries.push({ itemName: column.name, quantity });
          rowQuantitySum += quantity;
      }
    });

    const rowHash = crypto.createHash('sha256').update(`${internalId}|${issuePeriod.issue_period_label}|${JSON.stringify(itemEntries)}`).digest('hex');
    if (duplicateRowSet.has(rowHash)) {
        warnings.push(`Duplicate row skipped for employee ${rawCodeText} at row ${rowIdx + 1}`);
        skipped++;
        continue;
    }
    duplicateRowSet.add(rowHash);

    expectedTotalQuantity += rowQuantitySum;
    expectedTotalIssues += itemEntries.length;

    parsedRows.push({
      source_row: rowIdx + 1,
      employee_code: rawCodeText, 
      employee_name: rawNameText,
      father_name: rawFatherText,
      unit: primaryUnit,
      godown: godown,
      mobile_number: colMap.mobileIdx !== -1 ? normalizeString(row[colMap.mobileIdx]) : "",
      designation: colMap.designationIdx !== -1 ? normalizeString(row[colMap.designationIdx]) : "",
      status: "Active",
      issue_month: issuePeriod.issue_month || null,
      issue_year: issuePeriod.issue_year || null,
      issue_period_label: issuePeriod.issue_period_label || "",
      items: itemEntries
    });
  }

  const sheetText = `${sheetName} ${header.headers.join(" ")}`;
  const badPenalty = BAD_SHEET_PATTERNS.reduce((sum, pattern) => sum + (normalizeHeader(sheetText).includes(pattern) ? 8 : 0), 0);
  const goodBonus = GOOD_SHEET_PATTERNS.reduce((sum, pattern) => sum + (normalizeHeader(sheetName).includes(pattern) ? 4 : 0), 0);
  const score = parsedRows.length + expectedTotalIssues + (colMap.godownIdx !== -1 ? 20 : 0) + goodBonus - badPenalty;

  return {
    sheetName,
    rows,
    header: { ...header, colMap },
    parsedRows,
    skipped,
    info: `${sheetName}: ${parsedRows.length} employees, ${expectedTotalIssues} item entries`,
    score,
    warnings,
    errors,
    expectedMetrics: {
        expectedTotalEmployees: uniqueExpectedEmployees.size,
        expectedTotalIssues,
        expectedTotalQuantity
    }
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
      parsed.warnings.forEach(w => reasons.push(`WARNING: ${w}`));
      parsed.errors.forEach(e => reasons.push(`ERROR: ${e}`));

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
    expectedMetrics: candidate.parsed?.expectedMetrics || {}
  };

  summary.importHash = crypto.createHash("sha256").update(JSON.stringify({ sheet: candidate.sheetName || "", employees, uniformIssues })).digest("hex");

  return { summary, employees, reviews: [], uniformIssues, worksheetRows: safeParsedRows, headerReport: candidate.columns || {} };
}

function parseCandidate(filePath, selectedSheetName = null) {
  const workbook = readWorkbook(filePath);
  const candidates = analyzeWorkbook(workbook);
  
  const detected = selectedSheetName
    ? candidates.find((candidate) => candidate.sheetName === selectedSheetName)
    : candidates.find((candidate) => Array.isArray(candidate.parsed?.parsedRows) && candidate.parsed.parsedRows.length > 0);

  if (!detected || !Array.isArray(detected.parsed?.parsedRows) || detected.parsed.parsedRows.length === 0) {
    throw new Error(selectedSheetName ? `The selected sheet "${selectedSheetName}" does not look like a distribution sheet.` : "No distribution sheet was found with employee rows.");
  }

  const parsed = buildParsedImport(filePath, detected);
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

function buildValidatedImport(parsed, allEmployees = []) {
  const validEmployees = [];
  const validIssues = [];
  const validationErrors = [];
  const reviews = [];
  
  let validWorksheetRows = 0;
  let invalidWorksheetRows = 0;
  let duplicateWorksheetRows = 0;
  let generatedIssues = 0;
  let generatedQuantity = 0;
  let employeesWithItems = 0;
  let employeesWithZeroItems = 0;

  const worksheetRows = Array.isArray(parsed.worksheetRows) ? parsed.worksheetRows : [];
  const uniqueEmployeeMap = new Map();
  const usedEmployeeCodes = new Set(
    (Array.isArray(allEmployees) ? allEmployees : [])
      .map((employee) => normalizeIdentityPart(employee.employee_code))
      .filter(Boolean)
  );
  const existingPlaceholderEmployees = new Map();

  (Array.isArray(allEmployees) ? allEmployees : []).forEach((employee) => {
    const importedCode = normalizeIdentityPart(employee.imported_employee_code);
    if (!isPlaceholderEmployeeCode(importedCode)) return;
    const key = placeholderIdentityKey(importedCode, employee.employee_name, employee.father_name);
    if (!existingPlaceholderEmployees.has(key) && employee.employee_code) {
      existingPlaceholderEmployees.set(key, String(employee.employee_code).trim());
    }
  });

  for (const row of worksheetRows) {
    let error = null;
    
    let rawCode = String(row.employee_code || "").trim();
    const upperCode = normalizeIdentityPart(rawCode);
    const isPlaceholder = isPlaceholderEmployeeCode(rawCode);
    
    if (isPlaceholder) {
        const placeholder = upperCode || "BLANK";
        const key = placeholderIdentityKey(placeholder, row.employee_name, row.father_name);
        const existingCode = existingPlaceholderEmployees.get(key);

        if (existingCode) {
          row.employee_code = existingCode;
          usedEmployeeCodes.add(normalizeIdentityPart(existingCode));
        } else {
          row.employee_code = nextGeneratedEmployeeCode(usedEmployeeCodes);
          existingPlaceholderEmployees.set(key, row.employee_code);
        }
        row.imported_employee_code = placeholder;
    } else {
        row.employee_code = rawCode;
        row.imported_employee_code = "";
        usedEmployeeCodes.add(normalizeIdentityPart(rawCode));
    }

    if (!row.employee_code && !row.employee_name) error = "Identity missing";

    if (error) {
      validationErrors.push({ row: row.source_row || "-", employee_code: row.employee_code || "-", employee_name: row.employee_name || "-", reason: error });
      invalidWorksheetRows += 1;
      continue;
    }

    const internalId = buildEmployeeIdentity(row.employee_code, row.employee_name, row.father_name);
    
    if (!uniqueEmployeeMap.has(internalId)) {
        uniqueEmployeeMap.set(internalId, {
          employee_code: row.employee_code || "",
          imported_employee_code: row.imported_employee_code || "",
          employee_name: row.employee_name || "",
          father_name: row.father_name || "",
          unit: row.unit || "",
          godown: row.godown || "",
          mobile_number: row.mobile_number || "",
          designation: row.designation || "",
          status: "Active",
          hasItems: false
        });
    }

    const rowIssues = [];
    const items = Array.isArray(row.items) ? row.items : [];
    let rowHasItems = false;
    
    for (const item of items) {
      if (item.quantity > 0) {
          rowHasItems = true;
          rowIssues.push({
            employee_code: row.employee_code || "",
            employee_name: row.employee_name || "",
            unit: row.unit || "",
            godown: row.godown || "",
            item_name: item.itemName,
            quantity: item.quantity,
            issue_month: row.issue_month,
            issue_year: row.issue_year,
            issue_period_label: row.issue_period_label,
            source_sheet: parsed.summary.selectedSheet,
            source_row: row.source_row,
          });
          generatedQuantity += item.quantity;
      }
    }

    if (items.length > 0 && rowIssues.length === 0) {
      duplicateWorksheetRows += 1;
    }

    if (rowHasItems) {
        uniqueEmployeeMap.get(internalId).hasItems = true;
        if (!row.unit) {
          reviews.push({ employee_code: row.employee_code || "", employee_name: row.employee_name || "", unit: "", reason: "Unit Missing" });
        }
        validIssues.push(...rowIssues);
        generatedIssues += rowIssues.length;
    }

    validWorksheetRows += 1;
  }

  const expected = parsed.summary.expectedMetrics;
  if (expected) {
      if (expected.expectedTotalEmployees !== uniqueEmployeeMap.size ||
          expected.expectedTotalIssues !== generatedIssues ||
          expected.expectedTotalQuantity !== generatedQuantity) {
          validationErrors.push({
              row: "SYSTEM", employee_code: "ALL", employee_name: "ALL",
              reason: `CRITICAL AUDIT FAILURE: Expected ${expected.expectedTotalEmployees} employees, ${expected.expectedTotalIssues} issues (${expected.expectedTotalQuantity} qty). Generated ${uniqueEmployeeMap.size} employees, ${generatedIssues} issues (${generatedQuantity} qty).`
          });
      }
  }

  const finalEmployees = Array.from(uniqueEmployeeMap.values());
  finalEmployees.forEach(e => {
      if (e.hasItems) employeesWithItems++;
      else employeesWithZeroItems++;
      delete e.hasItems;
  });

  return {
    validEmployees: finalEmployees,
    validIssues,
    validationErrors,
    reviews,
    stats: {
      totalWorksheetRows: worksheetRows.length,
      validWorksheetRows,
      invalidWorksheetRows,
      duplicateWorksheetRows,
      generatedIssues,
      generatedQuantity,
      expectedTotalEmployees: expected?.expectedTotalEmployees || 0,
      employeesWithItems,
      employeesWithZeroItems
    },
  };
}

function importWorkbook(filePath, db) {
  const start = Date.now();
  const allEmployees = db.getState().employees || [];
  const parsed = parseCandidate(filePath);
  const validated = buildValidatedImport(parsed, allEmployees);
  const summary = { ...parsed.summary, ...validated.stats };

  if (validated.validationErrors.some(e => e.reason.includes("CRITICAL AUDIT FAILURE"))) {
      throw new Error(validated.validationErrors.find(e => e.reason.includes("CRITICAL AUDIT FAILURE")).reason);
  }

  if (summary.importHash && typeof db.hasImportHash === "function" && db.hasImportHash(summary.importHash)) {
    return { ...summary, duplicate: true, inserted: 0, updated: 0, skipped: summary.totalWorksheetRows || summary.totalRows || 0 };
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
  
  console.log("\n=== IMPORT AUDIT REPORT ===");
  console.log(`Employees Found: ${validated.stats.expectedTotalEmployees}`);
  console.log(`Employees Created: ${summary.inserted}`);
  console.log(`Employees Updated: ${summary.updated}`);
  console.log(`Employees With Zero Items: ${validated.stats.employeesWithZeroItems}`);
  console.log(`Employees With Distribution: ${validated.stats.employeesWithItems}`);
  console.log(`Distribution Records Created: ${validated.stats.generatedIssues}`);
  console.log(`Review Records Created: ${summary.generatedReviews}`);
  if (validated.validationErrors.length) console.log(`Validation Errors: ${validated.validationErrors.length}`);
  console.log("PASS\n");
  
  return summary;
}

module.exports = { parseCandidate, inspectWorkbook, importWorkbook, buildValidatedImport, buildEmployeeIdentity };
