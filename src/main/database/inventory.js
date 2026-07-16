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
        const exists = scalar("SELECT COUNT(*) FROM uniform_items WHERE id = ?", [normalized.id]);
        if (!exists) throw new Error(`Item #${normalized.id} was not found.`);
        db.run(
          `UPDATE uniform_items SET item_code = ?, item_name = ?, category = ?, size = ?, cost = ?, available_stock = ?, minimum_stock = ?, status = ?, updated_at = ? WHERE id = ?`,
          [normalized.item_code, normalized.item_name, normalized.category, normalized.size, normalized.cost, normalized.available_stock, normalized.minimum_stock, normalized.status, now(), normalized.id]
        );
      } else {
        db.run(
          `INSERT INTO uniform_items (item_code, item_name, category, size, cost, available_stock, minimum_stock, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [normalized.item_code, normalized.item_name, normalized.category, normalized.size, normalized.cost, normalized.available_stock, normalized.minimum_stock, normalized.status, now(), now()]
        );
      }
      audit("Item Saved", `${normalized.item_code} - ${normalized.item_name}`);
      save();
    },
    deleteItem(itemId) {
      const existing = all("SELECT id, item_code, item_name FROM uniform_items WHERE id = ?", [Number(itemId)])[0];
      if (!existing) throw new Error(`Item #${itemId} was not found.`);
      db.run("DELETE FROM uniform_items WHERE id = ?", [Number(itemId)]);
      audit("Item Deleted", `${existing.item_code} - ${existing.item_name}`);
      save();
    }
});
