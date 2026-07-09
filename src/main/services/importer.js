const path = require("path");
const crypto = require("crypto");
const XLSX = require("xlsx");

const aliases = {
  employee_code: [
    "employee code", "emp code", "ecode", "code", "employee id", "emp id", "emp no",
    "employee no", "card no", "guard code", "guard no", "staff code", "staff no",
  ],
  employee_name: ["employee name", "emp name", "name", "guard name", "worker name", "staff name"],
  father_name: [
    "father name", "fathers name", "father's name", "father husband name", "father husband",
    "fh name", "f h name", "s o", "son of", "guardian name",
  ],
  unit: ["unit", "unit name", "current unit", "client", "client name", "site", "site name", "company", "location"],
  godown: ["godown", "godown name", "unit godown", "warehouse", "warehouse name", "store", "store name", "depot"],
  mobile_number: ["mobile", "mobile number", "phone", "phone number", "contact", "contact number"],
  designation: ["designation", "post", "rank", "duty", "job title"],
  status: ["status", "employment status"],
};

const positiveSheetSignals = ["distribution", "issue", "issued", "stock distribution", "uniform distribution", "challan"];
const negativeSheetSignals = ["deduction", "salary", "payroll", "recovery", "waive", "summary", "abstract", "report", "previous", "prv", "prev"];
const distributionHeaderSignals = [
  "shirt", "pant", "shoes", "shoe", "cap", "helmet", "belt", "raincoat", "jacket",
  "safari", "torch", "whistle", "uniform", "jersey", "socks", "tie", "id card",
];
const quantityHeaderSignals = ["qty", "quantity", "issued", "issue", "pcs", "pieces", "nos", "number"];
const deductionHeaderSignals = ["deduction", "amount", "salary", "payroll", "recover", "waive", "total deduction", "rate", "price", "total", "value", "summary", "previous", "prv", "prev"];
const ignoredItemHeaders = new Set([
  "employee code", "emp code", "ecode", "code", "employee id", "emp id", "emp no", "employee no",
  "card no", "guard code", "guard no", "staff code", "staff no", "employee name", "emp name",
  "name", "guard name", "worker name", "staff name", "father name", "fathers name",
  "father s name", "father husband name", "father husband", "fh name", "f h name", "s o",
  "son of", "guardian name", "unit", "unit name", "current unit", "client", "client name",
  "site", "site name", "company", "location", "godown", "godown name", "unit godown",
  "warehouse", "warehouse name", "store", "store name", "depot", "mobile", "mobile number",
  "phone", "phone number", "contact", "contact number", "designation", "post", "rank",
  "duty", "job title", "status", "employment status", "sr no", "s no", "serial no", "remarks",
  "sr no in their reg", "reg no", "register no", "month",
  "date", "month", "year", "amount", "rate", "price", "total", "value", "deduction", "salary",
  "payroll", "days", "attendance", "bank", "account", "ifsc", "uan", "esi", "pf",
]);
const ignoredItemHeaderSignals = [
  "month", "year", "date", "sr no", "serial", "reg no", "register", "amount", "rate",
  "price", "total", "value", "deduction", "salary", "payroll", "attendance", "days",
  "bank", "account", "ifsc", "uan", "esi", "pf",
];

function normalize(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function rowHasData(row) {
  return Array.isArray(row) && row.some((cell) => String(cell || "").trim() !== "");
}

function nonEmptyCellCount(row) {
  return Array.isArray(row) ? row.filter((cell) => String(cell || "").trim() !== "").length : 0;
}

function tokenSet(value) {
  return new Set(normalize(value).split(" ").filter(Boolean));
}

function labelMatchesAlias(label, alias) {
  const cleanLabel = normalize(label);
  const cleanAlias = normalize(alias);
  if (!cleanLabel || !cleanAlias) return false;
  if (cleanLabel === cleanAlias) return true;

  const labelTokens = tokenSet(cleanLabel);
  const aliasTokens = [...tokenSet(cleanAlias)];
  if (aliasTokens.length === 1) return labelTokens.size === 1 && labelTokens.has(aliasTokens[0]);
  return aliasTokens.length > 1 && aliasTokens.every((token) => labelTokens.has(token));
}

function signalScore(value, signals) {
  const label = normalize(value);
  return signals.reduce((score, signal) => score + (label.includes(normalize(signal)) ? 1 : 0), 0);
}

function getRows(sheet, limit = 5000) {
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "", blankrows: false });
  return rows.filter(rowHasData).slice(0, limit);
}

