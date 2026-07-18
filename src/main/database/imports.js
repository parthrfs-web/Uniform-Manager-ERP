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
      audit("Excel Imported", `${importRecord.fileName} sheet ${importRecord.selectedSheet}`, {
        entityType: "Import",
        newValue: importRecord,
        remarks: `${importRecord.inserted || 0} inserted, ${importRecord.updated || 0} updated`,
      });
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
        audit("Default Policies Created", `${created} unit/item policy rows created with allowed qty 0.`, {
          entityType: "Policy",
          entityId: importId || null,
        });
        save();
      }
      return created;
    },
    
    // ISSUE 2 FIX: Moved synchronous blocking algorithm into a chunkable process
    evaluateEntitlementsForImport(importId, progressCallback) {
      const importedIssues = importId 
        ? all("SELECT * FROM uniform_issues WHERE import_id = ? AND quantity > 0", [Number(importId)])
        : all("SELECT * FROM uniform_issues WHERE quantity > 0");
        
      if (!importedIssues.length) return 0;

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
      
      const total = importedIssues.length;

      const issueKey = (issue) => issue.id || `${issue.import_id}:${issue.source_sheet}:${issue.source_row}:${issue.employee_code}:${issue.item_name}`;
      const buildPeriodScope = (issue, tableAlias = "") => {
        const prefix = tableAlias ? `${tableAlias}.` : "";
        const sql = [
          `COALESCE(${prefix}issue_month, 0) = COALESCE(?, 0)`,
          `COALESCE(${prefix}issue_year, 0) = COALESCE(?, 0)`,
          `lower(COALESCE(${prefix}issue_period_label, '')) = lower(COALESCE(?, ''))`,
        ].join(" AND ");
        return {
          sql: ` AND ${sql}`,
          params: [
            issue.issue_month ? Number(issue.issue_month) : null,
            issue.issue_year ? Number(issue.issue_year) : null,
            issue.issue_period_label || "",
          ],
          key: `${issue.issue_month || 0}|${issue.issue_year || 0}|${String(issue.issue_period_label || "").toLowerCase()}`,
        };
      };
      
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

      const processBatch = (start, end) => {
        for (let i = start; i < end; i++) {
          const issue = importedIssues[i];
          const sourceIssueKey = issueKey(issue);
          if (processedIssueIds.has(sourceIssueKey)) continue;
          processedIssueIds.add(sourceIssueKey);

          const periodScope = buildPeriodScope(issue);
          const periodKey = periodScope.key;
          
          const key = `${issue.employee_code}|${issue.unit}|${issue.item_name}|${periodKey}`.toLowerCase();
          
          if (checked.has(key)) continue;
          checked.add(key);

          const policy = policyByUnitItem.get(`${String(issue.unit).toLowerCase()}|${String(issue.item_name).toLowerCase()}`);
          const isRajjan = String(issue.employee_name || "").toLowerCase().includes("rajjan") || String(issue.employee_code) === "Rajjan Kumar";

          if (!policy) {
            const params = [issue.employee_code, issue.item_name, issue.unit || ""];
            params.push(...periodScope.params);
            
            if (importId) params.push(Number(importId));

            const importedQuantity = scalar(
              `SELECT COALESCE(SUM(quantity), 0) FROM uniform_issues
               WHERE employee_code = ? AND lower(item_name) = lower(?)
                 AND lower(COALESCE(unit, '')) = lower(COALESCE(?, ''))
                 ${periodScope.sql}
                 ${importId ? "AND import_id = ?" : ""}`,
              params
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
            const issuedQuantity = scalar(
              `SELECT COALESCE(SUM(quantity), 0) FROM uniform_issues
               WHERE employee_code = ? AND lower(item_name) = lower(?)
               AND lower(COALESCE(unit, '')) = lower(COALESCE(?, ''))
               ${periodScope.sql}`,
              [issue.employee_code, issue.item_name, issue.unit || "", ...periodScope.params]
            );
            const allowed = Number(policy.yearly_entitlement || 0);
            
            const settledQuantity = scalar(
              `SELECT COALESCE(SUM(excess_qty), 0) FROM review_queue
               WHERE employee_code = ? AND lower(item_name) = lower(?)
                 AND lower(COALESCE(unit, '')) = lower(COALESCE(?, ''))
                 AND status IN ('Waived', 'Deducted', 'Deduct')
                 ${periodScope.sql}`,
              [issue.employee_code, issue.item_name, issue.unit || "", ...periodScope.params]
            );
            const unresolvedQuantity = scalar(
              `SELECT COALESCE(SUM(excess_qty), 0) FROM review_queue
               WHERE employee_code = ? AND lower(item_name) = lower(?)
                 AND lower(COALESCE(unit, '')) = lower(COALESCE(?, ''))
                 AND status IN ('Pending', 'Held', 'Hold')
                 ${periodScope.sql}`,
              [issue.employee_code, issue.item_name, issue.unit || "", ...periodScope.params]
            );

            if (issuedQuantity > allowed + settledQuantity + unresolvedQuantity) {
              const excess = issuedQuantity - allowed - settledQuantity - unresolvedQuantity;
              const amount = excess * Number(policy.item_cost || 0);
              const created = queueReview(issue, {
                employee_code: issue.employee_code,
                employee_name: issue.employee_name,
                unit: issue.unit || "",
                item_name: issue.item_name,
                issue_month: issue.issue_month || null,
                issue_year: issue.issue_year || null,
                issue_period_label: issue.issue_period_label || "",
                issued_qty: issuedQuantity,
                allowed_qty: allowed,
                excess_qty: excess,
                item_cost: Number(policy.item_cost || 0),
                estimated_amount: amount,
                reason: `${issue.item_name} entitlement exceeded.`,
              });
              if (isRajjan && created) rajjanReviews++;
            }
          }
        }
      };

      const finalize = () => {
        if (rajjanDistRows > 0) {
            console.log(`\nEmployee: Rajjan Kumar`);
            console.log(`Distribution rows found: ${rajjanDistRows}`);
            console.log(`Uniform issues found: ${rajjanIssues}`);
            console.log(`Review rows generated: ${rajjanReviews}\n`);
        }

        this.bulkCreateReviews(reviewRows);
        if (reviewRows.length) {
          audit("Entitlement Review Generated", `${reviewRows.length} imported issue rows need review.`, {
            entityType: "Review",
            entityId: importId || null,
            newValue: { generated: reviewRows.length },
          });
          save();
        }
        return reviewRows.length;
      };

      // ISSUE 2 FIX: If no progress callback is passed (i.e. importer CLI tests), do sync execution
      if (!progressCallback) {
          processBatch(0, total);
          return finalize();
      }

      // ISSUE 2 FIX: If progress callback provided (i.e. electron app commit process), yield safely
      return (async () => {
          const BATCH_SIZE = 25;
          for (let i = 0; i < total; i += BATCH_SIZE) {
              processBatch(i, Math.min(i + BATCH_SIZE, total));
              if (progressCallback) progressCallback(Math.min(i + BATCH_SIZE, total), total);
              await new Promise(resolve => setTimeout(resolve, 0));
          }
          return finalize();
      })();
    },
    
    // ISSUE 2 FIX: Safely handles both async UI context and purely sync CLI context
    recalculateReviews(onProgress) {
      db.run("DELETE FROM review_queue WHERE status = 'Pending'");
      
      if (!onProgress) {
          const generated = this.evaluateEntitlementsForImport(null);
          audit("Review Queue Recalculated", `${generated} pending review rows generated from current policies.`, {
            entityType: "Review",
            newValue: { generated },
          });
          save();
          return generated;
      }

      return (async () => {
          const generated = await this.evaluateEntitlementsForImport(null, (processed, total) => {
              if (onProgress) onProgress(null, 1, 1, processed, total);
          });
          audit("Review Queue Recalculated", `${generated} pending review rows generated from current policies.`, {
            entityType: "Review",
            newValue: { generated },
          });
          save();
          return generated;
      })();
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
      audit("Operational Data Reset", "Employees, distribution register, review queue and deduction records cleared. Unit policies were kept.", {
        entityType: "System",
        remarks: "Unit policies and item settings were kept.",
      });
      save();
    }
});
