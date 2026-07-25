module.exports = ({ db, scalar, all, save, audit, now, normalizeLabel, isIgnoredIssueItemName, classifyReviewReason, extractAmount, generateDeductionPdf }) => ({
    upsertPolicy(policy) {
      const normalizedPolicy = {
        id: policy.id ? Number(policy.id) : null,
        unit: String(policy.unit || "").trim(),
        item_name: String(policy.item_name || "").trim(),
        yearly_entitlement: Number(policy.yearly_entitlement || 0),
        item_cost: Number(policy.item_cost || 0),
      };

      if (!normalizedPolicy.unit || !normalizedPolicy.item_name) {
        throw new Error("Unit and item name are required.");
      }

      if (normalizedPolicy.id) {
        var existing = all("SELECT * FROM unit_policies WHERE id = ?", [normalizedPolicy.id])[0];
        if (!existing) throw new Error(`Policy #${policy.id} was not found.`);
        db.run(
          `UPDATE unit_policies SET unit = ?, item_name = ?, yearly_entitlement = ?, item_cost = ? WHERE id = ?`,
          [normalizedPolicy.unit, normalizedPolicy.item_name, normalizedPolicy.yearly_entitlement, normalizedPolicy.item_cost, normalizedPolicy.id]
        );
      } else {
        var existing = all(
          "SELECT * FROM unit_policies WHERE lower(unit) = lower(?) AND lower(item_name) = lower(?)",
          [normalizedPolicy.unit, normalizedPolicy.item_name]
        )[0] || null;
        db.run(
          `INSERT INTO unit_policies (unit, item_name, yearly_entitlement, item_cost)
           VALUES (?, ?, ?, ?)
           ON CONFLICT(unit, item_name) DO UPDATE SET
             yearly_entitlement = excluded.yearly_entitlement,
             item_cost = excluded.item_cost`,
          [normalizedPolicy.unit, normalizedPolicy.item_name, normalizedPolicy.yearly_entitlement, normalizedPolicy.item_cost]
        );
      }
      const saved = normalizedPolicy.id
        ? all("SELECT * FROM unit_policies WHERE id = ?", [normalizedPolicy.id])[0]
        : all(
            "SELECT * FROM unit_policies WHERE lower(unit) = lower(?) AND lower(item_name) = lower(?)",
            [normalizedPolicy.unit, normalizedPolicy.item_name]
          )[0];
      audit("Policy Changed", `${normalizedPolicy.unit}: ${normalizedPolicy.item_name}`, {
        entityType: "Policy",
        entityId: saved?.id || normalizedPolicy.id || `${normalizedPolicy.unit}:${normalizedPolicy.item_name}`,
        oldValue: existing,
        newValue: saved || normalizedPolicy,
      });
      save();
      return normalizedPolicy;
    },
    deletePolicy(policyId) {
      const existing = all("SELECT id, unit, item_name FROM unit_policies WHERE id = ?", [Number(policyId)])[0];
      if (!existing) throw new Error(`Policy #${policyId} was not found.`);
      db.run("DELETE FROM unit_policies WHERE id = ?", [Number(policyId)]);
      audit("Policy Deleted", `${existing.unit}: ${existing.item_name}`, {
        entityType: "Policy",
        entityId: existing.id,
        oldValue: existing,
      });
      save();
    },
    bulkUpdatePolicy(payload) {
      const { item_name, update_price, new_price, update_qty, new_qty, units } = payload;
      
      if (!item_name || !units || !Array.isArray(units)) {
        throw new Error("Invalid bulk update parameters.");
      }
      if (!update_price && !update_qty) {
        throw new Error("No update options selected.");
      }

      let updated = 0;
      let skipped = 0;
      let failed = 0;
      const skippedDetails = [];

      for (const unit of units) {
        try {
          const existing = all(
            "SELECT id FROM unit_policies WHERE lower(unit) = lower(?) AND lower(item_name) = lower(?)",
            [unit, item_name]
          )[0];

          if (existing) {
            let updates = [];
            let params = [];
            
            if (update_price) {
              updates.push("item_cost = ?");
              params.push(Number(new_price || 0));
            }
            if (update_qty) {
              updates.push("yearly_entitlement = ?");
              params.push(Number(new_qty || 0));
            }
            
            if (updates.length > 0) {
              params.push(existing.id);
              db.run(`UPDATE unit_policies SET ${updates.join(", ")} WHERE id = ?`, params);
              updated++;
            }
          } else {
            skipped++;
            skippedDetails.push({ unit, reason: "Item not configured in policy." });
          }
        } catch (error) {
          failed++;
        }
      }

      if (updated > 0) {
        const changes = [];
        if (update_price) changes.push(`Price -> ₹${new_price}`);
        if (update_qty) changes.push(`Qty -> ${new_qty}`);
        
        audit("Bulk Item Update", `Updated ${changes.join(" and ")} for ${item_name} across ${updated} units.`, {
            entityType: "Policy",
            remarks: `Skipped: ${skipped}, Failed: ${failed}`
        });
        save();
      }

      return { updated, skipped, failed, skippedDetails };
    }
});