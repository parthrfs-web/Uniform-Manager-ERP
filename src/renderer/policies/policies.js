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
