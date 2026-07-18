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
      audit("Item Saved", `${normalized.item_code} -${normalized.item_name}`, {
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
      audit("Item Deleted", `${existing.item_code} -${existing.item_name}`, {
        entityType: "Inventory Item",
        entityId: existing.id,
        oldValue: existing,
      });
      save();
    },
    updateDistributionRow(record) {
      const { key, quantities } = record;
      if (!key || !key.employee_code) throw new Error("Employee code is required.");
      db.run("BEGIN TRANSACTION");
      try {
        const sqlBase = "FROM uniform_issues WHERE employee_code = ? AND lower(COALESCE(unit, '')) = lower(COALESCE(?, '')) AND lower(COALESCE(godown, '')) = lower(COALESCE(?, '')) AND COALESCE(issue_month, 0) = COALESCE(?, 0) AND COALESCE(issue_year, 0) = COALESCE(?, 0) AND lower(COALESCE(issue_period_label, '')) = lower(COALESCE(?, ''))";
        const params = [
          key.employee_code, key.unit || "", key.godown || "",
          key.issue_month ? Number(key.issue_month) : 0,
          key.issue_year ? Number(key.issue_year) : 0,
          key.issue_period_label || ""
        ];
        db.run(`DELETE ${sqlBase}`, params);
        
        const stmt = db.prepare(`INSERT INTO uniform_issues (employee_code, employee_name, unit, godown, item_name, quantity, issue_month, issue_year, issue_period_label, source_sheet, source_row, issued_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'Manual', 0, ?)`);
        const empName = scalar("SELECT employee_name FROM employees WHERE employee_code = ?", [key.employee_code]) || "Unknown";
        const issuedAt = now();
        
        for (const [itemName, qty] of Object.entries(quantities || {})) {
          if (Number(qty) > 0) {
            stmt.run([key.employee_code, empName, key.unit || "", key.godown || "", itemName, Number(qty), key.issue_month || null, key.issue_year || null, key.issue_period_label || "", issuedAt]);
          }
        }
        stmt.free();
        db.run("COMMIT");
        audit("Distribution Row Updated", `Manual update for matrix row for ${key.employee_code}`);
        save();
      } catch (error) {
        db.run("ROLLBACK");
        throw error;
      }
    },
    deleteDistributionRow(key) {
      if (!key || !key.employee_code) throw new Error("Employee code is required.");
      const params = [
        key.employee_code, key.unit || "", key.godown || "",
        key.issue_month ? Number(key.issue_month) : 0,
        key.issue_year ? Number(key.issue_year) : 0,
        key.issue_period_label || ""
      ];
      db.run(`DELETE FROM uniform_issues WHERE employee_code = ? AND lower(COALESCE(unit, '')) = lower(COALESCE(?, '')) AND lower(COALESCE(godown, '')) = lower(COALESCE(?, '')) AND COALESCE(issue_month, 0) = COALESCE(?, 0) AND COALESCE(issue_year, 0) = COALESCE(?, 0) AND lower(COALESCE(issue_period_label, '')) = lower(COALESCE(?, ''))`, params);
      audit("Distribution Row Deleted", `Deleted matrix row for ${key.employee_code}`);
      save();
    }
});