module.exports = ({ db, scalar, all }) => {

    db.run("CREATE INDEX IF NOT EXISTS idx_analytics_issues_period ON uniform_issues(issue_year, issue_month)");
    db.run("CREATE INDEX IF NOT EXISTS idx_analytics_issues_employee ON uniform_issues(employee_code)");
    db.run("CREATE INDEX IF NOT EXISTS idx_analytics_issues_unit ON uniform_issues(unit)");
    db.run("CREATE INDEX IF NOT EXISTS idx_analytics_issues_item ON uniform_issues(item_name)");

    function buildBaseFilter(filters) {
        let where = "WHERE ui.quantity > 0";
        const params = [];

        if (filters.fy) {
            where += " AND ui.issue_year = ?";
            params.push(Number(filters.fy));
        }
        if (filters.month) {
            where += " AND ui.issue_month = ?";
            params.push(Number(filters.month));
        }
        if (filters.unit) {
            where += " AND lower(ui.unit) = lower(?)";
            params.push(filters.unit);
        }
        if (filters.employee) {
            where += " AND ui.employee_code = ?";
            params.push(filters.employee);
        }
        if (filters.item) {
            where += " AND lower(ui.item_name) = lower(?)";
            params.push(filters.item);
        }
        
        let joinReviewQueue = `
            LEFT JOIN uniform_items itm ON lower(ui.item_name) = lower(itm.item_name)
            LEFT JOIN unit_policies up ON lower(up.unit) = lower(ui.unit) AND lower(up.item_name) = lower(ui.item_name)
            LEFT JOIN review_queue_items rqi ON ui.id = rqi.uniform_issue_id AND COALESCE(rqi.is_active, 1) = 1
        `;

        if (filters.decisionStatus && filters.decisionStatus !== 'All') {
            if (filters.decisionStatus === 'OK') {
                where += " AND rqi.id IS NULL";
            } else {
                const allocationField = { Deduct: 'deducted_quantity', Waive: 'waived_quantity', Hold: 'held_quantity' }[filters.decisionStatus];
                if (allocationField) where += ` AND COALESCE(rqi.${allocationField}, 0) > 0`;
                else { where += " AND rqi.decision = ?"; params.push(filters.decisionStatus); }
            }
        }

        return { where, params, joinReviewQueue };
    }

    function getSummaryCards(whereClause, params, joinClause) {
        const query = `
            SELECT 
                COUNT(DISTINCT ui.employee_code) AS total_employees,
                COUNT(DISTINCT ui.unit) AS total_units,
                COUNT(DISTINCT ui.item_name) AS total_items_issued,
                SUM(ui.quantity) AS total_quantity_issued,
                COUNT(ui.id) AS total_transactions,
                SUM(ui.quantity * COALESCE(up.item_cost, itm.cost, 0)) AS total_distribution_cost,
                SUM(COALESCE(rqi.deducted_quantity, 0) * COALESCE(up.item_cost, itm.cost, 0)) AS total_recovery_amount,
                SUM(COALESCE(rqi.waived_quantity, 0) * COALESCE(up.item_cost, itm.cost, 0)) AS total_waived_amount,
                SUM(COALESCE(rqi.held_quantity, 0) * COALESCE(up.item_cost, itm.cost, 0)) AS total_held_amount,
                SUM(CASE WHEN rqi.id IS NOT NULL THEN MAX(0, rqi.quantity - rqi.deducted_quantity - rqi.waived_quantity - rqi.held_quantity) ELSE 0 END) AS pending_qty_count,
                SUM(CASE WHEN rqi.deducted_quantity > 0 THEN 1 ELSE 0 END) AS deduction_count,
                SUM(CASE WHEN rqi.waived_quantity > 0 THEN 1 ELSE 0 END) AS waiver_count,
                SUM(CASE WHEN rqi.held_quantity > 0 THEN 1 ELSE 0 END) AS hold_count
            FROM uniform_issues ui
            ${joinClause}
            ${whereClause}
        `;
        const result = all(query, params)[0] || {};
        result.average_issue_per_employee = result.total_employees > 0 ? (result.total_quantity_issued / result.total_employees) : 0;
        return result;
    }

    function getDetailedTable(whereClause, params, joinClause) {
        const query = `
            SELECT 
                ui.employee_code,
                ui.employee_name,
                ui.unit,
                ui.item_name,
                ui.quantity,
                COALESCE(up.item_cost, itm.cost, 0) AS rate,
                (ui.quantity * COALESCE(up.item_cost, itm.cost, 0)) AS amount,
                ui.issued_at,
                ui.issue_year AS financial_year,
                ui.issue_month,
                CASE WHEN rqi.id IS NULL THEN 'OK' WHEN rqi.deducted_quantity > 0 AND rqi.waived_quantity + rqi.held_quantity = 0 THEN 'Deduct' WHEN rqi.waived_quantity > 0 AND rqi.deducted_quantity + rqi.held_quantity = 0 THEN 'Waive' WHEN rqi.held_quantity > 0 AND rqi.deducted_quantity + rqi.waived_quantity = 0 THEN 'Hold' WHEN rqi.deducted_quantity + rqi.waived_quantity + rqi.held_quantity > 0 THEN 'Completed' ELSE 'Pending' END AS decision_status,
                rqi.remarks
            FROM uniform_issues ui
            ${joinClause}
            ${whereClause}
            ORDER BY ui.issued_at DESC, ui.id DESC
            LIMIT 5000
        `;
        return all(query, params);
    }

    function getDecisionRegister(filters) {
        let where = "WHERE rqi.decision IN ('Deduct', 'Hold', 'Waive') AND COALESCE(rqi.is_active, 1) = 1 AND rqi.quantity > 0";
        const params = [];

        if (filters.fy) {
            where += " AND CAST(rq.issue_year AS INTEGER) = ?";
            params.push(Number(filters.fy));
        }
        if (filters.month) {
            where += " AND CAST(rq.issue_month AS INTEGER) = ?";
            params.push(Number(filters.month));
        }
        if (filters.unit) {
            where += " AND lower(COALESCE(rq.unit, e.unit, '')) = lower(?)";
            params.push(filters.unit);
        }
        if (filters.employee) {
            where += " AND rqi.employee_code = ?";
            params.push(filters.employee);
        }
        if (filters.item) {
            where += " AND lower(rqi.item_name) = lower(?)";
            params.push(filters.item);
        }

        return all(`
          WITH allocation_rows AS (
            SELECT id, review_queue_id, employee_code, item_name, remarks, reviewed_at, reviewed_by, is_active,
                   deducted_quantity AS quantity, 'Deduct' AS decision FROM review_queue_items WHERE deducted_quantity > 0
            UNION ALL SELECT id, review_queue_id, employee_code, item_name, remarks, reviewed_at, reviewed_by, is_active,
                   waived_quantity, 'Waive' FROM review_queue_items WHERE waived_quantity > 0
            UNION ALL SELECT id, review_queue_id, employee_code, item_name, remarks, reviewed_at, reviewed_by, is_active,
                   held_quantity, 'Hold' FROM review_queue_items WHERE held_quantity > 0
          )
            SELECT
                MAX(rq.issue_month) AS issue_month,
                MAX(rq.issue_year) AS issue_year,
                MIN(rqi.id) AS id,
                rqi.employee_code,
                COALESCE(MAX(e.employee_name), MAX(rq.employee_name), rqi.employee_code) AS employee_name,
                COALESCE(MAX(rq.unit), MAX(e.unit), '') AS unit,
                rqi.item_name,
                SUM(rqi.quantity) AS quantity,
                rqi.decision,
                SUM(CASE WHEN rqi.decision = 'Deduct' THEN (rqi.quantity * COALESCE(up.item_cost, rq.item_cost, 0)) ELSE 0 END) AS deduction_amount,
                MAX(rqi.reviewed_at) AS review_date,
                MAX(rqi.reviewed_by) AS approved_by,
                COALESCE(MAX(rqi.remarks), MAX(rq.remarks), '') AS remarks,
                MAX(rq.status) AS current_status
            FROM allocation_rows rqi
            JOIN review_queue rq ON rq.id = rqi.review_queue_id
            LEFT JOIN employees e ON e.employee_code = rqi.employee_code
            LEFT JOIN unit_policies up ON lower(up.unit) = lower(COALESCE(rq.unit, e.unit, '')) AND lower(up.item_name) = lower(rqi.item_name)
            ${where}
            GROUP BY rq.id, rqi.decision, rqi.item_name, rqi.employee_code
            ORDER BY MAX(COALESCE(rqi.reviewed_at, rq.decided_at, rq.created_at)) DESC, MIN(rqi.id) DESC
        `, params);
    }

    return {
        // =========================================================
        // STRICT PAYROLL DEDUCTION SUMMARY
        // Retrieves exclusively DEDUCT records, grouping dynamically
        // and accurately pulling historical policy costs.
        // =========================================================
        getPayrollSummaryAnalytics(filters) {
            let where = "WHERE rqi.decision = 'Deduct' AND COALESCE(rqi.is_active, 1) = 1";
            const params = [];

            if (filters.fy) {
                // Strict CAST ensures exact matching, preventing SQLite loose type issues
                where += " AND CAST(rq.issue_year AS INTEGER) = ?";
                params.push(Number(filters.fy));
            }
            if (filters.month) {
                where += " AND CAST(rq.issue_month AS INTEGER) = ?";
                params.push(Number(filters.month));
            }

            // Fetch raw finalized deduction records natively grouped
            // COALESCE(up.item_cost, rq.item_cost, 0) mimics EXACTLY how the Payroll Register calculates total amount
            const query = `
                WITH allocation_rows AS (
                  SELECT id, review_queue_id, employee_code, item_name, is_active, deducted_quantity AS quantity, 'Deduct' AS decision
                  FROM review_queue_items WHERE deducted_quantity > 0
                )
                SELECT 
                    rqi.employee_code,
                    COALESCE(MAX(e.employee_name), MAX(rq.employee_name), rqi.employee_code) AS employee_name,
                    COALESCE(MAX(rq.unit), MAX(e.unit), '') AS unit,
                    MAX(rq.issue_month) AS issue_month,
                    MAX(rq.issue_year) AS issue_year,
                    MAX(rq.issue_period_label) AS issue_period_label,
                    rqi.item_name,
                    SUM(rqi.quantity) as quantity,
                    COALESCE(MAX(up.item_cost), MAX(rq.item_cost), MAX(itm.cost), 0) AS rate
                FROM allocation_rows rqi
                JOIN review_queue rq ON rq.id = rqi.review_queue_id
                LEFT JOIN employees e ON e.employee_code = rqi.employee_code
                LEFT JOIN uniform_items itm ON lower(rqi.item_name) = lower(itm.item_name)
                LEFT JOIN unit_policies up ON lower(up.unit) = lower(COALESCE(rq.unit, e.unit, '')) AND lower(up.item_name) = lower(rqi.item_name)
                ${where}
                GROUP BY rqi.employee_code, rq.issue_period_label, rq.issue_month, rq.issue_year, rqi.item_name
                ORDER BY rqi.employee_code, rq.issue_year, rq.issue_month
            `;

            const deductions = all(query, params);
            
            // Fetch ALL Registered Inventory Items dynamically to ensure dynamic columns exist
            const allItems = all("SELECT item_name FROM uniform_items ORDER BY item_name ASC").map(r => r.item_name);
            const uniqueItems = new Set(allItems);
            
            // Group deeply by Employee + Payroll Month to flatten structure for columns
            const grouped = new Map();
            deductions.forEach(row => {
                uniqueItems.add(row.item_name); 
                
                const monthNames = ["", "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
                const mName = row.issue_month ? monthNames[Number(row.issue_month)] : '';
                
                let periodLabel = row.issue_period_label || "";
                if (!periodLabel) {
                    periodLabel = row.issue_year ? `${mName} ${row.issue_year}`.trim() : (mName || "Unknown");
                }
                
                const key = `${row.employee_code}|${periodLabel}`;
                
                if (!grouped.has(key)) {
                    grouped.set(key, {
                        employee_code: row.employee_code,
                        employee_name: row.employee_name,
                        unit: row.unit,
                        payroll_month: periodLabel,
                        total_amount: 0,
                        items: {}
                    });
                }
                
                const empData = grouped.get(key);
                const qty = Number(row.quantity || 0);
                const rate = Number(row.rate || 0);
                
                // Aggregate items and True Exact Total Amount
                empData.items[row.item_name] = (empData.items[row.item_name] || 0) + qty;
                empData.total_amount += (qty * rate); 
            });
            
            const itemsList = Array.from(uniqueItems).sort();
            const rows = Array.from(grouped.values()).map((row, index) => ({ sr_no: index + 1, ...row }));
            
            return { items: itemsList, rows };
        },

        getMonthlyAnalytics(filters) {
            const { where, params, joinReviewQueue } = buildBaseFilter(filters);
            const summary = getSummaryCards(where, params, joinReviewQueue);
            const itemWise = all(`SELECT ui.item_name AS label, SUM(ui.quantity) AS value FROM uniform_issues ui ${joinReviewQueue} ${where} GROUP BY lower(ui.item_name) ORDER BY value DESC`, params);
            const unitWise = all(`SELECT COALESCE(ui.unit, 'Unknown') AS label, SUM(ui.quantity) AS value FROM uniform_issues ui ${joinReviewQueue} ${where} GROUP BY lower(ui.unit) ORDER BY value DESC LIMIT 10`, params);
            const topEmployees = all(`SELECT ui.employee_name AS label, SUM(ui.quantity) AS value FROM uniform_issues ui ${joinReviewQueue} ${where} GROUP BY ui.employee_code ORDER BY value DESC LIMIT 10`, params);
            const table = getDetailedTable(where, params, joinReviewQueue);
            return { summary, itemWise, unitWise, topEmployees, table, decisionRegister: getDecisionRegister(filters) };
        },

        getYearlyAnalytics(filters) {
            const { where, params, joinReviewQueue } = buildBaseFilter(filters);
            const summary = getSummaryCards(where, params, joinReviewQueue);
            const monthlyTrend = all(`SELECT COALESCE(ui.issue_month, 0) AS month_num, SUM(ui.quantity) AS total_qty, SUM(ui.quantity * COALESCE(up.item_cost, itm.cost, 0)) AS total_cost, SUM(COALESCE(rqi.deducted_quantity, 0) * COALESCE(up.item_cost, itm.cost, 0)) AS total_recovery FROM uniform_issues ui ${joinReviewQueue} ${where} GROUP BY ui.issue_month ORDER BY ui.issue_month ASC`, params);
            const itemWise = all(`SELECT ui.item_name AS label, SUM(ui.quantity) AS value FROM uniform_issues ui ${joinReviewQueue} ${where} GROUP BY lower(ui.item_name) ORDER BY value DESC LIMIT 15`, params);
            const unitWise = all(`SELECT COALESCE(ui.unit, 'Unknown') AS label, SUM(ui.quantity) AS value FROM uniform_issues ui ${joinReviewQueue} ${where} GROUP BY lower(ui.unit) ORDER BY value DESC LIMIT 15`, params);
            const topEmployees = all(`SELECT ui.employee_name AS label, SUM(ui.quantity) AS value FROM uniform_issues ui ${joinReviewQueue} ${where} GROUP BY ui.employee_code ORDER BY value DESC LIMIT 15`, params);
            const table = getDetailedTable(where, params, joinReviewQueue);
            return { summary, monthlyTrend, itemWise, unitWise, topEmployees, table, decisionRegister: getDecisionRegister(filters) };
        },

        getUnitWiseAnalytics(filters) {
            const { where, params, joinReviewQueue } = buildBaseFilter(filters);
            const summary = getSummaryCards(where, params, joinReviewQueue);
            const itemWise = all(`SELECT ui.item_name AS label, SUM(ui.quantity) AS value, SUM(ui.quantity * COALESCE(up.item_cost, itm.cost, 0)) AS cost FROM uniform_issues ui ${joinReviewQueue} ${where} GROUP BY lower(ui.item_name) ORDER BY value DESC`, params);
            const topEmployees = all(`SELECT ui.employee_name AS label, SUM(ui.quantity) AS value FROM uniform_issues ui ${joinReviewQueue} ${where} GROUP BY ui.employee_code ORDER BY value DESC LIMIT 20`, params);
            const table = getDetailedTable(where, params, joinReviewQueue);
            return { summary, itemWise, topEmployees, table, decisionRegister: getDecisionRegister(filters) };
        },

        getItemWiseAnalytics(filters) {
            const { where, params, joinReviewQueue } = buildBaseFilter(filters);
            const summary = getSummaryCards(where, params, joinReviewQueue);
            const unitWise = all(`SELECT COALESCE(ui.unit, 'Unknown') AS label, SUM(ui.quantity) AS value FROM uniform_issues ui ${joinReviewQueue} ${where} GROUP BY lower(ui.unit) ORDER BY value DESC LIMIT 20`, params);
            const monthlyTrend = all(`SELECT COALESCE(ui.issue_month, 0) AS month_num, SUM(ui.quantity) AS total_qty FROM uniform_issues ui ${joinReviewQueue} ${where} GROUP BY ui.issue_month ORDER BY ui.issue_month ASC`, params);
            const topEmployees = all(`SELECT ui.employee_name AS label, SUM(ui.quantity) AS value FROM uniform_issues ui ${joinReviewQueue} ${where} GROUP BY ui.employee_code ORDER BY value DESC LIMIT 20`, params);
            const table = getDetailedTable(where, params, joinReviewQueue);
            return { summary, unitWise, monthlyTrend, topEmployees, table, decisionRegister: getDecisionRegister(filters) };
        },

        getEmployeeWiseAnalytics(filters) {
            const { where, params, joinReviewQueue } = buildBaseFilter(filters);
            const summary = getSummaryCards(where, params, joinReviewQueue);
            const itemWise = all(`SELECT ui.item_name AS label, SUM(ui.quantity) AS value FROM uniform_issues ui ${joinReviewQueue} ${where} GROUP BY lower(ui.item_name) ORDER BY value DESC`, params);
            const timeline = all(`SELECT ui.issued_at, ui.item_name, ui.quantity, COALESCE(rqi.decision, 'OK') AS decision_status FROM uniform_issues ui ${joinReviewQueue} ${where} ORDER BY ui.issued_at DESC`, params);
            const table = getDetailedTable(where, params, joinReviewQueue);
            return { summary, itemWise, timeline, table, decisionRegister: getDecisionRegister(filters) };
        }
    };
};
