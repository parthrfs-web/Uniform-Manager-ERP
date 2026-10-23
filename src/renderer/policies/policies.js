let actualPriceData = null;
let actualPriceDraftRows = [];
let pendingActualPriceImport = null;
let actualPriceLoadPromise = null;
let actualPricesEditMode = false;
let selectedAnnualBulkYear = null;
let annualBulkEditing = false;
let annualBulkDrafts = new Map();

function setPolicyEditMode(policyId = null) {
  editingPolicyId = policyId ? String(policyId) : null;
  document.getElementById("savePolicyBtn").textContent = editingPolicyId ? "Update Policy" : "Save Policy";
}

async function refreshReviewQueueAfterPolicyChange() {
  if (typeof window.refreshReviewQueue === "function") await window.refreshReviewQueue();
}

function entitlementOptionValues(type) {
  const options = state.entitlementOptions || {};
  if (type === "items") return options.items || [];
  if (type === "units") return options.units || [];
  if (type === "financialYears") return options.annualFinancialYears || [];
  return [];
}

function requireEntitlementOption(input, type, label) {
  const value = String(input?.value || "").trim();
  const options = entitlementOptionValues(type);
  const match = options.find((option) => String(option).trim().toLowerCase() === value.toLowerCase());
  if (!match) throw new Error(options.length
    ? `Select ${label} from the available database options.`
    : `No ${label.toLowerCase()} options are available in the database.`);
  input.value = String(match);
  return input.value;
}

function annualPolicyKey(itemName) { return String(itemName || '').trim().toLocaleLowerCase(); }

function renderAnnualBulkEditor() {
  const select = document.getElementById('annualBulkFinancialYear');
  const body = document.getElementById('annualBulkPolicyRows');
  if (!select || !body) return;
  const years = entitlementOptionValues('financialYears').map(Number).filter((year) => Number.isInteger(year));
  if (selectedAnnualBulkYear === null || !years.includes(Number(selectedAnnualBulkYear))) selectedAnnualBulkYear = years[0] ?? null;
  select.innerHTML = years.map((year) => `<option value="${year}">FY ${year}-${String((year + 1) % 100).padStart(2, '0')}</option>`).join('');
  select.value = selectedAnnualBulkYear === null ? '' : String(selectedAnnualBulkYear);

  const knownItems = entitlementOptionValues('items');
  const existing = new Map((state.annualPolicies || [])
    .filter((row) => Number(row.financial_year) === Number(selectedAnnualBulkYear))
    .map((row) => [annualPolicyKey(row.item_name), row]));
  body.innerHTML = knownItems.map((itemName) => {
    const row = existing.get(annualPolicyKey(itemName));
    const currentQuantity = Number(row?.allowed_quantity || 0);
    const draftQuantity = annualBulkDrafts.has(annualPolicyKey(itemName)) ? annualBulkDrafts.get(annualPolicyKey(itemName)) : String(currentQuantity);
    const quantityCell = annualBulkEditing
      ? `<input type="number" min="0" step="1" data-annual-bulk-item="${escapeHtml(itemName)}" value="${escapeHtml(draftQuantity)}" aria-label="Allowed quantity for ${escapeHtml(itemName)}">`
      : `<span>${currentQuantity}</span>`;
    return `<tr><td>${escapeHtml(itemName)}</td><td>FY ${escapeHtml(selectedAnnualBulkYear ?? '—')}</td><td>${quantityCell}</td><td>${escapeHtml(row?.status || 'Active')}</td></tr>`;
  }).join('') || `<tr><td colspan="4" class="muted">No recognized items are available yet. Add items to the item master or import a distribution workbook.</td></tr>`;

  document.getElementById('annualBulkEditBtn').hidden = annualBulkEditing;
  document.getElementById('annualBulkSaveBtn').hidden = !annualBulkEditing;
  document.getElementById('annualBulkCancelBtn').hidden = !annualBulkEditing;
  document.getElementById('annualBulkDownloadBtn').disabled = years.length === 0 || knownItems.length === 0;
  document.getElementById('annualBulkUploadBtn').disabled = years.length === 0 || knownItems.length === 0;
  const status = document.getElementById('annualBulkStatus');
  if (status) status.textContent = selectedAnnualBulkYear === null
    ? 'No financial year is available.'
    : `${knownItems.length} recognized item(s) for FY ${selectedAnnualBulkYear}. Edit quantities together and save once.`;
}

