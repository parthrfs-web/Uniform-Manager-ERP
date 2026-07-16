module.exports = ({ db, scalar, all, save, audit, now, normalizeLabel, isIgnoredIssueItemName, classifyReviewReason, ensureDefaultPoliciesForIssueRows, extractAmount, generateDeductionPdf }) => ({
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
    evaluateEntitlementsForImport(importId, progressCallback) {
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
      const processedIssueIds = new Set();
      const generatedIssueIds = new Set();
      
      let processed = 0;
      const total = importedIssues.length;

      const issueKey = (issue) => issue.id || `${issue.import_id}:${issue.source_sheet}:${issue.source_row}:${issue.employee_code}:${issue.item_name}`;
      const logReviewGeneration = (issue, created, note = "") => {
        console.log(
          `[ReviewGeneration] Issue ID=${issue.id || "-"} | Employee Code=${issue.employee_code || "-"} | ` +
          `Employee Name=${issue.employee_name || "-"} | Item=${issue.item_name || "-"} | ` +
          `Distribution Row ID=${issue.source_row || "-"} | Review Created=${created ? "YES" : "NO"}${note ? ` | ${note}` : ""}`
        );
      };
      const queueReview = (issue, reviewRow) => {
        const key = issueKey(issue);
        if (generatedIssueIds.has(key)) {
          logReviewGeneration(issue, false, "Duplicate source issue skipped inside evaluateEntitlementsForImport");
          return false;
        }
        generatedIssueIds.add(key);
        reviewRows.push(reviewRow);
        logReviewGeneration(issue, true);
        return true;
      };

      for (const issue of importedIssues) {
        const sourceIssueKey = issueKey(issue);
        if (processedIssueIds.has(sourceIssueKey)) {
          logReviewGeneration(issue, false, "Source issue was encountered twice before review generation");
          continue;
        }
        processedIssueIds.add(sourceIssueKey);

        const periodKey = issue.issue_period_label || `${issue.issue_month || ""}/${issue.issue_year || ""}`;
        
        const key = `${issue.employee_code}|${issue.unit}|${issue.item_name}|${periodKey}`.toLowerCase();
        
        if (checked.has(key)) continue;
        checked.add(key);

        const policy = policyByUnitItem.get(`${String(issue.unit).toLowerCase()}|${String(issue.item_name).toLowerCase()}`);
        
        const isRajjan = String(issue.employee_name || "").toLowerCase().includes("rajjan") || String(issue.employee_code) === "Rajjan Kumar";

        if (!policy) {
          const importedQuantity = scalar(
            `SELECT COALESCE(SUM(quantity), 0) FROM uniform_issues
             WHERE import_id = ? AND employee_code = ? AND lower(item_name) = lower(?)
               AND lower(COALESCE(unit, '')) = lower(COALESCE(?, ''))
               AND lower(COALESCE(issue_period_label, '')) = lower(COALESCE(?, ''))
               AND COALESCE(issue_month, 0) = COALESCE(?, 0)
               AND COALESCE(issue_year, 0) = COALESCE(?, 0)`,
            [
              Number(importId),
              issue.employee_code,
              issue.item_name,
              issue.unit || "",
              issue.issue_period_label || "",
              issue.issue_month || 0,
              issue.issue_year || 0,
            ]
          );

          const created = queueReview(issue, {
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
          
          if (isRajjan && created) rajjanReviews++;
          
        } else {
          const periodFilter = issue.issue_year
            ? { sql: " AND issue_year = ?", params: [issue.issue_year] }
            : issue.issue_period_label
              ? { sql: " AND lower(COALESCE(issue_period_label, '')) = lower(?)", params: [issue.issue_period_label] }
              : { sql: "", params: [] };
          
          const annualQuantity = scalar(
            `SELECT COALESCE(SUM(quantity), 0) FROM uniform_issues
             WHERE employee_code = ? AND lower(item_name) = lower(?)
             AND lower(COALESCE(unit, '')) = lower(COALESCE(?, ''))
             ${periodFilter.sql}`,
            [issue.employee_code, issue.item_name, issue.unit || "", ...periodFilter.params]
          );
          const allowed = Number(policy.yearly_entitlement || 0);
          
          const settledQuantity = scalar(
            `SELECT COALESCE(SUM(excess_qty), 0) FROM review_queue
             WHERE employee_code = ? AND lower(item_name) = lower(?)
               AND lower(COALESCE(unit, '')) = lower(COALESCE(?, ''))
               AND status IN ('Waived', 'Deducted', 'Deduct')
               ${periodFilter.sql}`,
            [issue.employee_code, issue.item_name, issue.unit || "", ...periodFilter.params]
          );
          const unresolvedQuantity = scalar(
            `SELECT COALESCE(SUM(excess_qty), 0) FROM review_queue
             WHERE employee_code = ? AND lower(item_name) = lower(?)
               AND lower(COALESCE(unit, '')) = lower(COALESCE(?, ''))
               AND status IN ('Pending', 'Held', 'Hold')
               ${periodFilter.sql}`,
            [issue.employee_code, issue.item_name, issue.unit || "", ...periodFilter.params]
          );

          if (annualQuantity > allowed + settledQuantity + unresolvedQuantity) {
            const excess = annualQuantity - allowed - settledQuantity - unresolvedQuantity;
            const amount = excess * Number(policy.item_cost || 0);
            const created = queueReview(issue, {
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
            if (isRajjan && created) rajjanReviews++;
          }
        }
        
        processed++;
        if (processed % 25 === 0) {
           if (progressCallback) progressCallback(processed, total);
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
    recalculateReviews(onProgress) {
      const imports = all("SELECT id FROM imports ORDER BY id ASC");
      let generated = 0;
      
      // CLEAR all old generated Pending reviews explicitly to prevent duplication creep
      db.run("DELETE FROM review_queue WHERE status = 'Pending'");
      
      for (let i = 0; i < imports.length; i++) {
         generated += this.evaluateEntitlementsForImport(imports[i].id, (processed, total) => {
             if (onProgress) onProgress(imports[i].id, i + 1, imports.length, processed, total);
         });
      }
      audit("Review Queue Recalculated", `${generated} pending review rows generated from current policies.`);
      save();
      return generated;
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
    }
});
