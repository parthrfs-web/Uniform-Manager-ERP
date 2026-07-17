const fs = require("fs");
const path = require("path");
const initSqlJs = require("sql.js");

const createEmployees = require("./employees");
const createReviews = require("./reviews");
const createImports = require("./imports");
const createPolicies = require("./policies");
const createInventory = require("./inventory");
const createReports = require("./reports");

const ignoredIssueItemSignals = [
  "month", "year", "date", "sr no", "serial", "reg no", "register", "total qty", "total quantity",
  "amount", "rate", "price", "total", "value", "deduction", "salary", "payroll", "attendance",
  "days", "bank", "account", "ifsc", "uan", "esi", "pf",
];

function normalizeLabel(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function isIgnoredIssueItemName(value) {
  const label = normalizeLabel(value);
  if (!label) return true;
  return ignoredIssueItemSignals.some((signal) => {
    const cleanSignal = normalizeLabel(signal);
    return label === cleanSignal || label.includes(cleanSignal) || cleanSignal.includes(label);
  });
}

function classifyReviewReason(reason) {
  const text = normalizeLabel(reason);
  if (text.includes("entitlement exceeded")) return "Excess Entitlement";
  if (text.includes("no entitlement policy")) return "Missing Policy";
  if (text.includes("incomplete")) return "Incomplete Employee Data";
  return "Other";
}

const APP_SCHEMA = {
  employees: [
    "employee_code TEXT PRIMARY KEY",
    "employee_name TEXT NOT NULL",
    "father_name TEXT",
    "unit TEXT",
    "godown TEXT",
    "mobile_number TEXT",
    "designation TEXT",
    "status TEXT DEFAULT 'Active'",
    "created_at TEXT",
    "updated_at TEXT"
  ],
  unit_policies: [
    "id INTEGER PRIMARY KEY AUTOINCREMENT",
    "unit TEXT NOT NULL",
    "item_name TEXT NOT NULL",
    "yearly_entitlement INTEGER NOT NULL DEFAULT 0",
    "item_cost REAL NOT NULL DEFAULT 0"
  ],
  uniform_items: [
    "id INTEGER PRIMARY KEY AUTOINCREMENT",
    "item_code TEXT NOT NULL UNIQUE",
    "item_name TEXT NOT NULL",
    "category TEXT",
    "size TEXT",
    "cost REAL NOT NULL DEFAULT 0",
    "available_stock REAL NOT NULL DEFAULT 0",
    "minimum_stock REAL NOT NULL DEFAULT 0",
    "status TEXT NOT NULL DEFAULT 'Active'",
    "created_at TEXT",
    "updated_at TEXT"
  ],
  stock_movements: [
    "id INTEGER PRIMARY KEY AUTOINCREMENT",
    "item_code TEXT NOT NULL",
    "item_name TEXT NOT NULL",
    "movement_type TEXT NOT NULL",
    "quantity REAL NOT NULL",
    "reference_type TEXT",
    "reference_id INTEGER",
    "notes TEXT",
    "created_at TEXT"
  ],
  imports: [
    "id INTEGER PRIMARY KEY AUTOINCREMENT",
    "file_name TEXT NOT NULL",
    "file_path TEXT NOT NULL",
    "selected_sheet TEXT NOT NULL",
    "import_hash TEXT UNIQUE",
    "imported_at TEXT NOT NULL",
    "total_rows INTEGER NOT NULL",
    "inserted_count INTEGER NOT NULL",
    "updated_count INTEGER NOT NULL",
    "skipped_count INTEGER NOT NULL",
    "failed_count INTEGER DEFAULT 0",
    "duplicate_count INTEGER DEFAULT 0",
    "validation_errors TEXT",
    "generated_reviews INTEGER DEFAULT 0",
    "duration_ms INTEGER DEFAULT 0",
    "status TEXT DEFAULT 'Completed'"
  ],
  uniform_issues: [
    "id INTEGER PRIMARY KEY AUTOINCREMENT",
    "import_id INTEGER",
    "employee_code TEXT NOT NULL",
    "employee_name TEXT NOT NULL",
    "unit TEXT",
    "godown TEXT",
    "item_name TEXT NOT NULL",
    "quantity REAL NOT NULL DEFAULT 0",
    "issue_month INTEGER",
    "issue_year INTEGER",
    "issue_period_label TEXT",
    "remarks TEXT",
    "source_sheet TEXT NOT NULL",
    "source_row INTEGER NOT NULL",
    "issued_at TEXT NOT NULL"
  ],
  review_queue: [
    "id INTEGER PRIMARY KEY AUTOINCREMENT",
    "employee_code TEXT NOT NULL",
    "employee_name TEXT NOT NULL",
    "unit TEXT",
    "item_name TEXT",
    "issue_month INTEGER",
    "issue_year INTEGER",
    "issue_period_label TEXT",
    "issued_qty REAL NOT NULL DEFAULT 0",
    "allowed_qty REAL",
    "excess_qty REAL NOT NULL DEFAULT 0",
    "item_cost REAL NOT NULL DEFAULT 0",
    "estimated_amount REAL NOT NULL DEFAULT 0",
    "reason TEXT NOT NULL",
    "status TEXT NOT NULL DEFAULT 'Pending'",
    "remarks TEXT",
    "created_at TEXT NOT NULL",
    "decided_at TEXT"
  ],
  salary_deductions: [
    "id INTEGER PRIMARY KEY AUTOINCREMENT",
    "review_id INTEGER",
    "employee_code TEXT NOT NULL",
    "employee_name TEXT NOT NULL",
    "unit TEXT",
    "issue_month INTEGER",
    "issue_year INTEGER",
    "issue_period_label TEXT",
    "amount REAL NOT NULL DEFAULT 0",
    "reason TEXT NOT NULL",
    "status TEXT NOT NULL DEFAULT 'Pending Payroll'",
    "pdf_path TEXT",
    "created_at TEXT NOT NULL",
    "exported_at TEXT",
    "approved_by TEXT",
    "approval_date TEXT",
    "remarks TEXT"
  ],
  waive_records: [
    "id INTEGER PRIMARY KEY AUTOINCREMENT",
    "review_id INTEGER",
    "employee_code TEXT NOT NULL",
    "employee_name TEXT NOT NULL",
    "unit TEXT",
    "reason TEXT NOT NULL",
    "remarks TEXT",
    "approved_by TEXT",
    "created_at TEXT NOT NULL"
  ],
  review_decisions: [
    "id INTEGER PRIMARY KEY AUTOINCREMENT",
    "review_id INTEGER NOT NULL",
    "employee_code TEXT NOT NULL",
    "employee_name TEXT NOT NULL",
    "unit TEXT",
    "decision TEXT NOT NULL",
    "reason TEXT",
    "approved_by TEXT",
    "remarks TEXT",
    "created_at TEXT NOT NULL"
  ],
  recovery_records: [
    "id INTEGER PRIMARY KEY AUTOINCREMENT",
    "employee_code TEXT NOT NULL",
    "employee_name TEXT NOT NULL",
    "unit TEXT",
    "item_name TEXT NOT NULL",
    "quantity REAL NOT NULL DEFAULT 0",
    "recovery_type TEXT NOT NULL DEFAULT 'Return'",
    "condition_note TEXT",
    "created_at TEXT NOT NULL"
  ],
  audit_log: [
    "id INTEGER PRIMARY KEY AUTOINCREMENT",
    "action TEXT NOT NULL",
    "details TEXT NOT NULL",
    "created_at TEXT NOT NULL"
  ]
};

async function createDatabase(userDataPath) {
  const SQL = await initSqlJs();
  const dbPath = path.join(userDataPath, "uniform-manager.sqlite");
  fs.mkdirSync(userDataPath, { recursive: true });

  const db = fs.existsSync(dbPath)
    ? new SQL.Database(fs.readFileSync(dbPath))
    : new SQL.Database();

  db.run("PRAGMA foreign_keys = ON;");

  function save() {
    fs.writeFileSync(dbPath, Buffer.from(db.export()));
  }

  function now() {
    return new Date().toISOString();
  }

  function scalar(sql, params = []) {
    const stmt = db.prepare(sql);
    stmt.bind(params);
    const value = stmt.step() ? Object.values(stmt.getAsObject())[0] : 0;
    stmt.free();
    return value;
  }

  function all(sql, params = []) {
    const stmt = db.prepare(sql);
    stmt.bind(params);
    const rows = [];
    while (stmt.step()) rows.push(stmt.getAsObject());
    stmt.free();
    return rows;
  }

  function audit(action, details) {
    db.run("INSERT INTO audit_log (action, details, created_at) VALUES (?, ?, ?)", [action, details, now()]);
  }

  function syncSchema() {
    db.run("BEGIN TRANSACTION");
    try {
      for (const [tableName, columns] of Object.entries(APP_SCHEMA)) {
        const colDefs = columns.join(", ");
        db.run(`CREATE TABLE IF NOT EXISTS ${tableName} (${colDefs})`);
      }

      for (const [tableName, columns] of Object.entries(APP_SCHEMA)) {
        const existingCols = all(`PRAGMA table_info(${tableName})`).map(r => r.name);
        for (const colDef of columns) {
          const match = colDef.match(/^([A-Za-z0-9_]+)/);
          if (match) {
            const colName = match[1];
            if (!["UNIQUE", "PRIMARY", "FOREIGN", "CHECK"].includes(colName.toUpperCase())) {
              if (!existingCols.includes(colName)) {
                db.run(`ALTER TABLE ${tableName} ADD COLUMN ${colDef}`);
                if (existingCols.length > 0 && tableName !== "audit_log") {
                  db.run("INSERT INTO audit_log (action, details, created_at) VALUES (?, ?, ?)", 
                    ["Schema Migrated", `Added missing column '${colName}' to table '${tableName}'`, now()]
                  );
                }
              }
            }
          }
        }
      }

      db.run("CREATE UNIQUE INDEX IF NOT EXISTS idx_unit_item ON unit_policies(unit, item_name)");
      db.run("COMMIT");
    } catch (error) {
      db.run("ROLLBACK");
      console.error("Database schema sync failed:", error);
      throw error;
    }
  }

  syncSchema();
  seedDefaults();
  save();

  function seedDefaults() {
    const count = scalar("SELECT COUNT(*) FROM unit_policies");
    if (count > 0) return;
    const defaults = [
      ["Reliance", "Shirt", 2, 400],
      ["Reliance", "Pant", 2, 450],
      ["Reliance", "Shoes", 1, 1200],
      ["Reliance", "Helmet", 1, 350],
      ["AMNS", "Shirt", 2, 380],
      ["AMNS", "Pant", 2, 430],
      ["MRF", "Shirt", 1, 400],
      ["MRF", "Pant", 1, 450],
    ];
    const stmt = db.prepare("INSERT INTO unit_policies (unit, item_name, yearly_entitlement, item_cost) VALUES (?, ?, ?, ?)");
    defaults.forEach((row) => stmt.run(row));
    stmt.free();
    audit("Seed Defaults", "Default editable entitlement policies created.");
    seedItemsFromPolicies(defaults);
  }

  function seedItemsFromPolicies(defaults) {
    const itemCount = scalar("SELECT COUNT(*) FROM uniform_items");
    if (itemCount > 0) return;
    const seen = new Set();
    const stmt = db.prepare(
      `INSERT INTO uniform_items (
        item_code, item_name, category, size, cost, available_stock, minimum_stock, status, created_at, updated_at
      ) VALUES (?, ?, 'Uniform', '', ?, 0, 0, 'Active', ?, ?)`
    );
    defaults.forEach(([, itemName, , cost]) => {
      if (seen.has(itemName)) return;
      seen.add(itemName);
      const code = itemName.toUpperCase().replace(/[^A-Z0-9]+/g, "-").replace(/^-|-$/g, "");
      stmt.run([code, itemName, cost, now(), now()]);
    });
    stmt.free();
  }

  function purgeInvalidImportedIssueItems() {
    const badItemNames = all("SELECT DISTINCT item_name FROM uniform_issues")
      .map((row) => row.item_name)
      .filter(isIgnoredIssueItemName);
    if (!badItemNames.length) return;

    db.run("BEGIN TRANSACTION");
    try {
      badItemNames.forEach((itemName) => {
        db.run("DELETE FROM uniform_issues WHERE lower(item_name) = lower(?)", [itemName]);
        db.run("DELETE FROM stock_movements WHERE lower(item_name) = lower(?)", [itemName]);
        db.run("DELETE FROM uniform_items WHERE lower(item_name) = lower(?)", [itemName]);
      });
      db.run("COMMIT");
    } catch (error) {
      db.run("ROLLBACK");
      throw error;
    }
    audit("Invalid Issue Columns Purged", `Removed non-item columns: ${badItemNames.join(", ")}.`);
  }

  function purgeZeroQuantityIssues() {
    const zeroCount = scalar("SELECT COUNT(*) FROM uniform_issues WHERE quantity <= 0");
    if (!zeroCount) return;
    db.run("DELETE FROM uniform_issues WHERE quantity <= 0");
    audit("Zero Quantity Issue Rows Purged", `Removed ${zeroCount} zero-quantity distribution rows.`);
  }

  function ensureDefaultPoliciesForIssueRows(importId = null) {
    const rows = all(
      `SELECT DISTINCT TRIM(unit) AS unit, TRIM(item_name) AS item_name
       FROM uniform_issues
       WHERE TRIM(COALESCE(unit, '')) <> ''
         AND TRIM(COALESCE(item_name, '')) <> ''
         ${importId ? "AND import_id = ?" : ""}`,
      importId ? [Number(importId)] : []
    ).filter((row) => !isIgnoredIssueItemName(row.item_name));
    if (!rows.length) return 0;

    const stmt = db.prepare(
      `INSERT INTO unit_policies (unit, item_name, yearly_entitlement, item_cost)
       VALUES (?, ?, 0, 0)`
    );
    let created = 0;
    const processed = new Set();
    
    db.run("BEGIN TRANSACTION");
    try {
      rows.forEach((row) => {
        const key = `${String(row.unit).toLowerCase()}|${String(row.item_name).toLowerCase()}`;
        if (processed.has(key)) return;
        processed.add(key);

        const before = scalar(
          "SELECT COUNT(*) FROM unit_policies WHERE lower(unit) = lower(?) AND lower(item_name) = lower(?)",
          [row.unit, row.item_name]
        );
        if (before === 0) {
          stmt.run([row.unit, row.item_name]);
          created += 1;
        }
      });
      db.run("COMMIT");
    } catch (error) {
      db.run("ROLLBACK");
      throw error;
    } finally {
      stmt.free();
    }
    return created;
  }

  function extractAmount(text) {
    const match = String(text || "").match(/(?:Rs\.?|INR|Amount)\s*[:.-]?\s*([0-9]+(?:\.[0-9]+)?)/i);
    return match ? Number(match[1]) : 0;
  }

  function writeTextPdf(filePath, lines) {
    const pageLineCount = 46;
    const pages = [];
    for (let index = 0; index < lines.length; index += pageLineCount) {
      pages.push(lines.slice(index, index + pageLineCount));
    }
    const objects = ["<< /Type /Catalog /Pages 2 0 R >>"];
    const pageRefs = pages.map((_, index) => `${3 + (index * 2)} 0 R`).join(" ");
    objects.push(`<< /Type /Pages /Kids [${pageRefs}] /Count ${pages.length} >>`);
    pages.forEach((pageLines, pageIndex) => {
      const pageObjectId = 3 + (pageIndex * 2);
      const contentObjectId = pageObjectId + 1;
      const escaped = pageLines.map((line) => String(line).replace(/[\\()]/g, "\\$&"));
      const textCommands = escaped
        .map((line, lineIndex) => `BT /F1 10 Tf 42 ${800 - (lineIndex * 16)} Td (${line}) Tj ET`)
        .join("\n");
      objects.push(
        `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 842] /Resources << /Font << /F1 ${3 + (pages.length * 2)} 0 R >> >> /Contents ${contentObjectId} 0 R >>`
      );
      objects.push(`<< /Length ${Buffer.byteLength(textCommands, "utf8")} >>\nstream\n${textCommands}\nendstream`);
    });
    objects.push("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");

    let pdf = "%PDF-1.4\n";
    const offsets = [0];
    objects.forEach((object, index) => {
      offsets.push(Buffer.byteLength(pdf, "utf8"));
      pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
    });
    const xref = Buffer.byteLength(pdf, "utf8");
    pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
    offsets.slice(1).forEach((offset) => {
      pdf += `${String(offset).padStart(10, "0")} 00000 n \n`;
    });
    pdf += `trailer << /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
    fs.writeFileSync(filePath, pdf);
  }

  function fitText(value, width) {
    const text = String(value ?? "").replace(/\s+/g, " ").trim();
    return text.length > width ? `${text.slice(0, Math.max(0, width - 3))}...` : text.padEnd(width, " ");
  }

  function money(value) {
    return `Rs. ${Number(value || 0).toFixed(2)}`;
  }

  function generateDeductionPdf(review, deduction, approvedBy, reason, remarks) {
    const reportDir = path.join(userDataPath, "deduction-reports");
    fs.mkdirSync(reportDir, { recursive: true });
    const safeCode = String(review.employee_code || "employee").replace(/[^a-z0-9_-]+/gi, "-");
    const filePath = path.join(reportDir, `deduction-${safeCode}-${Date.now()}.pdf`);
    const employee = all("SELECT * FROM employees WHERE employee_code = ? LIMIT 1", [review.employee_code])[0] || {};
    const issueHistory = all(
      `SELECT
         COALESCE(issue_period_label, '') AS period,
         issue_month,
         issue_year,
         item_name,
         SUM(quantity) AS issued_qty,
         MIN(source_row) AS first_row
        FROM uniform_issues
        WHERE employee_code = ? AND quantity > 0
        GROUP BY COALESCE(issue_period_label, ''), COALESCE(issue_month, 0), COALESCE(issue_year, 0), item_name
        ORDER BY COALESCE(issue_year, 9999), COALESCE(issue_month, 99), first_row, item_name`,
      [review.employee_code]
    );
    const currentPeriod = review.issue_period_label || (review.issue_month && review.issue_year ? `${review.issue_month}/${review.issue_year}` : "");
    const excessQty = Number(review.excess_qty || 0);
    const totalAmount = Number(deduction.amount || 0);
    const itemAmount = totalAmount; 
    const itemCost = excessQty > 0 ? itemAmount / excessQty : Number(review.item_cost || 0);
    const createdAt = deduction.created_at || new Date().toISOString();
    
    const detailRows = [
      [
        fitText(review.item_name || "Uniform Item", 24),
        fitText(Number(review.issued_qty || 0), 8),
        fitText(review.allowed_qty === null || review.allowed_qty === undefined ? "NoPolicy" : Number(review.allowed_qty || 0), 8),
        fitText(excessQty, 8),
        fitText(money(itemCost), 12),
        fitText(money(itemAmount), 12),
      ].join("  "),
    ];
    const historyRows = issueHistory.slice(0, 18).map((issue) => {
      const period = issue.period || (issue.issue_month && issue.issue_year ? `${issue.issue_month}/${issue.issue_year}` : "No period");
      return `${fitText(period, 12)}  ${fitText(issue.item_name, 28)}  Qty ${Number(issue.issued_qty || 0)}`;
    });
    if (issueHistory.length > historyRows.length) {
      historyRows.push(`... ${issueHistory.length - historyRows.length} more history rows available in Distribution Register`);
    }
    const lines = [
      "UNIFORM MANAGER",
      "SALARY DEDUCTION REPORT",
      "==============================================================",
      `Report No : DED-${deduction.id}                        Review ID : ${review.id}`,
      `Generated : ${createdAt}`,
      `Period    : ${currentPeriod || "-"}`,
      "",
      "EMPLOYEE DETAILS",
      "--------------------------------------------------------------",
      `Code        : ${review.employee_code}`,
      `Name        : ${review.employee_name}`,
      `Father Name : ${employee.father_name || "-"}`,
      `Unit        : ${review.unit || "-"}`,
      `Godown      : ${employee.godown || "-"}`,
      `Mobile      : ${employee.mobile_number || "-"}`,
      `Designation : ${employee.designation || "-"}`,
      "",
      "APPROVAL DETAILS",
      "--------------------------------------------------------------",
      `Deduction Date : ${createdAt}`,
      `Approved By    : ${approvedBy}`,
      `Reason         : ${reason || "-"}`,
      `Remarks        : ${remarks || "-"}`,
      "",
      "ITEM-WISE DEDUCTION BREAKDOWN",
      "--------------------------------------------------------------",
      `${fitText("Item", 24)}  ${fitText("Issued", 8)}  ${fitText("Allowed", 8)}  ${fitText("Excess", 8)}  ${fitText("Rate", 12)}  ${fitText("Amount", 12)}`,
      `${"-".repeat(24)}  ${"-".repeat(8)}  ${"-".repeat(8)}  ${"-".repeat(8)}  ${"-".repeat(12)}  ${"-".repeat(12)}`,
      ...detailRows,
      "",
      `TOTAL DEDUCTION AMOUNT: ${money(totalAmount)}`,
      "",
      "EMPLOYEE UNIFORM ISSUE HISTORY",
      "--------------------------------------------------------------",
      ...(historyRows.length ? historyRows : ["No imported issue history found for this employee."]),
      "",
      "PAYROLL NOTE",
      "--------------------------------------------------------------",
      "This report was generated locally by Uniform Manager for salary deduction processing.",
      "Keep this report with payroll records and the employee review decision.",
      "",
      "Prepared By: ____________________      Checked By: ____________________",
      "",
      "Employee Signature: ______________      Payroll Signature: ______________",
    ];
    writeTextPdf(filePath, lines);
    return filePath;
  }

  purgeInvalidImportedIssueItems();
  purgeZeroQuantityIssues();
  const startupPolicyCount = ensureDefaultPoliciesForIssueRows();
  if (startupPolicyCount) {
    audit("Default Policies Created", `${startupPolicyCount} existing unit/item policy rows created with allowed qty 0.`);
    save();
  }

const moduleContext = { db, dbPath, scalar, all, save, audit, now, normalizeLabel, isIgnoredIssueItemName, classifyReviewReason, ensureDefaultPoliciesForIssueRows, extractAmount, generateDeductionPdf };

  const employeeModule = createEmployees(moduleContext);
  const reviewModule = createReviews(moduleContext);
  const importModule = createImports(moduleContext);
  const policyModule = createPolicies(moduleContext);
  const inventoryModule = createInventory(moduleContext);
  const reportModule = createReports(moduleContext);

  return {
    dbPath,
    save,
    audit,
    ...employeeModule,
    ...reviewModule,
    ...importModule,
    ...policyModule,
    ...inventoryModule,
    ...reportModule,
  };
}

module.exports = { createDatabase };