async function loadActualPriceData(force = false) {
  if (actualPriceData && !force) return actualPriceData;
  if (!window.uniformManager?.getActualPriceData) return null;
  if (actualPriceLoadPromise && !force) return actualPriceLoadPromise;
  actualPriceLoadPromise = (async () => {
    actualPriceData = await window.uniformManager.getActualPriceData();
    actualPriceDraftRows = (actualPriceData.prices || []).map((row) => ({ item_name: row.item_name, actual_price: String(row.actual_price), existing: true }));
    renderActualPriceTable();
    return actualPriceData;
  })();
  try { return await actualPriceLoadPromise; }
  finally { actualPriceLoadPromise = null; }
}
window.refreshActualPriceData = async function () {
  actualPriceData = null;
  return loadActualPriceData(true);
};

function renderActualPriceTable() {
  const body = document.getElementById('actualPriceRows');
  if (!body) return;
  const search = String(document.getElementById('actualPriceSearch')?.value || '').trim().toLowerCase();
  const catalog = actualPriceData?.items || [];
  body.innerHTML = actualPriceDraftRows.map((row, index) => {
    const matches = !search || !row.item_name || row.item_name.toLowerCase().includes(search);
    const itemCell = row.existing
      ? `<td><span>${escapeHtml(row.item_name)}</span></td>`
      : `<td><select class="actual-price-item" aria-label="Select item"><option value="">Select item…</option>${catalog.map((item) => `<option value="${escapeHtml(item)}" ${item.toLowerCase() === row.item_name.toLowerCase() ? 'selected' : ''}>${escapeHtml(item)}</option>`).join('')}</select></td>`;
    const disabled = actualPricesEditMode ? '' : 'disabled';
    return `<tr data-actual-price-index="${index}" style="${matches ? '' : 'display:none;'}">${itemCell.replace('<select ', `<select ${disabled} `)}<td><input class="actual-price-value" type="number" min="0" step="0.01" required ${disabled} value="${escapeHtml(row.actual_price)}" aria-label="Actual Price for ${escapeHtml(row.item_name || 'new item')}"></td><td>${row.existing ? 'Configured' : 'New'}</td><td>${row.existing ? '—' : `<button type="button" class="secondary" data-remove-actual-price-row ${actualPricesEditMode ? '' : 'disabled'}>Remove</button>`}</td></tr>`;
  }).join('') || `<tr><td colspan="4" class="muted">No Actual Prices configured yet. Use Add Item Price or Bulk Import Actual Prices.</td></tr>`;
}

async function exportActualPriceFile(kind) {
  try {
    const result = await window.uniformManager.exportActualPrices(kind);
    if (!result?.canceled && typeof toast === 'function') toast(kind === 'template' ? 'Actual Price template saved.' : 'Actual Prices exported.');
  } catch (error) { showImportError(error.message || 'Could not export Actual Prices.'); }
}

function closeActualPriceImport() {
  const backdrop = document.getElementById('actualPriceImportBackdrop');
  if (backdrop) { backdrop.classList.remove('show'); backdrop.setAttribute('aria-hidden', 'true'); }
  pendingActualPriceImport = null;
}
window.closeActualPriceImport = closeActualPriceImport;

