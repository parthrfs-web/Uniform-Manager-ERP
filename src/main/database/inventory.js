module.exports = ({ db, scalar, all, save, audit, now, normalizeLabel, isIgnoredIssueItemName, classifyReviewReason, extractAmount, generateDeductionPdf }) => ({
    upsertItem(item) {
      const normalized = {
        id: item.id ? Number(item.id) : null,
        item_code: String(item.item_code || "").trim(),
        item_name: String(item.item_name || "").trim(),
        category: String(item.category || "").trim(),
        size: String(item.size || "").trim(),
        cost: Number(item.cost || 0),
        available_stock: Number(item.available_stock || 0),
        minimum_stock: Number(item.minimum_stock || 0),
        status: String(item.status || "Active").trim() || "Active",
      };
      if (!normalized.item_code || !normalized.item_name) throw new Error("Item code and item name are required.");
      if (normalized.id) {
        var existing = all("SELECT * FROM uniform_items WHERE id = ?", [normalized.id])[0];
        if (!existing) throw new Error(`Item #${normalized.id} was not found.`);
        db.run(
          `UPDATE uniform_items SET item_code = ?, item_name = ?, category = ?, size = ?, cost = ?, available_stock = ?, minimum_stock = ?, status = ?, updated_at = ? WHERE id = ?`,
          [normalized.item_code, normalized.item_name, normalized.category, normalized.size, normalized.cost, normalized.available_stock, normalized.minimum_stock, normalized.status, now(), normalized.id]
        );
      } else {
        var existing = null;
        db.run(
          `INSERT INTO uniform_items (item_code, item_name, category, size, cost, available_stock, minimum_stock, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [normalized.item_code, normalized.item_name, normalized.category, normalized.size, normalized.cost, normalized.available_stock, normalized.minimum_stock, normalized.status, now(), now()]
        );
      }
      const saved = normalized.id
        ? all("SELECT * FROM uniform_items WHERE id = ?", [normalized.id])[0]
        : all("SELECT * FROM uniform_items WHERE item_code = ?", [normalized.item_code])[0];
      audit("Item Saved", `${normalized.item_code} - ${normalized.item_name}`, {
        entityType: "Inventory Item",
        entityId: saved?.id || normalized.item_code,
        oldValue: existing,
        newValue: saved || normalized,
      });
      save();
    },
    deleteItem(itemId) {
      const existing = all("SELECT id, item_code, item_name FROM uniform_items WHERE id = ?", [Number(itemId)])[0];
      if (!existing) throw new Error(`Item #${itemId} was not found.`);
      db.run("DELETE FROM uniform_items WHERE id = ?", [Number(itemId)]);
      audit("Item Deleted", `${existing.item_code} - ${existing.item_name}`, {
        entityType: "Inventory Item",
        entityId: existing.id,
        oldValue: existing,
      });
      save();
    },
    updateUniformIssue(issue) {
      if (!issue.employee_code || !String(issue.employee_code).trim()) throw new Error("Employee code is required.");
      if (!issue.item_name || !String(issue.item_name).trim()) throw new Error("Item name is required.");
      if (Number(issue.quantity) < 0) throw new Error("Quantity cannot be negative.");
      if (issue.issue_month && (Number(issue.issue_month) < 1 || Number(issue.issue_month) > 12)) throw new Error("Invalid month. Enter 1-12.");
      if (issue.issue_year && (Number(issue.issue_year) < 1900 || Number(issue.issue_year) > 2100)) throw new Error("Invalid year.");

      const existing = all("SELECT * FROM uniform_issues WHERE id = ?", [Number(issue.id)])[0];
      if (!existing) throw new Error(`Distribution record #${issue.id} was not found.`);
      db.run(
        `UPDATE uniform_issues SET
         issued_at = ?, issue_month = ?, issue_year = ?, item_name = ?, quantity = ?, remarks = ?
         WHERE id = ?`,
        [issue.issued_at, issue.issue_month || null, issue.issue_year || null, issue.item_name, issue.quantity, issue.remarks || "", issue.id]
      );
      const updated = all("SELECT * FROM uniform_issues WHERE id = ?", [Number(issue.id)])[0];
      audit("Distribution Record Edited", `Record #${issue.id} for ${issue.employee_code}`, {
        entityType: "Distribution",
        entityId: issue.id,
        oldValue: existing,
        newValue: updated,
      });
      save();
    },
    deleteUniformIssue(id) {
      const existing = all("SELECT * FROM uniform_issues WHERE id = ?", [Number(id)])[0];
      db.run(`DELETE FROM uniform_issues WHERE id = ?`, [Number(id)]);
      audit("Distribution Record Deleted", `Record #${id}`, {
        entityType: "Distribution",
        entityId: id,
        oldValue: existing,
      });
      save();
    },
    bulkDeleteUniformIssues(ids) {
      if (!ids || !ids.length) return;
      const placeholders = ids.map(() => '?').join(',');
      const existing = all(`SELECT * FROM uniform_issues WHERE id IN (${placeholders})`, ids.map(Number));
      db.run(`DELETE FROM uniform_issues WHERE id IN (${placeholders})`, ids.map(Number));
      audit("Bulk Delete", `Deleted ${ids.length} distribution records.`, {
        entityType: "Distribution",
        oldValue: existing,
      });
      save();
    }
});
