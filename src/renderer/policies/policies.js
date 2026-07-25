function setPolicyEditMode(policyId = null) {
  editingPolicyId = policyId ? String(policyId) : null;
  document.getElementById("savePolicyBtn").textContent = editingPolicyId ? "Update Policy" : "Save Policy";
}

function renderPolicies() {
  const suggestions = state.missingPolicySuggestions || [];
  renderTableRows("missingPolicyRows", suggestions, (row) => `
    <tr>
      <td>${text(row.unit)}</td>
      <td>${text(row.item_name)}</td>
      <td>${text(row.case_count)}</td>
      <td>${text(row.sample_employee_code)} - ${text(row.sample_employee_name)}</td>
      <td>
        <button
          data-use-missing-policy="1"
          data-unit="${escapeHtml(row.unit || "")}"
          data-item="${escapeHtml(row.item_name || "")}">
          Use In Form
        </button>
      </td>
    </tr>
  `, "No missing policy suggestions.", 5);

  const search = normalizeSearch(policySearch);
  const unitMap = new Map();
  state.policies.forEach((policy) => {
    const unit = policy.unit || "No Unit";
    if (!unitMap.has(unit)) unitMap.set(unit, []);
    unitMap.get(unit).push(policy);
  });
  const unitRows = [...unitMap.entries()]
    .map(([unit, policies]) => ({
      unit,
      policies: sortByText(policies, (policy) => policy.item_name),
      searchText: [unit, ...policies.map((policy) => `${policy.item_name} ${policy.yearly_entitlement} ${policy.item_cost}`)]
        .join(" ")
        .toLowerCase(),
    }))
    .filter((row) => !search || row.searchText.includes(search))
    .sort((a, b) => a.unit.localeCompare(b.unit));

  if (!selectedPolicyUnit || !unitRows.some((row) => row.unit === selectedPolicyUnit)) {
    selectedPolicyUnit = unitRows[0]?.unit || null;
  }

  document.getElementById("policyUnitList").innerHTML = unitRows.map((row) => {
    const excessCount = row.policies.filter((policy) => Number(policy.yearly_entitlement || 0) === 0).length;
    return `
      <button class="unit-list-item ${row.unit === selectedPolicyUnit ? "active" : ""}" data-policy-unit="${escapeHtml(row.unit)}">
        <span>${escapeHtml(row.unit)}</span>
        <small>${row.policies.length} policies${excessCount ? ` | ${excessCount} at 0` : ""}</small>
      </button>
    `;
  }).join("") || `<div class="empty unit-empty">No units match this search.</div>`;

  const selectedPolicies = selectedPolicyUnit
    ? (unitMap.get(selectedPolicyUnit) || []).filter((policy) => {
        if (!search) return true;
        return `${policy.unit} ${policy.item_name} ${policy.yearly_entitlement} ${policy.item_cost}`.toLowerCase().includes(search);
      })
    : [];

  document.getElementById("selectedPolicyUnitTitle").textContent = selectedPolicyUnit || "Policies";
  document.getElementById("selectedPolicyUnitSubtitle").textContent = selectedPolicyUnit
    ? `${selectedPolicies.length} visible policies for ${selectedPolicyUnit}.`
    : "Choose a unit/client to view policies.";

  renderTableRows("policyRows", selectedPolicies, (row) => `
    <tr>
      <td>${text(row.item_name)}</td>
      <td>${text(row.yearly_entitlement)}</td>
      <td>${formatCompactMoney(row.item_cost)}</td>
      <td>
        <div class="row-actions">
          <button data-edit-policy="${row.id}">Edit</button>
          <button class="danger" data-delete-policy="${row.id}">Delete</button>
        </div>
      </td>
    </tr>
  `, "No policy records found for this unit.", 4);

  if (typeof renderManagementToolsSection === "function") {
    renderManagementToolsSection();
  }
}

document.getElementById("policySearch")?.addEventListener("input", (event) => {
  policySearch = event.target.value;
  renderPolicies();
});

document.getElementById("policyForm")?.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!desktopApi) return showImportError("Works only in Desktop App.");
  try {
    const form = event.currentTarget;
    const policy = {
      id: editingPolicyId || form.elements.id.value || "",
      unit: form.elements.unit.value,
      item_name: form.elements.item_name.value,
      yearly_entitlement: form.elements.yearly_entitlement.value,
      item_cost: form.elements.item_cost.value,
    };
    await window.uniformManager.upsertPolicy(policy);
    
    startProgress();
    const result = await window.uniformManager.recalculateReviews();
    state = await window.uniformManager.getState({ distributionLimit });
    stopProgress();
    
    selectedPolicyUnit = policy.unit || selectedPolicyUnit;
    setPolicyEditMode(null);
    form.reset();
    render();
    setView("policies");
    toast(`Policy saved. Review queue recalculated: ${result.generated} pending rows.`);
  } catch (error) {
    stopProgress();
    showImportError(error.message || "Policy save failed.");
  }
});