function renderActualPriceImportPreview(importResult) {
  pendingActualPriceImport = importResult;
  const preview = importResult.preview;
  document.getElementById('actualPriceImportSummary').textContent = `${importResult.fileName}: ${preview.valid_count} valid row(s), ${preview.invalid_count} invalid row(s). Global Actual Prices apply per item.`;
  document.getElementById('actualPriceImportRows').innerHTML = preview.rows.map((row) => `<tr>
    <td>${Number(row.row_number)}</td><td>${escapeHtml(row.item_name || '')}</td><td>${escapeHtml(row.unit || '—')}</td>
    <td>${row.existing_price === null ? '—' : formatCompactMoney(row.existing_price)}</td>
    <td>${row.imported_price === null ? '—' : formatCompactMoney(row.imported_price)}</td><td>${escapeHtml(row.action)}</td>
    <td>${row.valid ? '<span class="text-green">Valid</span>' : '<span class="text-red">Invalid</span>'}</td><td>${escapeHtml(row.error_message || '')}</td>
  </tr>`).join('');
  document.getElementById('actualPriceImportMessage').textContent = 'Confirm to commit valid rows. Invalid rows will be reported and rejected.';
  document.getElementById('confirmActualPriceImport').disabled = preview.valid_count === 0;
  const backdrop = document.getElementById('actualPriceImportBackdrop');
  backdrop.classList.add('show'); backdrop.setAttribute('aria-hidden', 'false');
}

async function refreshEntitlementsStateAfterFailure() {
  try {
    state = await window.uniformManager.getState({ distributionLimit });
    render();
    setView("policies");
  } catch (_) {
    // Keep the original operation error visible if the refresh also fails.
  }
}

function renderPolicies() {
  const modeSelect = document.getElementById("reviewCalculationMode");
  if (modeSelect) modeSelect.value = state.reviewQueueCalculationMode || "item_annual";
  const modeStatus = document.getElementById("reviewCalculationModeStatus");
  if (modeStatus) modeStatus.textContent = `Current mode: ${({ item_annual: "Item-wise Annual", unit_wise: "Unit-wise", combined: "Combined (Both)" })[modeSelect?.value || state.reviewQueueCalculationMode] || "Item-wise Annual"}`;

  const annualPolicies = state.annualPolicies || [];
  renderTableRows("annualPolicyRows", annualPolicies, (row) => `
    <tr><td>${text(row.item_name)}</td><td>FY ${text(row.financial_year)}</td><td>${text(row.allowed_quantity)}</td><td>${text(row.status)}</td>
      <td><div class="row-actions"><button data-edit-annual-policy="${row.id}">Edit</button><button class="danger" data-delete-annual-policy="${row.id}">Delete</button></div></td></tr>
  `, "No annual item policies configured.", 5);
  renderAnnualBulkEditor();

  const suggestions = state.missingPolicySuggestions || [];
  renderTableRows("missingPolicyRows", suggestions, (row) => `
    <tr>
      <td>All Units</td>
      <td>${text(row.item_name)}</td>
      <td>${Number(row.financial_year) >= 1900 && Number(row.financial_year) <= 9998 ? `FY ${text(row.financial_year)}-${String((Number(row.financial_year) + 1) % 100).padStart(2, "0")}` : "Unknown FY"}</td>
      <td>${text(row.case_count)}</td>
      <td>${text(row.sample_employee_code)} - ${text(row.sample_employee_name)}</td>
      <td>
        <button
          data-use-missing-annual-policy="1"
          data-fy="${Number(row.financial_year) >= 1900 && Number(row.financial_year) <= 9998 ? Number(row.financial_year) : ""}"
          data-item="${escapeHtml(row.item_name || "")}"
          data-case-count="${Number(row.case_count) || 0}"
          data-sample-employee-code="${escapeHtml(row.sample_employee_code || "")}"
          data-suggestion-fingerprint="${escapeHtml(row.suggestion_fingerprint || "")}">
          Create Annual Policy
        </button>
      </td>
    </tr>
  `, "No missing annual policy suggestions.", 6);

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
  if (!actualPriceData) loadActualPriceData().catch((error) => {
    const status = document.getElementById('actualPricesStatus');
    if (status) status.textContent = error.message || 'Could not load Actual Prices.';
  });
}

document.getElementById("policySearch")?.addEventListener("input", (event) => {
  policySearch = event.target.value;
  renderPolicies();
});

document.getElementById('annualBulkFinancialYear')?.addEventListener('change', (event) => {
  if (annualBulkEditing && annualBulkDrafts.size && !confirm('Discard unsaved annual quantity edits?')) {
    event.target.value = String(selectedAnnualBulkYear ?? '');
    return;
  }
  selectedAnnualBulkYear = Number(event.target.value) || null;
  annualBulkEditing = false;
  annualBulkDrafts.clear();
  document.getElementById('annualBulkErrors').hidden = true;
  renderAnnualBulkEditor();
});