function findHeader(rows, sheetName = "") {
  let best = { score: 0, rowIndex: -1, map: {} };

  rows.slice(0, 40).forEach((row, rowIndex) => {
    const map = {};
    const headerText = row.join(" ");
    row.forEach((cell, columnIndex) => {
      const label = normalize(cell);
      Object.entries(aliases).forEach(([field, names]) => {
        if (names.some((name) => labelMatchesAlias(label, name)) && map[field] === undefined) {
          map[field] = columnIndex;
        }
      });

      if (label.includes("unit") && label.includes("godown")) {
        if (map.unit === undefined) map.unit = columnIndex;
        if (map.godown === undefined) map.godown = columnIndex;
      }
    });

    const requiredScore = ["employee_code", "employee_name", "unit"]
      .filter((field) => map[field] !== undefined).length;
    const usefulScore = ["father_name", "godown"]
      .filter((field) => map[field] !== undefined).length * 0.8;
    const optionalScore = ["mobile_number", "designation", "status"]
      .filter((field) => map[field] !== undefined).length * 0.2;
    const itemColumns = detectItemColumns(row, map, rows, rowIndex);
    const badSummaryScore = signalScore(`${sheetName} ${headerText}`, negativeSheetSignals);
    const purposeScore =
      signalScore(sheetName, positiveSheetSignals) * 2.5 -
      badSummaryScore * 4 +
      itemColumns.length * 1.5 +
      signalScore(headerText, distributionHeaderSignals) * 0.35 -
      signalScore(headerText, deductionHeaderSignals) * 0.45;
    const score = requiredScore + usefulScore + optionalScore + purposeScore;
    if (score > best.score) best = { score, rowIndex, map, itemColumns };
  });

  return best.map.employee_code !== undefined &&
    best.map.employee_name !== undefined &&
    best.map.unit !== undefined &&
    best.itemColumns?.length
    ? best
    : null;
}

function countLikelyDataRows(rows, header) {
  let count = 0;
  const minimumCells = Math.max(2, Object.keys(header.map).length - 1);
  for (let i = header.rowIndex + 1; i < rows.length; i += 1) {
    const row = rows[i];
    const code = String(row[header.map.employee_code] || "").trim();
    const name = String(row[header.map.employee_name] || "").trim();
    if (code && name && nonEmptyCellCount(row) >= minimumCells) count += 1;
  }
  return count;
}

