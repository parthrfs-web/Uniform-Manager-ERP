module.exports = ({ db, scalar, all, save, audit, now, normalizeLabel, isIgnoredIssueItemName, classifyReviewReason, extractAmount, generateDeductionPdf }) => ({
    reviewIdentity(row) {
      const code = String(row.employee_code || "");
      const name = String(row.employee_name || "");
      return `${code} | ${name}`;
    },
    parseReviewIdentity(value) {
      const text = String(value || "");
      const parts = text.split(" | ");
      if (parts.length < 2) return { code: text };
      return {
        code: parts[0] || "",
        name: parts.slice(1).join(" | "),
      };
    },
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
          CASE
            WHEN TRIM(COALESCE(rq.employee_code, '')) <> ''
             AND TRIM(COALESCE(rq.employee_code, '')) NOT GLOB '*[^0-9]*'
            THEN 0
            ELSE 1
          END AS needs_identity,
          MAX(rq.issue_period_label) AS payroll_month,
          COUNT(rq.id) AS pending_item_count,
          SUM(rq.excess_qty * COALESCE(ui.cost, 0)) AS estimated_deduction
        FROM pending_reviews rq
        LEFT JOIN (
            SELECT lower(item_name) AS search_name, MAX(cost) AS cost
            FROM uniform_items
            GROUP BY lower(item_name)
        ) ui ON lower(rq.item_name) = ui.search_name
        GROUP BY
          CASE
            WHEN TRIM(COALESCE(rq.employee_code, '')) <> ''
             AND TRIM(COALESCE(rq.employee_code, '')) NOT GLOB '*[^0-9]*'
            THEN 'code:' || rq.employee_code
            ELSE 'temp:' || COALESCE(rq.employee_code, '') || '|' || lower(COALESCE(rq.employee_name, ''))
          END
        ORDER BY rq.created_at DESC
      `).map((row) => {
        if (!Number(row.needs_identity || 0)) return row;
        return {
          ...row,
          employee_code: this.reviewIdentity({
            employee_code: row.employee_code,
            employee_name: row.employee_name,
          }),
        };
      });
    },
    getReviewQueueStage2(employeeCode) {
      const identity = this.parseReviewIdentity(employeeCode);
      const identityFilter = identity.name !== undefined
        ? {
            sql: "rq.employee_code = ? AND lower(COALESCE(rq.employee_name, '')) = lower(COALESCE(?, ''))",
            params: [identity.code, identity.name],
          }
        : { sql: "rq.employee_code = ?", params: [identity.code] };
        
      const rows = all(`
        SELECT 
          rq.*,
          COALESCE(ui.cost, 0) AS live_rate,
          (SELECT COALESCE(SUM(quantity), 0) FROM review_queue_items WHERE review_queue_id = rq.id AND decision = 'Deduct') as sum_deduct,
          (SELECT COALESCE(SUM(quantity), 0) FROM review_queue_items WHERE review_queue_id = rq.id AND decision = 'Waive') as sum_waive,
          (SELECT COALESCE(SUM(quantity), 0) FROM review_queue_items WHERE review_queue_id = rq.id AND decision = 'Hold') as sum_hold
        FROM review_queue rq
        LEFT JOIN (
            SELECT lower(item_name) AS search_name, MAX(cost) AS cost
            FROM uniform_items
            GROUP BY lower(item_name)
        ) ui ON lower(rq.item_name) = ui.search_name
        WHERE ${identityFilter.sql}
        ORDER BY CASE WHEN rq.status = 'Pending' THEN 0 ELSE 1 END, rq.created_at DESC
      `, identityFilter.params);

      rows.forEach(row => {
          row.history_items = all(`
              SELECT id, issued_at as issue_date, quantity, unit, issue_month, issue_year, issue_period_label, remarks
              FROM uniform_issues
              WHERE employee_code = ? AND lower(item_name) = lower(?)
              ORDER BY COALESCE(issue_year, 9999) ASC, COALESCE(issue_month, 99) ASC, issued_at ASC, id ASC
          `, [row.employee_code, row.item_name]);
          
          row.child_items = all(`
              SELECT 
                rqi.id, rqi.decision, rqi.quantity, rqi.remarks, rqi.issue_date,
                ui.issue_month, ui.issue_year, ui.issue_period_label, ui.remarks as issue_remarks
              FROM review_queue_items rqi
              LEFT JOIN uniform_issues ui ON rqi.uniform_issue_id = ui.id
              WHERE rqi.review_queue_id = ?
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
              const liveCost = scalar("SELECT MAX(cost) FROM uniform_items WHERE lower(item_name) = lower(?)", [review.item_name]) || 0;
              const amount = totalDeduct * liveCost;
              db.run(`INSERT INTO salary_deductions (review_id, employee_code, employee_name, unit, issue_month, issue_year, issue_period_label, amount, reason, status, created_at, approved_by, approval_date, remarks) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'Pending Payroll', ?, ?, ?, ?)`,
                  [review.id, review.employee_code, review.employee_name, review.unit || "", review.issue_month || null, review.issue_year || null, review.issue_period_label || "", amount, action.reason, now(), approvedBy, now(), '']
              );
              const deduction = all("SELECT * FROM salary_deductions WHERE review_id = ? ORDER BY id DESC LIMIT 1", [review.id])[0];
              review.excess_qty = totalDeduct;
              review.status = newStatus;
              const pdfPath = generateDeductionPdf(review, deduction, approvedBy, action.reason, '');
              db.run("UPDATE salary_deductions SET pdf_path = ?, exported_at = ? WHERE id = ?", [pdfPath, now(), deduction.id]);
          }

          db.run("DELETE FROM waive_records WHERE review_id = ?", [Number(action.id)]);
          if (totalWaive > 0) {
              db.run(`INSERT INTO waive_records (review_id, employee_code, employee_name, unit, reason, remarks, approved_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
                  [review.id, review.employee_code, review.employee_name, review.unit || "", review.reason, action.reason, approvedBy, now()]
              );
          }

          db.run(`INSERT INTO review_decisions (review_id, employee_code, employee_name, unit, decision, reason, approved_by, remarks, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
    }
});