module.exports = ({ db, scalar, all, save, audit, now, normalizeLabel, isIgnoredIssueItemName, classifyReviewReason, extractAmount, generateDeductionPdf }) => ({
    bulkCreateReviews(reviewRows) {
        // Obsolete function, entitlement logic runs sequentially now
    },
    getReviewQueueStage1() {
        return all(`
            WITH review_totals AS (
                SELECT rq.id, rq.employee_code, rq.employee_name, rq.unit, rq.issue_period_label,
                    rq.created_at, rq.excess_qty, rq.item_cost, up.item_cost AS policy_item_cost,
                    COALESCE(SUM(rqi.deducted_quantity), 0) AS sum_deduct,
                    COALESCE(SUM(rqi.waived_quantity), 0) AS sum_waive,
                    COALESCE(SUM(rqi.held_quantity), 0) AS sum_hold,
                    COALESCE(SUM(MAX(0, rqi.quantity - rqi.deducted_quantity - rqi.waived_quantity - rqi.held_quantity)), 0) AS remaining_qty
                FROM review_queue rq
                LEFT JOIN review_queue_items rqi ON rqi.review_queue_id = rq.id AND COALESCE(rqi.is_active, 1) = 1
                LEFT JOIN unit_policies up ON lower(up.unit) = lower(rq.unit) AND lower(up.item_name) = lower(rq.item_name)
                GROUP BY rq.id
            ), pending_reviews AS (
                SELECT * FROM review_totals WHERE remaining_qty > 0
            )
            SELECT 
                rq.employee_code,
                MAX(rq.employee_name) AS employee_name,
                MAX(rq.unit) AS current_unit,
                MAX(rq.issue_period_label) AS payroll_month,
                COUNT(rq.id) AS pending_item_count,
                SUM(rq.remaining_qty * COALESCE(rq.policy_item_cost, rq.item_cost, 0)) AS estimated_deduction
            FROM pending_reviews rq
            GROUP BY rq.employee_code
            ORDER BY MAX(rq.created_at) DESC
        `);
    },
    getReviewQueueStage2(employeeCode) {
        const rows = all(`
            SELECT 
                rq.*,
                COALESCE(up.item_cost, rq.item_cost, 0) AS live_rate,
                (SELECT COALESCE(SUM(deducted_quantity), 0) FROM review_queue_items WHERE review_queue_id = rq.id AND COALESCE(is_active, 1) = 1) as sum_deduct,
                (SELECT COALESCE(SUM(waived_quantity), 0) FROM review_queue_items WHERE review_queue_id = rq.id AND COALESCE(is_active, 1) = 1) as sum_waive,
                (SELECT COALESCE(SUM(held_quantity), 0) FROM review_queue_items WHERE review_queue_id = rq.id AND COALESCE(is_active, 1) = 1) as sum_hold,
                (SELECT COALESCE(SUM(MAX(0, quantity - deducted_quantity - waived_quantity - held_quantity)), 0) FROM review_queue_items WHERE review_queue_id = rq.id AND COALESCE(is_active, 1) = 1) as remaining_qty
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
                    rqi.deducted_quantity, rqi.waived_quantity, rqi.held_quantity,
                    MAX(0, rqi.quantity - rqi.deducted_quantity - rqi.waived_quantity - rqi.held_quantity) AS remaining_quantity,
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
    getHeldRecords() {
        return all(`
            SELECT
                rq.id AS review_id, rq.employee_code, rq.employee_name, rq.unit, rq.item_name,
                rq.issue_month, rq.issue_year, rq.issue_period_label, rq.excess_qty AS original_excess_qty,
                SUM(rqi.deducted_quantity) AS deducted_quantity,
                SUM(rqi.waived_quantity) AS waived_quantity,
                SUM(rqi.held_quantity) AS held_quantity,
                SUM(MAX(0, rqi.quantity - rqi.deducted_quantity - rqi.waived_quantity - rqi.held_quantity)) AS remaining_quantity,
                rqi.id AS item_id, rqi.quantity AS transaction_quantity, rqi.issue_date AS hold_date,
                rqi.remarks AS hold_reason, rqi.reviewed_at, rqi.uniform_issue_id,
                ui.issue_period_label AS distribution_period
            FROM review_queue_items rqi
            JOIN review_queue rq ON rq.id = rqi.review_queue_id
            LEFT JOIN uniform_issues ui ON ui.id = rqi.uniform_issue_id
            WHERE COALESCE(rqi.is_active, 1) = 1 AND COALESCE(rqi.held_quantity, 0) > 0
            GROUP BY rqi.id
            ORDER BY COALESCE(rqi.reviewed_at, rqi.issue_date, rq.created_at) DESC, rq.employee_code, rq.item_name
        `);
    },
    resolveHeldQuantity(payload) {
        const { reviewId, itemId, quantity, decision, reason, resolvedBy = 'Admin' } = payload || {};
        const review = all("SELECT * FROM review_queue WHERE id = ?", [Number(reviewId)])[0];
        if (!review) throw new Error(`Review #${reviewId} was not found.`);
        if (!['Deduct', 'Waive', 'Hold'].includes(decision)) throw new Error('Choose Deduct, Waive, or keep the quantity on Hold.');
        if (!String(reason || '').trim()) throw new Error('A resolution reason is required.');
        const qty = Number(quantity);
        if (!Number.isInteger(qty) || qty <= 0) throw new Error('Resolution quantity must be a positive whole number.');
        const child = all("SELECT * FROM review_queue_items WHERE id = ? AND review_queue_id = ? AND COALESCE(is_active, 1) = 1", [Number(itemId), Number(reviewId)])[0];
        if (!child) throw new Error('The held transaction no longer belongs to this review. Refresh the Review Queue and try again.');
        if (Number(child.is_corrected || 0)) throw new Error('This transaction has already been corrected and cannot be resolved again.');
        const held = Number(child.held_quantity || 0);
        if (qty > held) throw new Error(`Only ${held} held units remain on this transaction.`);

        db.run('BEGIN TRANSACTION');
        try {
            const nextHold = held - qty;
            const nextDeduct = Number(child.deducted_quantity || 0) + (decision === 'Deduct' ? qty : 0);
            const nextWaive = Number(child.waived_quantity || 0) + (decision === 'Waive' ? qty : 0);
            const remaining = Math.max(0, Number(child.quantity) - nextDeduct - nextWaive - nextHold);
            const rowDecision = remaining > 0 ? 'Pending' : (nextHold > 0 ? 'Hold' : (nextDeduct > 0 && nextWaive === 0 ? 'Deduct' : (nextWaive > 0 && nextDeduct === 0 ? 'Waive' : 'Completed')));
            db.run(`UPDATE review_queue_items SET deducted_quantity = ?, waived_quantity = ?, held_quantity = ?, decision = ?, remarks = ?, reviewed_by = ?, reviewed_at = ? WHERE id = ? AND review_queue_id = ? AND COALESCE(is_active, 1) = 1 AND held_quantity = ?`,
                [nextDeduct, nextWaive, nextHold, rowDecision, String(reason).trim(), String(resolvedBy || 'Admin').trim(), now(), Number(itemId), Number(reviewId), held]);

            db.run(`INSERT INTO corrections (review_queue_item_id, old_decision, new_decision, reason, corrected_by, created_at, old_quantity, new_quantity) VALUES (?, 'Hold', ?, ?, ?, ?, ?, ?)`,
                [Number(itemId), decision, String(reason).trim(), String(resolvedBy || 'Admin').trim(), now(), qty, decision === 'Hold' ? qty : 0]);

            const totals = all(`SELECT COALESCE(SUM(deducted_quantity), 0) AS deduct, COALESCE(SUM(waived_quantity), 0) AS waive,
                COALESCE(SUM(held_quantity), 0) AS hold, COALESCE(SUM(MAX(0, quantity - deducted_quantity - waived_quantity - held_quantity)), 0) AS pending
                FROM review_queue_items WHERE review_queue_id = ? AND COALESCE(is_active, 1) = 1`, [Number(reviewId)])[0];
            const newStatus = Number(totals.pending) > 0 ? 'Pending' : (Number(totals.hold) > 0 ? 'Held' : 'Completed');
            db.run("UPDATE review_queue SET status = ?, decided_at = ? WHERE id = ?", [newStatus, now(), Number(reviewId)]);

            db.run("UPDATE salary_deductions SET is_active = 0 WHERE review_id = ? AND COALESCE(is_active, 1) = 1", [Number(reviewId)]);
            if (Number(totals.deduct) > 0) {
                const rate = scalar("SELECT item_cost FROM unit_policies WHERE lower(unit) = lower(?) AND lower(item_name) = lower(?)", [review.unit || '', review.item_name]) ?? review.item_cost ?? 0;
                db.run(`INSERT INTO salary_deductions (review_id, employee_code, employee_name, unit, issue_month, issue_year, issue_period_label, amount, reason, status, created_at, approved_by, approval_date, remarks, is_active) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'Pending Payroll', ?, ?, ?, ?, 1)`,
                    [review.id, review.employee_code, review.employee_name, review.unit || '', review.issue_month || null, review.issue_year || null, review.issue_period_label || '', Number(totals.deduct) * Number(rate), review.reason, now(), resolvedBy, now(), `Hold resolution: ${reason}`]);
            }
            db.run("UPDATE waive_records SET is_active = 0 WHERE review_id = ? AND COALESCE(is_active, 1) = 1", [Number(reviewId)]);
            if (Number(totals.waive) > 0) {
                db.run(`INSERT INTO waive_records (review_id, quantity, employee_code, employee_name, unit, reason, remarks, approved_by, created_at, is_active) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`,
                    [review.id, Number(totals.waive), review.employee_code, review.employee_name, review.unit || '', review.reason, reason, resolvedBy, now()]);
            }
            db.run("UPDATE review_decisions SET is_active = 0 WHERE review_id = ? AND COALESCE(is_active, 1) = 1", [Number(reviewId)]);
            if (newStatus !== 'Pending') {
                db.run(`INSERT INTO review_decisions (review_id, employee_code, employee_name, unit, decision, reason, approved_by, remarks, created_at, is_active) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`,
                    [review.id, review.employee_code, review.employee_name, review.unit || '', newStatus, reason, resolvedBy, 'Hold resolution', now()]);
            }
            db.run('COMMIT');
        } catch (error) {
            db.run('ROLLBACK');
            throw error;
        }
        audit('Hold Resolved', `Review #${reviewId}, transaction #${itemId}: ${qty} units ${decision}`, { entityType: 'Review', entityId: reviewId, remarks: reason });
        save();
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
        
        // 1. STRICT LOCK: Prevent double submission from UI latency or rogue renderer calls
        if (action.status !== 'Pending' && review.status !== 'Pending') {
            throw new Error(`Review #${action.id} has already been resolved as '${review.status}'. Revert it to Pending before modifying.`);
        }

        if (action.status === 'Pending') {
            db.run("BEGIN TRANSACTION");
            try {
                db.run("UPDATE review_queue SET status = 'Pending', remarks = NULL, decided_at = NULL WHERE id = ?", [Number(action.id)]);
                const activeChildren = all("SELECT * FROM review_queue_items WHERE review_queue_id = ? AND COALESCE(is_active, 1) = 1", [Number(action.id)]);
                for (const child of activeChildren) {
                    if (child.decision !== 'Pending' || Number(child.deducted_quantity || 0) + Number(child.waived_quantity || 0) + Number(child.held_quantity || 0) > 0) {
                        db.run("UPDATE review_queue_items SET is_active = 0 WHERE id = ?", [child.id]);
                        db.run(`INSERT INTO review_queue_items (review_queue_id, uniform_issue_id, employee_code, item_name, issue_date, quantity, decision, remarks, reviewed_by, reviewed_at, created_at, is_active, is_corrected, deducted_quantity, waived_quantity, held_quantity)
                            VALUES (?, ?, ?, ?, ?, ?, 'Pending', '', NULL, NULL, ?, 1, 0, 0, 0, 0)`,
                            [child.review_queue_id, child.uniform_issue_id, child.employee_code, child.item_name, child.issue_date, child.quantity, now()]);
                    }
                }
                db.run("UPDATE review_decisions SET is_active = 0 WHERE review_id = ? AND COALESCE(is_active, 1) = 1", [Number(action.id)]);
                db.run("UPDATE salary_deductions SET is_active = 0 WHERE review_id = ? AND COALESCE(is_active, 1) = 1", [Number(action.id)]);
                db.run("UPDATE waive_records SET is_active = 0 WHERE review_id = ? AND COALESCE(is_active, 1) = 1", [Number(action.id)]);
                db.run("COMMIT");
            } catch (error) {
                db.run("ROLLBACK");
                throw error;
            }
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
            if (action.quantity_decisions) {
                const amounts = {
                    Deduct: Number(action.quantity_decisions.deduct || 0),
                    Waive: Number(action.quantity_decisions.waive || 0),
                    Hold: Number(action.quantity_decisions.hold || 0),
                };
                if (Object.values(amounts).some((qty) => !Number.isInteger(qty) || qty < 0)) {
                    throw new Error("Decision quantities must be non-negative whole numbers.");
                }
                const children = all("SELECT * FROM review_queue_items WHERE review_queue_id = ? AND COALESCE(is_active, 1) = 1 ORDER BY issue_date, id", [Number(action.id)]);
                const remaining = children.reduce((sum, child) => sum + Math.max(0, Number(child.quantity) - Number(child.deducted_quantity || 0) - Number(child.waived_quantity || 0) - Number(child.held_quantity || 0)), 0);
                const selectedTotal = amounts.Deduct + amounts.Waive + amounts.Hold;
                if (selectedTotal > remaining) throw new Error(`Selected quantities exceed the ${remaining} remaining excess quantity.`);
                if (selectedTotal !== remaining) throw new Error(`${remaining - selectedTotal} excess quantity remains undecided. Allocate the full remaining quantity before saving.`);

                const left = { ...amounts };
                for (const child of children) {
                    let capacity = Math.max(0, Number(child.quantity) - Number(child.deducted_quantity || 0) - Number(child.waived_quantity || 0) - Number(child.held_quantity || 0));
                    const add = { Deduct: 0, Waive: 0, Hold: 0 };
                    for (const decision of ['Deduct', 'Waive', 'Hold']) {
                        add[decision] = Math.min(capacity, left[decision]);
                        capacity -= add[decision];
                        left[decision] -= add[decision];
                    }
                    const deduct = Number(child.deducted_quantity || 0) + add.Deduct;
                    const waive = Number(child.waived_quantity || 0) + add.Waive;
                    const hold = Number(child.held_quantity || 0) + add.Hold;
                    const rowRemaining = Math.max(0, Number(child.quantity) - deduct - waive - hold);
                    const rowDecision = rowRemaining > 0 ? 'Pending' : (deduct > 0 && waive === 0 && hold === 0 ? 'Deduct' : (waive > 0 && deduct === 0 && hold === 0 ? 'Waive' : (hold > 0 && deduct === 0 && waive === 0 ? 'Hold' : 'Completed')));
                    db.run(`UPDATE review_queue_items SET deducted_quantity = ?, waived_quantity = ?, held_quantity = ?, decision = ?, remarks = ?, reviewed_by = ?, reviewed_at = ? WHERE id = ? AND review_queue_id = ?`,
                        [deduct, waive, hold, rowDecision, action.remarks || '', approvedBy, now(), child.id, Number(action.id)]);
                }
                totalDeduct = amounts.Deduct + children.reduce((sum, child) => sum + Number(child.deducted_quantity || 0), 0);
                totalWaive = amounts.Waive + children.reduce((sum, child) => sum + Number(child.waived_quantity || 0), 0);
                totalHold = amounts.Hold + children.reduce((sum, child) => sum + Number(child.held_quantity || 0), 0);
            } else if (Array.isArray(action.issue_decisions)) {
                const activeChildren = all("SELECT * FROM review_queue_items WHERE review_queue_id = ? AND COALESCE(is_active, 1) = 1", [Number(action.id)]);
                const childrenById = new Map(activeChildren.map((child) => [Number(child.id), child]));
                const submittedIds = new Set();
                for (const child of action.issue_decisions) {
                    const childId = Number(child.id);
                    const storedChild = childrenById.get(childId);
                    if (!storedChild) throw new Error(`Review item #${child.id} does not belong to review #${action.id}.`);
                    if (submittedIds.has(childId)) throw new Error(`Review item #${child.id} was submitted more than once.`);
                    if (!['Pending', 'Deduct', 'Waive', 'Hold'].includes(child.decision)) throw new Error(`Invalid decision for review item #${child.id}.`);
                    submittedIds.add(childId);
                    const quantity = Number(storedChild.quantity || 0);
                    const nextAlloc = { Deduct: 0, Waive: 0, Hold: 0 };
                    if (child.decision !== 'Pending') nextAlloc[child.decision] = quantity;
                    db.run("UPDATE review_queue_items SET decision = ?, deducted_quantity = ?, waived_quantity = ?, held_quantity = ?, remarks = ?, reviewed_by = ?, reviewed_at = ? WHERE id = ? AND review_queue_id = ?",
                        [child.decision, nextAlloc.Deduct, nextAlloc.Waive, nextAlloc.Hold, child.remarks || '', approvedBy, now(), childId, Number(action.id)]
                    );

                    if (child.decision === 'Deduct') totalDeduct += quantity;
                    else if (child.decision === 'Waive') totalWaive += quantity;
                    else if (child.decision === 'Hold') totalHold += quantity;
                    else totalPending += quantity;
                }
                // Any active child omitted by the caller remains pending; never resolve a partial submission silently.
                for (const child of activeChildren) {
                    if (!submittedIds.has(Number(child.id))) totalPending += Number(child.quantity || 0);
                }
            } else if (['Deduct', 'Waive', 'Hold'].includes(action.status)) {
                // Backward-compatible parent-level decision: apply only to this parent's active transaction rows.
                const activeChildren = all("SELECT id, quantity FROM review_queue_items WHERE review_queue_id = ? AND COALESCE(is_active, 1) = 1", [Number(action.id)]);
                for (const child of activeChildren) {
                    const column = action.status === 'Deduct' ? 'deducted_quantity' : (action.status === 'Waive' ? 'waived_quantity' : 'held_quantity');
                    db.run(`UPDATE review_queue_items SET decision = ?, deducted_quantity = ?, waived_quantity = ?, held_quantity = ?, remarks = ?, reviewed_by = ?, reviewed_at = ? WHERE id = ?`, [action.status, column === 'deducted_quantity' ? child.quantity : 0, column === 'waived_quantity' ? child.quantity : 0, column === 'held_quantity' ? child.quantity : 0, action.remarks || '', approvedBy, now(), child.id]);
                    if (action.status === 'Deduct') totalDeduct += Number(child.quantity || 0);
                    else if (action.status === 'Waive') totalWaive += Number(child.quantity || 0);
                    else totalHold += Number(child.quantity || 0);
                }
            } else {
                throw new Error("A valid review decision is required.");
            }

            let newStatus = 'Completed';
            if (totalPending > 0) newStatus = 'Pending';
            else if (totalHold > 0) newStatus = 'Held';

            db.run("UPDATE review_queue SET status = ?, remarks = ?, decided_at = ? WHERE id = ?", [newStatus, action.reason, now(), Number(action.id)]);

            db.run("UPDATE salary_deductions SET is_active = 0 WHERE review_id = ? AND COALESCE(is_active, 1) = 1", [Number(action.id)]);
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

            db.run("UPDATE waive_records SET is_active = 0 WHERE review_id = ? AND COALESCE(is_active, 1) = 1", [Number(action.id)]);
            if (totalWaive > 0) {
                db.run(`INSERT INTO waive_records (review_id, quantity, employee_code, employee_name, unit, reason, remarks, approved_by, created_at, is_active) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`,
                    [review.id, totalWaive, review.employee_code, review.employee_name, review.unit || "", review.reason, action.reason, approvedBy, now()]
                );
            }

            db.run("UPDATE review_decisions SET is_active = 0 WHERE review_id = ? AND COALESCE(is_active, 1) = 1", [Number(action.id)]);
            if (newStatus !== 'Pending') {
                db.run(`INSERT INTO review_decisions (review_id, employee_code, employee_name, unit, decision, reason, approved_by, remarks, created_at, is_active) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`,
                    [review.id, review.employee_code, review.employee_name, review.unit || "", newStatus, action.reason, approvedBy, '', now()]
                );
            }

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

        const allocationMatch = String(itemId).match(/^(\d+):(Deduct|Waive|Hold)$/);
        if (allocationMatch) {
            const childId = Number(allocationMatch[1]);
            const oldDecision = allocationMatch[2];
            const oldItem = all("SELECT * FROM review_queue_items WHERE id = ? AND COALESCE(is_active, 1) = 1", [childId])[0];
            if (!oldItem) throw new Error(`Review item #${childId} not found.`);
            if (Number(oldItem.is_corrected || 0)) throw new Error("This transaction quantity has already been corrected.");
            const destination = newDecision === 'No Action' ? null : newDecision;
            if (destination && !['Deduct', 'Waive', 'Hold'].includes(destination)) throw new Error("Invalid correction decision.");
            const quantityColumn = { Deduct: 'deducted_quantity', Waive: 'waived_quantity', Hold: 'held_quantity' };
            const movedQuantity = Number(oldItem[quantityColumn[oldDecision]] || 0);
            if (movedQuantity <= 0) throw new Error("The selected decision quantity is no longer available to correct.");
            if (destination === oldDecision) throw new Error("The new decision is the same as the current decision.");

            db.run("BEGIN TRANSACTION");
            try {
                const nextAmounts = {
                    Deduct: Number(oldItem.deducted_quantity || 0),
                    Waive: Number(oldItem.waived_quantity || 0),
                    Hold: Number(oldItem.held_quantity || 0),
                };
                nextAmounts[oldDecision] -= movedQuantity;
                if (destination) nextAmounts[destination] += movedQuantity;
                const pendingQty = Math.max(0, Number(oldItem.quantity) - nextAmounts.Deduct - nextAmounts.Waive - nextAmounts.Hold);
                const rowDecision = pendingQty > 0 ? 'Pending' : (nextAmounts.Deduct > 0 && nextAmounts.Waive === 0 && nextAmounts.Hold === 0 ? 'Deduct' : (nextAmounts.Waive > 0 && nextAmounts.Deduct === 0 && nextAmounts.Hold === 0 ? 'Waive' : (nextAmounts.Hold > 0 && nextAmounts.Deduct === 0 && nextAmounts.Waive === 0 ? 'Hold' : 'Completed')));
                db.run(`UPDATE review_queue_items SET deducted_quantity = ?, waived_quantity = ?, held_quantity = ?, decision = ?, is_corrected = 1, remarks = ?, reviewed_by = ?, reviewed_at = ? WHERE id = ?`,
                    [nextAmounts.Deduct, nextAmounts.Waive, nextAmounts.Hold, rowDecision, reason, correctedBy, now(), childId]);
                const newItemId = childId;
                db.run(`INSERT INTO corrections (review_queue_item_id, old_decision, new_decision, reason, corrected_by, created_at, old_quantity, new_quantity) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
                    [newItemId, oldDecision, destination || 'Pending', reason, correctedBy, now(), movedQuantity, destination ? movedQuantity : 0]);

                const parentId = Number(oldItem.review_queue_id);
                const totals = all(`SELECT COALESCE(SUM(deducted_quantity), 0) AS deduct, COALESCE(SUM(waived_quantity), 0) AS waive,
                    COALESCE(SUM(held_quantity), 0) AS hold, COALESCE(SUM(MAX(0, quantity - deducted_quantity - waived_quantity - held_quantity)), 0) AS pending
                    FROM review_queue_items WHERE review_queue_id = ? AND COALESCE(is_active, 1) = 1`, [parentId])[0];
                let newStatus = 'Completed';
                if (totals.pending > 0) newStatus = 'Pending';
                else if (totals.hold > 0) newStatus = 'Held';
                db.run("UPDATE review_queue SET status = ?, decided_at = ? WHERE id = ?", [newStatus, now(), parentId]);
                const review = all("SELECT * FROM review_queue WHERE id = ?", [parentId])[0];
                db.run("UPDATE salary_deductions SET is_active = 0 WHERE review_id = ? AND COALESCE(is_active, 1) = 1", [parentId]);
                db.run("UPDATE waive_records SET is_active = 0 WHERE review_id = ? AND COALESCE(is_active, 1) = 1", [parentId]);
                db.run("UPDATE review_decisions SET is_active = 0 WHERE review_id = ? AND COALESCE(is_active, 1) = 1", [parentId]);
                if (totals.deduct > 0) {
                    const rate = scalar("SELECT item_cost FROM unit_policies WHERE lower(unit) = lower(?) AND lower(item_name) = lower(?)", [review.unit || '', review.item_name]) ?? review.item_cost ?? 0;
                    const amount = totals.deduct * rate;
                    db.run(`INSERT INTO salary_deductions (review_id, employee_code, employee_name, unit, issue_month, issue_year, issue_period_label, amount, reason, status, created_at, approved_by, approval_date, remarks, is_active) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'Pending Payroll', ?, ?, ?, ?, 1)`,
                        [review.id, review.employee_code, review.employee_name, review.unit || '', review.issue_month || null, review.issue_year || null, review.issue_period_label || '', amount, review.reason, now(), correctedBy, now(), `Correction: ${reason}`]);
                    const deduction = all("SELECT * FROM salary_deductions WHERE review_id = ? AND is_active = 1 ORDER BY id DESC LIMIT 1", [parentId])[0];
                    if (typeof generateDeductionPdf === 'function') {
                        db.run("UPDATE salary_deductions SET pdf_path = ?, exported_at = ? WHERE id = ?", [generateDeductionPdf({ ...review, excess_qty: totals.deduct, status: newStatus }, deduction, correctedBy, review.reason, `Correction: ${reason}`), now(), deduction.id]);
                    }
                }
                if (totals.waive > 0) db.run(`INSERT INTO waive_records (review_id, quantity, employee_code, employee_name, unit, reason, remarks, approved_by, created_at, is_active) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`,
                    [review.id, totals.waive, review.employee_code, review.employee_name, review.unit || '', review.reason, reason, correctedBy, now()]);
                if (newStatus !== 'Pending') db.run(`INSERT INTO review_decisions (review_id, employee_code, employee_name, unit, decision, reason, approved_by, remarks, created_at, is_active) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`,
                    [review.id, review.employee_code, review.employee_name, review.unit || '', newStatus, review.reason, correctedBy, `Correction applied: ${reason}`, now()]);
                db.run("COMMIT");
            } catch (error) {
                db.run("ROLLBACK");
                throw error;
            }
            audit("Correction Applied", `Item #${childId} ${oldDecision} quantity corrected to ${destination || 'Pending'}`, { entityType: "Correction", entityId: childId, remarks: reason });
            save();
            return;
        }

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
                db.run(`INSERT INTO waive_records (review_id, quantity, employee_code, employee_name, unit, reason, remarks, approved_by, created_at, is_active) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`,
                    [review.id, totalWaive, review.employee_code, review.employee_name, review.unit || "", review.reason, reason, correctedBy, now()]);
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
