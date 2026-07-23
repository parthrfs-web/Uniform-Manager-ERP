module.exports = ({ db, scalar, all, save, audit, now, normalizeLabel, isIgnoredIssueItemName, classifyReviewReason, extractAmount, generateDeductionPdf }) => ({
    // ... keep existing bulkUpsertEmployees ...

    updateEmployee(employee) {
      const oldCode = employee.original_employee_code || employee.employee_code;
      const newCode = String(employee.employee_code).trim();

      // NEW REQUIREMENT: Validate uniqueness if the code is being changed
      if (oldCode !== newCode) {
          const existing = scalar(
              "SELECT id FROM employees WHERE upper(trim(employee_code)) = upper(trim(?))",
              [newCode]
          );
          if (existing) {
              throw new Error("This Employee Code already exists. Please enter a unique Employee Code.");
          }
      }

      db.run("BEGIN TRANSACTION");
      try {
          // 1. Update the primary employee record
          db.run(
              `UPDATE employees SET employee_code=?, employee_name=?, father_name=?, unit=?, godown=?, mobile_number=?, designation=?, status=?, updated_at=? WHERE employee_code=?`,
              [newCode, employee.employee_name, employee.father_name || "", employee.unit || "", employee.godown || "", employee.mobile_number || "", employee.designation || "", employee.status || "Active", now(), oldCode]
          );

          // 2. Cascade update across all referenced tables if the code changed
          if (oldCode !== newCode) {
              db.run(`UPDATE uniform_issues SET employee_code=? WHERE employee_code=?`, [newCode, oldCode]);
              db.run(`UPDATE review_queue SET employee_code=? WHERE employee_code=?`, [newCode, oldCode]);
              db.run(`UPDATE review_queue_items SET employee_code=? WHERE employee_code=?`, [newCode, oldCode]);
              db.run(`UPDATE payroll_batch_records SET employee_code=? WHERE employee_code=?`, [newCode, oldCode]);
              db.run(`UPDATE salary_deductions SET employee_code=? WHERE employee_code=?`, [newCode, oldCode]);
              db.run(`UPDATE waive_records SET employee_code=? WHERE employee_code=?`, [newCode, oldCode]);
              db.run(`UPDATE review_decisions SET employee_code=? WHERE employee_code=?`, [newCode, oldCode]);
              db.run(`UPDATE recovery_records SET employee_code=? WHERE employee_code=?`, [newCode, oldCode]);
          }

          db.run("COMMIT");
      } catch (err) {
          db.run("ROLLBACK");
          throw err;
      }
      
      audit("Employee Edited", `${newCode} - ${employee.employee_name}`, {
        entityType: "Employee",
        entityId: newCode,
        remarks: oldCode !== newCode ? `Code changed from ${oldCode} to ${newCode}` : null
      });
      save();
    },

    // ... keep existing deleteEmployee ...
});