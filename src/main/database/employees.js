module.exports = ({ db, scalar, all, save, audit, now, normalizeLabel, isIgnoredIssueItemName, classifyReviewReason, extractAmount, generateDeductionPdf }) => ({
    bulkUpsertEmployees(employees) {
      let inserted = 0;
      let updated = 0;
      const checkedAt = now();
      const upsertStmt = db.prepare(
        `INSERT INTO employees (
          employee_code, employee_name, father_name, unit, godown, mobile_number, designation, status, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(employee_code) DO UPDATE SET
          employee_name = excluded.employee_name,
          father_name = excluded.father_name,
          unit = excluded.unit,
          godown = excluded.godown,
          mobile_number = excluded.mobile_number,
          designation = excluded.designation,
          status = excluded.status,
          updated_at = excluded.updated_at`
      );

      db.run("BEGIN TRANSACTION");
      try {
        employees.forEach((employee) => {
          const exists = scalar("SELECT 1 FROM employees WHERE employee_code = ?", [employee.employee_code]);
          if (exists) updated += 1;
          else inserted += 1;

          upsertStmt.run([
            employee.employee_code,
            employee.employee_name,
            employee.father_name || "",
            employee.unit || "",
            employee.godown || "",
            employee.mobile_number || "",
            employee.designation || "",
            employee.status || "Active",
            checkedAt,
            checkedAt,
          ]);
        });
        db.run("COMMIT");
      } catch (error) {
        db.run("ROLLBACK");
        throw error;
      } finally {
        upsertStmt.free();
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
      const existing = all("SELECT * FROM employees WHERE employee_code = ?", [employee.employee_code])[0];
      if (!existing) throw new Error(`Employee ${employee.employee_code} was not found.`);
      db.run(
        `UPDATE employees SET employee_name = ?, father_name = ?, unit = ?, godown = ?, mobile_number = ?, designation = ?, status = ?, updated_at = ? WHERE employee_code = ?`,
        [employee.employee_name, employee.father_name || "", employee.unit || "", employee.godown || "", employee.mobile_number || "", employee.designation || "", employee.status || "Active", now(), employee.employee_code]
      );
      audit("Employee Edited", `${employee.employee_code} - ${employee.employee_name}`, {
        entityType: "Employee",
        entityId: employee.employee_code,
        oldValue: existing,
        newValue: employee,
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
          db.run("DELETE FROM review_decisions WHERE employee_code = ?", [employeeCode]);
          db.run("DELETE FROM salary_deductions WHERE employee_code = ?", [employeeCode]);
          db.run("DELETE FROM waive_records WHERE employee_code = ?", [employeeCode]);
          db.run("COMMIT");
      } catch (error) {
          db.run("ROLLBACK");
          throw error;
      }
      audit("Employee Deleted", `${existing.employee_code} - ${existing.employee_name}`, {
        entityType: "Employee",
        entityId: existing.employee_code,
        oldValue: existing,
      });
      save();
    }
});