document.getElementById("cancelPolicyEditBtn")?.addEventListener("click", () => {
  setPolicyEditMode(null);
  document.getElementById("policyForm").reset();
  toast("Policy form cleared.");
});

document.addEventListener("click", async (event) => {
  const editPolicyButton = event.target.closest("[data-edit-policy]");
  if (editPolicyButton) {
    const policy = state.policies.find((row) => String(row.id) === editPolicyButton.dataset.editPolicy);
    if (policy) {
      const form = document.getElementById("policyForm");
      setPolicyEditMode(policy.id);
      form.querySelector('[name="id"]').value = policy.id;
      form.elements.unit.value = policy.unit || "";
      form.elements.item_name.value = policy.item_name || "";
      form.elements.yearly_entitlement.value = policy.yearly_entitlement || 0;
      form.elements.item_cost.value = policy.item_cost || 0;
      selectedPolicyUnit = policy.unit || selectedPolicyUnit;
      setView("policies");
      toast("Policy loaded for editing.");
    }
    return;
  }

  const deletePolicyButton = event.target.closest("[data-delete-policy]");
  if (deletePolicyButton) {
    const policy = state.policies.find((row) => String(row.id) === deletePolicyButton.dataset.deletePolicy);
    const label = policy ? `${policy.unit} - ${policy.item_name}` : `#${deletePolicyButton.dataset.deletePolicy}`;
    if (!confirm(`Delete policy ${label}?`)) return;
    try {
      await window.uniformManager.deletePolicy(deletePolicyButton.dataset.deletePolicy);
      startProgress();
      const result = await window.uniformManager.recalculateReviews();
      state = await window.uniformManager.getState({ distributionLimit });
      stopProgress();
      render();
      toast(`Policy deleted. Review queue recalculated: ${result.generated} pending rows.`);
    } catch (error) {
      stopProgress();
      showImportError(error.message || "Policy delete failed.");
    }
    return;
  }

  const missingPolicyButton = event.target.closest("[data-use-missing-policy]");
  if (missingPolicyButton) {
    const form = document.getElementById("policyForm");
    setPolicyEditMode(null);
    form.reset();
    form.elements.unit.value = missingPolicyButton.dataset.unit || "";
    form.elements.item_name.value = missingPolicyButton.dataset.item || "";
    form.elements.yearly_entitlement.value = 0;
    form.elements.item_cost.value = 0;
    selectedPolicyUnit = missingPolicyButton.dataset.unit || selectedPolicyUnit;
    setView("policies");
    form.elements.yearly_entitlement.focus();
    toast("Missing policy loaded. Enter allowed qty and cost, then save.");
    return;
  }

  const policyUnitButton = event.target.closest("[data-policy-unit]");
  if (policyUnitButton) {
    selectedPolicyUnit = policyUnitButton.dataset.policyUnit || null;
    renderPolicies();
    return;
  }
});

// ==========================================================
// MANAGEMENT TOOLS SECTION 
// ==========================================================

window.ManagementToolsContext = window.ManagementToolsContext || {
    selectedUnits: new Set(),
    allUnits: [],
    initialized: false
};

