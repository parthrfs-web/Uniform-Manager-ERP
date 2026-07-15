const fs = require("fs");
const path = require("path");
const initSqlJs = require("sql.js");

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
       VALUES (?, ?, 0, 0)
       ON CONFLICT(unit, item_name) DO NOTHING`
    );
    let created = 0;
    db.run("BEGIN TRANSACTION");
    try {
      rows.forEach((row) => {
        const before = scalar(
          "SELECT COUNT(*) FROM unit_policies WHERE lower(unit) = lower(?) AND lower(item_name) = lower(?)",
          [row.unit, row.item_name]
        );
        stmt.run([row.unit, row.item_name]);
        if (!before) created += 1;
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

  return {
    dbPath,
    save,
    audit,
    bulkUpsertEmployees(employees) {
      let inserted = 0;
      let updated = 0;
      const checkedAt = now();
      const upsertStmt = db.prepare(
        `INSERT INTO employees (
          employee_code, employee_name, father_name, unit, godown, mobile_number, designation, status, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(employee_code) DO UPDATE SET
          employee_name = excluded.employee_name,
          father_name = excluded.father_name,
          unit = excluded.unit,
          godown = excluded.godown,
          mobile_number = excluded.mobile_number,
          designation = excluded.designation,
          status = excluded.status,
          updated_at = excluded.updated_at`
      );

      db.run("BEGIN TRANSACTION");
      try {
        employees.forEach((employee) => {
          const exists = scalar("SELECT 1 FROM employees WHERE employee_code = ?", [employee.employee_code]);
          if (exists) updated += 1;
          else inserted += 1;

          upsertStmt.run([
            employee.employee_code,
            employee.employee_name,
            employee.father_name || "",
            employee.unit || "",
            employee.godown || "",
            employee.mobile_number || "",
            employee.designation || "",
            employee.status || "Active",
            checkedAt,
            checkedAt,
          ]);
        });
        db.run("COMMIT");
      } catch (error) {
        db.run("ROLLBACK");
        throw error;
      } finally {
        upsertStmt.free();
      }

      if (employees.length) {
        audit("Employees Bulk Imported", `${inserted} created, ${updated} updated.`);
      }
      return { inserted, updated };
    },
    
    bulkCreateReviews(reviewRows) {
      if (!reviewRows.length) return;
      const createdAt = now();
      
      const checkStmt = db.prepare(`
        SELECT id 
        FROM review_queue 
        WHERE status = 'Pending' 
          AND employee_code = ? 
          AND lower(item_name) = lower(?)
          AND lower(COALESCE(issue_period_label, '')) = lower(COALESCE(?, ''))
          AND COALESCE(issue_month, 0) = COALESCE(?, 0)
          AND COALESCE(issue_year, 0) = COALESCE(?, 0)
      `);
      
      const updateStmt = db.prepare(`
        UPDATE review_queue 
        SET issued_qty = ?, 
            excess_qty = excess_qty + ?, 
            estimated_amount = estimated_amount + ? 
        WHERE id = ?
      `);

      const insertStmt = db.prepare(
        `INSERT INTO review_queue (
          employee_code, employee_name, unit, item_name, issue_month, issue_year, issue_period_label, issued_qty, allowed_qty, excess_qty,
          item_cost, estimated_amount, reason, status, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Pending', ?)`
      );

      db.run("BEGIN TRANSACTION");
      try {
        reviewRows.forEach((row) => {
          checkStmt.bind([
            row.employee_code,
            row.item_name || "",
            row.issue_period_label || "",
            row.issue_month ? Number(row.issue_month) : 0,
            row.issue_year ? Number(row.issue_year) : 0
          ]);
          
          let existingId = null;
          if (checkStmt.step()) {
            existingId = checkStmt.getAsObject().id;
          }
          checkStmt.reset();

          if (existingId) {
             updateStmt.run([
               Number(row.issued_qty || 0), 
               Number(row.excess_qty || 0), 
               Number(row.estimated_amount || 0), 
               existingId
             ]);
          } else {
             insertStmt.run([
                row.employee_code,
                row.employee_name,
                row.unit || "",
                row.item_name || "",
                row.issue_month ? Number(row.issue_month) : null,
                row.issue_year ? Number(row.issue_year) : null,
                row.issue_period_label || "",
                Number(row.issued_qty || 0),
                row.allowed_qty === null || row.allowed_qty === undefined ? null : Number(row.allowed_qty || 0),
                Number(row.excess_qty || 0),
                Number(row.item_cost || 0),
                Number(row.estimated_amount || 0),
                row.reason,
                createdAt,
             ]);
          }
        });
        db.run("COMMIT");
      } catch (error) {
        db.run("ROLLBACK");
        throw error;
      } finally {
        checkStmt.free();
        updateStmt.free();
        insertStmt.free();
      }
      audit("Reviews Bulk Created", `${reviewRows.length} review rows processed (inserted/updated) from import.`);
    },
    
    recordImport(importRecord) {
      db.run(
        `INSERT INTO imports (
          file_name, file_path, selected_sheet, import_hash, imported_at, total_rows, inserted_count, updated_count, skipped_count, failed_count, duplicate_count, validation_errors, generated_reviews, duration_ms, status
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          importRecord.fileName,
          importRecord.filePath,
          importRecord.selectedSheet,
          importRecord.importHash || "",
          now(),
          importRecord.totalRows,
          importRecord.inserted || 0,
          importRecord.updated || 0,
          importRecord.skipped || 0,
          importRecord.failedCount || 0,
          importRecord.duplicateCount || 0,
          JSON.stringify(importRecord.validationErrors || []),
          importRecord.generatedReviews || 0,
          importRecord.durationMs || 0,
          importRecord.status || 'Completed'
        ]
      );
      audit("Excel Imported", `${importRecord.fileName} sheet ${importRecord.selectedSheet}`);
      save();
      return scalar("SELECT MAX(id) FROM imports");
    },
    
    hasImportHash(importHash) {
      return Boolean(importHash && scalar("SELECT COUNT(*) FROM imports WHERE import_hash = ?", [importHash]));
    },
    
    updateImportReviewsCount(importId, generated) {
      db.run("UPDATE imports SET generated_reviews = ? WHERE id = ?", [generated, importId]);
      save();
    },
    
    isDuplicateIssue(issue) {
      return scalar(
        `SELECT COUNT(*) FROM uniform_issues 
         WHERE employee_code = ? AND lower(item_name) = lower(?)
           AND COALESCE(issue_month, 0) = COALESCE(?, 0)
           AND COALESCE(issue_year, 0) = COALESCE(?, 0)
           AND COALESCE(issue_period_label, '') = COALESCE(?, '')`,
        [issue.employee_code, issue.item_name, issue.issue_month, issue.issue_year, issue.issue_period_label]
      ) > 0;
    },
    
    getReviewQueueStage1() {
      return all(`
        SELECT 
          rq.employee_code,
          rq.employee_name,
          MAX(rq.unit) AS current_unit,
          MAX(rq.issue_period_label) AS payroll_month,
          COUNT(rq.id) AS pending_item_count,
          SUM(rq.excess_qty * COALESCE(ui.cost, 0)) AS estimated_deduction
        FROM review_queue rq
        LEFT JOIN (
            SELECT lower(item_name) AS search_name, MAX(cost) AS cost
            FROM uniform_items
            GROUP BY lower(item_name)
        ) ui ON lower(rq.item_name) = ui.search_name
        WHERE rq.status = 'Pending'
        GROUP BY rq.employee_code
        ORDER BY rq.created_at DESC
      `);
    },
    
    getReviewQueueStage2(employeeCode) {
      return all(`
        SELECT 
          rq.*,
          COALESCE(ui.cost, 0) AS live_rate,
          (rq.excess_qty * COALESCE(ui.cost, 0)) AS live_amount
        FROM review_queue rq
        LEFT JOIN (
            SELECT lower(item_name) AS search_name, MAX(cost) AS cost
            FROM uniform_items
            GROUP BY lower(item_name)
        ) ui ON lower(rq.item_name) = ui.search_name
        WHERE rq.employee_code = ?
        ORDER BY CASE WHEN rq.status = 'Pending' THEN 0 ELSE 1 END, rq.created_at DESC
      `, [employeeCode]);
    },
    
    getReviewQueueStage3(req) {
      return all(`
        SELECT 
          COALESCE(
            NULLIF(TRIM(i.issue_period_label), ''), 
            CASE WHEN i.issue_year > 0 THEN i.issue_year || '-' || substr('00' || COALESCE(i.issue_month, 1), -2, 2) || '-01' ELSE NULL END, 
            date(MAX(i.issued_at))
          ) AS issue_date,
          COALESCE(i.issue_month, 0) AS month,
          COALESCE(i.issue_year, 0) AS year,
          MAX(i.unit) AS unit,
          SUM(i.quantity) AS issued_qty,
          COALESCE(MAX(p.yearly_entitlement), 0) AS allowed_qty,
          COALESCE(MAX(r.status), 'No Action') AS previous_decision
        FROM uniform_issues i
        LEFT JOIN unit_policies p 
          ON lower(TRIM(COALESCE(i.unit, ''))) = lower(TRIM(COALESCE(p.unit, ''))) 
          AND lower(TRIM(i.item_name)) = lower(TRIM(p.item_name))
        LEFT JOIN review_queue r 
          ON i.employee_code = r.employee_code 
          AND lower(TRIM(i.item_name)) = lower(TRIM(r.item_name)) 
          AND COALESCE(i.issue_month, 0) = COALESCE(r.issue_month, 0) 
          AND COALESCE(i.issue_year, 0) = COALESCE(r.issue_year, 0)
          AND lower(TRIM(COALESCE(i.issue_period_label, ''))) = lower(TRIM(COALESCE(r.issue_period_label, '')))
        WHERE i.employee_code = ? 
          AND lower(TRIM(i.item_name)) = lower(TRIM(?))
          AND i.quantity > 0
          AND (
            i.issue_year >= (CAST(strftime('%Y', 'now') AS INTEGER) - 2)
            OR date(i.issued_at) >= date('now', '-2 years')
            OR (i.issue_year IS NULL OR i.issue_year = 0)
          )
        GROUP BY 
          i.employee_code, 
          lower(TRIM(i.item_name)), 
          COALESCE(i.issue_year, 0), 
          COALESCE(i.issue_month, 0), 
          lower(TRIM(COALESCE(i.issue_period_label, '')))
        ORDER BY 
          COALESCE(i.issue_year, 0) DESC, 
          COALESCE(i.issue_month, 0) DESC,
          MAX(i.issued_at) DESC
      `, [req.code, req.item]);
    },

    bulkCreateUniformIssues(issueRows, importId) {
      const validIssueRows = issueRows.filter((row) => Number(row.quantity || 0) > 0 && !isIgnoredIssueItemName(row.item_name));
      if (!validIssueRows.length) return;
      const issuedAt = now();
      const stmt = db.prepare(
        `INSERT INTO uniform_issues (
          import_id, employee_code, employee_name, unit, godown, item_name, quantity,
          issue_month, issue_year, issue_period_label, source_sheet, source_row, issued_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      );
      db.run("BEGIN TRANSACTION");
      try {
        validIssueRows.forEach((row) => {
          stmt.run([
            importId || null,
            row.employee_code,
            row.employee_name,
            row.unit || "",
            row.godown || "",
            row.item_name,
            Number(row.quantity || 0),
            row.issue_month ? Number(row.issue_month) : null,
            row.issue_year ? Number(row.issue_year) : null,
            row.issue_period_label || "",
            row.source_sheet,
            Number(row.source_row || 0),
            issuedAt,
          ]);
        });
        db.run("COMMIT");
      } catch (error) {
        db.run("ROLLBACK");
        throw error;
      } finally {
        stmt.free();
      }
      audit("Uniform Issues Imported", `${validIssueRows.length} item issue rows imported.`);
      save();
    },
    ensureDefaultPoliciesForImport(importId) {
      const created = ensureDefaultPoliciesForIssueRows(importId);
      if (created) {
        audit("Default Policies Created", `${created} unit/item policy rows created with allowed qty 0.`);
        save();
      }
      return created;
    },
    async evaluateEntitlementsForImport(importId, progressCallback) {
      const importedIssues = all("SELECT * FROM uniform_issues WHERE import_id = ? AND quantity > 0", [Number(importId)]);
      if (!importedIssues.length) return 0;

      // DEBUG: Setup trackers for Rajjan Kumar
      let rajjanDistRows = 0;
      let rajjanIssues = 0;
      let rajjanReviews = 0;
      importedIssues.forEach(issue => {
          if (String(issue.employee_name || "").toLowerCase().includes("rajjan") || String(issue.employee_code) === "Rajjan Kumar") {
              rajjanDistRows++;
              rajjanIssues += Number(issue.quantity || 0);
          }
      });

      const policies = all("SELECT * FROM unit_policies");
      const policyByUnitItem = new Map(
        policies.map((policy) => [
          `${String(policy.unit).toLowerCase()}|${String(policy.item_name).toLowerCase()}`,
          policy,
        ])
      );

      const reviewRows = [];
      const checked = new Set();
      
      let processed = 0;
      const total = importedIssues.length;

      for (const issue of importedIssues) {
        const periodKey = issue.issue_period_label || `${issue.issue_month || ""}/${issue.issue_year || ""}`;
        
        // BUG FIX: Removed `unit` from the unique check key. 
        // This stops multiple duplicate rows from firing if the employee was logged with varying units in the same import period.
        const key = `${issue.employee_code}|${issue.item_name}|${periodKey}`.toLowerCase();
        
        if (checked.has(key)) continue;
        checked.add(key);

        const policy = policyByUnitItem.get(`${String(issue.unit).toLowerCase()}|${String(issue.item_name).toLowerCase()}`);
        
        const isRajjan = String(issue.employee_name || "").toLowerCase().includes("rajjan") || String(issue.employee_code) === "Rajjan Kumar";

        if (!policy) {
          const importedQuantity = scalar(
            `SELECT COALESCE(SUM(quantity), 0) FROM uniform_issues
             WHERE import_id = ? AND employee_code = ? AND lower(item_name) = lower(?)
               AND lower(COALESCE(issue_period_label, '')) = lower(COALESCE(?, ''))
               AND COALESCE(issue_month, 0) = COALESCE(?, 0)
               AND COALESCE(issue_year, 0) = COALESCE(?, 0)`,
            [
              Number(importId),
              issue.employee_code,
              issue.item_name,
              issue.issue_period_label || "",
              issue.issue_month || 0,
              issue.issue_year || 0,
            ]
          );

          reviewRows.push({
            employee_code: issue.employee_code,
            employee_name: issue.employee_name,
            unit: issue.unit || "",
            item_name: issue.item_name,
            issue_month: issue.issue_month || null,
            issue_year: issue.issue_year || null,
            issue_period_label: issue.issue_period_label || "",
            issued_qty: importedQuantity,
            allowed_qty: null,
            excess_qty: importedQuantity,
            item_cost: 0,
            estimated_amount: 0,
            reason: `No entitlement policy found for ${issue.unit || "Unknown Unit"} / ${issue.item_name}.`,
          });
          
          if (isRajjan) rajjanReviews++;
          
        } else {
          const periodFilter = issue.issue_year
            ? { sql: " AND issue_year = ?", params: [issue.issue_year] }
            : issue.issue_period_label
              ? { sql: " AND lower(COALESCE(issue_period_label, '')) = lower(?)", params: [issue.issue_period_label] }
              : { sql: "", params: [] };
          
          // BUG FIX: Removed `unit` filter from SQL aggregates. Ensures employee totals are evaluated 
          // globally for the period, correctly mapping to a single unified entitlement.
          const annualQuantity = scalar(
            `SELECT COALESCE(SUM(quantity), 0) FROM uniform_issues
             WHERE employee_code = ? AND lower(item_name) = lower(?)
             ${periodFilter.sql}`,
            [issue.employee_code, issue.item_name, ...periodFilter.params]
          );
          const allowed = Number(policy.yearly_entitlement || 0);
          
          const settledQuantity = scalar(
            `SELECT COALESCE(SUM(excess_qty), 0) FROM review_queue
             WHERE employee_code = ? AND lower(item_name) = lower(?)
               AND status IN ('Waived', 'Deducted', 'Deduct')
               ${periodFilter.sql}`,
            [issue.employee_code, issue.item_name, ...periodFilter.params]
          );
          const unresolvedQuantity = scalar(
            `SELECT COALESCE(SUM(excess_qty), 0) FROM review_queue
             WHERE employee_code = ? AND lower(item_name) = lower(?)
               AND status IN ('Pending', 'Held', 'Hold')
               ${periodFilter.sql}`,
            [issue.employee_code, issue.item_name, ...periodFilter.params]
          );

          if (annualQuantity > allowed + settledQuantity + unresolvedQuantity) {
            const excess = annualQuantity - allowed - settledQuantity - unresolvedQuantity;
            const amount = excess * Number(policy.item_cost || 0);
            reviewRows.push({
              employee_code: issue.employee_code,
              employee_name: issue.employee_name,
              unit: issue.unit || "",
              item_name: issue.item_name,
              issue_month: issue.issue_month || null,
              issue_year: issue.issue_year || null,
              issue_period_label: issue.issue_period_label || "",
              issued_qty: annualQuantity,
              allowed_qty: allowed,
              excess_qty: excess,
              item_cost: Number(policy.item_cost || 0),
              estimated_amount: amount,
              reason: `${issue.item_name} entitlement exceeded.`,
            });
            if (isRajjan) rajjanReviews++;
          }
        }
        
        processed++;
        if (processed % 25 === 0) {
           if (progressCallback) progressCallback(processed, total);
           await new Promise(resolve => setTimeout(resolve, 0));
        }
      }

      // Output debug logs for Rajjan Kumar tracking
      if (rajjanDistRows > 0) {
          console.log(`\nEmployee: Rajjan Kumar`);
          console.log(`Distribution rows found: ${rajjanDistRows}`);
          console.log(`Uniform issues found: ${rajjanIssues}`);
          console.log(`Review rows generated: ${rajjanReviews}\n`);
      }

      this.bulkCreateReviews(reviewRows);
      if (reviewRows.length) {
        audit("Entitlement Review Generated", `${reviewRows.length} imported issue rows need review.`);
        save();
      }
      return reviewRows.length;
    },
    async recalculateReviews(onProgress) {
      const imports = all("SELECT id FROM imports ORDER BY id ASC");
      let generated = 0;
      
      // CLEAR all old generated Pending reviews explicitly to prevent duplication creep
      db.run("DELETE FROM review_queue WHERE status = 'Pending'");
      
      for (let i = 0; i < imports.length; i++) {
         generated += await this.evaluateEntitlementsForImport(imports[i].id, (processed, total) => {
             if (onProgress) onProgress(imports[i].id, i + 1, imports.length, processed, total);
         });
      }
      audit("Review Queue Recalculated", `${generated} pending review rows generated from current policies.`);
      save();
      return generated;
    },
    upsertPolicy(policy) {
      const normalizedPolicy = {
        id: policy.id ? Number(policy.id) : null,
        unit: String(policy.unit || "").trim(),
        item_name: String(policy.item_name || "").trim(),
        yearly_entitlement: Number(policy.yearly_entitlement || 0),
        item_cost: Number(policy.item_cost || 0),
      };

      if (!normalizedPolicy.unit || !normalizedPolicy.item_name) {
        throw new Error("Unit and item name are required.");
      }

      if (normalizedPolicy.id) {
        const exists = scalar("SELECT COUNT(*) FROM unit_policies WHERE id = ?", [normalizedPolicy.id]);
        if (!exists) throw new Error(`Policy #${policy.id} was not found.`);
        db.run(
          `UPDATE unit_policies SET unit = ?, item_name = ?, yearly_entitlement = ?, item_cost = ? WHERE id = ?`,
          [normalizedPolicy.unit, normalizedPolicy.item_name, normalizedPolicy.yearly_entitlement, normalizedPolicy.item_cost, normalizedPolicy.id]
        );
      } else {
        db.run(
          `INSERT INTO unit_policies (unit, item_name, yearly_entitlement, item_cost) VALUES (?, ?, ?, ?)`,
          [normalizedPolicy.unit, normalizedPolicy.item_name, normalizedPolicy.yearly_entitlement, normalizedPolicy.item_cost]
        );
      }
      audit("Policy Changed", `${normalizedPolicy.unit}: ${normalizedPolicy.item_name}`);
      save();
      return normalizedPolicy;
    },
    upsertItem(item) {
      const normalized = {
        id: item.id ? Number(item.id) : null,
        item_code: String(item.item_code || "").trim(),
        item_name: String(item.item_name || "").trim(),
        category: String(item.category || "").trim(),
        size: String(item.size || "").trim(),
        cost: Number(item.cost || 0),
        available_stock: Number(item.available_stock || 0),
        minimum_stock: Number(item.minimum_stock || 0),
        status: String(item.status || "Active").trim() || "Active",
      };
      if (!normalized.item_code || !normalized.item_name) throw new Error("Item code and item name are required.");
      if (normalized.id) {
        const exists = scalar("SELECT COUNT(*) FROM uniform_items WHERE id = ?", [normalized.id]);
        if (!exists) throw new Error(`Item #${normalized.id} was not found.`);
        db.run(
          `UPDATE uniform_items SET item_code = ?, item_name = ?, category = ?, size = ?, cost = ?, available_stock = ?, minimum_stock = ?, status = ?, updated_at = ? WHERE id = ?`,
          [normalized.item_code, normalized.item_name, normalized.category, normalized.size, normalized.cost, normalized.available_stock, normalized.minimum_stock, normalized.status, now(), normalized.id]
        );
      } else {
        db.run(
          `INSERT INTO uniform_items (item_code, item_name, category, size, cost, available_stock, minimum_stock, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [normalized.item_code, normalized.item_name, normalized.category, normalized.size, normalized.cost, normalized.available_stock, normalized.minimum_stock, normalized.status, now(), now()]
        );
      }
      audit("Item Saved", `${normalized.item_code} - ${normalized.item_name}`);
      save();
    },
    deleteItem(itemId) {
      const existing = all("SELECT id, item_code, item_name FROM uniform_items WHERE id = ?", [Number(itemId)])[0];
      if (!existing) throw new Error(`Item #${itemId} was not found.`);
      db.run("DELETE FROM uniform_items WHERE id = ?", [Number(itemId)]);
      audit("Item Deleted", `${existing.item_code} - ${existing.item_name}`);
      save();
    },
    deletePolicy(policyId) {
      const existing = all("SELECT id, unit, item_name FROM unit_policies WHERE id = ?", [Number(policyId)])[0];
      if (!existing) throw new Error(`Policy #${policyId} was not found.`);
      db.run("DELETE FROM unit_policies WHERE id = ?", [Number(policyId)]);
      audit("Policy Deleted", `${existing.unit}: ${existing.item_name}`);
      save();
    },
    updateDistributionRow(record) {
      const key = record.key || {};
      const quantities = record.quantities || {};
      const existingRows = all(
        `SELECT * FROM uniform_issues
         WHERE employee_code = ?
           AND lower(COALESCE(unit, '')) = lower(COALESCE(?, ''))
           AND lower(COALESCE(godown, '')) = lower(COALESCE(?, ''))
           AND COALESCE(issue_period_label, '') = COALESCE(?, '')
           AND COALESCE(issue_month, 0) = COALESCE(?, 0)
           AND COALESCE(issue_year, 0) = COALESCE(?, 0)`,
        [key.employee_code, key.unit || "", key.godown || "", key.issue_period_label || "", key.issue_month || 0, key.issue_year || 0]
      );
      if (!existingRows.length) throw new Error("Distribution row was not found.");
      const sample = existingRows[0];
      db.run("BEGIN TRANSACTION");
      try {
        db.run(
          `DELETE FROM uniform_issues
           WHERE employee_code = ?
             AND lower(COALESCE(unit, '')) = lower(COALESCE(?, ''))
             AND lower(COALESCE(godown, '')) = lower(COALESCE(?, ''))
             AND COALESCE(issue_period_label, '') = COALESCE(?, '')
             AND COALESCE(issue_month, 0) = COALESCE(?, 0)
             AND COALESCE(issue_year, 0) = COALESCE(?, 0)`,
          [key.employee_code, key.unit || "", key.godown || "", key.issue_period_label || "", key.issue_month || 0, key.issue_year || 0]
        );
        Object.entries(quantities).forEach(([itemName, value]) => {
          const quantity = Number(value || 0);
          if (quantity <= 0 || isIgnoredIssueItemName(itemName)) return;
          db.run(
            `INSERT INTO uniform_issues (import_id, employee_code, employee_name, unit, godown, item_name, quantity, issue_month, issue_year, issue_period_label, source_sheet, source_row, issued_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [sample.import_id || null, sample.employee_code, sample.employee_name, sample.unit || "", sample.godown || "", itemName, quantity, sample.issue_month || null, sample.issue_year || null, sample.issue_period_label || "", sample.source_sheet || "Manual Edit", sample.source_row || 0, now()]
          );
        });
        db.run("COMMIT");
      } catch (error) {
        db.run("ROLLBACK");
        throw error;
      }
      audit("Distribution Row Edited", `${sample.employee_code} ${sample.issue_period_label || ""}`);
      save();
    },
    deleteDistributionRow(key) {
      const result = db.run(
        `DELETE FROM uniform_issues WHERE employee_code = ? AND lower(COALESCE(unit, '')) = lower(COALESCE(?, '')) AND lower(COALESCE(godown, '')) = lower(COALESCE(?, '')) AND COALESCE(issue_period_label, '') = COALESCE(?, '') AND COALESCE(issue_month, 0) = COALESCE(?, 0) AND COALESCE(issue_year, 0) = COALESCE(?, 0)`,
        [key.employee_code, key.unit || "", key.godown || "", key.issue_period_label || "", key.issue_month || 0, key.issue_year || 0]
      );
      audit("Distribution Row Deleted", `${key.employee_code} ${key.issue_period_label || ""}`);
      save();
      return result;
    },
    deleteReview(reviewId) {
      const review = all("SELECT * FROM review_queue WHERE id = ?", [Number(reviewId)])[0];
      if (!review) throw new Error(`Review #${reviewId} was not found.`);
      db.run("DELETE FROM review_queue WHERE id = ?", [Number(reviewId)]);
      db.run("DELETE FROM review_decisions WHERE review_id = ?", [Number(reviewId)]);
      db.run("DELETE FROM salary_deductions WHERE review_id = ?", [Number(reviewId)]);
      db.run("DELETE FROM waive_records WHERE review_id = ?", [Number(reviewId)]);
      audit("Review Deleted", `Review #${reviewId}: ${review.employee_code}`);
      save();
    },
    updateReview(action) {
      const review = all("SELECT * FROM review_queue WHERE id = ?", [Number(action.id)])[0];
      if (!review) throw new Error(`Review #${action.id} was not found.`);
      
      if (action.status === 'Pending') {
        db.run("UPDATE review_queue SET status = 'Pending', remarks = NULL, decided_at = NULL WHERE id = ?", [Number(action.id)]);
        db.run("DELETE FROM review_decisions WHERE review_id = ?", [Number(action.id)]);
        db.run("DELETE FROM salary_deductions WHERE review_id = ?", [Number(action.id)]);
        db.run("DELETE FROM waive_records WHERE review_id = ?", [Number(action.id)]);
        audit("Review Reverted", `Review #${action.id} reverted to Pending.`);
        save();
        return;
      }

      const validStatuses = new Set(["Waived", "Held", "Deducted"]);
      if (!validStatuses.has(action.status)) throw new Error("Invalid review decision.");
      
      const approvedBy = String(action.approved_by || "").trim();
      const reason = String(action.reason || "").trim();
      const remarks = String(action.remarks || "").trim();
      
      if (!approvedBy) throw new Error("Approved by is required for review decisions.");
      if ((action.status === "Waived" || action.status === "Deducted") && !reason) {
        throw new Error("Reason is required for Waive and Deduct decisions.");
      }
      
      db.run(
        "UPDATE review_queue SET status = ?, remarks = ?, decided_at = ? WHERE id = ?",
        [action.status, remarks || reason, now(), Number(action.id)]
      );
      
      db.run(
        `INSERT INTO review_decisions (review_id, employee_code, employee_name, unit, decision, reason, approved_by, remarks, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [Number(action.id), review.employee_code, review.employee_name, review.unit || "", action.status, reason, approvedBy, remarks, now()]
      );
      
      if (action.status === "Deducted") {
        const existing = scalar("SELECT COUNT(*) FROM salary_deductions WHERE review_id = ?", [Number(action.id)]);
        if (!existing) {
          const liveCost = scalar("SELECT MAX(cost) FROM uniform_items WHERE lower(item_name) = lower(?)", [review.item_name]) || 0;
          const liveAmount = review.excess_qty * liveCost;
          const amount = liveAmount > 0 ? liveAmount : Number(review.estimated_amount || extractAmount(review.reason) || 0);
          
          db.run(
            `INSERT INTO salary_deductions (review_id, employee_code, employee_name, unit, issue_month, issue_year, issue_period_label, amount, reason, status, created_at, approved_by, approval_date, remarks) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'Pending Payroll', ?, ?, ?, ?)`,
            [Number(action.id), review.employee_code, review.employee_name, review.unit || "", review.issue_month || null, review.issue_year || null, review.issue_period_label || "", amount, reason || review.reason, now(), approvedBy, now(), remarks]
          );
          const deduction = all("SELECT * FROM salary_deductions WHERE review_id = ? ORDER BY id DESC LIMIT 1", [Number(action.id)])[0];
          const pdfPath = generateDeductionPdf(review, deduction, approvedBy, reason || review.reason, remarks);
          db.run("UPDATE salary_deductions SET pdf_path = ?, exported_at = ? WHERE id = ?", [pdfPath, now(), deduction.id]);
          audit("Salary Deduction Created", `Review #${action.id}: ${review.employee_code}`);
        }
      }
      
      if (action.status === "Waived") {
        const existing = scalar("SELECT COUNT(*) FROM waive_records WHERE review_id = ?", [Number(action.id)]);
        if (!existing) {
          db.run(
            `INSERT INTO waive_records (review_id, employee_code, employee_name, unit, reason, remarks, approved_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            [Number(action.id), review.employee_code, review.employee_name, review.unit || "", review.reason, remarks || reason, approvedBy, now()]
          );
          audit("Waive Record Created", `Review #${action.id}: ${review.employee_code}`);
        }
      }
      audit("Review Decision", `#${action.id} marked ${action.status} by ${approvedBy}`);
      save();
    },
    updateEmployee(employee) {
      const exists = scalar("SELECT COUNT(*) FROM employees WHERE employee_code = ?", [employee.employee_code]);
      if (!exists) throw new Error(`Employee ${employee.employee_code} was not found.`);
      db.run(
        `UPDATE employees SET employee_name = ?, father_name = ?, unit = ?, godown = ?, mobile_number = ?, designation = ?, status = ?, updated_at = ? WHERE employee_code = ?`,
        [employee.employee_name, employee.father_name || "", employee.unit || "", employee.godown || "", employee.mobile_number || "", employee.designation || "", employee.status || "Active", now(), employee.employee_code]
      );
      audit("Employee Edited", `${employee.employee_code} - ${employee.employee_name}`);
      save();
    },
    deleteEmployee(employeeCode) {
      const existing = all("SELECT employee_code, employee_name FROM employees WHERE employee_code = ?", [employeeCode])[0];
      if (!existing) throw new Error(`Employee ${employeeCode} was not found.`);
      db.run("DELETE FROM employees WHERE employee_code = ?", [employeeCode]);
      db.run("DELETE FROM review_queue WHERE employee_code = ?", [employeeCode]);
      audit("Employee Deleted", `${existing.employee_code} - ${existing.employee_name}`);
      save();
    },
    resetOperationalData() {
      db.run("BEGIN TRANSACTION");
      try {
        db.run("DELETE FROM employees");
        db.run("DELETE FROM imports");
        db.run("DELETE FROM review_queue");
        db.run("DELETE FROM uniform_issues");
        db.run("DELETE FROM salary_deductions");
        db.run("DELETE FROM waive_records");
        db.run("DELETE FROM review_decisions");
        db.run("COMMIT");
      } catch (error) {
        db.run("ROLLBACK");
        throw error;
      }
      audit("Operational Data Reset", "Employees, distribution register, review queue and deduction records cleared. Unit policies were kept.");
      save();
    },
    getState(options = {}) {
      const limitParam = options ? options.distributionLimit : undefined;
      const distributionLimit = limitParam !== undefined 
          ? Math.max(300, Math.min(Number(limitParam), 20000)) 
          : 300; 

      const issueRows = all("SELECT * FROM uniform_issues WHERE quantity > 0 ORDER BY COALESCE(issue_year, 9999), COALESCE(issue_month, 99), import_id ASC, source_row ASC, id ASC")
        .filter((row) => !isIgnoredIssueItemName(row.item_name));
      
      const policies = all("SELECT * FROM unit_policies ORDER BY unit, item_name");
      const policyByUnitItem = new Map(
        policies.map((policy) => [
          `${normalizeLabel(policy.unit)}|${normalizeLabel(policy.item_name)}`,
          policy,
        ])
      );
      
      const itemOrder = new Map();
      issueRows.forEach((row) => {
        const key = String(row.item_name);
        if (!itemOrder.has(key)) itemOrder.set(key, Number(row.id || 0));
      });
      const itemNames = [...itemOrder.entries()]
        .sort((a, b) => a[1] - b[1])
        .map(([itemName]) => itemName);
        
      const matrixByEmployee = new Map();
      issueRows.forEach((row) => {
        const periodLabel = row.issue_period_label || (row.issue_month && row.issue_year ? `${row.issue_month}/${row.issue_year}` : "");
        const key = `${row.employee_code}|${row.employee_name}|${row.unit}|${row.godown}|${periodLabel}`;
        if (!matrixByEmployee.has(key)) {
          matrixByEmployee.set(key, {
            employee_code: row.employee_code,
            employee_name: row.employee_name,
            unit: row.unit,
            godown: row.godown,
            issue_month: row.issue_month || null,
            issue_year: row.issue_year || null,
            issue_period_label: periodLabel,
            quantities: {},
            entitlements: {},
            total_quantity: 0,
            total_allowed: 0,
            total_excess: 0,
            has_missing_policy: false,
            has_excess: false,
            first_source_row: Number(row.source_row || 0),
            latest_import_id: Number(row.import_id || 0),
            sort_year: Number(row.issue_year || 0),
            sort_month: Number(row.issue_month || 0),
          });
        }
        const target = matrixByEmployee.get(key);
        target.quantities[row.item_name] = Number(target.quantities[row.item_name] || 0) + Number(row.quantity || 0);
        target.total_quantity += Number(row.quantity || 0);
        target.first_source_row = Math.min(target.first_source_row || Number(row.source_row || 0), Number(row.source_row || 0));
        target.latest_import_id = Math.max(target.latest_import_id || 0, Number(row.import_id || 0));
        target.sort_year = Math.max(target.sort_year || 0, Number(row.issue_year || 0));
        target.sort_month = Math.max(target.sort_month || 0, Number(row.issue_month || 0));
      });
      
      matrixByEmployee.forEach((employeeRow) => {
        itemNames.forEach((itemName) => {
          const issued = Number(employeeRow.quantities[itemName] || 0);
          if (!issued) {
            employeeRow.entitlements[itemName] = { issued: 0, allowed: 0, balance: 0, status: "None" };
            return;
          }
          const policy = policyByUnitItem.get(`${normalizeLabel(employeeRow.unit)}|${normalizeLabel(itemName)}`);
          if (!policy) {
            employeeRow.has_missing_policy = true;
            employeeRow.entitlements[itemName] = { issued, allowed: null, balance: null, status: "Missing Policy" };
            return;
          }
          const allowed = Number(policy.yearly_entitlement || 0);
          const balance = allowed - issued;
          employeeRow.total_allowed += allowed;
          if (balance < 0) {
            employeeRow.has_excess = true;
            employeeRow.total_excess += Math.abs(balance);
          }
          employeeRow.entitlements[itemName] = { issued, allowed, balance, status: balance < 0 ? "Excess" : "OK" };
        });
        employeeRow.entitlement_status = employeeRow.has_missing_policy ? "Missing Policy" : employeeRow.has_excess ? "Excess" : "OK";
      });
      
      const reviews = all("SELECT * FROM review_queue ORDER BY CASE WHEN status = 'Pending' THEN 0 ELSE 1 END, created_at ASC, id ASC LIMIT 500")
        .map((row) => ({ ...row, category: classifyReviewReason(row.reason) }));
        
      const reviewSummaryRows = all("SELECT reason, status, COUNT(*) AS row_count FROM review_queue GROUP BY reason, status");
      const missingPolicySuggestions = all(
        `SELECT unit, item_name, COUNT(*) AS case_count, MIN(employee_code) AS sample_employee_code, MIN(employee_name) AS sample_employee_name
         FROM review_queue
         WHERE status = 'Pending' AND item_name IS NOT NULL AND TRIM(item_name) <> '' AND (allowed_qty IS NULL OR lower(reason) LIKE '%no entitlement policy%')
         GROUP BY lower(unit), lower(item_name) ORDER BY unit, item_name`
      );
      
      const reviewSummary = reviewSummaryRows.reduce((summary, row) => {
        const key = classifyReviewReason(row.reason);
        if (!summary[key]) summary[key] = { total: 0, pending: 0 };
        summary[key].total += Number(row.row_count || 0);
        if (row.status === "Pending") summary[key].pending += Number(row.row_count || 0);
        return summary;
      }, {});
      
      const reviewPendingCount = scalar("SELECT COUNT(*) FROM review_queue WHERE status = 'Pending'");
      const reviewTotalCount = scalar("SELECT COUNT(*) FROM review_queue");
      const uniformIssueCount = scalar("SELECT COUNT(*) FROM uniform_issues WHERE quantity > 0");
      const distributionRows = [...matrixByEmployee.values()]
        .sort((a, b) =>
          Number(b.sort_year || 0) - Number(a.sort_year || 0) ||
          Number(b.sort_month || 0) - Number(a.sort_month || 0) ||
          Number(b.latest_import_id || 0) - Number(a.latest_import_id || 0) ||
          Number(a.first_source_row || 0) - Number(b.first_source_row || 0)
        );
        
      return {
        dbPath,
        employees: all("SELECT * FROM employees ORDER BY updated_at DESC"),
        policies,
        items: all("SELECT *, CASE WHEN available_stock <= minimum_stock THEN 1 ELSE 0 END AS is_low_stock FROM uniform_items ORDER BY item_name, size"),
        stockMovements: all("SELECT * FROM stock_movements ORDER BY created_at DESC, id DESC LIMIT 100"),
        salaryDeductions: all("SELECT * FROM salary_deductions ORDER BY created_at DESC, id DESC"),
        waiveRecords: all("SELECT * FROM waive_records ORDER BY created_at DESC, id DESC"),
        reviewDecisions: all("SELECT * FROM review_decisions ORDER BY created_at DESC, id DESC LIMIT 200"),
        recoveryRecords: all("SELECT * FROM recovery_records ORDER BY created_at DESC, id DESC"),
        uniformIssueMatrix: {
          items: itemNames,
          totalRows: distributionRows.length,
          rows: distributionRows.slice(0, distributionLimit),
        },
        uniformIssueCount,
        uniformIssues: issueRows.filter((row) => Number(row.quantity || 0) > 0).slice(0, 200),
        imports: all("SELECT * FROM imports ORDER BY imported_at DESC LIMIT 20"),
        reviews,
        reviewPendingCount,
        reviewTotalCount,
        missingPolicySuggestions,
        reviewSummary,
        audit: all("SELECT * FROM audit_log ORDER BY created_at DESC LIMIT 50"),
      };
    }
  };
}

module.exports = { createDatabase };