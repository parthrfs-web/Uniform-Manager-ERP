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
    
    evaluateEntitlementsForImport(importId, progressCallback) {
        const targetEmployees = importId 
            ? all("SELECT DISTINCT employee_code FROM uniform_issues WHERE import_id = ?", [Number(importId)]).map(r => r.employee_code)
            : all("SELECT DISTINCT employee_code FROM uniform_issues").map(r => r.employee_code);
            
        if (!targetEmployees.length) return 0;

        const policies = all("SELECT * FROM unit_policies");
        const policyMap = new Map(policies.map(p => [`${String(p.unit).toLowerCase()}|${String(p.item_name).toLowerCase()}`, Number(p.yearly_entitlement || 0)]));
        const costMap = new Map(policies.map(p => [`${String(p.unit).toLowerCase()}|${String(p.item_name).toLowerCase()}`, Number(p.item_cost || 0)]));

        let generatedCount = 0;
        const total = targetEmployees.length;

        const processBatch = (start, end) => {
            db.run("BEGIN TRANSACTION");
            try {
                for (let i = start; i < end; i++) {
                    const empCode = targetEmployees[i];
                    
                    const issues = all(`SELECT * FROM uniform_issues WHERE employee_code = ? AND quantity > 0 ORDER BY COALESCE(issue_year, 9999) ASC, COALESCE(issue_month, 99) ASC, issued_at ASC, source_row ASC, id ASC`, [empCode]);
                    
                    const itemsMap = new Map();
                    issues.forEach(issue => {
                        const key = String(issue.item_name).toLowerCase();
                        if (!itemsMap.has(key)) itemsMap.set(key, { item_name: issue.item_name, issues: [] });
                        itemsMap.get(key).issues.push(issue);
                    });

                    for (const [itemKey, data] of itemsMap.entries()) {
                        const itemName = data.item_name;
                        const itemIssues = data.issues;
                        
                        let totalIssued = 0;
                        let totalExcess = 0;
                        
                        const unitBalances = new Map();
                        const excessTransactions = [];
                        let latestUnit = "";
                        let maxCost = 0;

                        for (const issue of itemIssues) {
                            latestUnit = issue.unit || latestUnit;
                            const pKey = `${String(issue.unit || '').toLowerCase()}|${itemKey}`;
                            const cost = costMap.get(pKey) || 0;
                            if (cost > maxCost) maxCost = cost;
                            
                            if (!unitBalances.has(pKey)) {
                                unitBalances.set(pKey, policyMap.has(pKey) ? policyMap.get(pKey) : 0);
                            }
                            
                            totalIssued += issue.quantity;
                            
                            let balance = unitBalances.get(pKey);
                            let consumed = Math.min(issue.quantity, balance);
                            unitBalances.set(pKey, balance - consumed);
                            
                            let excess = issue.quantity - consumed;
                            if (excess > 0) {
                                totalExcess += excess;
                                excessTransactions.push({ issue, excess_qty: excess });
                            }
                        }
                        
                        const totalAllowed = totalIssued - totalExcess;
                        
                        let rq = all("SELECT * FROM review_queue WHERE employee_code = ? AND lower(item_name) = ?", [empCode, itemKey])[0];
                        let rqId;
                        
                        const pKey = `${String(latestUnit).toLowerCase()}|${itemKey}`;
                        const reason = policyMap.has(pKey) 
                            ? `${itemName} entitlement exceeded.` 
                            : `No entitlement policy found for ${latestUnit || "Unknown Unit"} / ${itemName}.`;
                        const estimatedAmount = totalExcess * maxCost;
                        
                        if (!rq) {
                            if (totalExcess > 0) {
                                db.run(`INSERT INTO review_queue (employee_code, employee_name, unit, item_name, issued_qty, allowed_qty, excess_qty, item_cost, estimated_amount, reason, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Pending', ?)`,
                                [empCode, itemIssues[0].employee_name, latestUnit, itemName, totalIssued, totalAllowed, totalExcess, maxCost, estimatedAmount, reason, now()]);
                                rqId = scalar("SELECT last_insert_rowid()");
                                generatedCount++;
                            } else {
                                continue; 
                            }
                        } else {
                            rqId = rq.id;
                        }
                        
                        const legacyItems = all("SELECT * FROM review_queue_items WHERE review_queue_id = ? AND decision != 'Pending'", [rqId]);
                        const legacyMap = new Map(legacyItems.map(li => [li.uniform_issue_id, li]));
                        
                        db.run("DELETE FROM review_queue_items WHERE review_queue_id = ?", [rqId]);
                        
                        let hasPending = false;
                        
                        for (const ext of excessTransactions) {
                            const legacy = legacyMap.get(ext.issue.id);
                            const decision = legacy ? legacy.decision : 'Pending';
                            const remarks = legacy ? legacy.remarks : '';
                            const reviewedBy = legacy ? legacy.reviewed_by : null;
                            const reviewedAt = legacy ? legacy.reviewed_at : null;
                            
                            if (decision === 'Pending') hasPending = true;
                            
                            db.run(`INSERT INTO review_queue_items (review_queue_id, uniform_issue_id, employee_code, item_name, issue_date, quantity, decision, remarks, reviewed_by, reviewed_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                            [rqId, ext.issue.id, empCode, itemName, ext.issue.issued_at, ext.excess_qty, decision, remarks, reviewedBy, reviewedAt, now()]);
                        }
                        
                        let newStatus = hasPending ? 'Pending' : 'Completed';
                        if (totalExcess === 0) newStatus = 'Completed'; 
                        
                        db.run("UPDATE review_queue SET issued_qty = ?, allowed_qty = ?, excess_qty = ?, item_cost = ?, estimated_amount = ?, reason = ?, status = ? WHERE id = ?", [totalIssued, totalAllowed, totalExcess, maxCost, estimatedAmount, reason, newStatus, rqId]);
                    }
                }
                db.run("COMMIT");
            } catch (e) {
                db.run("ROLLBACK");
                throw e;
            }
        };

        const finalize = () => {
            if (generatedCount > 0) {
                audit("Entitlement Review Generated", `${generatedCount} transaction groups marked pending review.`, {
                    entityType: "Review",
                    entityId: importId || null,
                    newValue: { generated: generatedCount },
                });
                save();
            }
            return generatedCount;
        };

        if (!progressCallback) {
            processBatch(0, total);
            return finalize();
        }

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
    
    recalculateReviews(onProgress) {
      if (!onProgress) {
          const generated = this.evaluateEntitlementsForImport(null);
          return generated;
      }

      return (async () => {
          const generated = await this.evaluateEntitlementsForImport(null, (processed, total) => {
              if (onProgress) onProgress(null, 1, 1, processed, total);
          });
          return generated;
      })();
    },
    
    resetOperationalData() {
      db.run("BEGIN TRANSACTION");
      try {
        db.run("DELETE FROM employees");
        db.run("DELETE FROM imports");
        db.run("DELETE FROM review_queue");
        db.run("DELETE FROM review_queue_items");
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