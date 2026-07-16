module.exports = ({ db, dbPath, scalar, all, save, audit, now, normalizeLabel, isIgnoredIssueItemName, classifyReviewReason, extractAmount, generateDeductionPdf }) => ({
    getState(options = {}) {
      const limitParam = options ? options.distributionLimit : undefined;
      const distributionLimit = limitParam !== undefined 
          ? Math.max(300, Math.min(Number(limitParam), 20000)) 
          : 300; 

      const issueRows = all("SELECT * FROM uniform_issues WHERE quantity > 0 ORDER BY COALESCE(issue_year, 9999), COALESCE(issue_month, 99), import_id ASC, source_row ASC, id ASC")
        .filter((row) => !isIgnoredIssueItemName(row.item_name));
      
      const policies = all("SELECT * FROM unit_policies ORDER BY unit, item_name");
      const policyByUnitItem = new Map(
        policies.map((policy) => [
          `${normalizeLabel(policy.unit)}|${normalizeLabel(policy.item_name)}`,
          policy,
        ])
      );
      
      const itemOrder = new Map();
      issueRows.forEach((row) => {
        const key = String(row.item_name);
        if (!itemOrder.has(key)) itemOrder.set(key, Number(row.id || 0));
      });
      const itemNames = [...itemOrder.entries()]
        .sort((a, b) => a[1] - b[1])
        .map(([itemName]) => itemName);
        
      const matrixByEmployee = new Map();
      issueRows.forEach((row) => {
        const periodLabel = row.issue_period_label || (row.issue_month && row.issue_year ? `${row.issue_month}/${row.issue_year}` : "");
        const key = `${row.employee_code}|${row.employee_name}|${row.unit}|${row.godown}|${periodLabel}`;
        if (!matrixByEmployee.has(key)) {
          matrixByEmployee.set(key, {
            employee_code: row.employee_code,
            employee_name: row.employee_name,
            unit: row.unit,
            godown: row.godown,
            issue_month: row.issue_month || null,
            issue_year: row.issue_year || null,
            issue_period_label: periodLabel,
            quantities: {},
            entitlements: {},
            total_quantity: 0,
            total_allowed: 0,
            total_excess: 0,
            has_missing_policy: false,
            has_excess: false,
            first_source_row: Number(row.source_row || 0),
            latest_import_id: Number(row.import_id || 0),
            sort_year: Number(row.issue_year || 0),
            sort_month: Number(row.issue_month || 0),
          });
        }
        const target = matrixByEmployee.get(key);
        target.quantities[row.item_name] = Number(target.quantities[row.item_name] || 0) + Number(row.quantity || 0);
        target.total_quantity += Number(row.quantity || 0);
        target.first_source_row = Math.min(target.first_source_row || Number(row.source_row || 0), Number(row.source_row || 0));
        target.latest_import_id = Math.max(target.latest_import_id || 0, Number(row.import_id || 0));
        target.sort_year = Math.max(target.sort_year || 0, Number(row.issue_year || 0));
        target.sort_month = Math.max(target.sort_month || 0, Number(row.issue_month || 0));
      });
      
      matrixByEmployee.forEach((employeeRow) => {
        itemNames.forEach((itemName) => {
          const issued = Number(employeeRow.quantities[itemName] || 0);
          if (!issued) {
            employeeRow.entitlements[itemName] = { issued: 0, allowed: 0, balance: 0, status: "None" };
            return;
          }
          const policy = policyByUnitItem.get(`${normalizeLabel(employeeRow.unit)}|${normalizeLabel(itemName)}`);
          if (!policy) {
            employeeRow.has_missing_policy = true;
            employeeRow.entitlements[itemName] = { issued, allowed: null, balance: null, status: "Missing Policy" };
            return;
          }
          const allowed = Number(policy.yearly_entitlement || 0);
          const balance = allowed - issued;
          employeeRow.total_allowed += allowed;
          if (balance < 0) {
            employeeRow.has_excess = true;
            employeeRow.total_excess += Math.abs(balance);
          }
          employeeRow.entitlements[itemName] = { issued, allowed, balance, status: balance < 0 ? "Excess" : "OK" };
        });
        employeeRow.entitlement_status = employeeRow.has_missing_policy ? "Missing Policy" : employeeRow.has_excess ? "Excess" : "OK";
      });
      
      const reviews = all("SELECT * FROM review_queue ORDER BY CASE WHEN status = 'Pending' THEN 0 ELSE 1 END, created_at ASC, id ASC LIMIT 500")
        .map((row) => ({ ...row, category: classifyReviewReason(row.reason) }));
        
      const reviewSummaryRows = all("SELECT reason, status, COUNT(*) AS row_count FROM review_queue GROUP BY reason, status");
      const missingPolicySuggestions = all(
        `SELECT unit, item_name, COUNT(*) AS case_count, MIN(employee_code) AS sample_employee_code, MIN(employee_name) AS sample_employee_name
         FROM review_queue
         WHERE status = 'Pending' AND item_name IS NOT NULL AND TRIM(item_name) <> '' AND (allowed_qty IS NULL OR lower(reason) LIKE '%no entitlement policy%')
         GROUP BY lower(unit), lower(item_name) ORDER BY unit, item_name`
      );
      
      const reviewSummary = reviewSummaryRows.reduce((summary, row) => {
        const key = classifyReviewReason(row.reason);
        if (!summary[key]) summary[key] = { total: 0, pending: 0 };
        summary[key].total += Number(row.row_count || 0);
        if (row.status === "Pending") summary[key].pending += Number(row.row_count || 0);
        return summary;
      }, {});
      
      const reviewPendingCount = scalar("SELECT COUNT(*) FROM review_queue WHERE status = 'Pending'");
      const reviewTotalCount = scalar("SELECT COUNT(*) FROM review_queue");
      const uniformIssueCount = scalar("SELECT COUNT(*) FROM uniform_issues WHERE quantity > 0");
      const distributionRows = [...matrixByEmployee.values()]
        .sort((a, b) =>
          Number(b.sort_year || 0) - Number(a.sort_year || 0) ||
          Number(b.sort_month || 0) - Number(a.sort_month || 0) ||
          Number(b.latest_import_id || 0) - Number(a.latest_import_id || 0) ||
          Number(a.first_source_row || 0) - Number(b.first_source_row || 0)
        );
        
      return {
        dbPath,
        employees: all("SELECT * FROM employees ORDER BY updated_at DESC"),
        policies,
        items: all("SELECT *, CASE WHEN available_stock <= minimum_stock THEN 1 ELSE 0 END AS is_low_stock FROM uniform_items ORDER BY item_name, size"),
        stockMovements: all("SELECT * FROM stock_movements ORDER BY created_at DESC, id DESC LIMIT 100"),
        salaryDeductions: all("SELECT s.*, r.item_name, r.excess_qty, r.item_cost, r.issued_qty FROM salary_deductions s LEFT JOIN review_queue r ON s.review_id = r.id ORDER BY s.created_at DESC, s.id DESC"),
        waiveRecords: all("SELECT w.*, r.item_name FROM waive_records w LEFT JOIN review_queue r ON w.review_id = r.id ORDER BY w.created_at DESC, w.id DESC"),
        holdRecords: all("SELECT * FROM review_queue WHERE status IN ('Held', 'Hold') ORDER BY decided_at DESC, id DESC"),
        reviewDecisions: all("SELECT * FROM review_decisions ORDER BY created_at DESC, id DESC LIMIT 200"),
        recoveryRecords: all("SELECT * FROM recovery_records ORDER BY created_at DESC, id DESC"),
        uniformIssueMatrix: {
          items: itemNames,
          totalRows: distributionRows.length,
          rows: distributionRows.slice(0, distributionLimit),
        },
        uniformIssueCount,
        uniformIssues: issueRows.filter((row) => Number(row.quantity || 0) > 0).slice(0, 200),
        imports: all("SELECT * FROM imports ORDER BY imported_at DESC LIMIT 20"),
        reviews,
        reviewPendingCount,
        reviewTotalCount,
        missingPolicySuggestions,
        reviewSummary,
        audit: all("SELECT * FROM audit_log ORDER BY created_at DESC LIMIT 50"),
      };
    }
});