module.exports = ({ db, scalar, all, save, audit, now, normalizeLabel, isIgnoredIssueItemName, classifyReviewReason, extractAmount, generateDeductionPdf }) => ({
    bulkUpsertEmployees(employees) {
      let inserted = 0;
      let updated = 0;
      const checkedAt = now();
      
      const upsertStmt = db.prepare(`UPDATE employees SET imported_employee_code=?, unit=?, godown=?, mobile_number=?, designation=?, status=?, updated_at=? WHERE id=?`);
      const insertStmt = db.prepare(`INSERT INTO employees (employee_code, imported_employee_code, employee_name, father_name, unit, godown, mobile_number, designation, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);

      db.run("BEGIN TRANSACTION");
      try {
        employees.forEach((emp) => {
          const existingId = scalar(
              "SELECT id FROM employees WHERE upper(trim(employee_code)) = upper(trim(?)) AND upper(trim(employee_name)) = upper(trim(?)) AND upper(trim(COALESCE(father_name, ''))) = upper(trim(?))", 
              [emp.employee_code || "", emp.employee_name || "", emp.father_name || ""]
          );
          
          if (existingId) {
              upsertStmt.run([emp.imported_employee_code || "", emp.unit || "", emp.godown || "", emp.mobile_number || "", emp.designation || "", emp.status || "Active", checkedAt, existingId]);
              updated++;
          } else {
              insertStmt.run([emp.employee_code || "", emp.imported_employee_code || "", emp.employee_name || "", emp.father_name || "", emp.unit || "", emp.godown || "", emp.mobile_number || "", emp.designation || "", emp.status || "Active", checkedAt, checkedAt]);
              inserted++;
          }
        });
        db.run("COMMIT");
      } catch (error) {
        db.run("ROLLBACK");
        throw error;
      } finally {
        upsertStmt.free();
        insertStmt.free();
      }

      if (employees.length) {
        audit("Employees Bulk Imported", `${inserted} created, ${updated} updated.`, {
          entityType: "Employee",
          result: "Success",
          remarks: `${employees.length} rows processed`,
        });
      }
      return { inserted, updated };
    },
    updateEmployee(employee) {
      db.run("BEGIN TRANSACTION");
      try {
          db.run(
              `UPDATE employees SET employee_name=?, father_name=?, unit=?, godown=?, mobile_number=?, designation=?, status=?, updated_at=? WHERE employee_code=?`,
              [employee.employee_name, employee.father_name || "", employee.unit || "", employee.godown || "", employee.mobile_number || "", employee.designation || "", employee.status || "Active", now(), employee.employee_code]
          );
          db.run("COMMIT");
      } catch (err) {
          db.run("ROLLBACK");
          throw err;
      }
      audit("Employee Edited", `${employee.employee_code} - ${employee.employee_name}`, {
        entityType: "Employee",
        entityId: employee.employee_code,
      });
      save();
    },
    deleteEmployee(employeeCode) {
      db.run("BEGIN TRANSACTION");
      try {
          db.run("DELETE FROM employees WHERE employee_code = ?", [employeeCode]);
          db.run("DELETE FROM uniform_issues WHERE employee_code = ?", [employeeCode]);
          db.run("DELETE FROM review_queue WHERE employee_code = ?", [employeeCode]);
          db.run("DELETE FROM review_decisions WHERE employee_code = ?", [employeeCode]);
          db.run("DELETE FROM salary_deductions WHERE employee_code = ?", [employeeCode]);
          db.run("DELETE FROM waive_records WHERE employee_code = ?", [employeeCode]);
          db.run("COMMIT");
      } catch (error) {
          db.run("ROLLBACK");
          throw error;
      }
      audit("Employee Deleted", employeeCode, {
        entityType: "Employee",
        entityId: employeeCode,
      });
      save();
    }
});