function initManagementToolsUI() {
  if (window.ManagementToolsContext.initialized) return;
  const policiesView = document.getElementById("policies");
  if (!policiesView) return;

  const toolsHtml = `
      <div class="panel" id="managementToolsPanel" style="margin-top: 24px;">
          <div class="panel-heading">
              <h3>Management Tools</h3>
              <p>Bulk administrative operations for Unit Entitlements.</p>
          </div>
          
          <div style="padding: 0 18px 18px; display: grid; gap: 18px;">
              <!-- Tool 1: Bulk Item Update -->
              <div class="tool-section" style="border: 1px solid var(--line); border-radius: 8px; background: #131922; overflow: hidden;">
                  <div style="padding: 14px 18px; border-bottom: 1px solid var(--line); background: #1e2733;">
                      <h4 style="margin: 0; font-size: 15px;">Bulk Item Update</h4>
                  </div>
                  <div style="padding: 18px;">
                      <form id="bulkUpdateForm" style="display: grid; gap: 16px;">
                          <div style="display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 16px;">
                              <label style="display: grid; gap: 6px; color: var(--muted); font-weight: 600;">
                                  Inventory Item
                                  <select id="bulkUpdateItemSelect" required style="width: 100%;">
                                      <option value="">Select Item...</option>
                                  </select>
                              </label>
                              <label style="display: grid; gap: 6px; color: var(--muted); font-weight: 600;">
                                  New Price
                                  <input type="number" id="bulkUpdatePrice" min="0" step="0.01" />
                              </label>
                              <label style="display: grid; gap: 6px; color: var(--muted); font-weight: 600;">
                                  Allowed Quantity
                                  <input type="number" id="bulkUpdateQty" min="0" step="1" />
                              </label>
                          </div>
                          
                          <div style="display: flex; gap: 16px; align-items: center; padding: 12px; background: #111821; border-radius: 6px; border: 1px solid var(--line);">
                              <strong style="color: var(--muted);">Update Options:</strong>
                              <label style="display: flex; align-items: center; gap: 6px; cursor: pointer; color: var(--ink);">
                                  <input type="checkbox" id="chkUpdatePrice" value="1" /> Update Price
                              </label>
                              <label style="display: flex; align-items: center; gap: 6px; cursor: pointer; color: var(--ink);">
                                  <input type="checkbox" id="chkUpdateQty" value="1" /> Update Allowed Quantity
                              </label>
                          </div>

                          <div style="border: 1px solid var(--line); border-radius: 6px; padding: 12px; background: #111821;">
                              <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px;">
                                  <strong style="color: var(--muted);">Unit Selection</strong>
                                  <div style="display: flex; gap: 8px;">
                                      <button type="button" class="secondary" id="bulkUpdateSelectAllBtn" style="padding: 4px 8px; font-size: 12px;">Select All</button>
                                      <button type="button" class="secondary" id="bulkUpdateClearBtn" style="padding: 4px 8px; font-size: 12px;">Clear Selection</button>
                                  </div>
                              </div>
                              <input type="text" id="bulkUpdateUnitSearch" placeholder="Search Units..." style="width: 100%; margin-bottom: 10px;" autocomplete="off" />
                              <div id="bulkUpdateUnitList" style="max-height: 200px; overflow-y: auto; display: grid; gap: 6px; border: 1px solid var(--line); padding: 8px; border-radius: 4px; background: var(--bg);">
                                  <!-- Units injected here -->
                              </div>
                          </div>
                          <button type="submit" class="primary" style="justify-self: start;">Apply Update</button>
                      </form>
                  </div>
              </div>
          </div>
      </div>

      <!-- Bulk Update Modals -->
      <div class="modal-backdrop" id="bulkUpdateConfirmModal">
          <div class="modal" style="width: 440px; margin: auto;">
              <div class="modal-header">
                  <h3>Are you sure?</h3>
              </div>
              <div class="modal-body" style="padding: 18px; line-height: 1.6;">
                  <div style="display: grid; grid-template-columns: 1fr; gap: 8px; margin-bottom: 16px;">
                      <div><span style="color: var(--muted);">Item: </span><strong id="bulkConfirmItem"></strong></div>
                      <div><span style="color: var(--muted);">Updates: </span><strong id="bulkConfirmUpdates"></strong></div>
                      <div><span style="color: var(--muted);">Units Selected: </span><strong id="bulkConfirmUnits"></strong></div>
                  </div>
                  <p id="bulkConfirmMessage" style="margin: 0; color: var(--muted);"></p>
              </div>
              <div class="modal-footer">
                  <button type="button" class="secondary" id="bulkConfirmCancelBtn">Cancel</button>
                  <button type="button" class="primary" id="bulkConfirmUpdateBtn">Update</button>
              </div>
          </div>
      </div>

      <div class="modal-backdrop" id="bulkUpdateResultModal">
          <div class="modal" style="width: 500px; margin: auto;">
              <div class="modal-header">
                  <h3>Bulk Update Completed</h3>
              </div>
              <div class="modal-body" style="padding: 18px; line-height: 1.6;">
                  <div style="display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 8px; padding-bottom: 14px; border-bottom: 1px solid var(--line); margin-bottom: 14px;">
                      <div><span style="color: var(--muted); display: block;">Updated</span><strong class="text-green" id="bulkResultUpdated" style="font-size: 20px;"></strong></div>
                      <div><span style="color: var(--muted); display: block;">Skipped</span><strong class="text-amber" id="bulkResultSkipped" style="font-size: 20px;"></strong></div>
                      <div><span style="color: var(--muted); display: block;">Failed</span><strong class="text-red" id="bulkResultFailed" style="font-size: 20px;"></strong></div>
                  </div>
                  <strong style="color: var(--muted); display: block; margin-bottom: 8px;">Skipped Units Detail:</strong>
                  <div id="bulkResultSkippedList" style="max-height: 160px; overflow-y: auto; font-size: 13px; color: var(--muted); background: #111821; padding: 10px; border-radius: 6px; border: 1px solid var(--line);"></div>
              </div>
              <div class="modal-footer">
                  <button type="button" class="primary" id="bulkResultCloseBtn">Close</button>
              </div>
          </div>
      </div>
  `;
  policiesView.insertAdjacentHTML('beforeend', toolsHtml);

  document.getElementById("chkUpdatePrice")?.addEventListener("change", (e) => {
    const input = document.getElementById("bulkUpdatePrice");
    if (input) input.required = e.target.checked;
  });

  document.getElementById("chkUpdateQty")?.addEventListener("change", (e) => {
    const input = document.getElementById("bulkUpdateQty");
    if (input) input.required = e.target.checked;
  });

  document.getElementById("bulkUpdateUnitSearch")?.addEventListener("input", renderBulkUpdateUnits);

  document.getElementById("bulkUpdateUnitList")?.addEventListener("change", (e) => {
    if (e.target.classList.contains("bulk-unit-cb")) {
      if (e.target.checked) window.ManagementToolsContext.selectedUnits.add(e.target.value);
      else window.ManagementToolsContext.selectedUnits.delete(e.target.value);
    }
  });

  document.getElementById("bulkUpdateSelectAllBtn")?.addEventListener("click", () => {
    const search = (document.getElementById("bulkUpdateUnitSearch")?.value || "").toLowerCase();
    document.querySelectorAll(".bulk-unit-cb").forEach(cb => {
      if(cb.value.toLowerCase().includes(search)) {
        cb.checked = true;
        window.ManagementToolsContext.selectedUnits.add(cb.value);
      }
    });
  });

  document.getElementById("bulkUpdateClearBtn")?.addEventListener("click", () => {
    const search = (document.getElementById("bulkUpdateUnitSearch")?.value || "").toLowerCase();
    document.querySelectorAll(".bulk-unit-cb").forEach(cb => {
       if(cb.value.toLowerCase().includes(search)) {
          cb.checked = false;
          window.ManagementToolsContext.selectedUnits.delete(cb.value);
       }
    });
  });

  document.getElementById("bulkUpdateForm")?.addEventListener("submit", (e) => {
    e.preventDefault();
    const item = document.getElementById("bulkUpdateItemSelect").value;
    const priceStr = document.getElementById("bulkUpdatePrice").value;
    const qtyStr = document.getElementById("bulkUpdateQty").value;
    
    const updatePrice = document.getElementById("chkUpdatePrice").checked;
    const updateQty = document.getElementById("chkUpdateQty").checked;

    if (!item) return toast("Select an item.");
    if (!updatePrice && !updateQty) return toast("Select at least one update option.");
    if (window.ManagementToolsContext.selectedUnits.size === 0) return toast("Select at least one unit.");

    document.getElementById("bulkConfirmItem").textContent = item;
    
    let updatesTxt = [];
    if (updatePrice) updatesTxt.push(`Price -> ₹${priceStr}`);
    if (updateQty) updatesTxt.push(`Allowed Qty -> ${qtyStr}`);
    document.getElementById("bulkConfirmUpdates").textContent = updatesTxt.join(" | ");
    
    document.getElementById("bulkConfirmUnits").textContent = window.ManagementToolsContext.selectedUnits.size;
    document.getElementById("bulkConfirmMessage").textContent = `This operation will update the selected item's configured values in ${window.ManagementToolsContext.selectedUnits.size} Unit Policies. Other items and policy rules will remain unchanged.`;

    document.getElementById("bulkUpdateConfirmModal").classList.add("show");
  });

  document.getElementById("bulkConfirmCancelBtn")?.addEventListener("click", () => {
    document.getElementById("bulkUpdateConfirmModal").classList.remove("show");
  });

  document.getElementById("bulkConfirmUpdateBtn")?.addEventListener("click", async () => {
    const item = document.getElementById("bulkUpdateItemSelect").value;
    
    const updatePrice = document.getElementById("chkUpdatePrice").checked;
    const updateQty = document.getElementById("chkUpdateQty").checked;
    
    const priceStr = document.getElementById("bulkUpdatePrice").value;
    const qtyStr = document.getElementById("bulkUpdateQty").value;
    
    const units = Array.from(window.ManagementToolsContext.selectedUnits);

    document.getElementById("bulkUpdateConfirmModal").classList.remove("show");

    try {
      startProgress();
      const payload = {
          item_name: item,
          update_price: updatePrice,
          new_price: updatePrice ? Number(priceStr) : undefined,
          update_qty: updateQty,
          new_qty: updateQty ? Number(qtyStr) : undefined,
          units
      };

      const result = await window.uniformManager.bulkUpdatePolicy(payload);
      
      if (updateQty && result.updated > 0) {
          await window.uniformManager.recalculateReviews();
      }

      state = await window.uniformManager.getState({ distributionLimit: typeof distributionLimit !== 'undefined' ? distributionLimit : 1000 });
      stopProgress();

      document.getElementById("bulkResultUpdated").textContent = result.updated;
      document.getElementById("bulkResultSkipped").textContent = result.skipped;
      document.getElementById("bulkResultFailed").textContent = result.failed;
      
      const skippedHtml = result.skippedDetails.map(d => `<div style="margin-bottom: 4px;"><strong>${escapeHtml(d.unit)}</strong>: ${escapeHtml(d.reason)}</div>`).join('') || `<div>None</div>`;
      document.getElementById("bulkResultSkippedList").innerHTML = skippedHtml;

      document.getElementById("bulkUpdateResultModal").classList.add("show");

      document.getElementById("bulkUpdateForm").reset();
      window.ManagementToolsContext.selectedUnits.clear();
      renderManagementToolsSection();
      renderPolicies();

    } catch (error) {
      stopProgress();
      showImportError(error.message || "Bulk update failed.");
    }
  });

  document.getElementById("bulkResultCloseBtn")?.addEventListener("click", () => {
    document.getElementById("bulkUpdateResultModal").classList.remove("show");
  });

  window.ManagementToolsContext.initialized = true;
}