document.getElementById('annualBulkEditBtn')?.addEventListener('click', () => {
  if (selectedAnnualBulkYear === null) return;
  annualBulkDrafts.clear();
  annualBulkEditing = true;
  document.getElementById('annualBulkErrors').hidden = true;
  renderAnnualBulkEditor();
});

document.getElementById('annualBulkCancelBtn')?.addEventListener('click', () => {
  annualBulkEditing = false;
  annualBulkDrafts.clear();
  document.getElementById('annualBulkErrors').hidden = true;
  renderAnnualBulkEditor();
});

document.getElementById('annualBulkPolicyRows')?.addEventListener('input', (event) => {
  const input = event.target.closest('[data-annual-bulk-item]');
  if (!input) return;
  annualBulkDrafts.set(annualPolicyKey(input.dataset.annualBulkItem), input.value);
});

document.getElementById('annualBulkSaveBtn')?.addEventListener('click', async () => {
  const errorBox = document.getElementById('annualBulkErrors');
  const items = entitlementOptionValues('items');
  const rows = [...annualBulkDrafts.entries()].map(([key, allowed_quantity]) => ({
    item_name: items.find((item) => annualPolicyKey(item) === key) || '', allowed_quantity,
  })).filter((row) => row.item_name);
  if (!rows.length) {
    errorBox.textContent = 'No quantities were changed.';
    errorBox.hidden = false;
    return;
  }
  const invalid = rows.flatMap((row) => {
    const value = row.allowed_quantity === '' ? NaN : Number(row.allowed_quantity);
    return !Number.isInteger(value) || value < 0 ? [`${row.item_name}: enter a non-negative whole quantity.`] : [];
  });
  if (invalid.length) {
    errorBox.textContent = invalid.join('\n');
    errorBox.hidden = false;
    return;
  }
  errorBox.hidden = true;
  const button = document.getElementById('annualBulkSaveBtn');
  button.disabled = true;
  try {
    startProgress();
    const result = await window.uniformManager.bulkUpdateAnnualPolicies({ financial_year: selectedAnnualBulkYear, rows });
    state = result.state;
    if (result.recalculationRequired) await refreshReviewQueueAfterPolicyChange();
    stopProgress();
    annualBulkEditing = false;
    annualBulkDrafts.clear();
    render();
    setView('policies');
    const status = document.getElementById('annualBulkStatus');
    if (status) status.textContent = `Saved ${result.saved} item quantity row(s) for FY ${selectedAnnualBulkYear}; ${result.changed} changed, ${result.inserted} created. ${result.recalculationRequired ? `Review Queue recalculated (${result.generated} new pending group(s)).` : 'No review recalculation was needed.'}`;
    toast('Annual item quantities saved.');
  } catch (error) {
    stopProgress();
    errorBox.textContent = error.message || 'Annual item quantities could not be saved.';
    errorBox.hidden = false;
    await refreshEntitlementsStateAfterFailure();
  } finally {
    button.disabled = false;
  }
});

