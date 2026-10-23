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
        getDetailedDeductionReportOptions() {
            const source = `
                SELECT DISTINCT
                    CASE WHEN COALESCE(ui.issue_month, rq.issue_month) >= 4 THEN COALESCE(ui.issue_year, rq.issue_year)
                         ELSE COALESCE(ui.issue_year, rq.issue_year) - 1 END AS financial_year,
                    COALESCE(ui.issue_month, rq.issue_month) AS distribution_month,
                    COALESCE(rq.unit, e.unit, '') AS unit,
                    substr(dm.recorded_at, 1, 7) AS deduction_record_month
                FROM review_queue_items rqi
                JOIN review_queue rq ON rq.id = rqi.review_queue_id
                LEFT JOIN uniform_issues ui ON ui.id = rqi.uniform_issue_id
                LEFT JOIN employees e ON e.employee_code = rqi.employee_code
                JOIN (
                    SELECT review_id, MAX(created_at) AS recorded_at
                    FROM salary_deductions WHERE COALESCE(is_active, 1) = 1 GROUP BY review_id
                ) dm ON dm.review_id = rq.id
                WHERE COALESCE(rqi.is_active, 1) = 1 AND COALESCE(rqi.deducted_quantity, 0) > 0`;
            const rows = all(source);
            return {
                financialYears: [...new Set(rows.map((row) => Number(row.financial_year)).filter((year) => Number.isInteger(year) && year > 1900))].sort((a, b) => b - a),
                distributionMonths: [...new Set(rows.map((row) => Number(row.distribution_month)).filter((month) => Number.isInteger(month) && month >= 1 && month <= 12))].sort((a, b) => a - b),
                deductionMonths: [...new Set(rows.map((row) => row.deduction_record_month).filter(Boolean))].sort().reverse(),
                units: [...new Set(rows.map((row) => String(row.unit || '').trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b)),
            };
        },

        getDetailedDeductionReport(filters = {}) {
            const where = ["COALESCE(rqi.is_active, 1) = 1", "COALESCE(rqi.deducted_quantity, 0) > 0"];
            const params = [];
            const financialYear = filters.financialYear === '' || filters.financialYear === undefined ? null : Number(filters.financialYear);
            const distributionMonth = filters.distributionMonth === '' || filters.distributionMonth === undefined ? null : Number(filters.distributionMonth);
            if (financialYear !== null && Number.isInteger(financialYear)) {
                where.push("(CASE WHEN COALESCE(ui.issue_month, rq.issue_month) >= 4 THEN COALESCE(ui.issue_year, rq.issue_year) ELSE COALESCE(ui.issue_year, rq.issue_year) - 1 END) = ?");
                params.push(financialYear);
            }
            if (distributionMonth !== null && Number.isInteger(distributionMonth)) {
                where.push("CAST(COALESCE(ui.issue_month, rq.issue_month) AS INTEGER) = ?");
                params.push(distributionMonth);
            }
            if (filters.deductionMonth) {
                where.push("substr(dm.recorded_at, 1, 7) = ?");
                params.push(String(filters.deductionMonth));
            }
            if (filters.unit) {
                where.push("lower(COALESCE(rq.unit, e.unit, '')) = lower(?)");
                params.push(String(filters.unit));
            }
            if (filters.employeeCode) {
                where.push("lower(rqi.employee_code) LIKE lower(?)");
                params.push(`%${String(filters.employeeCode).trim()}%`);
            }
            if (filters.employeeName) {
                where.push("lower(COALESCE(e.employee_name, rq.employee_name, '')) LIKE lower(?)");
                params.push(`%${String(filters.employeeName).trim()}%`);
            }

            const source = all(`
                WITH item_rates AS (
                    SELECT lower(TRIM(item_name)) AS item_key, MIN(cost) AS min_cost, MAX(cost) AS max_cost,
                           COUNT(DISTINCT cost) AS cost_count
                    FROM uniform_items GROUP BY lower(TRIM(item_name))
                ), unit_limits AS (
                    SELECT lower(TRIM(unit)) AS unit_key, lower(TRIM(item_name)) AS item_key,
                           MAX(item_cost) AS item_cost, MAX(yearly_entitlement) AS yearly_entitlement
                    FROM unit_policies GROUP BY lower(TRIM(unit)), lower(TRIM(item_name))
                ), annual_limits AS (
                    SELECT lower(TRIM(item_name)) AS item_key, CAST(financial_year AS INTEGER) AS financial_year,
                           MAX(allowed_quantity) AS allowed_quantity
                    FROM annual_policies WHERE lower(COALESCE(status, 'Active')) = 'active'
                    GROUP BY lower(TRIM(item_name)), CAST(financial_year AS INTEGER)
                ), deduction_months AS (
                    SELECT review_id, MAX(created_at) AS recorded_at, MAX(status) AS status
                    FROM salary_deductions WHERE COALESCE(is_active, 1) = 1 GROUP BY review_id
                )
                SELECT
                    rq.id AS review_id,
                    rqi.uniform_issue_id,
                    rqi.employee_code,
                    COALESCE(NULLIF(e.employee_name, ''), rq.employee_name, rqi.employee_code) AS employee_name,
                    e.father_name,
                    COALESCE(rq.unit, e.unit, '') AS unit,
                    COALESCE(NULLIF(TRIM(ui.issue_period_label), ''), NULLIF(TRIM(rq.issue_period_label), ''),
                        CASE WHEN COALESCE(ui.issue_month, rq.issue_month) IS NOT NULL AND COALESCE(ui.issue_year, rq.issue_year) IS NOT NULL
                             THEN printf('%02d-%02d', COALESCE(ui.issue_month, rq.issue_month), COALESCE(ui.issue_year, rq.issue_year) % 100) ELSE '' END) AS for_month,
                    COALESCE(ui.issue_month, rq.issue_month) AS issue_month,
                    COALESCE(ui.issue_year, rq.issue_year) AS issue_year,
                    CASE WHEN COALESCE(ui.issue_month, rq.issue_month) >= 4 THEN COALESCE(ui.issue_year, rq.issue_year)
                         ELSE COALESCE(ui.issue_year, rq.issue_year) - 1 END AS financial_year,
                    rqi.item_name,
                    SUM(rqi.deducted_quantity) AS quantity,
                    COALESCE(MAX(up.item_cost), MAX(rq.item_cost), MAX(itm.max_cost)) AS deduction_rate,
                    MAX(aip.actual_price) AS actual_rate,
                    MAX(up.yearly_entitlement) AS unit_max_supplied,
                    MAX(ap.allowed_quantity) AS annual_max_supplied,
                    MAX(dm.recorded_at) AS deduction_recorded_at,
                    MAX(dm.status) AS deduction_record_status
                FROM review_queue_items rqi
                JOIN review_queue rq ON rq.id = rqi.review_queue_id
                LEFT JOIN uniform_issues ui ON ui.id = rqi.uniform_issue_id
                LEFT JOIN employees e ON e.employee_code = rqi.employee_code
                LEFT JOIN item_rates itm ON itm.item_key = lower(TRIM(rqi.item_name))
                LEFT JOIN actual_item_prices aip ON lower(TRIM(aip.item_name)) = lower(TRIM(rqi.item_name))
                LEFT JOIN unit_limits up ON up.unit_key = lower(TRIM(COALESCE(rq.unit, e.unit, '')))
                    AND up.item_key = lower(TRIM(rqi.item_name))
                LEFT JOIN annual_limits ap ON ap.item_key = lower(TRIM(rqi.item_name))
                    AND ap.financial_year = (CASE WHEN COALESCE(ui.issue_month, rq.issue_month) >= 4 THEN COALESCE(ui.issue_year, rq.issue_year)
                         ELSE COALESCE(ui.issue_year, rq.issue_year) - 1 END)
                JOIN deduction_months dm ON dm.review_id = rq.id
                WHERE ${where.join(' AND ')}
                GROUP BY rq.id, rqi.uniform_issue_id, rqi.employee_code, e.employee_name, e.father_name,
                    COALESCE(rq.unit, e.unit, ''),
                    COALESCE(NULLIF(TRIM(ui.issue_period_label), ''), NULLIF(TRIM(rq.issue_period_label), ''),
                        CASE WHEN COALESCE(ui.issue_month, rq.issue_month) IS NOT NULL AND COALESCE(ui.issue_year, rq.issue_year) IS NOT NULL
                             THEN printf('%02d-%02d', COALESCE(ui.issue_month, rq.issue_month), COALESCE(ui.issue_year, rq.issue_year) % 100) ELSE '' END),
                    COALESCE(ui.issue_month, rq.issue_month), COALESCE(ui.issue_year, rq.issue_year), rqi.item_name
                ORDER BY rqi.employee_code,
                    CASE WHEN COALESCE(ui.issue_month, rq.issue_month) >= 4 THEN COALESCE(ui.issue_year, rq.issue_year) ELSE COALESCE(ui.issue_year, rq.issue_year) - 1 END,
                    COALESCE(ui.issue_month, rq.issue_month), rq.unit, for_month, deduction_recorded_at, lower(rqi.item_name)
            `, params);

            const itemOrder = [...new Set(source.map((row) => String(row.item_name || '').trim()).filter(Boolean))]
                .sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }));
            const modeValue = scalar("SELECT setting_value FROM app_settings WHERE setting_key = 'review_queue_calculation_mode'");
            const calculationMode = ['item_annual', 'unit_wise', 'combined'].includes(modeValue) ? modeValue : 'item_annual';
            const itemContexts = new Map(itemOrder.map((item) => [item, new Map()]));
            const rowsByKey = new Map();
            source.forEach((record) => {
                const deductionRecordMonth = record.deduction_recorded_at ? String(record.deduction_recorded_at).slice(0, 7) : '';
                const key = [record.employee_code, record.unit, record.for_month, deductionRecordMonth].join('|');
                if (!rowsByKey.has(key)) rowsByKey.set(key, {
                    employee_code: record.employee_code,
                    employee_name: record.employee_name,
                    father_name: record.father_name || '',
                    unit: record.unit || '',
                    for_month: record.for_month || '',
                    financial_year: Number(record.financial_year || 0) || null,
                    distribution_month: Number(record.issue_month || 0) || null,
                    deduction_record_month: deductionRecordMonth,
                    deduction_record_status: record.deduction_record_status || '',
                    items: {},
                    total: 0,
                });
                const row = rowsByKey.get(key);
                const qty = Number(record.quantity || 0);
                const rate = record.deduction_rate === null || record.deduction_rate === undefined ? null : Number(record.deduction_rate);
                row.items[record.item_name] = Number(row.items[record.item_name] || 0) + qty;
                if (rate !== null && Number.isFinite(rate)) row.total += qty * rate;

                const contexts = itemContexts.get(record.item_name);
                const contextKey = `${record.unit}|${record.financial_year}`;
                if (!contexts.has(contextKey)) contexts.set(contextKey, {
                    unit: record.unit || '',
                    annual: record.annual_max_supplied === null ? null : Number(record.annual_max_supplied),
                    unitLimit: record.unit_max_supplied === null ? null : Number(record.unit_max_supplied),
                    deductionRate: rate,
                    actualRate: record.actual_rate === null ? null : record.actual_rate,
                });
            });

            const unavailable = 'N/A';
            const displayValues = (values) => {
                const normalized = [...new Set(values.map((value) => {
                    if (value === null || value === undefined || value === '') return unavailable;
                    if (typeof value === 'string' && !Number.isFinite(Number(value))) return value;
                    return Number.isFinite(Number(value)) ? String(Number(value)) : unavailable;
                }))];
                if (!normalized.length) return unavailable;
                return normalized.length === 1 ? normalized[0] : 'Varies by unit';
            };
            const itemInfo = itemOrder.map((item) => {
                const contexts = [...itemContexts.get(item).values()];
                const limitValues = contexts.map((context) => calculationMode === 'item_annual'
                    ? context.annual
                    : calculationMode === 'unit_wise'
                        ? context.unitLimit
                        : `Annual: ${context.annual ?? unavailable} / Unit: ${context.unitLimit ?? unavailable}`);
                const limitDisplay = calculationMode === 'combined'
                    ? ([...new Set(limitValues)].length > 1 ? 'Varies by unit' : (limitValues[0] || unavailable))
                    : displayValues(limitValues);
                return {
                    item,
                    max_supplied_pa: limitDisplay,
                    deduction_rate: displayValues(contexts.map((context) => context.deductionRate)),
                    actual_rate: displayValues(contexts.map((context) => context.actualRate)),
                    actual_price: displayValues(contexts.map((context) => context.actualRate)),
                    contexts: contexts.map((context) => ({ unit: context.unit, annual_limit: context.annual, unit_limit: context.unitLimit, deduction_rate: context.deductionRate })),
                };
            });
            const rows = [...rowsByKey.values()].map((row, index) => ({
                sr: index + 1,
                register_serial: null,
                ...row,
                deduction_month_display: row.deduction_record_month
                    ? new Date(`${row.deduction_record_month}-01T00:00:00`).toLocaleString('en-US', { month: 'short', year: '2-digit' }).replace(' ', '-')
                    : '',
                items: Object.fromEntries(itemOrder.map((item) => [item, Number(row.items[item] || 0)])),
                total: Number(row.total.toFixed(2)),
            }));
            const selectedDeductionMonth = String(filters.deductionMonth || '');
            const reportTitle = selectedDeductionMonth
                ? `Deductions ${new Date(`${selectedDeductionMonth}-01T00:00:00`).toLocaleString('en-US', { month: 'short', year: '2-digit' }).replace(' ', '-')}`
                : rows.length && new Set(rows.map((row) => row.deduction_record_month).filter(Boolean)).size === 1
                    ? `Deductions ${rows.find((row) => row.deduction_record_month)?.deduction_month_display}`
                    : 'Detailed Deductions';
            return {
                reportTitle,
                items: itemOrder,
                itemInfo,
                rows,
                totalAmount: Number(rows.reduce((sum, row) => sum + row.total, 0).toFixed(2)),
                calculationMode,
                registerSerialAvailable: false,
                actualPayrollMonthAvailable: false,
            };
        },

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
