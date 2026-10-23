const fs = require('fs');
const { parseCandidate } = require('../import/smart-importer');
const getMissingAnnualPolicySuggestions = require('./missing-annual-policy-suggestions');
const { getRecognizedAnnualItems, ensureAnnualPoliciesForRecognizedItems } = require('./annual-policy-sync');

module.exports = ({ db, scalar, all, save, audit, now, normalizeLabel, isIgnoredIssueItemName, classifyReviewReason, extractAmount, generateDeductionPdf }) => ({
    ensureAnnualPoliciesForRecognizedItems() {
      return ensureAnnualPoliciesForRecognizedItems({ db, all, scalar, save, audit, now, isIgnoredIssueItemName });
    },
    bulkUpdateAnnualPolicies(payload) {
      const financialYear = Number(payload?.financial_year);
      const rows = Array.isArray(payload?.rows) ? payload.rows : [];
      if (!Number.isInteger(financialYear) || financialYear < 1900 || financialYear > 9998) throw new Error('Select a valid financial year.');
      if (!rows.length) throw new Error('Add at least one item quantity to save.');

      this.ensureAnnualPoliciesForRecognizedItems();
      const recognized = new Map(getRecognizedAnnualItems(all, isIgnoredIssueItemName).map((name) => [String(name).trim().toLocaleLowerCase(), name]));
      const validated = [];
      const seen = new Set();
      rows.forEach((row, index) => {
        const itemName = String(row?.item_name || '').trim();
        const itemKey = itemName.toLocaleLowerCase();
        const quantityText = row?.allowed_quantity;
        const quantity = quantityText === '' || quantityText === null || quantityText === undefined ? NaN : Number(quantityText);
        if (!itemKey || !recognized.has(itemKey)) throw new Error(`Row ${index + 1}: select a recognized item from the item master or imported distribution data.`);
        if (seen.has(itemKey)) throw new Error(`Row ${index + 1}: duplicate item entry for ${recognized.get(itemKey)}.`);
        if (!Number.isInteger(quantity) || quantity < 0) throw new Error(`Row ${index + 1}: Allowed Quantity must be a non-negative whole number.`);
        seen.add(itemKey);
        validated.push({ item_name: recognized.get(itemKey), allowed_quantity: quantity });
      });

      let changed = 0;
      let inserted = 0;
      const oldValues = [];
      db.run('BEGIN TRANSACTION');
      try {
        validated.forEach((row) => {
          const existing = all('SELECT * FROM annual_policies WHERE lower(item_name) = lower(?) AND financial_year = ?', [row.item_name, financialYear])[0];
          if (existing) {
            const oldQuantity = Number(existing.allowed_quantity || 0);
            if (oldQuantity !== row.allowed_quantity) {
              db.run('UPDATE annual_policies SET allowed_quantity = ?, updated_at = ? WHERE id = ?', [row.allowed_quantity, now(), existing.id]);
              changed += 1;
              oldValues.push({ item_name: existing.item_name, financial_year: financialYear, allowed_quantity: oldQuantity });
            }
          } else {
            db.run("INSERT INTO annual_policies (item_name, financial_year, allowed_quantity, status, created_at, updated_at) VALUES (?, ?, ?, 'Active', ?, ?)",
              [row.item_name, financialYear, row.allowed_quantity, now(), now()]);
            inserted += 1;
            if (row.allowed_quantity > 0) changed += 1;
          }
        });
        db.run('COMMIT');
      } catch (error) {
        db.run('ROLLBACK');
        throw error;
      }

      if (changed > 0 || inserted > 0) {
        audit('Annual Item Policies Bulk Updated', `Saved ${validated.length} item quantity row(s) for FY ${financialYear}.`, {
          entityType: 'Annual Policy', entityId: financialYear, oldValue: oldValues,
          newValue: validated.map((row) => ({ ...row, financial_year: financialYear })),
        });
        save();
      }
      return { saved: validated.length, changed, inserted, recalculationRequired: changed > 0 };
    },
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
    upsertAnnualPolicy(policy) {
      const normalized = {
        id: policy.id ? Number(policy.id) : null,
        item_name: String(policy.item_name || '').trim(),
        financial_year: Number(policy.financial_year || 0),
        allowed_quantity: Number(policy.allowed_quantity || 0),
        status: String(policy.status || 'Active').trim() || 'Active',
      };
      if (!normalized.item_name || !Number.isInteger(normalized.financial_year) || normalized.financial_year < 1900 || !Number.isInteger(normalized.allowed_quantity) || normalized.allowed_quantity < 0) {
        throw new Error('Item name, valid Financial Year, and non-negative whole allowed quantity are required.');
      }
      const existing = normalized.id
        ? all('SELECT * FROM annual_policies WHERE id = ?', [normalized.id])[0]
        : all('SELECT * FROM annual_policies WHERE lower(item_name) = lower(?) AND financial_year = ?', [normalized.item_name, normalized.financial_year])[0];
      if (normalized.id && !existing) throw new Error(`Annual Policy #${normalized.id} was not found.`);
      if (existing) {
        db.run('UPDATE annual_policies SET item_name = ?, financial_year = ?, allowed_quantity = ?, status = ?, updated_at = ? WHERE id = ?',
          [normalized.item_name, normalized.financial_year, normalized.allowed_quantity, normalized.status, now(), existing.id]);
      } else {
        db.run('INSERT INTO annual_policies (item_name, financial_year, allowed_quantity, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
          [normalized.item_name, normalized.financial_year, normalized.allowed_quantity, normalized.status, now(), now()]);
      }
      const saved = all('SELECT * FROM annual_policies WHERE lower(item_name) = lower(?) AND financial_year = ?', [normalized.item_name, normalized.financial_year])[0];
      audit('Annual Policy Changed', `${normalized.item_name} (FY ${normalized.financial_year})`, { entityType: 'Annual Policy', entityId: saved.id, oldValue: existing || null, newValue: saved });
      save();
      return saved;
    },
    createAnnualPolicyFromSuggestion(policy, expected = {}) {
      const normalized = {
        item_name: String(policy.item_name || '').trim(),
        financial_year: Number(policy.financial_year || 0),
        allowed_quantity: Number(policy.allowed_quantity || 0),
      };
      if (!normalized.item_name || !Number.isInteger(normalized.financial_year) || normalized.financial_year < 1900
          || !Number.isInteger(normalized.allowed_quantity) || normalized.allowed_quantity < 0) {
        throw new Error('Item name, valid Financial Year, and non-negative whole allowed quantity are required.');
      }

      db.run('BEGIN TRANSACTION');
      let saved;
      try {
        const suggestion = getMissingAnnualPolicySuggestions({ all, scalar, normalizeLabel, isIgnoredIssueItemName })
          .find((row) => normalizeLabel(row.item_name) === normalizeLabel(normalized.item_name)
            && Number(row.financial_year) === normalized.financial_year);
        if (!suggestion) {
          throw new Error('This annual-policy suggestion is no longer applicable. The records or policy have changed; refresh the Entitlements page and review the updated suggestions.');
        }
        const expectedCount = Number(expected.case_count);
        const expectedSample = String(expected.sample_employee_code || '').trim();
        if (!Number.isInteger(expectedCount) || expectedCount !== Number(suggestion.case_count)
            || !expectedSample || expectedSample !== String(suggestion.sample_employee_code || '').trim()
            || !/^[a-f0-9]{64}$/i.test(String(expected.suggestion_fingerprint || ''))
            || String(expected.suggestion_fingerprint).toLowerCase() !== String(suggestion.suggestion_fingerprint || '').toLowerCase()) {
          throw new Error('The qualifying Review Queue records changed after this suggestion was opened. Refresh the Entitlements page and use the current suggestion.');
        }

        const existing = all('SELECT * FROM annual_policies WHERE lower(item_name) = lower(?) AND financial_year = ?',
          [normalized.item_name, normalized.financial_year])[0] || null;
        if (existing && String(existing.status || 'Active').toLowerCase() === 'active') {
          throw new Error('An active annual policy now exists for this item and financial year. Refresh the Entitlements page.');
        }
        if (existing) {
          db.run("UPDATE annual_policies SET allowed_quantity = ?, status = 'Active', updated_at = ? WHERE id = ?",
            [normalized.allowed_quantity, now(), existing.id]);
        } else {
          db.run("INSERT INTO annual_policies (item_name, financial_year, allowed_quantity, status, created_at, updated_at) VALUES (?, ?, ?, 'Active', ?, ?)",
            [suggestion.item_name, normalized.financial_year, normalized.allowed_quantity, now(), now()]);
        }
        saved = all('SELECT * FROM annual_policies WHERE lower(item_name) = lower(?) AND financial_year = ?',
          [normalized.item_name, normalized.financial_year])[0];
        db.run('COMMIT');
      } catch (error) {
        db.run('ROLLBACK');
        throw error;
      }
      audit('Annual Policy Created From Verified Suggestion', `${saved.item_name} (FY ${saved.financial_year})`, {
        entityType: 'Annual Policy', entityId: saved.id, oldValue: null, newValue: saved,
        remarks: `Created from ${Number(expected.case_count)} currently qualifying employee/item records.`,
      });
      save();
      return saved;
    },
    saveDetailedReportItemValues(payload) {
      const itemName = String(payload?.item_name || '').trim();
      const unit = String(payload?.unit || '').trim();
      const financialYear = Number(payload?.financial_year);
      if (!itemName || !unit || !Number.isInteger(financialYear) || financialYear < 1900) throw new Error('A valid item, unit, and financial year are required.');
      const nonNegative = (value, label, integer = false) => {
        if (value === undefined || value === null || value === '') return null;
        const number = Number(value);
        if (!Number.isFinite(number) || number < 0 || (integer && !Number.isInteger(number))) throw new Error(`${label} must be a valid non-negative ${integer ? 'whole quantity' : 'number'}.`);
        return number;
      };
      const deductionRate = nonNegative(payload.deduction_rate, 'Deduction rate');
      const annualLimit = nonNegative(payload.annual_limit, 'Annual limit', true);
      const unitLimit = nonNegative(payload.unit_limit, 'Unit entitlement', true);
      const actualPrice = nonNegative(payload.actual_price, 'Actual Price');
      const oldUnitPolicy = all('SELECT * FROM unit_policies WHERE lower(unit) = lower(?) AND lower(item_name) = lower(?)', [unit, itemName])[0] || null;
      const oldAnnualPolicy = all('SELECT * FROM annual_policies WHERE lower(item_name) = lower(?) AND financial_year = ?', [itemName, financialYear])[0] || null;
      const oldActualPrice = all('SELECT * FROM actual_item_prices WHERE lower(item_name) = lower(?)', [itemName])[0] || null;
      const unitPolicyChanged = (deductionRate !== null || unitLimit !== null) && (!oldUnitPolicy
        || (deductionRate !== null && Number(oldUnitPolicy.item_cost) !== deductionRate)
        || (unitLimit !== null && Number(oldUnitPolicy.yearly_entitlement) !== unitLimit));
      const annualPolicyChanged = annualLimit !== null && (!oldAnnualPolicy || Number(oldAnnualPolicy.allowed_quantity) !== annualLimit);
      const actualPriceChanged = actualPrice !== null && (!oldActualPrice || Number(oldActualPrice.actual_price) !== actualPrice);
      db.run('BEGIN TRANSACTION');
      try {
        if (deductionRate !== null || unitLimit !== null) {
          const cost = deductionRate ?? Number(oldUnitPolicy?.item_cost || 0);
          const entitlement = unitLimit ?? Number(oldUnitPolicy?.yearly_entitlement || 0);
          db.run(`INSERT INTO unit_policies (unit, item_name, yearly_entitlement, item_cost) VALUES (?, ?, ?, ?)
            ON CONFLICT(unit, item_name) DO UPDATE SET yearly_entitlement = excluded.yearly_entitlement, item_cost = excluded.item_cost`, [unit, itemName, entitlement, cost]);
        }
        if (annualLimit !== null) {
          db.run(`INSERT INTO annual_policies (item_name, financial_year, allowed_quantity, status, created_at, updated_at)
            VALUES (?, ?, ?, 'Active', ?, ?) ON CONFLICT(lower(item_name), financial_year) DO UPDATE SET allowed_quantity = excluded.allowed_quantity, updated_at = excluded.updated_at`, [itemName, financialYear, annualLimit, now(), now()]);
        }
        if (actualPrice !== null) db.run(`INSERT INTO actual_item_prices (item_name, actual_price, created_at, updated_at) VALUES (?, ?, ?, ?)
          ON CONFLICT(item_name) DO UPDATE SET actual_price = excluded.actual_price, updated_at = excluded.updated_at`, [itemName, actualPrice, now(), now()]);
        db.run('COMMIT');
      } catch (error) {
        db.run('ROLLBACK');
        throw error;
      }
      const newUnitPolicy = all('SELECT * FROM unit_policies WHERE lower(unit) = lower(?) AND lower(item_name) = lower(?)', [unit, itemName])[0] || null;
      const newAnnualPolicy = all('SELECT * FROM annual_policies WHERE lower(item_name) = lower(?) AND financial_year = ?', [itemName, financialYear])[0] || null;
      const newActualPrice = all('SELECT * FROM actual_item_prices WHERE lower(item_name) = lower(?)', [itemName])[0] || null;
      if (unitPolicyChanged || annualPolicyChanged || actualPriceChanged) {
        audit('Detailed Report Item Values Changed', `${itemName} — ${unit} — FY ${financialYear}`, {
          entityType: 'Item Policy', entityId: `${unit}:${itemName}:${financialYear}`,
          oldValue: { unitPolicy: oldUnitPolicy, annualPolicy: oldAnnualPolicy, actualPrice: oldActualPrice },
          newValue: { unitPolicy: newUnitPolicy, annualPolicy: newAnnualPolicy, actualPrice: newActualPrice },
        });
        save();
      }
      return { unitPolicy: newUnitPolicy, annualPolicy: newAnnualPolicy, actualPrice: newActualPrice, actualPriceChanged, reviewCalculationsChanged: unitPolicyChanged || annualPolicyChanged };
    },
    deleteAnnualPolicy(policyId) {
      const existing = all('SELECT * FROM annual_policies WHERE id = ?', [Number(policyId)])[0];
      if (!existing) throw new Error(`Annual Policy #${policyId} was not found.`);
      db.run('DELETE FROM annual_policies WHERE id = ?', [Number(policyId)]);
      audit('Annual Policy Deleted', `${existing.item_name} (FY ${existing.financial_year})`, { entityType: 'Annual Policy', entityId: existing.id, oldValue: existing });
      save();
    },
    getActualPriceData() {
      let historicalImportItemsUpdated = false;
      const legacyImports = all(`SELECT id, file_path, selected_sheet FROM imports
        WHERE TRIM(COALESCE(detected_items, '')) IN ('', '[]') AND TRIM(COALESCE(file_path, '')) <> ''`);
      legacyImports.forEach((record) => {
        if (!fs.existsSync(record.file_path)) return;
        try {
          const detected = parseCandidate(record.file_path, record.selected_sheet).summary.detectedItems || [];
          if (!detected.length) return;
          db.run('UPDATE imports SET detected_items = ? WHERE id = ?', [JSON.stringify(detected), Number(record.id)]);
          historicalImportItemsUpdated = true;
        } catch (error) {
          console.warn(`Could not backfill detected items for import #${record.id}:`, error.message || error);
        }
      });
      const sourceNames = all(`SELECT TRIM(item_name) AS item_name FROM (
        SELECT TRIM(item_name) AS item_name FROM uniform_items
        UNION SELECT TRIM(item_name) AS item_name FROM uniform_issues
        UNION SELECT TRIM(item_name) AS item_name FROM unit_policies
        UNION SELECT TRIM(item_name) AS item_name FROM annual_policies
      ) WHERE TRIM(COALESCE(item_name, '')) <> ''`).map((row) => row.item_name);
      const importedNames = all('SELECT detected_items FROM imports WHERE TRIM(COALESCE(detected_items, \'\')) <> \'\'')
        .flatMap((row) => { try { const parsed = JSON.parse(row.detected_items); return Array.isArray(parsed) ? parsed : []; } catch { return []; } })
        .map((item) => String(item || '').trim())
        .filter((item) => item && !isIgnoredIssueItemName(item));
      const canonicalItems = new Map();
      [...sourceNames, ...importedNames].forEach((name) => {
        const clean = String(name || '').trim();
        if (!clean || isIgnoredIssueItemName(clean)) return;
        const key = clean.toLocaleLowerCase();
        const previous = canonicalItems.get(key);
        if (!previous || clean.localeCompare(previous, undefined, { sensitivity: 'base' }) < 0) canonicalItems.set(key, clean);
      });
      const items = [...canonicalItems.values()].sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }));
      const before = Number(scalar('SELECT COUNT(*) FROM actual_item_prices') || 0);
      items.forEach((itemName) => db.run(`INSERT OR IGNORE INTO actual_item_prices (item_name, actual_price, created_at, updated_at) VALUES (?, 0, ?, ?)`, [itemName, now(), now()]));
      const after = Number(scalar('SELECT COUNT(*) FROM actual_item_prices') || 0);
      if (after !== before || historicalImportItemsUpdated) {
        audit('Actual Item Price Defaults Created', `Created ${after - before} default Actual Price row(s).`, {
          entityType: 'Actual Item Prices', entityId: 'global-item-prices',
          remarks: `${historicalImportItemsUpdated ? 'Historical import item headers were recovered. ' : ''}Newly detected catalog items defaulted to 0 without changing inventory or deduction rates.`,
        });
        save();
      }
      return { items, prices: all('SELECT item_name, actual_price, created_at, updated_at FROM actual_item_prices ORDER BY lower(item_name), item_name') };
    },
    previewActualItemPrices(rows) {
      if (!Array.isArray(rows)) throw new Error('The price import must contain a list of rows.');
      const data = this.getActualPriceData();
      const itemMap = new Map(data.items.map((item) => [String(item).toLowerCase(), item]));
      const currentMap = new Map(data.prices.map((entry) => [String(entry.item_name).toLowerCase(), Number(entry.actual_price)]));
      const counts = new Map();
      rows.forEach((row) => {
        const key = String(row?.item_name || '').trim().toLowerCase();
        if (key) counts.set(key, (counts.get(key) || 0) + 1);
      });
      const preview = rows.map((row, index) => {
        const rawName = String(row?.item_name || '').trim();
        const key = rawName.toLowerCase();
        const name = itemMap.get(key);
        const rawPrice = row?.actual_price ?? row?.price;
        const price = rawPrice === '' || rawPrice === null || rawPrice === undefined ? NaN : Number(rawPrice);
        const errors = [];
        if (!rawName) errors.push('Item name is missing.');
        else if (!name) errors.push('Item name is not in the existing item master.');
        if (row?.unit && String(row.unit).trim()) errors.push('Actual prices are global per item; unit-specific prices are not configured.');
        if (!Number.isFinite(price) || price < 0) errors.push('Actual Price must be a valid non-negative number.');
        if (key && counts.get(key) > 1) errors.push('Duplicate item entry in this operation.');
        const existing = name ? currentMap.get(String(name).toLowerCase()) : undefined;
        return {
          row_number: Number(row?.row_number || index + 2), item_name: name || rawName, unit: String(row?.unit || '').trim(),
          existing_price: existing ?? null, imported_price: Number.isFinite(price) && price >= 0 ? price : null,
          action: existing === undefined ? 'Insert' : Number(existing) === price ? 'Unchanged' : 'Update',
          valid: errors.length === 0, error_message: errors.join(' '),
        };
      });
      return { rows: preview, valid_count: preview.filter((row) => row.valid).length, invalid_count: preview.filter((row) => !row.valid).length };
    },
    saveActualItemPrices(rows) {
      const preview = this.previewActualItemPrices(rows);
      const validRows = preview.rows.filter((row) => row.valid);
      let inserted = 0; let updated = 0; let skipped = 0;
      db.run('BEGIN TRANSACTION');
      try {
        validRows.forEach((row) => {
          if (row.action === 'Unchanged') { skipped += 1; return; }
          if (row.action === 'Insert') {
            db.run('INSERT INTO actual_item_prices (item_name, actual_price, created_at, updated_at) VALUES (?, ?, ?, ?)', [row.item_name, row.imported_price, now(), now()]);
            inserted += 1;
          } else {
            db.run('UPDATE actual_item_prices SET actual_price = ?, updated_at = ? WHERE lower(item_name) = lower(?)', [row.imported_price, now(), row.item_name]);
            updated += 1;
          }
        });
        db.run('COMMIT');
      } catch (error) {
        db.run('ROLLBACK');
        throw new Error(`Actual Price changes were rolled back: ${error.message || error}`);
      }
      if (inserted || updated) {
        audit('Actual Item Prices Changed', `Inserted ${inserted}, updated ${updated}, unchanged ${skipped}, rejected ${preview.invalid_count}.`, {
          entityType: 'Actual Item Prices', entityId: 'global-item-prices',
          oldValue: validRows.filter((row) => row.action === 'Update').map((row) => ({ item_name: row.item_name, actual_price: row.existing_price })),
          newValue: validRows.filter((row) => row.action !== 'Unchanged').map((row) => ({ item_name: row.item_name, actual_price: row.imported_price, action: row.action })),
          remarks: `Rejected ${preview.invalid_count} invalid row(s).`,
        });
        save();
      }
      return { inserted, updated, skipped, rejected: preview.invalid_count, preview, data: this.getActualPriceData() };
    },
    setReviewQueueCalculationMode(mode) {
      const allowedModes = new Set(["item_annual", "unit_wise", "combined"]);
      if (!allowedModes.has(mode)) throw new Error("Select a valid Review Queue Calculation Mode.");
      const existing = all("SELECT setting_value FROM app_settings WHERE setting_key = 'review_queue_calculation_mode'")[0];
      const previousMode = allowedModes.has(existing?.setting_value) ? existing.setting_value : "item_annual";
      if (previousMode !== mode) {
        db.run(`INSERT INTO entitlement_classification_history (uniform_issue_id, calculation_mode, entitlement_consumed, excess_generated, recorded_at)
          SELECT id, ?, entitlement_consumed, excess_generated, ? FROM uniform_issues WHERE quantity > 0`, [previousMode, now()]);
      }
      db.run(`INSERT INTO app_settings (setting_key, setting_value, updated_at) VALUES ('review_queue_calculation_mode', ?, ?)
        ON CONFLICT(setting_key) DO UPDATE SET setting_value = excluded.setting_value, updated_at = excluded.updated_at`, [mode, now()]);
      audit("Review Queue Calculation Mode Changed", `${previousMode} → ${mode}`, {
        entityType: "Setting", entityId: "review_queue_calculation_mode", oldValue: previousMode, newValue: mode,
      });
      save();
      return mode;
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
            "SELECT id, item_cost, yearly_entitlement FROM unit_policies WHERE lower(unit) = lower(?) AND lower(item_name) = lower(?)",
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
            
            const priceChanged = update_price && Number(existing.item_cost) !== Number(new_price || 0);
            const quantityChanged = update_qty && Number(existing.yearly_entitlement) !== Number(new_qty || 0);
            if ((priceChanged || quantityChanged) && updates.length > 0) {
              params.push(existing.id);
              db.run(`UPDATE unit_policies SET ${updates.join(", ")} WHERE id = ?`, params);
              updated++;
            } else {
              skipped++;
              skippedDetails.push({ unit, reason: "Configured values already match." });
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