document.getElementById('annualBulkDownloadBtn')?.addEventListener('click', () => {
  const year = selectedAnnualBulkYear;
  if (year === null) return;
  const policies = new Map((state.annualPolicies || []).filter((row) => Number(row.financial_year) === year)
    .map((row) => [annualPolicyKey(row.item_name), Number(row.allowed_quantity || 0)]));
  const csvCell = (value) => `"${String(value ?? '').replace(/"/g, '""')}"`;
  const content = [['Item', 'Allowed Quantity'], ...entitlementOptionValues('items').map((item) => [item, policies.get(annualPolicyKey(item)) ?? 0])]
    .map((row) => row.map(csvCell).join(',')).join('\r\n');
  const url = URL.createObjectURL(new Blob([`\uFEFF${content}`], { type: 'text/csv;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = `annual-item-entitlements-FY-${year}.csv`;
  link.click();
  URL.revokeObjectURL(url);
});

document.getElementById('annualBulkUploadBtn')?.addEventListener('click', () => document.getElementById('annualBulkCsvInput')?.click());
document.getElementById('annualBulkCsvInput')?.addEventListener('change', async (event) => {
  const file = event.target.files?.[0];
  event.target.value = '';
  if (!file) return;
  const errorBox = document.getElementById('annualBulkErrors');
  try {
    const validation = window.AnnualPolicyCsv.validate(await file.text(), entitlementOptionValues('items'));
    if (validation.errors.length) throw new Error(validation.errors.join('\n'));
    annualBulkDrafts = new Map(validation.rows.map((row) => [annualPolicyKey(row.item_name), row.allowed_quantity]));
    annualBulkEditing = true;
    errorBox.hidden = true;
    renderAnnualBulkEditor();
    const status = document.getElementById('annualBulkStatus');
    if (status) status.textContent = `Loaded ${validation.rows.length} validated item quantity row(s) from ${file.name}; review and save to apply.`;
  } catch (error) {
    errorBox.textContent = error.message || 'Could not load annual quantity CSV.';
    errorBox.hidden = false;
  }
});

document.getElementById('actualPriceSearch')?.addEventListener('input', renderActualPriceTable);
document.getElementById('bulkEditActualPrices')?.addEventListener('click', () => {
  actualPricesEditMode = !actualPricesEditMode;
  const button = document.getElementById('bulkEditActualPrices');
  if (button) button.textContent = actualPricesEditMode ? 'Stop Editing' : 'Bulk Edit';
  const save = document.getElementById('saveActualPrices');
  if (save) save.disabled = !actualPricesEditMode;
  const status = document.getElementById('actualPricesStatus');
  if (status) status.textContent = actualPricesEditMode ? 'Edit multiple prices, then select Save Changes.' : 'Bulk edit cancelled.';
  renderActualPriceTable();
});
document.getElementById('addActualPriceRow')?.addEventListener('click', async () => {
  try { await loadActualPriceData(); actualPricesEditMode = true; document.getElementById('bulkEditActualPrices').textContent = 'Stop Editing'; document.getElementById('saveActualPrices').disabled = false; actualPriceDraftRows.push({ item_name: '', actual_price: '', existing: false }); renderActualPriceTable(); }
  catch (error) { showImportError(error.message || 'Could not load item options.'); }
});
document.getElementById('actualPriceRows')?.addEventListener('click', (event) => {
  if (!actualPricesEditMode) return;
  const button = event.target.closest('[data-remove-actual-price-row]');
  if (!button) return;
  const row = button.closest('tr');
  actualPriceDraftRows.splice(Number(row.dataset.actualPriceIndex), 1);
  renderActualPriceTable();
});
document.getElementById('actualPriceRows')?.addEventListener('change', (event) => {
  const row = event.target.closest('tr[data-actual-price-index]');
  if (!row) return;
  const draft = actualPriceDraftRows[Number(row.dataset.actualPriceIndex)];
  if (event.target.matches('.actual-price-item')) draft.item_name = event.target.value;
  if (event.target.matches('.actual-price-value')) draft.actual_price = event.target.value;
});
document.getElementById('actualPriceRows')?.addEventListener('input', (event) => {
  if (!event.target.matches('.actual-price-value')) return;
  const row = event.target.closest('tr[data-actual-price-index]');
  if (row) actualPriceDraftRows[Number(row.dataset.actualPriceIndex)].actual_price = event.target.value;
});
document.getElementById('actualPricesForm')?.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (!actualPricesEditMode) return;
  const status = document.getElementById('actualPricesStatus');
  const button = document.getElementById('saveActualPrices');
  const rows = actualPriceDraftRows.map((draft) => ({ item_name: draft.item_name, actual_price: draft.actual_price }))
    .filter((row) => row.item_name || row.actual_price !== '');
  if (!rows.length) { if (status) status.textContent = 'Enter or select at least one item price.'; return; }
  const seen = new Set();
  for (const row of rows) {
    const key = String(row.item_name || '').trim().toLowerCase();
    const price = row.actual_price === '' ? NaN : Number(row.actual_price);
    if (!key || !actualPriceData?.items?.some((item) => item.toLowerCase() === key)) { if (status) status.textContent = 'Select every item from the existing item master.'; return; }
    if (seen.has(key)) { if (status) status.textContent = 'Each item can appear only once in a bulk edit.'; return; }
    if (!Number.isFinite(price) || price < 0) { if (status) status.textContent = 'Every Actual Price must be a valid non-negative number.'; return; }
    seen.add(key);
  }
  button.disabled = true;
  try {
    const result = await window.uniformManager.saveActualItemPrices(rows);
    actualPriceData = result.data;
    actualPriceDraftRows = (actualPriceData.prices || []).map((row) => ({ item_name: row.item_name, actual_price: String(row.actual_price), existing: true }));
    actualPricesEditMode = false;
    document.getElementById('bulkEditActualPrices').textContent = 'Bulk Edit';
    document.getElementById('addActualPriceRow').disabled = false;
    button.disabled = true;
    renderActualPriceTable();
    if (status) status.textContent = `Saved: ${result.inserted} inserted, ${result.updated} updated, ${result.skipped} unchanged, ${result.rejected} rejected.`;
    if (typeof toast === 'function') toast('Actual Item Prices saved. Deduction rates and inventory quantities were not changed.');
  } catch (error) { if (status) status.textContent = error.message || 'Could not save Actual Prices.'; }
  finally { button.disabled = !actualPricesEditMode; }
});
document.getElementById('cancelActualPriceEdits')?.addEventListener('click', () => {
  actualPriceDraftRows = (actualPriceData?.prices || []).map((row) => ({ item_name: row.item_name, actual_price: String(row.actual_price), existing: true }));
  actualPricesEditMode = false;
  document.getElementById('bulkEditActualPrices').textContent = 'Bulk Edit';
  document.getElementById('saveActualPrices').disabled = true;
  document.getElementById('addActualPriceRow').disabled = false;
  renderActualPriceTable();
  const status = document.getElementById('actualPricesStatus'); if (status) status.textContent = 'Unsaved changes cancelled.';
});
document.getElementById('downloadActualPriceTemplate')?.addEventListener('click', () => exportActualPriceFile('template'));
document.getElementById('exportActualPrices')?.addEventListener('click', () => exportActualPriceFile('export'));
document.getElementById('bulkImportActualPrices')?.addEventListener('click', async () => {
  try {
    const result = await window.uniformManager.chooseActualPriceImport();
    if (!result.canceled) renderActualPriceImportPreview(result);
  } catch (error) { showImportError(error.message || 'Actual Price import failed.'); }
});
document.getElementById('confirmActualPriceImport')?.addEventListener('click', async () => {
  if (!pendingActualPriceImport) return;
  const button = document.getElementById('confirmActualPriceImport');
  button.disabled = true;
  try {
    const rows = pendingActualPriceImport.preview.rows.map((row) => ({ item_name: row.item_name, actual_price: row.imported_price, unit: row.unit, row_number: row.row_number }));
    const result = await window.uniformManager.saveActualItemPrices(rows);
    actualPriceData = result.data;
    actualPriceDraftRows = (actualPriceData.prices || []).map((row) => ({ item_name: row.item_name, actual_price: String(row.actual_price), existing: true }));
    actualPricesEditMode = false;
    document.getElementById('bulkEditActualPrices').textContent = 'Bulk Edit';
    document.getElementById('saveActualPrices').disabled = true;
    renderActualPriceTable();
    document.getElementById('actualPriceImportMessage').textContent = `Committed: ${result.inserted} inserted, ${result.updated} updated, ${result.skipped} unchanged, ${result.rejected} rejected.`;
    if (typeof toast === 'function') toast(`Actual Price import complete: ${result.inserted} inserted, ${result.updated} updated, ${result.rejected} rejected.`);
    setTimeout(closeActualPriceImport, 900);
  } catch (error) { document.getElementById('actualPriceImportMessage').textContent = error.message || 'Import commit failed; database changes were rolled back.'; }
  finally { button.disabled = false; }
});
document.addEventListener('click', (event) => {
  if (event.target.closest('[data-close-actual-price-import]') || event.target.id === 'actualPriceImportBackdrop') closeActualPriceImport();
});

document.getElementById("policyForm")?.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!desktopApi) return showImportError("Works only in Desktop App.");
  try {
    const form = event.currentTarget;
    const unit = requireEntitlementOption(form.elements.unit, "units", "a unit/client");
    const itemName = requireEntitlementOption(form.elements.item_name, "items", "an item");
    const policy = {
      id: editingPolicyId || form.elements.id.value || "",
      unit,
      item_name: itemName,
      yearly_entitlement: form.elements.yearly_entitlement.value,
      item_cost: form.elements.item_cost.value,
    };
    startProgress();
    const result = await window.uniformManager.upsertPolicy(policy);
    state = result.state;
    await refreshReviewQueueAfterPolicyChange();
    stopProgress();
    
    selectedPolicyUnit = policy.unit || selectedPolicyUnit;
    setPolicyEditMode(null);
    form.reset();
    render();
    setView("policies");
    toast(`Policy saved. Review queue recalculated: ${result.generated} pending rows.`);
  } catch (error) {
    stopProgress();
    await refreshEntitlementsStateAfterFailure();
    showImportError(error.message || "Policy save failed.");
  }
});

