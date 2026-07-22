module.exports = ({ db, scalar, all }) => {

    // Performance Optimization: Create Indexes for Analytics
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
            LEFT JOIN review_queue_items rqi ON ui.id = rqi.uniform_issue_id
        `;

        if (filters.decisionStatus && filters.decisionStatus !== 'All') {
            if (filters.decisionStatus === 'OK') {
                where += " AND rqi.id IS NULL";
            } else {
                where += " AND rqi.decision = ?";
                params.push(filters.decisionStatus);
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
                SUM(ui.quantity * COALESCE(itm.cost, 0)) AS total_distribution_cost,
                SUM(CASE WHEN rqi.decision = 'Deduct' THEN rqi.quantity * COALESCE(itm.cost, 0) ELSE 0 END) AS total_recovery_amount,
                SUM(CASE WHEN rqi.decision = 'Waive' THEN rqi.quantity * COALESCE(itm.cost, 0) ELSE 0 END) AS total_waived_amount,
                SUM(CASE WHEN rqi.decision = 'Hold' THEN rqi.quantity * COALESCE(itm.cost, 0) ELSE 0 END) AS total_held_amount,
                SUM(CASE WHEN rqi.decision = 'Pending' THEN rqi.quantity ELSE 0 END) AS pending_qty_count,
                SUM(CASE WHEN rqi.decision = 'Deduct' THEN 1 ELSE 0 END) AS deduction_count,
                SUM(CASE WHEN rqi.decision = 'Waive' THEN 1 ELSE 0 END) AS waiver_count,
                SUM(CASE WHEN rqi.decision = 'Hold' THEN 1 ELSE 0 END) AS hold_count
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
                COALESCE(itm.cost, 0) AS rate,
                (ui.quantity * COALESCE(itm.cost, 0)) AS amount,
                ui.issued_at,
                ui.issue_year AS financial_year,
                ui.issue_month,
                COALESCE(rqi.decision, 'OK') AS decision_status,
                rqi.remarks
            FROM uniform_issues ui
            ${joinClause}
            ${whereClause}
            ORDER BY ui.issued_at DESC, ui.id DESC
            LIMIT 5000
        `;
        return all(query, params);
    }

    // Generic function to pull live operational ledger data for all Decision Registers
    function getDecisionRegister(filters) {
        let where = "WHERE rqi.decision IN ('Deduct', 'Hold', 'Waive')";
        const params = [];

        if (filters.fy) {
            where += " AND rq.issue_year = ?";
            params.push(Number(filters.fy));
        }
        if (filters.month) {
            where += " AND rq.issue_month = ?";
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
            SELECT
                rq.issue_month,
                rq.issue_year,
                rqi.employee_code,
                COALESCE(e.employee_name, rq.employee_name, rqi.employee_code) AS employee_name,
                COALESCE(rq.unit, e.unit, '') AS unit,
                rqi.item_name,
                rqi.quantity,
                rqi.decision,
                CASE WHEN rqi.decision = 'Deduct' THEN (rqi.quantity * COALESCE(ui_item.cost, rq.item_cost, 0)) ELSE 0 END AS deduction_amount,
                rqi.reviewed_at AS review_date,
                rqi.reviewed_by AS approved_by,
                rqi.remarks,
                rq.status AS current_status
            FROM review_queue_items rqi
            JOIN review_queue rq ON rq.id = rqi.review_queue_id
            LEFT JOIN employees e ON e.employee_code = rqi.employee_code
            LEFT JOIN (
                SELECT lower(item_name) AS search_name, MAX(cost) AS cost
                FROM uniform_items
                GROUP BY lower(item_name)
            ) ui_item ON lower(rqi.item_name) = ui_item.search_name
            ${where}
            ORDER BY COALESCE(rqi.reviewed_at, rq.decided_at, rq.created_at) DESC, rqi.id DESC
        `, params);
    }

    return {
        getMonthlyAnalytics(filters) {
            const { where, params, joinReviewQueue } = buildBaseFilter(filters);
            
            const summary = getSummaryCards(where, params, joinReviewQueue);
            
            const itemWise = all(`
                SELECT ui.item_name AS label, SUM(ui.quantity) AS value
                FROM uniform_issues ui ${joinReviewQueue} ${where}
                GROUP BY lower(ui.item_name) ORDER BY value DESC
            `, params);

            const unitWise = all(`
                SELECT COALESCE(ui.unit, 'Unknown') AS label, SUM(ui.quantity) AS value
                FROM uniform_issues ui ${joinReviewQueue} ${where}
                GROUP BY lower(ui.unit) ORDER BY value DESC LIMIT 10
            `, params);

            const topEmployees = all(`
                SELECT ui.employee_name AS label, SUM(ui.quantity) AS value
                FROM uniform_issues ui ${joinReviewQueue} ${where}
                GROUP BY ui.employee_code ORDER BY value DESC LIMIT 10
            `, params);

            const table = getDetailedTable(where, params, joinReviewQueue);

            return { summary, itemWise, unitWise, topEmployees, table, decisionRegister: getDecisionRegister(filters) };
        },

        getYearlyAnalytics(filters) {
            const { where, params, joinReviewQueue } = buildBaseFilter(filters);
            
            const summary = getSummaryCards(where, params, joinReviewQueue);

            const monthlyTrend = all(`
                SELECT 
                    COALESCE(ui.issue_month, 0) AS month_num,
                    SUM(ui.quantity) AS total_qty,
                    SUM(ui.quantity * COALESCE(itm.cost, 0)) AS total_cost,
                    SUM(CASE WHEN rqi.decision = 'Deduct' THEN rqi.quantity * COALESCE(itm.cost, 0) ELSE 0 END) AS total_recovery
                FROM uniform_issues ui ${joinReviewQueue} ${where}
                GROUP BY ui.issue_month ORDER BY ui.issue_month ASC
            `, params);

            const itemWise = all(`SELECT ui.item_name AS label, SUM(ui.quantity) AS value FROM uniform_issues ui ${joinReviewQueue} ${where} GROUP BY lower(ui.item_name) ORDER BY value DESC LIMIT 15`, params);
            const unitWise = all(`SELECT COALESCE(ui.unit, 'Unknown') AS label, SUM(ui.quantity) AS value FROM uniform_issues ui ${joinReviewQueue} ${where} GROUP BY lower(ui.unit) ORDER BY value DESC LIMIT 15`, params);
            const topEmployees = all(`SELECT ui.employee_name AS label, SUM(ui.quantity) AS value FROM uniform_issues ui ${joinReviewQueue} ${where} GROUP BY ui.employee_code ORDER BY value DESC LIMIT 15`, params);

            const table = getDetailedTable(where, params, joinReviewQueue);

            return { summary, monthlyTrend, itemWise, unitWise, topEmployees, table, decisionRegister: getDecisionRegister(filters) };
        },

        getUnitWiseAnalytics(filters) {
            const { where, params, joinReviewQueue } = buildBaseFilter(filters);
            
            const summary = getSummaryCards(where, params, joinReviewQueue);

            const itemWise = all(`SELECT ui.item_name AS label, SUM(ui.quantity) AS value, SUM(ui.quantity * COALESCE(itm.cost, 0)) AS cost FROM uniform_issues ui ${joinReviewQueue} ${where} GROUP BY lower(ui.item_name) ORDER BY value DESC`, params);
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
            
            const timeline = all(`
                SELECT 
                    ui.issued_at,
                    ui.item_name,
                    ui.quantity,
                    COALESCE(rqi.decision, 'OK') AS decision_status
                FROM uniform_issues ui ${joinReviewQueue} ${where}
                ORDER BY ui.issued_at DESC
            `, params);

            const table = getDetailedTable(where, params, joinReviewQueue);

            return { summary, itemWise, timeline, table, decisionRegister: getDecisionRegister(filters) };
        }
    };
};