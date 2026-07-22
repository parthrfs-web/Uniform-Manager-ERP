module.exports = ({ db, dbPath, scalar, all, save, audit, now, normalizeLabel, isIgnoredIssueItemName, classifyReviewReason, extractAmount, generateDeductionPdf }) => ({
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
      
      const reviews = all(`
          SELECT r.*, 
              (SELECT COALESCE(SUM(quantity), 0) FROM review_queue_items WHERE review_queue_id = r.id AND decision = 'Pending') as pending_qty,
              (SELECT COALESCE(SUM(quantity), 0) FROM review_queue_items WHERE review_queue_id = r.id AND decision = 'Deduct') as deduct_qty,
              (SELECT COALESCE(SUM(quantity), 0) FROM review_queue_items WHERE review_queue_id = r.id AND decision = 'Waive') as waive_qty,
              (SELECT COALESCE(SUM(quantity), 0) FROM review_queue_items WHERE review_queue_id = r.id AND decision = 'Hold') as hold_qty
          FROM review_queue r 
          ORDER BY CASE WHEN r.status = 'Pending' THEN 0 ELSE 1 END, r.created_at ASC, r.id ASC LIMIT 500
      `).map((row) => ({ ...row, category: classifyReviewReason(row.reason) }));
        
      const missingPolicySuggestions = all(
        `SELECT unit, item_name, COUNT(*) AS case_count, MIN(employee_code) AS sample_employee_code, MIN(employee_name) AS sample_employee_name
         FROM review_queue
         WHERE status = 'Pending' AND item_name IS NOT NULL AND TRIM(item_name) <> '' AND (allowed_qty IS NULL OR lower(reason) LIKE '%no entitlement policy%')
         GROUP BY lower(unit), lower(item_name) ORDER BY unit, item_name`
      );
      
      const reviewPendingCount = scalar("SELECT COUNT(*) FROM review_queue_items WHERE decision = 'Pending'");
      const reviewTotalCount = scalar("SELECT COUNT(*) FROM review_queue_items");
      const uniformIssueCount = scalar("SELECT COUNT(*) FROM uniform_issues WHERE quantity > 0");
      const distributionRows = [...matrixByEmployee.values()]
        .sort((a, b) =>
          Number(b.sort_year || 0) - Number(a.sort_year || 0) ||
          Number(b.sort_month || 0) - Number(a.sort_month || 0) ||
          Number(b.latest_import_id || 0) - Number(a.latest_import_id || 0) ||
          Number(a.first_source_row || 0) - Number(b.first_source_row || 0)
        );
        
      const livePayrollRecords = all(`
        SELECT
          rqi.id,
          rqi.decision AS record_type,
          rqi.employee_code,
          COALESCE(e.employee_name, rq.employee_name, rqi.employee_code) AS employee_name,
          COALESCE(rq.unit, e.unit, '') AS unit,
          rqi.item_name,
          rqi.quantity,
          COALESCE(ui.cost, rq.item_cost, 0) AS rate,
          CASE
            WHEN rqi.decision = 'Deduct' THEN rqi.quantity * COALESCE(ui.cost, rq.item_cost, 0)
            ELSE 0
          END AS amount,
          COALESCE(rqi.remarks, rq.remarks, '') AS remarks,
          rq.issue_month,
          rq.issue_year,
          rq.issue_period_label,
          rqi.reviewed_by,
          rqi.reviewed_at
        FROM review_queue_items rqi
        JOIN review_queue rq ON rq.id = rqi.review_queue_id
        LEFT JOIN employees e ON e.employee_code = rqi.employee_code
        LEFT JOIN (
          SELECT lower(item_name) AS search_name, MAX(cost) AS cost
          FROM uniform_items
          GROUP BY lower(item_name)
        ) ui ON lower(rqi.item_name) = ui.search_name
        WHERE rqi.decision IN ('Deduct', 'Waive', 'Hold')
        ORDER BY COALESCE(rqi.reviewed_at, rq.decided_at, rq.created_at) DESC, rqi.id DESC
      `);

      return {
        dbPath,
        employees: all("SELECT * FROM employees ORDER BY updated_at DESC"),
        policies,
        items: all("SELECT *, CASE WHEN available_stock <= minimum_stock THEN 1 ELSE 0 END AS is_low_stock FROM uniform_items ORDER BY item_name, size"),
        stockMovements: all("SELECT * FROM stock_movements ORDER BY created_at DESC, id DESC LIMIT 100"),
        childDecisionStats: all("SELECT decision, COUNT(*) as count, SUM(quantity) as qty FROM review_queue_items GROUP BY decision"),
        payrollArchives: all(`
          SELECT
            pb.*,
            COUNT(pbr.id) AS record_count,
            COUNT(DISTINCT pbr.employee_code) AS total_employees,
            COALESCE(SUM(CASE WHEN pbr.record_type = 'Deduct' THEN pbr.amount ELSE 0 END), 0) AS total_deduction,
            'Archived' AS status
          FROM payroll_batches pb
          LEFT JOIN payroll_batch_records pbr ON pbr.archive_id = pb.id
          GROUP BY pb.id
          ORDER BY pb.created_at DESC
        `),
        payrollBatches: all(`
          SELECT
            pb.*,
            COUNT(pbr.id) AS record_count,
            COUNT(DISTINCT pbr.employee_code) AS total_employees,
            COALESCE(SUM(CASE WHEN pbr.record_type = 'Deduct' THEN pbr.amount ELSE 0 END), 0) AS total_deduction,
            'Archived' AS status
          FROM payroll_batches pb
          LEFT JOIN payroll_batch_records pbr ON pbr.archive_id = pb.id
          GROUP BY pb.id
          ORDER BY pb.created_at DESC
        `),
        livePayrollRecords,
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
        uniformIssues: issueRows.slice(0, distributionLimit),
        imports: all("SELECT * FROM imports ORDER BY imported_at DESC LIMIT 20"),
        reviews,
        reviewPendingCount,
        reviewTotalCount,
        missingPolicySuggestions,
        audit: all("SELECT * FROM audit_log ORDER BY created_at DESC LIMIT 50"),
      };
    },

    archiveCurrentPayrollRegister(payload) {
        const archiveName = String(payload.archive_name || payload.payroll_month || "").trim();
        if (!archiveName) throw new Error("Archive name is required.");

        const liveRecords = all(`
            SELECT
              rqi.decision,
              rqi.employee_code,
              COALESCE(e.employee_name, rq.employee_name, rqi.employee_code) AS employee_name,
              rqi.item_name,
              rqi.quantity,
              COALESCE(ui.cost, rq.item_cost, 0) AS rate,
              CASE
                WHEN rqi.decision = 'Deduct' THEN rqi.quantity * COALESCE(ui.cost, rq.item_cost, 0)
                ELSE 0
              END AS amount,
              COALESCE(rqi.remarks, rq.remarks, '') AS remarks
            FROM review_queue_items rqi
            JOIN review_queue rq ON rqi.review_queue_id = rq.id
            LEFT JOIN employees e ON e.employee_code = rqi.employee_code
            LEFT JOIN (
              SELECT lower(item_name) AS search_name, MAX(cost) AS cost
              FROM uniform_items
              GROUP BY lower(item_name)
            ) ui ON lower(rqi.item_name) = ui.search_name
            WHERE rqi.decision IN ('Deduct', 'Waive', 'Hold')
            ORDER BY COALESCE(rqi.reviewed_at, rq.decided_at, rq.created_at) DESC, rqi.id DESC
        `);

        if (liveRecords.length === 0) {
            throw new Error("No live register records found to archive.");
        }

        db.run("BEGIN TRANSACTION");
        try {
            const nextId = scalar("SELECT COALESCE(MAX(id), 0) + 1 FROM payroll_batches");
            const archiveNumber = `AR-${new Date().getFullYear()}-${String(new Date().getMonth()+1).padStart(2,'0')}-${String(nextId).padStart(3, '0')}`;
            
            let totalRecovery = 0;
            const archiveCols = all(`PRAGMA table_info(payroll_batches)`).map((row) => row.name);
            const archiveRecordCols = all(`PRAGMA table_info(payroll_batch_records)`).map((row) => row.name);
            const legacyArchiveIdCol = ["batch", "id"].join("_");
            const headerColumns = ["payroll_month", "generated_by", "created_at"];
            const headerValues = [archiveName, "Archive Current Register", now()];
            if (archiveCols.includes("archive_number")) {
                headerColumns.unshift("archive_number");
                headerValues.unshift(archiveNumber);
            }
            if (archiveCols.includes("batch_number")) {
                headerColumns.unshift("batch_number");
                headerValues.unshift(archiveNumber);
            }

            db.run(
                `INSERT INTO payroll_batches (${headerColumns.join(", ")}) VALUES (${headerColumns.map(() => "?").join(", ")})`,
                headerValues
            );
            const archiveId = scalar("SELECT last_insert_rowid()");

            for (const item of liveRecords) {
                const rate = Number(item.rate || 0);
                const amount = Number(item.amount || 0);
                
                if (item.decision === 'Deduct') {
                    totalRecovery += amount;
                }

                const recordColumns = ["archive_id", "record_type", "employee_code", "employee_name", "item_name", "quantity", "rate", "amount", "remarks"];
                const recordValues = [archiveId, item.decision, item.employee_code, item.employee_name || item.employee_code, item.item_name, item.quantity, rate, amount, item.remarks];
                if (archiveRecordCols.includes(legacyArchiveIdCol)) {
                    recordColumns.unshift(legacyArchiveIdCol);
                    recordValues.unshift(archiveId);
                }
                db.run(
                    `INSERT INTO payroll_batch_records (${recordColumns.join(", ")}) VALUES (${recordColumns.map(() => "?").join(", ")})`,
                    recordValues
                );
            }

            db.run(`UPDATE payroll_batches SET total_recovery_amount = ? WHERE id = ?`, [totalRecovery, archiveId]);

            db.run("COMMIT");
            audit("Payroll Register Archived", `Archived live register as ${archiveName}.`, {
                entityType: "Payroll Archive",
                entityId: archiveId,
                newValue: { archiveName, recordCount: liveRecords.length, totalRecovery },
            });
            save();
            return archiveId;
        } catch(e) {
            db.run("ROLLBACK");
            throw e;
        }
    },

    getPayrollArchiveData(archiveId) {
        const archive = all("SELECT * FROM payroll_batches WHERE id = ?", [Number(archiveId)])[0];
        if (!archive) throw new Error("Archive not found.");
        const records = all("SELECT * FROM payroll_batch_records WHERE archive_id = ?", [Number(archiveId)]);
        return { archive, records };
    },

    renamePayrollArchive(payload) {
        const archiveId = Number(payload.id);
        const archiveName = String(payload.archive_name || "").trim();
        if (!archiveId) throw new Error("Archive id is required.");
        if (!archiveName) throw new Error("Archive name is required.");

        const existing = all("SELECT * FROM payroll_batches WHERE id = ?", [archiveId])[0];
        if (!existing) throw new Error("Archive not found.");

        db.run("UPDATE payroll_batches SET payroll_month = ? WHERE id = ?", [archiveName, archiveId]);
        audit("Payroll Archive Renamed", `Renamed archive ${existing.payroll_month} to ${archiveName}.`, {
            entityType: "Payroll Archive",
            entityId: archiveId,
            oldValue: { archiveName: existing.payroll_month },
            newValue: { archiveName },
        });
        save();
    },

    deletePayrollArchiveById(archiveId) {
        const id = Number(archiveId);
        if (!id) throw new Error("Archive id is required.");

        const existing = all("SELECT * FROM payroll_batches WHERE id = ?", [id])[0];
        if (!existing) throw new Error("Archive not found.");
        const recordCount = Number(scalar("SELECT COUNT(*) FROM payroll_batch_records WHERE archive_id = ?", [id]) || 0);

        db.run("BEGIN TRANSACTION");
        try {
            db.run("DELETE FROM payroll_batch_records WHERE archive_id = ?", [id]);
            db.run("DELETE FROM payroll_batches WHERE id = ?", [id]);
            db.run("COMMIT");
        } catch (error) {
            db.run("ROLLBACK");
            throw error;
        }

        audit("Payroll Archive Deleted", `Deleted archive ${existing.payroll_month}.`, {
            entityType: "Payroll Archive",
            entityId: id,
            oldValue: { archiveName: existing.payroll_month, recordCount },
            result: "Success",
            remarks: "Live register was not changed.",
        });
        save();
    },

    buildPayrollArchivePdf(archiveId, filePath) {
        const archiveData = this.getPayrollArchiveData(archiveId);
        const archive = archiveData.archive;
        const records = archiveData.records || [];
        const deductions = records.filter((row) => row.record_type === "Deduct");
        const holds = records.filter((row) => row.record_type === "Hold");
        const waives = records.filter((row) => row.record_type === "Waive");
        const totalEmployees = new Set(records.map((row) => row.employee_code).filter(Boolean)).size;

        const fit = (value, width) => {
            const text = String(value ?? "").replace(/\s+/g, " ").trim();
            return text.length > width ? `${text.slice(0, Math.max(0, width - 3))}...` : text.padEnd(width, " ");
        };
        const money = (value) => `Rs. ${Number(value || 0).toFixed(2)}`;
        const pushRows = (lines, title, rows, includeAmount) => {
            lines.push("", title, "-".repeat(72));
            if (!rows.length) {
                lines.push("No records.");
                return;
            }
            lines.push(includeAmount
                ? `${fit("Code", 10)} ${fit("Name", 20)} ${fit("Item", 16)} ${fit("Qty", 6)} ${fit("Rate", 10)} ${fit("Amount", 12)}`
                : `${fit("Code", 10)} ${fit("Name", 24)} ${fit("Item", 20)} ${fit("Qty", 6)} ${fit("Remarks", 20)}`);
            rows.forEach((row) => {
                lines.push(includeAmount
                    ? `${fit(row.employee_code, 10)} ${fit(row.employee_name, 20)} ${fit(row.item_name, 16)} ${fit(row.quantity, 6)} ${fit(money(row.rate), 10)} ${fit(money(row.amount), 12)}`
                    : `${fit(row.employee_code, 10)} ${fit(row.employee_name, 24)} ${fit(row.item_name, 20)} ${fit(row.quantity, 6)} ${fit(row.remarks, 20)}`);
            });
        };

        const lines = [
            "UNIFORM MANAGER",
            "PAYROLL ARCHIVE",
            "=".repeat(72),
            `Archive Name  : ${archive.payroll_month}`,
            `Created       : ${(archive.created_at || "").replace("T", " ").substring(0, 19)}`,
            `Total Employees: ${totalEmployees}`,
            `Total Deduction: ${money(archive.total_recovery_amount)}`,
            "Status        : Archived",
        ];
        pushRows(lines, "SALARY DEDUCTION REGISTER", deductions, true);
        pushRows(lines, "HOLD REGISTER", holds, false);
        pushRows(lines, "WAIVE REGISTER", waives, false);

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
                .map((line, lineIndex) => `BT /F1 9 Tf 36 ${800 - (lineIndex * 15)} Td (${line}) Tj ET`)
                .join("\n");
            objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 842] /Resources << /Font << /F1 ${3 + (pages.length * 2)} 0 R >> >> /Contents ${contentObjectId} 0 R >>`);
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
        require("fs").writeFileSync(filePath, pdf);
        return filePath;
    },

    deleteAllPayrollArchives() {
        const archiveCount = Number(scalar("SELECT COUNT(*) FROM payroll_batches") || 0);
        const recordCount = Number(scalar("SELECT COUNT(*) FROM payroll_batch_records") || 0);

        if (archiveCount === 0 && recordCount === 0) {
            return {
                deleted: false,
                message: "No archived payroll reports found.",
                deletedArchives: 0,
                deletedRecords: 0,
            };
        }

        db.run("BEGIN TRANSACTION");
        try {
            db.run("DELETE FROM payroll_batch_records");
            db.run("DELETE FROM payroll_batches");
            db.run("COMMIT");
        } catch (error) {
            db.run("ROLLBACK");
            throw error;
        }

        audit("Payroll Archive Deleted", "All archived payroll reports were permanently deleted.", {
            entityType: "Payroll Archive",
            oldValue: { payroll_archives: archiveCount, payroll_archive_records: recordCount },
            result: "Success",
            remarks: "Operational data was not deleted.",
        });
        save();

        return {
            deleted: true,
            message: "Payroll Archive deleted successfully.",
            deletedArchives: archiveCount,
            deletedRecords: recordCount,
        };
    }
});
