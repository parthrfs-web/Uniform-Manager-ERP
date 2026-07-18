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
      if (!reviewRows.length) return;
      const createdAt = now();
      
      const checkStmt = db.prepare(`
        SELECT id 
        FROM review_queue 
        WHERE status = 'Pending' 
          AND employee_code = ? 
          AND lower(item_name) = lower(?)
          AND lower(COALESCE(unit, '')) = lower(COALESCE(?, ''))
          AND COALESCE(issue_month, 0) = COALESCE(?, 0)
          AND COALESCE(issue_year, 0) = COALESCE(?, 0)
          AND lower(COALESCE(issue_period_label, '')) = lower(COALESCE(?, ''))
      `);
      
      const updateStmt = db.prepare(`
        UPDATE review_queue 
        SET issued_qty = ?, 
            allowed_qty = ?,
            excess_qty = excess_qty + ?, 
            item_cost = ?,
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
            row.unit || "",
            row.issue_month ? Number(row.issue_month) : null,
            row.issue_year ? Number(row.issue_year) : null,
            row.issue_period_label || "",
          ]);
          
          let existingId = null;
          if (checkStmt.step()) {
            existingId = checkStmt.getAsObject().id;
          }
          checkStmt.reset();

          if (existingId) {
             updateStmt.run([
               Number(row.issued_qty || 0), 
               row.allowed_qty === null || row.allowed_qty === undefined ? null : Number(row.allowed_qty || 0),
               Number(row.excess_qty || 0), 
               Number(row.item_cost || 0),
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
      audit("Reviews Bulk Created", `${reviewRows.length} review rows processed (inserted/updated) from import.`, {
        entityType: "Review",
        result: "Success",
      });
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
        WHERE ${identityFilter.sql}
        ORDER BY CASE WHEN rq.status = 'Pending' THEN 0 ELSE 1 END, rq.created_at DESC
      `, identityFilter.params);
    },
    getReviewQueueStage3(req) {
      const identity = this.parseReviewIdentity(req.code);
      const identityFilter = identity.name !== undefined
        ? {
            issueSql: "i.employee_code = ? AND lower(COALESCE(i.employee_name, '')) = lower(COALESCE(?, ''))",
            reviewSql: "i.employee_code = r.employee_code AND lower(COALESCE(i.employee_name, '')) = lower(COALESCE(r.employee_name, ''))",
            params: [identity.code, identity.name],
          }
        : {
            issueSql: "i.employee_code = ?",
            reviewSql: "i.employee_code = r.employee_code",
            params: [identity.code],
          };
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
          ON ${identityFilter.reviewSql} 
          AND lower(TRIM(i.item_name)) = lower(TRIM(r.item_name)) 
          AND COALESCE(i.issue_month, 0) = COALESCE(r.issue_month, 0) 
          AND COALESCE(i.issue_year, 0) = COALESCE(r.issue_year, 0)
          AND lower(TRIM(COALESCE(i.issue_period_label, ''))) = lower(TRIM(COALESCE(r.issue_period_label, '')))
        WHERE ${identityFilter.issueSql} 
          AND lower(TRIM(i.item_name)) = lower(TRIM(?))
          AND i.quantity > 0
          AND (
            i.issue_year >= (CAST(strftime('%Y', 'now') AS INTEGER) - 2)
            OR date(i.issued_at) >= date('now', '-2 years')
            OR (i.issue_year IS NULL OR i.issue_year = 0)
          )
        GROUP BY 
          i.employee_code, 
          lower(TRIM(COALESCE(i.employee_name, ''))),
          lower(TRIM(i.item_name)), 
          COALESCE(i.issue_year, 0), 
          COALESCE(i.issue_month, 0), 
          lower(TRIM(COALESCE(i.issue_period_label, '')))
        ORDER BY 
          COALESCE(i.issue_year, 0) DESC, 
          COALESCE(i.issue_month, 0) DESC,
          MAX(i.issued_at) DESC
      `, [...identityFilter.params, req.item]);
    },
    deleteReview(reviewId) {
      const review = all("SELECT * FROM review_queue WHERE id = ?", [Number(reviewId)])[0];
      if (!review) throw new Error(`Review #${reviewId} was not found.`);
      db.run("DELETE FROM review_queue WHERE id = ?", [Number(reviewId)]);
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
        db.run("DELETE FROM review_decisions WHERE review_id = ?", [Number(action.id)]);
        db.run("DELETE FROM salary_deductions WHERE review_id = ?", [Number(action.id)]);
        db.run("DELETE FROM waive_records WHERE review_id = ?", [Number(action.id)]);
        audit("Review Reverted", `Review #${action.id} reverted to Pending.`, {
          entityType: "Review",
          entityId: action.id,
          oldValue: review,
          newValue: { ...review, status: "Pending", remarks: null, decided_at: null },
        });
        save();
        return;
      }

      const validStatuses = new Set(["Waived", "Held", "Hold", "Deducted", "Deduct"]);
      if (!validStatuses.has(action.status)) throw new Error("Invalid review decision.");
      const isWaived = action.status === "Waived";
      const isDeducted = action.status === "Deducted" || action.status === "Deduct";
      
      const approvedBy = String(action.approved_by || "").trim();
      const reason = String(action.reason || "").trim();
      const remarks = String(action.remarks || "").trim();
      
      if (!approvedBy) throw new Error("Approved by is required for review decisions.");
      if ((isWaived || isDeducted) && !reason) {
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
      
      if (isDeducted) {
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
          audit("Salary Deduction Created", `Review #${action.id}: ${review.employee_code}`, {
            entityType: "Review",
            entityId: action.id,
            oldValue: review,
            newValue: { deduction, pdf_path: pdfPath },
            remarks: reason || review.reason,
          });
        }
      }
      
      if (isWaived) {
        const existing = scalar("SELECT COUNT(*) FROM waive_records WHERE review_id = ?", [Number(action.id)]);
        if (!existing) {
          db.run(
            `INSERT INTO waive_records (review_id, employee_code, employee_name, unit, reason, remarks, approved_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            [Number(action.id), review.employee_code, review.employee_name, review.unit || "", review.reason, remarks || reason, approvedBy, now()]
          );
          audit("Waive Record Created", `Review #${action.id}: ${review.employee_code}`, {
            entityType: "Review",
            entityId: action.id,
            oldValue: review,
            newValue: { status: action.status, reason, approved_by: approvedBy, remarks },
          });
        }
      }
      audit("Review Decision", `#${action.id} marked ${action.status} by ${approvedBy}`, {
        entityType: "Review",
        entityId: action.id,
        oldValue: review,
        newValue: { ...review, status: action.status, remarks: remarks || reason, decided_at: now() },
        remarks: reason || remarks || review.reason,
      });
      save();
    }
});