function cleanItemName(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function parseQuantity(value) {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  const text = String(value || "").trim();
  if (!text) return 0;
  const match = text.match(/-?\d+(\.\d+)?/);
  return match ? Number(match[0]) : 0;
}

function looksLikeUniformItem(label) {
  if (label.includes("sr no") || label.includes("month") || label.includes("reg")) return false;
  return signalScore(label, distributionHeaderSignals) > 0;
}

function isIgnoredItemHeader(label) {
  if (!label) return true;
  if (ignoredItemHeaders.has(label)) return true;
  return ignoredItemHeaderSignals.some((signal) => labelMatchesAlias(label, signal));
}

function looksLikeQuantityColumn(label) {
  return signalScore(label, quantityHeaderSignals) > 0;
}

function hasPositiveQuantities(rows, headerRowIndex, columnIndex) {
  let positiveCount = 0;
  for (let i = headerRowIndex + 1; i < Math.min(rows.length, headerRowIndex + 31); i += 1) {
    if (parseQuantity(rows[i]?.[columnIndex]) > 0) positiveCount += 1;
    if (positiveCount >= 2) return true;
  }
  return positiveCount >= 1;
}

function detectItemColumns(headerRow, headerMap, rows = [], headerRowIndex = 0) {
  const mappedIndexes = new Set(Object.values(headerMap));
  return headerRow
    .map((cell, index) => ({ index, itemName: cleanItemName(cell), normalized: normalize(cell) }))
    .filter((column) => {
      if (!column.itemName || mappedIndexes.has(column.index)) return false;
      if (isIgnoredItemHeader(column.normalized)) return false;
      if (signalScore(column.normalized, deductionHeaderSignals) > 0) return false;
      if (column.normalized.length < 2) return false;
      if (!hasPositiveQuantities(rows, headerRowIndex, column.index)) return false;
      return looksLikeUniformItem(column.normalized) || looksLikeQuantityColumn(column.normalized);
    })
    .map(({ index, itemName }) => ({ index, itemName }));
}

function analyzeWorkbook(workbook) {
  const candidates = workbook.SheetNames.map((sheetName) => {
    const rows = getRows(workbook.Sheets[sheetName]);
    const header = findHeader(rows, sheetName);
    const likelyRows = header ? countLikelyDataRows(rows, header) : 0;
    const dataVolumeScore = Math.min(likelyRows, 500) / 100;
    const score = header ? header.score + dataVolumeScore : 0;
    const sampleRows = header
      ? rows.slice(header.rowIndex + 1).filter(rowHasData).slice(0, 5).map((row) => {
          const sample = {};
          Object.entries(header.map).forEach(([field, index]) => {
            sample[field] = String(row[index] || "").trim();
          });
          return sample;
        })
      : [];
    const columns = header
      ? Object.fromEntries(Object.entries(header.map).map(([field, index]) => [field, String(rows[header.rowIndex][index] || "").trim()]))
      : {};
    const itemColumns = header ? detectItemColumns(rows[header.rowIndex], header.map, rows, header.rowIndex) : [];
    const reasons = [];
    if (signalScore(sheetName, positiveSheetSignals)) reasons.push("sheet name suggests distribution/issue data");
    if (signalScore(sheetName, negativeSheetSignals)) reasons.push("sheet name suggests deduction/payroll/report data");
    if (header && signalScore(rows[header.rowIndex].join(" "), distributionHeaderSignals)) reasons.push("headers include uniform item/quantity fields");
    if (header && signalScore(rows[header.rowIndex].join(" "), deductionHeaderSignals)) reasons.push("headers include deduction/payroll fields");
    if (header) reasons.push(`matched ${Object.keys(header.map).length} useful employee columns`);
    return {
      sheetName,
      rows,
      header,
      likelyRows,
      score,
      columns,
      itemColumns,
      sampleRows,
      reasons,
    };
  });

  candidates.sort((a, b) => b.score - a.score);
  return candidates;
}

function detectSheet(workbook) {
  return analyzeWorkbook(workbook).find((candidate) => candidate.header) || null;
}

function describeWorkbook(workbook) {
  return workbook.SheetNames.map((sheetName) => {
    const rows = getRows(workbook.Sheets[sheetName], 8);
    const previewRows = rows.slice(0, 8)
      .map((row, index) => {
        const cells = row.slice(0, 12).map((cell) => String(cell || "").trim()).filter(Boolean);
        return cells.length ? `row ${index + 1}: ${cells.join(" | ")}` : "";
      })
      .filter(Boolean);
    return `${sheetName}: ${previewRows.join(" / ") || "no visible headers"}`;
  }).join("\n");
}

function readWorkbook(filePath) {
  return XLSX.readFile(filePath, {
    cellDates: false,
    cellStyles: false,
    cellFormula: false,
    cellHTML: false,
    dense: true,
  });
}

function parseCandidate(filePath, selectedSheetName = null) {
  const workbook = readWorkbook(filePath);
  const candidates = analyzeWorkbook(workbook);
  const detected = selectedSheetName
    ? candidates.find((candidate) => candidate.sheetName === selectedSheetName)
    : candidates.find((candidate) => candidate.header);

  if (!detected || !detected.header) {
    throw new Error(
      selectedSheetName
        ? `The selected sheet "${selectedSheetName}" does not contain recognizable Employee Code, Employee Name, Unit, and uniform item quantity columns such as Shirt/Pant/Shoes.`
        : "No sheet was found with Employee Code, Employee Name, Unit, and uniform item quantity columns such as Shirt/Pant/Shoes.\n\n" +
          "Workbook preview:\n" +
          describeWorkbook(workbook)
    );
  }

  return buildParsedImport(filePath, detected);
}

function inspectWorkbook(filePath) {
  const workbook = readWorkbook(filePath);
  const candidates = analyzeWorkbook(workbook);
  return {
    fileName: path.basename(filePath),
    filePath,
    candidates: candidates.map((candidate) => ({
      sheetName: candidate.sheetName,
      canImport: Boolean(candidate.header),
      score: Number(candidate.score.toFixed(2)),
      likelyRows: candidate.likelyRows,
      headerRow: candidate.header ? candidate.header.rowIndex + 1 : null,
      columns: candidate.columns,
      itemColumns: candidate.itemColumns,
      sampleRows: candidate.sampleRows,
      reasons: candidate.reasons,
    })),
  };
}

function parseWorkbook(filePath) {
  return parseCandidate(filePath);
}

function buildParsedImport(filePath, detected) {
  let inserted = 0;
  let updated = 0;
  let skipped = 0;
  let scannedRows = 0;
  const employees = [];
  const reviews = [];
  const uniformIssues = [];
  const { rows, header } = detected;
  const itemColumns = detectItemColumns(rows[header.rowIndex], header.map, rows, header.rowIndex);

  for (let i = header.rowIndex + 1; i < rows.length; i += 1) {
    const row = rows[i];
    if (!rowHasData(row)) continue;
    scannedRows += 1;
    const employee = {};
    Object.entries(header.map).forEach(([field, index]) => {
      employee[field] = String(row[index] || "").trim();
    });

    if (header.map.unit === header.map.godown && employee.unit && !employee.godown) {
      const parts = employee.unit.split(/[\/|,-]+/).map((part) => part.trim()).filter(Boolean);
      employee.unit = parts[0] || employee.unit;
      employee.godown = parts[1] || "";
    }

    if (!employee.employee_code || !employee.employee_name) {
      skipped += 1;
      continue;
    }

    employees.push(employee);

    itemColumns.forEach((itemColumn) => {
      const quantity = parseQuantity(row[itemColumn.index]);
      if (quantity > 0) {
        uniformIssues.push({
          employee_code: employee.employee_code,
          employee_name: employee.employee_name,
          unit: employee.unit || "",
          godown: employee.godown || "",
          item_name: itemColumn.itemName,
          quantity,
          source_sheet: detected.sheetName,
          source_row: i + 1,
        });
      }
    });

    if (!employee.unit || !employee.godown) {
      reviews.push({
        employee_code: employee.employee_code,
        employee_name: employee.employee_name,
        unit: employee.unit || "",
        reason: "Employee master data is incomplete after import.",
      });
    }
  }

  const summary = {
    fileName: path.basename(filePath),
    filePath,
    selectedSheet: detected.sheetName,
    importHash: "",
    totalRows: scannedRows,
    inserted,
    updated,
    skipped,
  };
  summary.importHash = crypto
    .createHash("sha256")
    .update(JSON.stringify({
      sheet: detected.sheetName,
      employees,
      uniformIssues,
      totalRows: scannedRows,
    }))
    .digest("hex");

  return { summary, employees, reviews, uniformIssues };
}

function importWorkbook(filePath, database) {
  const parsed = parseWorkbook(filePath);
  if (database.hasImportHash(parsed.summary.importHash)) {
    return { ...parsed.summary, duplicate: true, inserted: 0, updated: 0, skipped: parsed.summary.totalRows };
  }
  const result = database.bulkUpsertEmployees(parsed.employees);
  parsed.summary.inserted = result.inserted;
  parsed.summary.updated = result.updated;
  database.bulkCreateReviews(parsed.reviews);
  const importId = database.recordImport(parsed.summary);
  database.bulkCreateUniformIssues(parsed.uniformIssues || [], importId);
  database.applyIssueStockMovements(importId);
  database.evaluateEntitlementsForImport(importId);
  return parsed.summary;
}

module.exports = { importWorkbook, parseWorkbook, parseCandidate, inspectWorkbook, detectSheet, analyzeWorkbook };
