const { ensureAnnualPoliciesForRecognizedItems } = require('./annual-policy-sync');
const { normalizeEntitlementLabel, getEntitlementFinancialYear } = require('./entitlement-scope');

module.exports = ({ db, scalar, all, save, audit, now, normalizeLabel, isIgnoredIssueItemName, classifyReviewReason, ensureDefaultPoliciesForIssueRows, extractAmount, generateDeductionPdf, reopenDueHeldReviews }) => ({
    recordImport(importRecord) {
      db.run('BEGIN TRANSACTION');
      try {
        db.run(
        `INSERT INTO imports (
          file_name, file_path, selected_sheet, import_hash, imported_at, total_rows, inserted_count, updated_count, skipped_count, failed_count, duplicate_count, validation_errors, detected_items, generated_reviews, duration_ms, status
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
          JSON.stringify([...new Set((Array.isArray(importRecord.detectedItems) ? importRecord.detectedItems : [])
            .map((item) => String(item || '').trim()).filter((item) => item && !isIgnoredIssueItemName(item)))]),
          importRecord.generatedReviews || 0,
          importRecord.durationMs || 0,
          importRecord.status || 'Completed'
        ]
        );
        const detectedItems = [...new Set((Array.isArray(importRecord.detectedItems) ? importRecord.detectedItems : [])
        .map((item) => String(item || '').trim()).filter((item) => item && !isIgnoredIssueItemName(item)))];
        detectedItems.forEach((itemName) => db.run(`INSERT OR IGNORE INTO actual_item_prices (item_name, actual_price, created_at, updated_at)
          VALUES (?, 0, ?, ?)`, [itemName, now(), now()]));
        audit("Excel Imported", `${importRecord.fileName} sheet ${importRecord.selectedSheet}`, {
        entityType: "Import",
        newValue: importRecord,
        remarks: `${importRecord.inserted || 0} inserted, ${importRecord.updated || 0} updated`,
        });
        if (detectedItems.length) audit('Imported Item Prices Synchronized', `Verified ${detectedItems.length} detected item(s) and inserted missing zero-price rows.`, {
          entityType: 'Actual Item Prices', entityId: 'global-item-prices',
          remarks: 'Existing Actual Prices were preserved; imported item names remain separate from inventory stock.',
        });
        const importId = scalar("SELECT MAX(id) FROM imports");
        db.run('COMMIT');
        save();
        return importId;
      } catch (error) {
        db.run('ROLLBACK');
        throw error;
      }
    },
    hasImportHash(importHash) {
      return Boolean(importHash && scalar("SELECT COUNT(*) FROM imports WHERE import_hash = ?", [importHash]));
    },
    syncDuplicateImportDetectedItems(importHash, itemNames) {
      if (!importHash || !Array.isArray(itemNames)) return { added: 0 };
      const imported = all('SELECT id, detected_items FROM imports WHERE import_hash = ?', [importHash])[0];
      if (!imported) return { added: 0 };
      let existingItems = [];
      try { const parsed = JSON.parse(imported.detected_items || '[]'); if (Array.isArray(parsed)) existingItems = parsed; } catch {}
      const merged = new Map(existingItems.map((name) => [String(name || '').trim().toLocaleLowerCase(), String(name || '').trim()]).filter(([key, name]) => key && name && !isIgnoredIssueItemName(name)));
      const before = merged.size;
      itemNames.forEach((rawName) => {
        const name = String(rawName || '').trim();
        if (!name || isIgnoredIssueItemName(name)) return;
        const key = name.toLocaleLowerCase();
        if (!merged.has(key)) merged.set(key, name);
      });
      if (merged.size === before) return { added: 0 };
      const names = [...merged.values()];
      db.run('BEGIN TRANSACTION');
      try {
        names.forEach((name) => db.run(`INSERT OR IGNORE INTO actual_item_prices (item_name, actual_price, created_at, updated_at) VALUES (?, 0, ?, ?)`, [name, now(), now()]));
        db.run('UPDATE imports SET detected_items = ? WHERE id = ?', [JSON.stringify(names), Number(imported.id)]);
        audit('Duplicate Import Item Catalog Synchronized', `Added ${merged.size - before} newly detected item name(s) to the existing import.`, {
          entityType: 'Import', entityId: imported.id,
          remarks: 'Duplicate distribution rows were skipped; existing Actual Prices were preserved.',
        });
        db.run('COMMIT');
        save();
        return { added: merged.size - before };
      } catch (error) {
        db.run('ROLLBACK');
        throw error;
      }
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
      // Legacy API retained for compatibility; unknown policy must not become 0.
      return 0;
    },
    
    evaluateEntitlementsForImport(importId, progressCallback, onlyEmployeeCode = null, options = {}) {
        ensureAnnualPoliciesForRecognizedItems({ db, all, scalar, save, audit, now, isIgnoredIssueItemName });
        if (!options.deferHoldReconciliation && typeof reopenDueHeldReviews === 'function') reopenDueHeldReviews();
        const targetEmployees = onlyEmployeeCode
            ? [String(onlyEmployeeCode)]
            : importId
            ? all("SELECT DISTINCT employee_code FROM uniform_issues WHERE import_id = ?", [Number(importId)]).map(r => r.employee_code)
            : all("SELECT DISTINCT employee_code FROM uniform_issues").map(r => r.employee_code);
            
        if (!targetEmployees.length) return 0;

        const configuredMode = scalar("SELECT setting_value FROM app_settings WHERE setting_key = 'review_queue_calculation_mode'");
        const mode = ["item_annual", "unit_wise", "combined"].includes(configuredMode) ? configuredMode : "item_annual";
        const policies = all("SELECT * FROM unit_policies");
        const unitPolicyMap = new Map(policies.map((policy) => [`${normalizeEntitlementLabel(policy.unit)}|${normalizeEntitlementLabel(policy.item_name)}`, Number(policy.yearly_entitlement || 0)]));
        const costMap = new Map(policies.map(p => [`${normalizeEntitlementLabel(p.unit)}|${normalizeEntitlementLabel(p.item_name)}`, Number(p.item_cost || 0)]));
        const annualPolicies = all("SELECT * FROM annual_policies WHERE lower(trim(COALESCE(status, 'Active'))) = 'active'");
        const annualLimitMap = new Map(annualPolicies.map((policy) => [`${normalizeEntitlementLabel(policy.item_name)}|${Number(policy.financial_year)}`, Number(policy.allowed_quantity || 0)]));

        let generatedCount = 0;
        const total = targetEmployees.length;

        const processBatch = (start, end) => {
    db.run("BEGIN TRANSACTION");
    try {
        const batchEmps = targetEmployees.slice(start, end);

        for (let i = start; i < end; i++) {
            const empCode = targetEmployees[i];
            // Include completed parents too: a prior policy change may have
            // deactivated their last pending child, but their display snapshot
            // still needs to refresh when this employee is recalculated.
            const affectedParents = new Set(all("SELECT id FROM review_queue WHERE employee_code = ?", [empCode]).map((row) => Number(row.id)));
            
            const issues = all(`SELECT * FROM uniform_issues WHERE employee_code = ? AND quantity > 0 ORDER BY COALESCE(issue_year, 9999) ASC, COALESCE(issue_month, 99) ASC, issued_at ASC, source_row ASC, id ASC`, [empCode]);
            
            const unitBalances = new Map();
            const annualBalances = new Map();
            const pendingByUnitItem = new Map();
            const issuedByScope = new Map();

            for (const issue of issues) {
                const quantity = Number(issue.quantity || 0);
                const itemName = issue.item_name;
                const itemKey = normalizeEntitlementLabel(itemName);
                const unit = issue.unit || "";
                const unitPolicyKey = `${normalizeEntitlementLabel(unit)}|${itemKey}`;
                const financialYear = getEntitlementFinancialYear(issue);
                const financialYearKey = financialYear === null ? 'unknown' : String(financialYear);
                const unitKey = `${unitPolicyKey}|${financialYearKey}`;
                const annualKey = `${itemKey}|${financialYear}`;
                issuedByScope.set(`${itemKey}|${financialYearKey}`, (issuedByScope.get(`${itemKey}|${financialYearKey}`) || 0) + quantity);
                issuedByScope.set(`${unitKey}`, (issuedByScope.get(unitKey) || 0) + quantity);

                if (!unitBalances.has(unitKey) && unitPolicyMap.has(unitPolicyKey)) unitBalances.set(unitKey, unitPolicyMap.get(unitPolicyKey));
                if (!annualBalances.has(annualKey) && annualLimitMap.has(annualKey)) annualBalances.set(annualKey, annualLimitMap.get(annualKey));
                const unitAllowed = unitPolicyMap.has(unitPolicyKey) ? unitPolicyMap.get(unitPolicyKey) : null;
                const annualAllowed = annualLimitMap.has(annualKey) ? annualLimitMap.get(annualKey) : null;
                const existingChildren = all("SELECT * FROM review_queue_items WHERE uniform_issue_id = ? AND COALESCE(is_active, 1) = 1 ORDER BY id", [issue.id]);
                const resolvedQty = existingChildren.reduce((sum, child) => sum + Number(child.deducted_quantity || 0) + Number(child.waived_quantity || 0) + Number(child.held_quantity || 0), 0);

                const unitRawExcess = unitAllowed === null ? 0 : Math.max(0, quantity - Math.min(quantity, unitBalances.get(unitKey) || 0));
                const annualRawExcess = annualAllowed === null ? 0 : Math.max(0, quantity - Math.min(quantity, annualBalances.get(annualKey) || 0));
                const unitExcess = Math.max(unitRawExcess, mode === "unit_wise" || mode === "combined" ? Math.min(quantity, resolvedQty) : 0);
                const annualExcess = Math.max(annualRawExcess, mode === "item_annual" || mode === "combined" ? Math.min(quantity, resolvedQty) : 0);

                if ((mode === "unit_wise" || mode === "combined") && unitAllowed !== null) unitBalances.set(unitKey, Math.max(0, (unitBalances.get(unitKey) || 0) - (quantity - unitExcess)));
                if ((mode === "item_annual" || mode === "combined") && annualAllowed !== null) annualBalances.set(annualKey, Math.max(0, (annualBalances.get(annualKey) || 0) - (quantity - annualExcess)));

                const policyConfigured = mode === "item_annual" ? annualAllowed !== null
                    : mode === "unit_wise" ? unitAllowed !== null : (annualAllowed !== null || unitAllowed !== null);
                let policyExcess = mode === "item_annual" ? annualRawExcess : mode === "unit_wise" ? unitRawExcess : Math.max(unitRawExcess, annualRawExcess);
                policyExcess = Math.min(quantity, policyExcess);
                const finalExcess = Math.min(quantity, Math.max(policyExcess, resolvedQty));
                const consumed = policyConfigured ? Math.max(0, quantity - finalExcess) : 0;
                db.run('UPDATE uniform_issues SET entitlement_consumed = ?, excess_generated = ? WHERE id = ?', [consumed, finalExcess, issue.id]);
                const pendingExcess = Math.max(0, finalExcess - resolvedQty);
                let reusablePendingChild = null;
                for (const child of existingChildren) {
                    const allocated = Number(child.deducted_quantity || 0) + Number(child.waived_quantity || 0) + Number(child.held_quantity || 0);
                    affectedParents.add(Number(child.review_queue_id));
                    if (allocated <= 0) {
                        // Reuse a still-pending child so routine recalculation
                        // does not churn its ID or accumulate duplicate history rows.
                        if (!reusablePendingChild) reusablePendingChild = child;
                        else db.run("UPDATE review_queue_items SET is_active = 0 WHERE id = ? AND COALESCE(is_active, 1) = 1", [child.id]);
                        continue;
                    }
                    const decision = Number(child.held_quantity || 0) > 0
                        ? (Number(child.deducted_quantity || 0) > 0 || Number(child.waived_quantity || 0) > 0 ? "Completed" : "Hold")
                        : Number(child.deducted_quantity || 0) > 0 && Number(child.waived_quantity || 0) === 0 ? "Deduct"
                            : Number(child.waived_quantity || 0) > 0 && Number(child.deducted_quantity || 0) === 0 ? "Waive" : "Completed";
                    // Keep finalized allocations and their child IDs; replace only the undecided remainder below.
                    db.run("UPDATE review_queue_items SET quantity = ?, decision = ? WHERE id = ?", [allocated, decision, child.id]);
                }

                if (reusablePendingChild) {
                    if (pendingExcess > 0) {
                        db.run("UPDATE review_queue_items SET quantity = ?, decision = 'Pending' WHERE id = ? AND COALESCE(is_active, 1) = 1",
                            [pendingExcess, reusablePendingChild.id]);
                    } else {
                        db.run("UPDATE review_queue_items SET is_active = 0 WHERE id = ? AND COALESCE(is_active, 1) = 1", [reusablePendingChild.id]);
                    }
                }

                if (pendingExcess > 0 && existingChildren.length > 0) {
                    const parentId = Number(reusablePendingChild?.review_queue_id || existingChildren[existingChildren.length - 1].review_queue_id);
                    const effectiveAllowed = mode === "item_annual" ? annualAllowed : mode === "unit_wise" ? unitAllowed : (annualAllowed ?? unitAllowed);
                    const reason = mode === "item_annual"
                        ? (annualAllowed === null ? `No annual entitlement policy found for ${itemName}.` : `${itemName} annual entitlement exceeded.`)
                        : mode === "unit_wise"
                            ? (unitAllowed === null ? `No entitlement policy found for ${unit || "Unknown Unit"} / ${itemName}.` : `${itemName} unit entitlement exceeded.`)
                            : `Combined annual and unit entitlement review for ${itemName}.`;
                    const issuedForScope = mode === 'unit_wise' ? (issuedByScope.get(unitKey) || 0) : (issuedByScope.get(`${itemKey}|${financialYearKey}`) || 0);
                    const itemCost = costMap.get(unitPolicyKey) || 0;
                    db.run("UPDATE review_queue SET allowed_qty = ?, issued_qty = ?, item_cost = ?, reason = ? WHERE id = ?",
                        [effectiveAllowed, issuedForScope, itemCost, reason, parentId]);
                    if (!reusablePendingChild) {
                        db.run(`INSERT INTO review_queue_items (review_queue_id, uniform_issue_id, employee_code, item_name, issue_date, quantity, decision, remarks, reviewed_by, reviewed_at, created_at) VALUES (?, ?, ?, ?, ?, ?, 'Pending', '', NULL, NULL, ?)`,
                            [parentId, issue.id, empCode, itemName, issue.issued_at, pendingExcess, now()]);
                    }
                    affectedParents.add(parentId);
                } else if (pendingExcess > 0) {
                    const groupKey = `${unitKey}|${itemKey}`;
                    if (!pendingByUnitItem.has(groupKey)) pendingByUnitItem.set(groupKey, { unit, itemName, itemCost: costMap.get(unitPolicyKey) || 0, issues: [], totalExcess: 0, annualAllowed, unitAllowed, financialYear, itemKey, unitKey });
                    const group = pendingByUnitItem.get(groupKey);
                    group.issues.push({ issue, pendingExcess });
                    group.totalExcess += pendingExcess;
                }
            }

            for (const [unitKey, group] of pendingByUnitItem.entries()) {
                const sampleIssue = group.issues[0].issue;
                const effectiveAllowed = mode === "item_annual" ? group.annualAllowed : mode === "unit_wise" ? group.unitAllowed : (group.annualAllowed ?? group.unitAllowed);
                const reason = mode === "item_annual"
                    ? (group.annualAllowed === null ? `No annual entitlement policy found for ${group.itemName}.` : `${group.itemName} annual entitlement exceeded.`)
                    : mode === "unit_wise"
                        ? (group.unitAllowed === null ? `No entitlement policy found for ${group.unit || "Unknown Unit"} / ${group.itemName}.` : `${group.itemName} unit entitlement exceeded.`)
                        : `Combined annual and unit entitlement review for ${group.itemName}.`;
                const itemKey = group.itemKey;
                const financialYearKey = group.financialYear === null ? 'unknown' : String(group.financialYear);
                const issuedForScope = mode === 'unit_wise' ? (issuedByScope.get(group.unitKey) || 0) : (issuedByScope.get(`${itemKey}|${financialYearKey}`) || 0);
                db.run(`INSERT INTO review_queue (employee_code, employee_name, unit, item_name, issue_month, issue_year, issue_period_label, issued_qty, allowed_qty, excess_qty, item_cost, estimated_amount, reason, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Pending', ?)`,
                    [empCode, sampleIssue.employee_name, group.unit, group.itemName, sampleIssue.issue_month, sampleIssue.issue_year, sampleIssue.issue_period_label, issuedForScope, effectiveAllowed, group.totalExcess, group.itemCost, group.totalExcess * group.itemCost, reason, now()]);
                const rqId = scalar("SELECT last_insert_rowid()");
                affectedParents.add(Number(rqId));
                for (const ext of group.issues) {
                    db.run(`INSERT INTO review_queue_items (review_queue_id, uniform_issue_id, employee_code, item_name, issue_date, quantity, decision, remarks, reviewed_by, reviewed_at, created_at) VALUES (?, ?, ?, ?, ?, ?, 'Pending', '', NULL, NULL, ?)`,
                        [rqId, ext.issue.id, empCode, group.itemName, ext.issue.issued_at, ext.pendingExcess, now()]);
                }
                generatedCount++;
            }

            for (const reviewId of affectedParents) {
                const totals = all(`SELECT COUNT(*) AS active_count, COALESCE(SUM(quantity), 0) AS excess_total,
                    COALESCE(SUM(deducted_quantity), 0) AS deduct_total, COALESCE(SUM(waived_quantity), 0) AS waive_total,
                    COALESCE(SUM(held_quantity), 0) AS hold_total,
                    COALESCE(SUM(MAX(0, quantity - deducted_quantity - waived_quantity - held_quantity)), 0) AS pending_total
                    FROM review_queue_items WHERE review_queue_id = ? AND COALESCE(is_active, 1) = 1`, [reviewId])[0];
                const nextStatus = Number(totals.pending_total) > 0 ? "Pending" : Number(totals.hold_total) > 0 ? "Held" : "Completed";
                const parent = all("SELECT item_cost FROM review_queue WHERE id = ?", [reviewId])[0];
                db.run("UPDATE review_queue SET status = ?, excess_qty = ?, estimated_amount = ? WHERE id = ?", [nextStatus, totals.excess_total, Number(totals.excess_total) * Number(parent?.item_cost || 0), reviewId]);
                if (Number(totals.active_count) === 0) db.run("UPDATE review_queue SET status = 'Completed' WHERE id = ?", [reviewId]);

                // Keep the parent card's snapshot in sync even when a policy
                // increase eliminated all pending excess. Previously only
                // parents with a new pending child had allowed_qty/issued_qty
                // refreshed, so status could become Completed while the card
                // still showed the old allowance and excess snapshot.
                const review = all("SELECT employee_code, item_name, unit, issue_month, issue_year FROM review_queue WHERE id = ?", [reviewId])[0];
                if (review) {
                    const financialYear = getEntitlementFinancialYear(review);
                    const financialYearKey = financialYear === null ? 'unknown' : String(financialYear);
                    const itemKey = normalizeEntitlementLabel(review.item_name);
                    const annualAllowed = annualLimitMap.has(`${itemKey}|${financialYear}`)
                        ? annualLimitMap.get(`${itemKey}|${financialYear}`) : null;
                    const unitPolicyKey = `${normalizeEntitlementLabel(review.unit)}|${itemKey}`;
                    const unitAllowed = unitPolicyMap.has(unitPolicyKey) ? unitPolicyMap.get(unitPolicyKey) : null;
                    const effectiveAllowed = mode === "item_annual" ? annualAllowed
                        : mode === "unit_wise" ? unitAllowed : (annualAllowed ?? unitAllowed);
                    const issued = issues.reduce((sum, issue) => {
                        if (normalizeEntitlementLabel(issue.item_name) !== itemKey
                            || getEntitlementFinancialYear(issue) !== financialYear) return sum;
                        if (mode === 'unit_wise' && normalizeEntitlementLabel(issue.unit) !== normalizeEntitlementLabel(review.unit)) return sum;
                        return sum + Number(issue.quantity || 0);
                    }, 0);
                    db.run("UPDATE review_queue SET allowed_qty = ?, issued_qty = ? WHERE id = ?",
                        [effectiveAllowed, Number(issued || 0), reviewId]);
                }
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
            }
            save();
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
    recalculateReviewsForEmployee(employeeCode) {
      const code = String(employeeCode || '').trim();
      if (!code) throw new Error('Employee code is required to refresh review calculations.');
      return this.evaluateEntitlementsForImport(null, null, code);
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
        db.run("DELETE FROM entitlement_classification_history");
        db.run("COMMIT");
      } catch (error) {
        db.run("ROLLBACK");
        throw error;
      }
      audit("Operational Data Reset", "Employees, distribution register, review queue and deduction records cleared. Unit policies, annual item entitlements, actual item prices, and item settings were kept.", {
        entityType: "System",
        remarks: "Unit policies, annual item entitlements, actual item prices, and item settings were kept.",
      });
      save();
    }
});