document.getElementById("cancelPolicyEditBtn")?.addEventListener("click", () => {
  setPolicyEditMode(null);
  document.getElementById("policyForm").reset();
  toast("Policy form cleared.");
});

document.getElementById("annualPolicyForm")?.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!desktopApi) return showImportError("Works only in Desktop App.");
  const form = event.currentTarget;
  try {
    const itemName = requireEntitlementOption(form.elements.item_name, "items", "an item");
    const financialYear = requireEntitlementOption(form.elements.financial_year, "financialYears", "a financial year");
    const policy = { id: form.elements.id.value || "", item_name: itemName, financial_year: financialYear, allowed_quantity: form.elements.allowed_quantity.value, status: "Active" };
    startProgress();
    const suggestionContext = form.dataset.missingAnnualSuggestion ? JSON.parse(form.dataset.missingAnnualSuggestion) : null;
    const result = suggestionContext
      ? await window.uniformManager.createAnnualPolicyFromSuggestion({ policy, expected: suggestionContext })
      : await window.uniformManager.upsertAnnualPolicy(policy);
    state = result.state;
    await refreshReviewQueueAfterPolicyChange();
    stopProgress();
    form.reset();
    delete form.dataset.missingAnnualSuggestion;
    render(); setView("policies");
    toast(`Annual policy saved. Review queue recalculated: ${result.generated} pending rows.`);
  } catch (error) { stopProgress(); await refreshEntitlementsStateAfterFailure(); showImportError(error.message || "Annual policy save failed."); }
});

