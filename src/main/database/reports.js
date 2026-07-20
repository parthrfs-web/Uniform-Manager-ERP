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
        
      return {
        dbPath,
        employees: all("SELECT * FROM employees ORDER BY updated_at DESC"),
        policies,
        items: all("SELECT *, CASE WHEN available_stock <= minimum_stock THEN 1 ELSE 0 END AS is_low_stock FROM uniform_items ORDER BY item_name, size"),
        stockMovements: all("SELECT * FROM stock_movements ORDER BY created_at DESC, id DESC LIMIT 100"),
        childDecisionStats: all("SELECT decision, COUNT(*) as count, SUM(quantity) as qty FROM review_queue_items GROUP BY decision"),
        payrollBatches: all("SELECT * FROM payroll_batches ORDER BY created_at DESC"),
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

    generatePayrollBatch(payload) {
        const unbatched = all(`
            SELECT rqi.*, rq.item_cost, 
                   (SELECT employee_name FROM employees WHERE employee_code = rqi.employee_code) as emp_name
            FROM review_queue_items rqi
            JOIN review_queue rq ON rqi.review_queue_id = rq.id
            WHERE rqi.batch_id IS NULL AND rqi.decision IN ('Deduct', 'Waive', 'Hold')
        `);

        if (unbatched.length === 0) {
            throw new Error("No unbatched review decisions found to generate a report.");
        }

        db.run("BEGIN TRANSACTION");
        try {
            const nextId = scalar("SELECT COALESCE(MAX(id), 0) + 1 FROM payroll_batches");
            const batchNum = `PR-${new Date().getFullYear()}-${String(new Date().getMonth()+1).padStart(2,'0')}-${String(nextId).padStart(3, '0')}`;
            
            let totalRecovery = 0;

            db.run(
                `INSERT INTO payroll_batches (batch_number, payroll_month, generated_by, created_at) VALUES (?, ?, ?, ?)`,
                [batchNum, payload.payroll_month, payload.generated_by, now()]
            );
            const batchId = scalar("SELECT last_insert_rowid()");

            for (const item of unbatched) {
                const rate = Number(item.item_cost || 0);
                const amount = item.decision === 'Deduct' ? (Number(item.quantity) * rate) : 0;
                
                if (item.decision === 'Deduct') {
                    totalRecovery += amount;
                }

                db.run(
                    `INSERT INTO payroll_batch_records (batch_id, record_type, employee_code, employee_name, item_name, quantity, rate, amount, remarks) 
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                    [batchId, item.decision, item.employee_code, item.emp_name || item.employee_code, item.item_name, item.quantity, rate, amount, item.remarks]
                );

                db.run(`UPDATE review_queue_items SET batch_id = ? WHERE id = ?`, [batchId, item.id]);
            }

            db.run(`UPDATE payroll_batches SET total_recovery_amount = ? WHERE id = ?`, [totalRecovery, batchId]);

            db.run("COMMIT");
            return batchId;
        } catch(e) {
            db.run("ROLLBACK");
            throw e;
        }
    },

    getPayrollBatchData(batchId) {
        const batch = all("SELECT * FROM payroll_batches WHERE id = ?", [Number(batchId)])[0];
        if (!batch) throw new Error("Batch not found.");
        const records = all("SELECT * FROM payroll_batch_records WHERE batch_id = ?", [Number(batchId)]);
        return { batch, records };
    },

    deletePayrollArchive() {
        const batchCount = Number(scalar("SELECT COUNT(*) FROM payroll_batches") || 0);
        const recordCount = Number(scalar("SELECT COUNT(*) FROM payroll_batch_records") || 0);

        if (batchCount === 0 && recordCount === 0) {
            return {
                deleted: false,
                message: "No archived payroll reports found.",
                deletedBatches: 0,
                deletedRecords: 0,
            };
        }

        db.run("BEGIN TRANSACTION");
        try {
            db.run("UPDATE review_queue_items SET batch_id = NULL WHERE batch_id IS NOT NULL");
            db.run("DELETE FROM payroll_batch_records");
            db.run("DELETE FROM payroll_batches");
            db.run("COMMIT");
        } catch (error) {
            db.run("ROLLBACK");
            throw error;
        }

        audit("Payroll Archive Deleted", "All archived payroll reports were permanently deleted.", {
            entityType: "Payroll Archive",
            oldValue: { payroll_batches: batchCount, payroll_batch_records: recordCount },
            result: "Success",
            remarks: "Operational data was not deleted.",
        });
        save();

        return {
            deleted: true,
            message: "Payroll Archive deleted successfully.",
            deletedBatches: batchCount,
            deletedRecords: recordCount,
        };
    }
});
