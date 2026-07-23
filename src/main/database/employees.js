module.exports = ({ db, scalar, all, save, audit, now, normalizeLabel, isIgnoredIssueItemName, classifyReviewReason, extractAmount, generateDeductionPdf }) => ({
    
    bulkUpsertEmployees(employees) {
        if (!employees || !employees.length) return { inserted: 0, updated: 0 };
        let inserted = 0;
        let updated = 0;
        const timestamp = now();
        
        db.run("BEGIN TRANSACTION");
        const insertStmt = db.prepare(
            `INSERT INTO employees (
                employee_code, imported_employee_code, employee_name, father_name, 
                unit, godown, mobile_number, designation, status, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        );
        const updateStmt = db.prepare(
            `UPDATE employees SET 
                imported_employee_code=?, employee_name=?, father_name=?, unit=?, 
                godown=?, mobile_number=?, designation=?, status=?, updated_at=? 
            WHERE employee_code=?`
        );
        
        try {
            employees.forEach(emp => {
                const existing = scalar("SELECT id FROM employees WHERE employee_code = ?", [emp.employee_code]);
                if (existing) {
                    updateStmt.run([
                        emp.imported_employee_code || "",
                        emp.employee_name || "",
                        emp.father_name || "",
                        emp.unit || "",
                        emp.godown || "",
                        emp.mobile_number || "",
                        emp.designation || "",
                        emp.status || "Active",
                        timestamp,
                        emp.employee_code
                    ]);
                    updated += 1;
                } else {
                    insertStmt.run([
                        emp.employee_code || "",
                        emp.imported_employee_code || "",
                        emp.employee_name || "",
                        emp.father_name || "",
                        emp.unit || "",
                        emp.godown || "",
                        emp.mobile_number || "",
                        emp.designation || "",
                        emp.status || "Active",
                        timestamp,
                        timestamp
                    ]);
                    inserted += 1;
                }
            });
            db.run("COMMIT");
        } catch (error) {
            db.run("ROLLBACK");
            throw error;
        } finally {
            insertStmt.free();
            updateStmt.free();
        }
        
        if (inserted > 0 || updated > 0) {
            save();
        }
        
        return { inserted, updated };
    },

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

    deleteEmployee(employeeCode) {
        const existing = all("SELECT * FROM employees WHERE employee_code = ?", [employeeCode])[0];
        if (!existing) throw new Error(`Employee ${employeeCode} was not found.`);
        
        db.run("BEGIN TRANSACTION");
        try {
            db.run("DELETE FROM employees WHERE employee_code = ?", [employeeCode]);
            db.run("DELETE FROM uniform_issues WHERE employee_code = ?", [employeeCode]);
            db.run("DELETE FROM review_queue WHERE employee_code = ?", [employeeCode]);
            db.run("DELETE FROM review_queue_items WHERE employee_code = ?", [employeeCode]);
            db.run("DELETE FROM payroll_batch_records WHERE employee_code = ?", [employeeCode]);
            db.run("DELETE FROM salary_deductions WHERE employee_code = ?", [employeeCode]);
            db.run("DELETE FROM waive_records WHERE employee_code = ?", [employeeCode]);
            db.run("DELETE FROM review_decisions WHERE employee_code = ?", [employeeCode]);
            db.run("DELETE FROM recovery_records WHERE employee_code = ?", [employeeCode]);
            db.run("COMMIT");
        } catch (err) {
            db.run("ROLLBACK");
            throw err;
        }

        audit("Employee Deleted", `${existing.employee_code} - ${existing.employee_name}`, {
            entityType: "Employee",
            entityId: employeeCode,
            oldValue: existing,
        });
        save();
    }
});