function renderManagementToolsSection() {
  initManagementToolsUI();

  // Aggregate items seamlessly from the master inventory and active policies
  const itemsSet = new Set();
  (state.items || []).forEach(i => { if (i.item_name) itemsSet.add(String(i.item_name).trim()); });
  (state.policies || []).forEach(p => { if (p.item_name) itemsSet.add(String(p.item_name).trim()); });
  if (state.uniformIssueMatrix && Array.isArray(state.uniformIssueMatrix.items)) {
      state.uniformIssueMatrix.items.forEach(i => { if (i) itemsSet.add(String(i).trim()); });
  }

  const sortedItems = Array.from(itemsSet).filter(Boolean).sort((a,b) => a.localeCompare(b));

  const itemSelect = document.getElementById("bulkUpdateItemSelect");
  if (itemSelect) {
    const currentItem = itemSelect.value;
    itemSelect.innerHTML = `<option value="">Select Item...</option>` +
      sortedItems.map(item => `<option value="${escapeHtml(item)}">${escapeHtml(item)}</option>`).join("");
    itemSelect.value = currentItem;
  }

  const units = new Set();
  (state.employees || []).forEach(e => { if (e.unit) units.add(String(e.unit).trim()); });
  (state.policies || []).forEach(p => { if (p.unit) units.add(String(p.unit).trim()); });
  if (state.uniformIssueMatrix && Array.isArray(state.uniformIssueMatrix.rows)) {
    state.uniformIssueMatrix.rows.forEach(r => { if (r.unit) units.add(String(r.unit).trim()); });
  }
  window.ManagementToolsContext.allUnits = [...units].filter(Boolean).sort();
  
  for (const selected of window.ManagementToolsContext.selectedUnits) {
      if (!units.has(selected)) window.ManagementToolsContext.selectedUnits.delete(selected);
  }

  renderBulkUpdateUnits();
}

function renderBulkUpdateUnits() {
  const container = document.getElementById("bulkUpdateUnitList");
  const search = (document.getElementById("bulkUpdateUnitSearch")?.value || "").toLowerCase();

  if (!container) return;

  container.innerHTML = window.ManagementToolsContext.allUnits.filter(u => u.toLowerCase().includes(search)).map(unit => `
    <label style="display: flex; align-items: center; gap: 8px; padding: 4px; cursor: pointer; border-radius: 4px;" class="unit-checkbox-label">
      <input type="checkbox" value="${escapeHtml(unit)}" class="bulk-unit-cb" style="margin-top: 2px;" ${window.ManagementToolsContext.selectedUnits.has(unit) ? 'checked' : ''} />
      <span>${escapeHtml(unit)}</span>
    </label>
  `).join("") || `<div class="empty" style="padding: 4px;">No units found.</div>`;
}