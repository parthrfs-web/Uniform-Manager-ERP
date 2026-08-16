module.exports = ({ db, scalar, all, save, audit, now, normalizeLabel, isIgnoredIssueItemName, classifyReviewReason, extractAmount, generateDeductionPdf }) => ({
    bulkCreateReviews(reviewRows) {
        // Obsolete function, entitlement logic runs sequentially now
    },
    getReviewQueueStage1() {
        return all(`
            WITH pending_reviews AS (
                SELECT *
                FROM review_queue
                WHERE status = 'Pending'
            )
            SELECT 
                rq.employee_code,
                MAX(rq.employee_name) AS employee_name,
                MAX(rq.unit) AS current_unit,
                MAX(rq.issue_period_label) AS payroll_month,
                COUNT(rq.id) AS pending_item_count,
                SUM(rq.excess_qty * COALESCE(up.item_cost, rq.item_cost, 0)) AS estimated_deduction
            FROM pending_reviews rq
            LEFT JOIN unit_policies up ON lower(up.unit) = lower(rq.unit) AND lower(up.item_name) = lower(rq.item_name)
            GROUP BY rq.employee_code
            ORDER BY MAX(rq.created_at) DESC
        `);
    },
    getReviewQueueStage2(employeeCode) {
        const rows = all(`
            SELECT 
                rq.*,
                COALESCE(up.item_cost, rq.item_cost, 0) AS live_rate,
                (SELECT COALESCE(SUM(quantity), 0) FROM review_queue_items WHERE review_queue_id = rq.id AND decision = 'Deduct' AND COALESCE(is_active, 1) = 1) as sum_deduct,
                (SELECT COALESCE(SUM(quantity), 0) FROM review_queue_items WHERE review_queue_id = rq.id AND decision = 'Waive' AND COALESCE(is_active, 1) = 1) as sum_waive,
                (SELECT COALESCE(SUM(quantity), 0) FROM review_queue_items WHERE review_queue_id = rq.id AND decision = 'Hold' AND COALESCE(is_active, 1) = 1) as sum_hold
            FROM review_queue rq
            LEFT JOIN unit_policies up ON lower(up.unit) = lower(rq.unit) AND lower(up.item_name) = lower(rq.item_name)
            WHERE rq.employee_code = ?
            ORDER BY CASE WHEN rq.status = 'Pending' THEN 0 ELSE 1 END, rq.created_at DESC
        `, [employeeCode]);

        rows.forEach(row => {
            const history = all(`
                SELECT id, issued_at as issue_date, quantity, unit, issue_month, issue_year, issue_period_label, remarks
                FROM uniform_issues
                WHERE employee_code = ? AND lower(item_name) = lower(?)
                  AND (issue_year >= (CAST(strftime('%Y', 'now') AS INTEGER) - 2) OR issue_year IS NULL)
                ORDER BY COALESCE(issue_year, 9999) ASC, COALESCE(issue_month, 99) ASC, issued_at ASC, id ASC
            `, [row.employee_code, row.item_name]);

            row.history_items = history.length > 0 ? history : [{ quantity: 0, remarks: 'No history found for the previous two years.' }];
            
            row.child_items = all(`
                SELECT 
                    rqi.id, rqi.decision, rqi.quantity, rqi.remarks, rqi.issue_date,
                    ui.issue_month, ui.issue_year, ui.issue_period_label, ui.remarks as issue_remarks
                FROM review_queue_items rqi
                LEFT JOIN uniform_issues ui ON rqi.uniform_issue_id = ui.id
                WHERE rqi.review_queue_id = ? AND COALESCE(rqi.is_active, 1) = 1
                ORDER BY ui.issued_at ASC, ui.id ASC
            `, [row.id]);
        });

        return rows;
    },
    getReviewQueueStage3(req) {
       // Function fully deprecated, logic incorporated in Stage 2. Included for structure integrity.
       return [];
    },
    deleteReview(reviewId) {
        const review = all("SELECT * FROM review_queue WHERE id = ?", [Number(reviewId)])[0];
        if (!review) throw new Error(`Review #${reviewId} was not found.`);
        db.run("DELETE FROM review_queue WHERE id = ?", [Number(reviewId)]);
        db.run("DELETE FROM review_queue_items WHERE review_queue_id = ?", [Number(reviewId)]);
        db.run("DELETE FROM review_decisions WHERE review_id = ?", [Number(reviewId)]);
        db.run("DELETE FROM salary_deductions WHERE review_id = ?", [Number(reviewId)]);
        db.run("DELETE FROM waive_records WHERE review_id = ?", [Number(reviewId)]);
        audit("Review Deleted", `Review #${reviewId}: ${review.employee_code}`, {
            entityType: "Review",
            entityId: review.id,
            oldValue: review,
        });
        save();
    },
    updateReview(action) {
        const review = all("SELECT * FROM review_queue WHERE id = ?", [Number(action.id)])[0];
        if (!review) throw new Error(`Review #${action.id} was not found.`);
        
        if (action.status === 'Pending') {
            db.run("UPDATE review_queue SET status = 'Pending', remarks = NULL, decided_at = NULL WHERE id = ?", [Number(action.id)]);
            db.run("UPDATE review_queue_items SET decision = 'Pending', remarks = NULL, reviewed_by = NULL, reviewed_at = NULL WHERE review_queue_id = ?", [Number(action.id)]);
            db.run("DELETE FROM review_decisions WHERE review_id = ?", [Number(action.id)]);
            db.run("DELETE FROM salary_deductions WHERE review_id = ?", [Number(action.id)]);
            db.run("DELETE FROM waive_records WHERE review_id = ?", [Number(action.id)]);
            audit("Review Reverted", `Review #${action.id} reverted to Pending.`, {
                entityType: "Review",
                entityId: action.id,
                oldValue: review,
                newValue: { ...review, status: "Pending" },
            });
            save();
            return;
        }
        
        const approvedBy = String(action.approved_by || "").trim();
        if (!approvedBy) throw new Error("Approved by is required for review decisions.");
        if (!action.reason) throw new Error("A general reason is required for review decisions.");

        let totalDeduct = 0;
        let totalWaive = 0;
        let totalHold = 0;
        let totalPending = 0;

        db.run("BEGIN TRANSACTION");
        try {
            if (Array.isArray(action.issue_decisions)) {
                for (const child of action.issue_decisions) {
                    db.run("UPDATE review_queue_items SET decision = ?, remarks = ?, reviewed_by = ?, reviewed_at = ? WHERE id = ?",
                        [child.decision, child.remarks, approvedBy, now(), Number(child.id)]
                    );

                    if (child.decision === 'Deduct') totalDeduct += Number(child.quantity);
                    else if (child.decision === 'Waive') totalWaive += Number(child.quantity);
                    else if (child.decision === 'Hold') totalHold += Number(child.quantity);
                    else totalPending += Number(child.quantity);
                }
            }

            let newStatus = 'Completed';
            if (totalPending > 0) newStatus = 'Pending';
            else if (totalHold > 0) newStatus = 'Held';
            else if (totalDeduct > 0 && totalWaive === 0) newStatus = 'Deducted';
            else if (totalWaive > 0 && totalDeduct === 0) newStatus = 'Waived';

            db.run("UPDATE review_queue SET status = ?, remarks = ?, decided_at = ? WHERE id = ?", [newStatus, action.reason, now(), Number(action.id)]);

            db.run("DELETE FROM salary_deductions WHERE review_id = ?", [Number(action.id)]);
            if (totalDeduct > 0) {
                let liveCost = scalar("SELECT item_cost FROM unit_policies WHERE lower(unit) = lower(?) AND lower(item_name) = lower(?)", [review.unit || "", review.item_name]);
                if (liveCost === undefined || liveCost === null) {
                    liveCost = review.item_cost || 0;
                }
                const amount = totalDeduct * liveCost;
                db.run(`INSERT INTO salary_deductions (review_id, employee_code, employee_name, unit, issue_month, issue_year, issue_period_label, amount, reason, status, created_at, approved_by, approval_date, remarks, is_active) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'Pending Payroll', ?, ?, ?, ?, 1)`,
                    [review.id, review.employee_code, review.employee_name, review.unit || "", review.issue_month || null, review.issue_year || null, review.issue_period_label || "", amount, action.reason, now(), approvedBy, now(), '']
                );
                const deduction = all("SELECT * FROM salary_deductions WHERE review_id = ? AND COALESCE(is_active, 1) = 1 ORDER BY id DESC LIMIT 1", [review.id])[0];
                review.excess_qty = totalDeduct;
                review.status = newStatus;
                const pdfPath = generateDeductionPdf(review, deduction, approvedBy, action.reason, '');
                db.run("UPDATE salary_deductions SET pdf_path = ?, exported_at = ? WHERE id = ?", [pdfPath, now(), deduction.id]);
            }

            db.run("DELETE FROM waive_records WHERE review_id = ?", [Number(action.id)]);
            if (totalWaive > 0) {
                db.run(`INSERT INTO waive_records (review_id, employee_code, employee_name, unit, reason, remarks, approved_by, created_at, is_active) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)`,
                    [review.id, review.employee_code, review.employee_name, review.unit || "", review.reason, action.reason, approvedBy, now()]
                );
            }

            db.run(`INSERT INTO review_decisions (review_id, employee_code, employee_name, unit, decision, reason, approved_by, remarks, created_at, is_active) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`,
                [review.id, review.employee_code, review.employee_name, review.unit || "", newStatus, action.reason, approvedBy, '', now()]
            );

            db.run("COMMIT");
        } catch (err) {
            db.run("ROLLBACK");
            throw err;
        }

        audit("Review Decision", `#${action.id} processed by ${approvedBy}`, {
            entityType: "Review",
            entityId: action.id,
            remarks: action.reason
        });
        save();
    },

    correctDecision(payload) {
        const { itemId, newDecision, reason, correctedBy = 'Admin' } = payload;
        if (!reason) throw new Error("Correction reason is mandatory.");

        const oldItem = all("SELECT * FROM review_queue_items WHERE id = ?", [Number(itemId)])[0];
        if (!oldItem) throw new Error(`Review item #${itemId} not found.`);
        
        const decisionToSave = newDecision === 'No Action' ? 'Pending' : newDecision;
        if (oldItem.decision === decisionToSave) return;

        db.run("BEGIN TRANSACTION");
        try {
            // 1. Mark old item as inactive
            db.run("UPDATE review_queue_items SET is_active = 0 WHERE id = ?", [oldItem.id]);

            // 2. Insert new item representing the corrected path, specifically flagged as corrected.
            // is_corrected = 1 serves as the absolute permanent lock.
            db.run(`INSERT INTO review_queue_items (review_queue_id, uniform_issue_id, employee_code, item_name, issue_date, quantity, decision, remarks, reviewed_by, reviewed_at, created_at, is_active, is_corrected) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 1)`,
                [oldItem.review_queue_id, oldItem.uniform_issue_id, oldItem.employee_code, oldItem.item_name, oldItem.issue_date, oldItem.quantity, decisionToSave, reason, correctedBy, now(), now()]);
            const newItemId = scalar("SELECT last_insert_rowid()");

            // 3. Log audit specific to the SCD Correction approach
            db.run(`INSERT INTO corrections (review_queue_item_id, old_decision, new_decision, reason, corrected_by, created_at) VALUES (?, ?, ?, ?, ?, ?)`,
                [newItemId, oldItem.decision, decisionToSave, reason, correctedBy, now()]);

            // 4. Re-evaluate parent review queue status based on active items only
            const parentId = oldItem.review_queue_id;
            const activeItems = all("SELECT * FROM review_queue_items WHERE review_queue_id = ? AND COALESCE(is_active, 1) = 1", [parentId]);

            let totalDeduct = 0, totalWaive = 0, totalHold = 0, totalPending = 0;
            for (const child of activeItems) {
                if (child.decision === 'Deduct') totalDeduct += child.quantity;
                else if (child.decision === 'Waive') totalWaive += child.quantity;
                else if (child.decision === 'Hold') totalHold += child.quantity;
                else totalPending += child.quantity;
            }

            let newStatus = 'Completed';
            if (totalPending > 0) newStatus = 'Pending';
            else if (totalHold > 0) newStatus = 'Held';
            else if (totalDeduct > 0 && totalWaive === 0) newStatus = 'Deducted';
            else if (totalWaive > 0 && totalDeduct === 0) newStatus = 'Waived';

            db.run("UPDATE review_queue SET status = ?, decided_at = ? WHERE id = ?", [newStatus, now(), parentId]);

            // 5. Deactivate old payroll and waive records globally for this review item cycle
            db.run("UPDATE salary_deductions SET is_active = 0 WHERE review_id = ?", [parentId]);
            db.run("UPDATE waive_records SET is_active = 0 WHERE review_id = ?", [parentId]);
            db.run("UPDATE review_decisions SET is_active = 0 WHERE review_id = ?", [parentId]);

            const review = all("SELECT * FROM review_queue WHERE id = ?", [parentId])[0];

            if (totalDeduct > 0) {
                let liveCost = scalar("SELECT item_cost FROM unit_policies WHERE lower(unit) = lower(?) AND lower(item_name) = lower(?)", [review.unit || "", review.item_name]);
                if (liveCost === undefined || liveCost === null) {
                    liveCost = review.item_cost || 0;
                }
                const amount = totalDeduct * liveCost;
                
                db.run(`INSERT INTO salary_deductions (review_id, employee_code, employee_name, unit, issue_month, issue_year, issue_period_label, amount, reason, status, created_at, approved_by, approval_date, remarks, is_active) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'Pending Payroll', ?, ?, ?, ?, 1)`,
                    [review.id, review.employee_code, review.employee_name, review.unit || "", review.issue_month || null, review.issue_year || null, review.issue_period_label || "", amount, review.reason, now(), correctedBy, now(), `Correction Applied: ${reason}`]);
                
                const deduction = all("SELECT * FROM salary_deductions WHERE review_id = ? AND COALESCE(is_active, 1) = 1 ORDER BY id DESC LIMIT 1", [review.id])[0];
                if (deduction && typeof generateDeductionPdf === "function") {
                    review.excess_qty = totalDeduct;
                    review.status = newStatus;
                    const pdfPath = generateDeductionPdf(review, deduction, correctedBy, review.reason, `Correction: ${reason}`);
                    db.run("UPDATE salary_deductions SET pdf_path = ?, exported_at = ? WHERE id = ?", [pdfPath, now(), deduction.id]);
                }
            }

            if (totalWaive > 0) {
                db.run(`INSERT INTO waive_records (review_id, employee_code, employee_name, unit, reason, remarks, approved_by, created_at, is_active) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)`,
                    [review.id, review.employee_code, review.employee_name, review.unit || "", review.reason, reason, correctedBy, now()]);
            }

            db.run(`INSERT INTO review_decisions (review_id, employee_code, employee_name, unit, decision, reason, approved_by, remarks, created_at, is_active) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`,
                [review.id, review.employee_code, review.employee_name, review.unit || "", newStatus, review.reason, correctedBy, `Correction applied: ${reason}`, now()]);

            db.run("COMMIT");
        } catch (err) {
            db.run("ROLLBACK");
            throw err;
        }

        audit("Correction Applied", `Item #${itemId} changed ${oldItem.decision} -> ${decisionToSave}`, {
            entityType: "Correction",
            entityId: itemId,
            remarks: reason
        });
        save();
    }
});