document.getElementById("cancelAnnualPolicyEditBtn")?.addEventListener("click", () => {
  const form = document.getElementById("annualPolicyForm");
  form?.reset();
  if (form) delete form.dataset.missingAnnualSuggestion;
});

document.getElementById("reviewCalculationModeForm")?.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!desktopApi) return showImportError("Works only in Desktop App.");
  const selectedMode = document.getElementById("reviewCalculationMode")?.value || "item_annual";
  try {
    startProgress();
    const result = await window.uniformManager.setReviewQueueCalculationMode(selectedMode);
    state = result.state;
    await refreshReviewQueueAfterPolicyChange();
    stopProgress();
    render();
    setView("policies");
    const modeName = ({ item_annual: "Item-wise Annual", unit_wise: "Unit-wise", combined: "Combined (Both)" })[selectedMode];
    toast(`${modeName} mode applied. Review Queue recalculated: ${result.generated} pending rows.`);
  } catch (error) {
    stopProgress();
    await refreshEntitlementsStateAfterFailure();
    showImportError(error.message || "Calculation mode could not be applied.");
  }
});

document.addEventListener("click", async (event) => {
  const editAnnualButton = event.target.closest("[data-edit-annual-policy]");
  if (editAnnualButton) {
    const policy = (state.annualPolicies || []).find((row) => String(row.id) === editAnnualButton.dataset.editAnnualPolicy);
    if (policy) { const form = document.getElementById("annualPolicyForm"); delete form.dataset.missingAnnualSuggestion; form.elements.id.value = policy.id; form.elements.item_name.value = policy.item_name; form.elements.financial_year.value = policy.financial_year; form.elements.allowed_quantity.value = policy.allowed_quantity; form.elements.item_name.focus(); }
    return;
  }
  const deleteAnnualButton = event.target.closest("[data-delete-annual-policy]");
  if (deleteAnnualButton) {
    const policy = (state.annualPolicies || []).find((row) => String(row.id) === deleteAnnualButton.dataset.deleteAnnualPolicy);
    if (!confirm(`Delete annual policy ${policy?.item_name || ""} FY ${policy?.financial_year || ""}?`)) return;
    try { startProgress(); const result = await window.uniformManager.deleteAnnualPolicy(deleteAnnualButton.dataset.deleteAnnualPolicy); state = result.state; await refreshReviewQueueAfterPolicyChange(); stopProgress(); render(); setView("policies"); toast(`Annual policy deleted. Review queue recalculated: ${result.generated} pending rows.`); }
    catch (error) { stopProgress(); await refreshEntitlementsStateAfterFailure(); showImportError(error.message || "Annual policy delete failed."); }
    return;
  }
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
      startProgress();
      const result = await window.uniformManager.deletePolicy(deletePolicyButton.dataset.deletePolicy);
      state = result.state;
      await refreshReviewQueueAfterPolicyChange();
      stopProgress();
      render();
      toast(`Policy deleted. Review queue recalculated: ${result.generated} pending rows.`);
    } catch (error) {
      stopProgress();
      await refreshEntitlementsStateAfterFailure();
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

  const missingAnnualPolicyButton = event.target.closest("[data-use-missing-annual-policy]");
  if (missingAnnualPolicyButton) {
    const form = document.getElementById("annualPolicyForm");
    if (form) {
      form.reset();
      form.elements.id.value = "";
      form.elements.item_name.value = missingAnnualPolicyButton.dataset.item || "";
      form.elements.financial_year.value = missingAnnualPolicyButton.dataset.fy || "";
      form.elements.allowed_quantity.value = 0;
      form.dataset.missingAnnualSuggestion = JSON.stringify({
        case_count: Number(missingAnnualPolicyButton.dataset.caseCount || 0),
        sample_employee_code: missingAnnualPolicyButton.dataset.sampleEmployeeCode || "",
        suggestion_fingerprint: missingAnnualPolicyButton.dataset.suggestionFingerprint || "",
      });
      form.elements.allowed_quantity.focus();
    }
    setView("policies");
    toast("Enter the annual allowed quantity, then save.");
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
                  <p id="bulkResultReviewStatus" style="margin: 12px 0 0; color: var(--muted);"></p>
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
      state = result.state;
      if (result.recalculated) await refreshReviewQueueAfterPolicyChange();
      stopProgress();

      document.getElementById("bulkResultUpdated").textContent = result.updated;
      document.getElementById("bulkResultSkipped").textContent = result.skipped;
      document.getElementById("bulkResultFailed").textContent = result.failed;
      document.getElementById("bulkResultReviewStatus").textContent = result.recalculated
        ? `Review Queue recalculated successfully (${result.generated} new pending review group(s)).`
        : "No review-affecting policy rows changed; recalculation was not needed.";
      
      const skippedHtml = result.skippedDetails.map(d => `<div style="margin-bottom: 4px;"><strong>${escapeHtml(d.unit)}</strong>: ${escapeHtml(d.reason)}</div>`).join('') || `<div>None</div>`;
      document.getElementById("bulkResultSkippedList").innerHTML = skippedHtml;

      document.getElementById("bulkUpdateResultModal").classList.add("show");

      document.getElementById("bulkUpdateForm").reset();
      window.ManagementToolsContext.selectedUnits.clear();
      renderManagementToolsSection();
      renderPolicies();

    } catch (error) {
      stopProgress();
      await refreshEntitlementsStateAfterFailure();
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
