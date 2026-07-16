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
        const exists = scalar("SELECT COUNT(*) FROM unit_policies WHERE id = ?", [normalizedPolicy.id]);
        if (!exists) throw new Error(`Policy #${policy.id} was not found.`);
        db.run(
          `UPDATE unit_policies SET unit = ?, item_name = ?, yearly_entitlement = ?, item_cost = ? WHERE id = ?`,
          [normalizedPolicy.unit, normalizedPolicy.item_name, normalizedPolicy.yearly_entitlement, normalizedPolicy.item_cost, normalizedPolicy.id]
        );
      } else {
        db.run(
          `INSERT INTO unit_policies (unit, item_name, yearly_entitlement, item_cost)
           VALUES (?, ?, ?, ?)
           ON CONFLICT(unit, item_name) DO UPDATE SET
             yearly_entitlement = excluded.yearly_entitlement,
             item_cost = excluded.item_cost`,
          [normalizedPolicy.unit, normalizedPolicy.item_name, normalizedPolicy.yearly_entitlement, normalizedPolicy.item_cost]
        );
      }
      audit("Policy Changed", `${normalizedPolicy.unit}: ${normalizedPolicy.item_name}`);
      save();
      return normalizedPolicy;
    },
    deletePolicy(policyId) {
      const existing = all("SELECT id, unit, item_name FROM unit_policies WHERE id = ?", [Number(policyId)])[0];
      if (!existing) throw new Error(`Policy #${policyId} was not found.`);
      db.run("DELETE FROM unit_policies WHERE id = ?", [Number(policyId)]);
      audit("Policy Deleted", `${existing.unit}: ${existing.item_name}`);
      save();
    }
});
