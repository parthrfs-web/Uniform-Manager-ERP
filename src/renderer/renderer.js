let state = null;
let employeeFilter = "";
let pendingInspection = null;
let selectedSheetName = null;
let editingPolicyId = null;
let editingItemId = null;
let reviewFilter = "All";
let pendingReviewDecision = null;
let selectedPolicyUnit = null;
let policySearch = "";
let distributionLimit = 20000;
let pendingDistributionEdit = null;
let currentPreviewData = null;
let selectedReviewEmployee = null;

const desktopApi = window.uniformManager;

const views = {
  dashboard: ["Dashboard", "Import distribution data and review excess uniform cases."],
  import: ["Import Excel", "Inspect workbook sheets before importing distribution data."],
  employees: ["Employees", "Search and review imported employee records."],
  issues: ["Distribution Register", "Employee-wise uniform quantity matrix."],
  deductions: ["Salary Deductions", "Payroll deduction and waive records created from review decisions."],
  review: ["Review Queue", "Resolve records that need office staff attention."],
  policies: ["Unit Entitlements", "Set allowed uniform quantity for each unit/company and item."],
  reset: ["Reset Data", "Clear imported operational data only after confirmation."],
};

function text(value) {
  return value === null || value === undefined || value === "" ? "-" : String(value);
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[char]);
}

function toast(message) {
  const el = document.getElementById("toast");
  el.textContent = message;
  el.classList.add("show");
  setTimeout(() => el.classList.remove("show"), 3600);
}

function showImportError(message) {
  const panel = document.getElementById("importError");
  panel.textContent = message;
  panel.classList.add("show");
  setView("dashboard");
}

function clearImportError() {
  const panel = document.getElementById("importError");
  panel.textContent = "";
  panel.classList.remove("show");
}

function setImporting(isImporting) {
  const button = document.getElementById("importBtn");
  button.disabled = isImporting;
  button.textContent = isImporting ? "Importing..." : "Import Excel";
}

function showImportModal(inspection) {
  pendingInspection = inspection;
  selectedSheetName = inspection.candidates.find((candidate) => candidate.canImport)?.sheetName || null;
  document.getElementById("importModalSubtitle").textContent =
    `${inspection.fileName} - review all sheets before importing.`;
  renderSheetCandidates();
  document.getElementById("importModal").classList.add("show");
}

function hideImportModal() {
  document.getElementById("importModal").classList.remove("show");
}

function showEmployeeModal(employee) {
  const form = document.getElementById("employeeForm");
  ["employee_code", "employee_name", "father_name", "unit", "godown", "mobile_number", "designation", "status"].forEach((field) => {
    form.elements[field].value = employee[field] || "";
  });
  document.getElementById("employeeModal").classList.add("show");
}

function hideEmployeeModal() {
  document.getElementById("employeeModal").classList.remove("show");
}

function showReviewDecisionModal(review, status) {
  pendingReviewDecision = { review, status };
  const labels = {
    Waived: "Waive Off",
    Hold: "Hold",
    Deduct: "Deduct From Salary",
  };
  const form = document.getElementById("reviewDecisionForm");
  form.reset();
  form.elements.id.value = review.id;
  form.elements.status.value = status;
  document.getElementById("reviewDecisionTitle").textContent = labels[status] || "Review Decision";
  document.getElementById("decisionByLabel").textContent = status === "Waived" ? "Waived By" : status === "Hold" ? "Held By" : "Approved By";
  document.getElementById("reviewDecisionSubtitle").textContent =
    `${review.employee_code} - ${review.employee_name} | ${review.category}: ${review.reason}`;
  form.elements.reason.required = status === "Waived" || status === "Deduct";
  document.getElementById("reviewDecisionModal").classList.add("show");
}

function hideReviewDecisionModal() {
  pendingReviewDecision = null;
  document.getElementById("reviewDecisionModal").classList.remove("show");
}

function distributionKey(row) {
  return {
    employee_code: row.employee_code,
    unit: row.unit || "",
    godown: row.godown || "",
    issue_month: row.issue_month || null,
    issue_year: row.issue_year || null,
    issue_period_label: row.issue_period_label || "",
  };
}

function showDistributionModal(row) {
  pendingDistributionEdit = row;
  document.getElementById("distributionModalTitle").textContent = `${row.employee_code} - ${row.employee_name}`;
  document.getElementById("distributionModalSubtitle").textContent =
    `${row.issue_period_label || (row.issue_month && row.issue_year ? `${row.issue_month}/${row.issue_year}` : "No period")} | ${row.unit || "-"} | ${row.godown || "-"}`;
  document.getElementById("distributionQuantityFields").innerHTML = (state.uniformIssueMatrix?.items || []).map((item) => `
    <label>${escapeHtml(item)}<input name="${escapeHtml(item)}" type="number" min="0" step="0.01" value="${Number(row.quantities?.[item] || 0)}" /></label>
  `).join("");
  document.getElementById("distributionModal").classList.add("show");
}

function hideDistributionModal() {
  pendingDistributionEdit = null;
  document.getElementById("distributionModal").classList.remove("show");
}

function setPolicyEditMode(policyId = null) {
  editingPolicyId = policyId ? String(policyId) : null;
  document.getElementById("savePolicyBtn").textContent = editingPolicyId ? "Update Policy" : "Save Policy";
}

function setItemEditMode(itemId = null) {
  editingItemId = itemId ? String(itemId) : null;
  document.getElementById("saveItemBtn").textContent = editingItemId ? "Update Item" : "Save Item";
}

function formatObject(value) {
  return escapeHtml(JSON.stringify(value, null, 2));
}

function renderSheetCandidates() {
  const list = document.getElementById("sheetCandidates");
  const confirm = document.getElementById("confirmImportBtn");
  confirm.disabled = !selectedSheetName;
  list.innerHTML = pendingInspection.candidates.map((candidate, index) => {
    const checked = candidate.sheetName === selectedSheetName ? "checked" : "";
    const disabled = candidate.canImport ? "" : "disabled";
    const classes = [
      "candidate",
      candidate.sheetName === selectedSheetName ? "selected" : "",
      candidate.canImport ? "" : "disabled",
    ].filter(Boolean).join(" ");
    const reasons = candidate.reasons.length ? candidate.reasons.join("; ") : "No recognizable import pattern found.";
    const sample = candidate.sampleRows.length ? formatObject(candidate.sampleRows) : "No employee-like sample rows detected.";
    const items = candidate.itemColumns?.length ? candidate.itemColumns.map((item) => item.itemName).join(", ") : "No uniform item columns detected.";
    return `
      <article class="${classes}">
        <div class="candidate-top">
          <label class="candidate-title">
            <input type="radio" name="sheetCandidate" value="${escapeHtml(candidate.sheetName)}" ${checked} ${disabled} />
            <span>${index + 1}. ${escapeHtml(candidate.sheetName)}</span>
          </label>
          <div class="candidate-meta">
            Score ${candidate.score} | Rows ${candidate.likelyRows} | Header row ${candidate.headerRow || "-"}
          </div>
        </div>
        <div class="candidate-grid">
          <div>
            <strong>Detected Columns</strong>
          <pre>${formatObject(candidate.columns)}</pre>
          </div>
          <div>
            <strong>Sample Rows</strong>
            <pre>${sample}</pre>
          </div>
        </div>
        <p class="candidate-meta"><strong>Uniform item columns:</strong> ${escapeHtml(items)}</p>
        <p class="candidate-meta">${escapeHtml(reasons)}</p>
      </article>
    `;
  }).join("");
}

function setView(name) {
  if (!views[name]) return;
  document.querySelectorAll(".view").forEach((el) => el.classList.toggle("active", el.id === name));
  document.querySelectorAll(".nav-button").forEach((el) => el.classList.toggle("active", el.dataset.view === name));
  document.getElementById("viewTitle").textContent = views[name][0];
  document.getElementById("viewSubtitle").textContent = views[name][1];
}

function render() {
  if (!state) return;
  document.getElementById("dbPath").textContent = state.dbPath || "Unknown";
  
  // Safe Array Length checks
  document.getElementById("employeeCount").textContent = Array.isArray(state.employees) ? state.employees.length : 0;
  document.getElementById("deductionTotal").textContent = `Rs. ${(Array.isArray(state.salaryDeductions) ? state.salaryDeductions : []).reduce((sum, row) => sum + Number(row.amount || 0), 0).toFixed(2)}`;
  
  const matrixRows = state.uniformIssueMatrix?.rows;
  document.getElementById("issueCount").textContent = state.uniformIssueMatrix?.totalRows ?? (Array.isArray(matrixRows) ? matrixRows.length : 0);
  
  const pendingReviews = Array.isArray(state.reviews) ? state.reviews.filter((r) => r.status === "Pending").length : 0;
  document.getElementById("reviewCount").textContent = state.reviewPendingCount ?? pendingReviews;

  renderLatestImport();
  renderEmployees();
  renderIssues();
  renderDeductions();
  renderReviews();
  renderPolicies();
  renderItems();
}

function renderLatestImport() {
  const latest = state.imports[0];
  const box = document.getElementById("lastImport");
  if (!latest) {
    box.className = "empty";
    box.textContent = "No workbook imported yet.";
    return;
  }
  box.className = "";
  const issueCount = Number(state.uniformIssueCount || state.uniformIssues.filter((row) => row.import_id === latest.id && Number(row.quantity || 0) > 0).length);
  box.innerHTML = `
    <strong>${text(latest.file_name)}</strong>
    <p>Detected sheet: <b>${text(latest.selected_sheet)}</b>. Employees inserted ${latest.inserted_count}, updated ${latest.updated_count}, skipped ${latest.skipped_count} from ${latest.total_rows} rows. Uniform item entries captured: ${issueCount}.</p>
  `;
}

function employeeMatches(row) {
  const haystack = [row.employee_code, row.employee_name, row.father_name, row.unit, row.godown, row.mobile_number]
    .join(" ")
    .toLowerCase();
  return haystack.includes(employeeFilter.toLowerCase());
}

function renderEmployees() {
  const rows = state.employees.filter(employeeMatches);
  document.getElementById("employeeRows").innerHTML = rows.map((row) => `
    <tr>
      <td>${text(row.employee_code)}</td>
      <td>${text(row.employee_name)}</td>
      <td>${text(row.father_name)}</td>
      <td>${text(row.unit)}</td>
      <td>${text(row.godown)}</td>
      <td>${text(row.mobile_number)}</td>
      <td>${text(row.designation)}</td>
      <td><span class="badge">${text(row.status)}</span></td>
      <td>
        <div class="row-actions">
          <button data-edit-employee="${escapeHtml(row.employee_code)}">Edit</button>
          <button class="danger" data-delete-employee="${escapeHtml(row.employee_code)}">Delete</button>
        </div>
      </td>
    </tr>
  `).join("") || `<tr><td colspan="9" class="empty">No employee records found.</td></tr>`;
}

function renderIssues() {
  const matrix = state.uniformIssueMatrix || { items: [], rows: [] };
  document.getElementById("distributionVisibleCount").textContent = matrix.totalRows && matrix.totalRows !== matrix.rows.length
    ? `${matrix.rows.length} of ${matrix.totalRows}`
    : matrix.rows.length;
  document.getElementById("distributionEntryCount").textContent = Number(state.uniformIssueCount || state.uniformIssues.filter((row) => Number(row.quantity || 0) > 0).length);
  document.getElementById("distributionItemCount").textContent = matrix.items.length;
  document.getElementById("loadMoreDistributionBtn").disabled = matrix.rows.length >= Number(matrix.totalRows || 0);
  document.getElementById("loadAllDistributionBtn").disabled = matrix.rows.length >= Number(matrix.totalRows || 0);
  document.getElementById("issueMatrixHead").innerHTML = `
    <tr>
      <th>Employee Code</th>
      <th>Name</th>
      <th>Period</th>
      <th>Unit</th>
      <th>Godown</th>
      <th>Status</th>
      ${matrix.items.map((item) => `<th>${escapeHtml(item)}</th>`).join("")}
      <th>Allowed Qty</th>
      <th>Excess Qty</th>
      <th>Total Qty</th>
      <th>Actions</th>
    </tr>
  `;
  document.getElementById("issueSummaryRows").innerHTML = matrix.rows.map((row, index) => `
    <tr>
      <td>${text(row.employee_code)}</td>
      <td>${text(row.employee_name)}</td>
      <td>${text(row.issue_period_label || (row.issue_month && row.issue_year ? `${row.issue_month}/${row.issue_year}` : ""))}</td>
      <td>${text(row.unit)}</td>
      <td>${text(row.godown)}</td>
      <td><span class="badge ${escapeHtml(row.entitlement_status || "OK")}">${text(row.entitlement_status || "OK")}</span></td>
      ${matrix.items.map((item) => {
        const entitlement = row.entitlements?.[item] || {};
        const issued = Number(row.quantities?.[item] || 0);
        const allowed = entitlement.allowed;
        const label = allowed === null || allowed === undefined
          ? `${issued} / No Policy`
          : issued
            ? `${issued} / ${allowed}`
            : "0";
        return `<td><span class="qty-cell ${escapeHtml(entitlement.status || "None")}">${escapeHtml(label)}</span></td>`;
      }).join("")}
      <td>${Number(row.total_allowed || 0)}</td>
      <td>${Number(row.total_excess || 0)}</td>
      <td>${Number(row.total_quantity || 0)}</td>
      <td>
        <div class="row-actions">
          <button data-edit-distribution="${index}">Edit</button>
          <button class="danger" data-delete-distribution="${index}">Delete</button>
        </div>
      </td>
    </tr>
  `).join("") || `<tr><td colspan="${9 + matrix.items.length}" class="empty">No employee distribution data available yet.</td></tr>`;
}

function renderItems() {
  const itemRowsBody = document.getElementById("itemRows");
  if (itemRowsBody && state.items) {
    itemRowsBody.innerHTML = state.items.map((row) => `
      <tr>
        <td>${text(row.item_code)}</td>
        <td>${text(row.item_name)}</td>
        <td>${text(row.category)}</td>
        <td>${text(row.size)}</td>
        <td>Rs. ${Number(row.cost || 0).toFixed(2)}</td>
        <td><span class="badge ${Number(row.is_low_stock) === 1 ? "low" : ""}">${text(row.available_stock)}</span></td>
        <td>${text(row.minimum_stock)}</td>
        <td>${text(row.status)}</td>
        <td>
          <div class="row-actions">
            <button data-edit-item="${row.id}">Edit</button>
            <button class="danger" data-delete-item="${row.id}">Delete</button>
          </div>
        </td>
      </tr>
    `).join("") || `<tr><td colspan="9" class="empty">No item records found.</td></tr>`;
  }

  const movementRowsBody = document.getElementById("movementRows");
  if (movementRowsBody && state.stockMovements) {
    movementRowsBody.innerHTML = state.stockMovements.map((row) => `
      <tr>
        <td>${text(row.item_name)}</td>
        <td>${text(row.movement_type)}</td>
        <td>${text(row.quantity)}</td>
        <td>${text(row.reference_type)} #${text(row.reference_id)}</td>
        <td>${text(row.notes)}</td>
        <td>${text(row.created_at)}</td>
      </tr>
    `).join("") || `<tr><td colspan="6" class="empty">No stock movement records yet.</td></tr>`;
  }
}

function renderDeductions() {
  document.getElementById("deductionRows").innerHTML = state.salaryDeductions.map((row) => `
    <tr>
      <td>${text(row.created_at)}</td>
      <td>${text(row.employee_code)}</td>
      <td>${text(row.employee_name)}</td>
      <td>${text(row.unit)}</td>
      <td>${text(row.issue_period_label || (row.issue_month && row.issue_year ? `${row.issue_month}/${row.issue_year}` : ""))}</td>
      <td>Rs. ${Number(row.amount || 0).toFixed(2)}</td>
      <td class="reason">${text(row.reason)}</td>
      <td class="reason">
        ${row.pdf_path ? `
          <div class="report-cell">
            <button data-open-report="${escapeHtml(row.pdf_path)}">Open PDF</button>
            <span>${escapeHtml(row.pdf_path)}</span>
          </div>
        ` : "-"}
      </td>
    </tr>
  `).join("") || `<tr><td colspan="8" class="empty">No salary deductions created yet. Use Deduct From Salary in Review Queue.</td></tr>`;

  document.getElementById("waiveRows").innerHTML = state.waiveRecords.map((row) => `
    <tr>
      <td>${text(row.created_at)}</td>
      <td>#${text(row.review_id)}</td>
      <td>${text(row.employee_code)}</td>
      <td>${text(row.employee_name)}</td>
      <td>${text(row.unit)}</td>
      <td>${text(row.remarks)}</td>
      <td class="reason">${text(row.reason)}</td>
    </tr>
  `).join("") || `<tr><td colspan="7" class="empty">No waive records created yet. Use Waive in Review Queue.</td></tr>`;
}

function decisionButtons(row) {
  if (row.status !== "Pending") return text(row.remarks);
  return `
    <div class="decision-buttons">
      <button data-review="${row.id}" data-status="Waived">Waive Off</button>
      <button data-review="${row.id}" data-status="Hold">Hold</button>
      <button data-review="${row.id}" data-status="Deduct">Deduct From Salary</button>
      <button class="danger" data-delete-review="${row.id}">Delete</button>
    </div>
  `;
}

async function renderReviewStage1() {
  document.getElementById("reviewStage1").style.display = "block";
  document.getElementById("reviewStage2").style.display = "none";
  document.getElementById("reviewStage3").style.display = "none";
  try {
    const summary = await window.uniformManager.getReviewQueueStage1();
    document.getElementById("reviewStage1Rows").innerHTML = summary.map(emp => `
      <tr class="clickable" onclick="loadReviewStage2('${escapeHtml(emp.employee_code)}', '${escapeHtml(emp.employee_name)}')">
        <td>${text(emp.employee_code)}</td>
        <td>${text(emp.employee_name)}</td>
        <td>${text(emp.current_unit)}</td>
        <td>${text(emp.payroll_month)}</td>
        <td>${text(emp.pending_item_count)}</td>
        <td>Rs. ${Number(emp.estimated_deduction || 0).toFixed(2)}</td>
      </tr>
    `).join("") || `<tr><td colspan="6" class="empty">No pending reviews.</td></tr>`;
  } catch (error) {
    showImportError(error.message || "Failed to load review summary.");
  }
}

async function loadReviewStage2(employeeCode, employeeName) {
  selectedReviewEmployee = employeeCode;
  document.getElementById("reviewStage1").style.display = "none";
  document.getElementById("reviewStage2").style.display = "block";
  document.getElementById("reviewStage3").style.display = "none";
  document.getElementById("stage2Title").textContent = `Item Breakdown: ${employeeCode} - ${employeeName}`;
  try {
    const items = await window.uniformManager.getReviewQueueStage2(employeeCode);
    document.getElementById("reviewStage2Rows").innerHTML = items.map(row => {
      const isPending = row.status === 'Pending';
      return `
        <tr class="${isPending ? 'text-red' : 'text-green'}">
          <td class="clickable" onclick="loadReviewStage3('${escapeHtml(employeeCode)}', '${escapeHtml(row.item_name)}')" style="text-decoration: underline;">${text(row.item_name)}</td>
          <td>${text(row.status)}</td>
          <td>${text(row.issued_qty)}</td>
          <td>${text(row.allowed_qty)}</td>
          <td>${text(row.excess_qty)}</td>
          <td class="reason">${text(row.reason)}</td>
          <td>${isPending ? decisionButtons(row) : ''}</td>
        </tr>
      `;
    }).join("") || `<tr><td colspan="7" class="empty">No items found.</td></tr>`;
  } catch (error) {
    showImportError(error.message || "Failed to load items.");
  }
}

async function loadReviewStage3(employeeCode, itemName) {
  document.getElementById("reviewStage2").style.display = "none";
  document.getElementById("reviewStage3").style.display = "block";
  document.getElementById("stage3Title").textContent = `History (Last 2 Years): ${itemName}`;
  try {
    const history = await window.uniformManager.getReviewQueueStage3(employeeCode, itemName);
    document.getElementById("reviewStage3Rows").innerHTML = history.map(row => `
      <tr>
        <td>${text(row.issue_date).split('T')[0]}</td>
        <td>${text(row.month)}</td>
        <td>${text(row.year)}</td>
        <td>${text(row.unit)}</td>
        <td>${text(row.issued_qty)}</td>
        <td>${text(row.allowed_qty)}</td>
        <td>${text(row.previous_decision)}</td>
      </tr>
    `).join("") || `<tr><td colspan="7" class="empty">No history found for the last 2 years.</td></tr>`;
  } catch (error) {
    showImportError(error.message || "Failed to load history.");
  }
}

function renderReviews() {
  if (document.getElementById("reviewStage2")?.style.display === "block" && selectedReviewEmployee) {
    loadReviewStage2(selectedReviewEmployee, selectedReviewEmployee);
  } else if (document.getElementById("reviewStage3")?.style.display === "block") {
    // Keep Stage 3 visible
  } else {
    renderReviewStage1();
  }
}

document.getElementById("backToStage1Btn")?.addEventListener("click", renderReviewStage1);
document.getElementById("backToStage2Btn")?.addEventListener("click", () => {
  if (selectedReviewEmployee) loadReviewStage2(selectedReviewEmployee, selectedReviewEmployee);
});

function renderPolicies() {
  const suggestions = state.missingPolicySuggestions || [];
  document.getElementById("missingPolicyRows").innerHTML = suggestions.map((row) => `
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
  `).join("") || `<tr><td colspan="5" class="empty">No missing policy suggestions.</td></tr>`;

  const search = policySearch.trim().toLowerCase();
  const unitMap = new Map();
  state.policies.forEach((policy) => {
    const unit = policy.unit || "No Unit";
    if (!unitMap.has(unit)) unitMap.set(unit, []);
    unitMap.get(unit).push(policy);
  });
  const unitRows = [...unitMap.entries()]
    .map(([unit, policies]) => ({
      unit,
      policies: policies.sort((a, b) => String(a.item_name).localeCompare(String(b.item_name))),
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

  document.getElementById("policyRows").innerHTML = selectedPolicies.map((row) => `
    <tr>
      <td>${text(row.item_name)}</td>
      <td>${text(row.yearly_entitlement)}</td>
      <td>Rs. ${Number(row.item_cost || 0).toFixed(2)}</td>
      <td>
        <div class="row-actions">
          <button data-edit-policy="${row.id}">Edit</button>
          <button class="danger" data-delete-policy="${row.id}">Delete</button>
        </div>
      </td>
    </tr>
  `).join("") || `<tr><td colspan="4" class="empty">No policy records found for this unit.</td></tr>`;
}

function renderHistory() {
  const historyEl = document.getElementById("importHistory");
  if (historyEl && state.imports) {
    historyEl.innerHTML = state.imports.map((row) => `
      <div class="history-item">
        <strong>${text(row.file_name)}</strong>
        <span>${text(row.imported_at)} | Sheet ${text(row.selected_sheet)} | Status: ${text(row.status)}</span>
        <span style="display:block; margin-top:4px;">Rows: ${row.total_rows} total | ${row.inserted_count} new | ${row.updated_count} updated | <b style="color:var(--red)">${row.failed_count} failed</b> | <b style="color:var(--amber)">${row.duplicate_count} dupes</b></span>
        <span style="display:block; margin-top:4px;">Generated ${row.generated_reviews} reviews in ${row.duration_ms}ms</span>
      </div>
    `).join("") || `<div class="empty">No imports yet.</div>`;
  }

  const auditEl = document.getElementById("auditLog");
  if (auditEl && state.audit) {
    auditEl.innerHTML = state.audit.map((row) => `
      <div class="history-item">
        <strong>${text(row.action)}</strong>
        <span>${text(row.created_at)} | ${text(row.details)}</span>
      </div>
    `).join("");
  }
}

async function loadState() {
  if (!desktopApi) {
    showImportError(
      "Uniform Manager was opened in a web browser, so Excel import and local database access are not available.\n\n" +
      "Please close this browser tab and start the desktop app using Start Uniform Manager.bat or run npm start from the Application folder."
    );
    document.getElementById("dbPath").textContent = "Desktop app not running";
    return;
  }
  
  try {
    state = await window.uniformManager.getState({ distributionLimit });
    render();
  } catch (error) {
    showImportError("Failed to load state: " + error.message);
  }
}

// Navigation Fix (e.preventDefault())
document.querySelectorAll(".nav-button").forEach((button) => {
  button.addEventListener("click", (e) => {
    e.preventDefault(); 
    setView(button.dataset.view);
  });
});

document.querySelectorAll("[data-review-filter]").forEach((button) => {
  button.addEventListener("click", (e) => {
    e.preventDefault();
    reviewFilter = button.dataset.reviewFilter;
    document.querySelectorAll("[data-review-filter]").forEach((el) => {
      el.classList.toggle("active", el.dataset.reviewFilter === reviewFilter);
    });
    renderReviews();
  });
});

document.getElementById("employeeSearch")?.addEventListener("input", (event) => {
  employeeFilter = event.target.value;
  renderEmployees();
});

document.getElementById("policySearch")?.addEventListener("input", (event) => {
  policySearch = event.target.value;
  renderPolicies();
});

document.getElementById("loadMoreDistributionBtn")?.addEventListener("click", async () => {
  distributionLimit += 1000;
  try {
    state = await window.uniformManager.getState({ distributionLimit });
    render();
    setView("issues");
  } catch (error) {
    showImportError(error.message);
  }
});

document.getElementById("loadAllDistributionBtn")?.addEventListener("click", async () => {
  distributionLimit = Number(state.uniformIssueMatrix?.totalRows || distributionLimit);
  try {
    state = await window.uniformManager.getState({ distributionLimit });
    render();
    setView("issues");
  } catch (error) {
    showImportError(error.message);
  }
});

document.getElementById("importBtn")?.addEventListener("click", async () => {
  try {
    clearImportError();
    if (!desktopApi) {
      showImportError("Excel import works only in the Electron desktop app.");
      return;
    }
    setImporting(true);
    toast("Analyzing workbook sheets before import.");
    const result = await window.uniformManager.chooseAndImportWorkbook();
    if (result.canceled) return;
    showImportModal(result.inspection);
    toast("Workbook analyzed. Please confirm the correct sheet.");
  } catch (error) {
    const message = error.message || "Import failed.";
    showImportError(message);
    toast("Import failed. Details are shown on the dashboard.");
  } finally {
    setImporting(false);
  }
});

document.getElementById("closeImportModal")?.addEventListener("click", hideImportModal);

document.getElementById("sheetCandidates")?.addEventListener("change", (event) => {
  if (event.target.name !== "sheetCandidate") return;
  selectedSheetName = event.target.value;
  renderSheetCandidates();
});

document.getElementById("confirmImportBtn")?.addEventListener("click", async () => {
  if (!pendingInspection || !selectedSheetName) return;
  try {
    setImporting(true);
    document.getElementById("confirmImportBtn").disabled = true;
    toast(`Validating sheet ${selectedSheetName}...`);
    
    const result = await window.uniformManager.previewImportSelectedSheet({
      filePath: pendingInspection.filePath,
      sheetName: selectedSheetName,
    });
    
    currentPreviewData = result.preview;
    hideImportModal();
    
    document.getElementById("previewTotal").textContent = currentPreviewData.summary.totalWorksheetRows;
    document.getElementById("previewValid").textContent = currentPreviewData.summary.validWorksheetRows;
    document.getElementById("previewErrors").textContent = currentPreviewData.summary.invalidWorksheetRows;
    document.getElementById("previewDuplicates").textContent = currentPreviewData.summary.duplicateWorksheetRows;
    document.getElementById("previewIssues").textContent = currentPreviewData.summary.generatedIssues;
    
    document.getElementById("previewErrorRows").innerHTML = currentPreviewData.validationErrors.map(e => `
        <tr><td>${e.row}</td><td>${escapeHtml(e.employee_code)}</td><td>${escapeHtml(e.employee_name)}</td><td class="reason">${escapeHtml(e.reason)}</td></tr>
    `).join("") || `<tr><td colspan="4" class="empty">No validation errors found on worksheet.</td></tr>`;
    
    document.getElementById("importPreviewModal").classList.add("show");
  } catch (error) {
    showImportError(error.message || "Preview failed.");
    toast("Preview failed.");
  } finally {
    setImporting(false);
    document.getElementById("confirmImportBtn").disabled = !selectedSheetName;
  }
});

document.getElementById("cancelPreviewBtn")?.addEventListener("click", () => {
  currentPreviewData = null;
  document.getElementById("importPreviewModal").classList.remove("show");
});

document.getElementById("commitImportBtn")?.addEventListener("click", async () => {
  if (!currentPreviewData) return;
  try {
    setImporting(true);
    document.getElementById("commitImportBtn").disabled = true;
    toast("Importing and tracking history...");
    
    const result = await window.uniformManager.commitImport(currentPreviewData);
    state = result.state;
    render();
    document.getElementById("importPreviewModal").classList.remove("show");
    currentPreviewData = null;
    toast(result.summary.duplicate ? "Duplicate import hash detected. Discarded." : "Import completed successfully.");
  } catch (error) {
    showImportError(error.message || "Import failed.");
  } finally {
    setImporting(false);
    document.getElementById("commitImportBtn").disabled = false;
  }
});

document.getElementById("goImportBtn")?.addEventListener("click", (e) => {
  e.preventDefault();
  setView("import");
});

document.getElementById("recalculateReviewsBtn")?.addEventListener("click", async () => {
  if (!desktopApi) return showImportError("Works only in Desktop App.");
  try {
    const result = await window.uniformManager.recalculateReviews();
    state = result.state;
    render();
    setView("review");
    toast(`Review queue recalculated: ${result.generated} pending rows.`);
  } catch (error) {
    try {
      state = await window.uniformManager.getState();
      render();
    } catch (e) {}
    setView("review");
    showImportError(error.message || "Review recalculation failed.");
  }
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
    const result = await window.uniformManager.recalculateReviews();
    state = result.state;
    selectedPolicyUnit = policy.unit || selectedPolicyUnit;
    setPolicyEditMode(null);
    form.reset();
    render();
    setView("policies");
    toast(`Policy saved. Review queue recalculated: ${result.generated} pending rows.`);
  } catch (error) {
    showImportError(error.message || "Policy save failed.");
  }
});

document.getElementById("cancelPolicyEditBtn")?.addEventListener("click", () => {
  setPolicyEditMode(null);
  document.getElementById("policyForm").reset();
  toast("Policy form cleared.");
});

document.getElementById("itemForm")?.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!desktopApi) return showImportError("Works only in Desktop App.");
  try {
    const form = event.currentTarget;
    const item = {
      id: editingItemId || form.elements.id.value || "",
      item_code: form.elements.item_code.value,
      item_name: form.elements.item_name.value,
      category: form.elements.category.value,
      size: form.elements.size.value,
      cost: form.elements.cost.value,
      available_stock: form.elements.available_stock.value,
      minimum_stock: form.elements.minimum_stock.value,
      status: form.elements.status.value,
    };
    state = await window.uniformManager.upsertItem(item);
    setItemEditMode(null);
    form.reset();
    render();
    setView("items");
    toast("Item saved.");
  } catch (error) {
    showImportError(error.message || "Item save failed.");
  }
});

document.getElementById("cancelItemEditBtn")?.addEventListener("click", () => {
  setItemEditMode(null);
  document.getElementById("itemForm").reset();
  toast("Item form cleared.");
});

document.getElementById("closeEmployeeModal")?.addEventListener("click", hideEmployeeModal);
document.getElementById("closeReviewDecisionModal")?.addEventListener("click", hideReviewDecisionModal);
document.getElementById("closeDistributionModal")?.addEventListener("click", hideDistributionModal);

document.getElementById("resetAcknowledge")?.addEventListener("change", (event) => {
  document.getElementById("resetDataBtn").disabled = !event.target.checked;
});

document.getElementById("employeeForm")?.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!desktopApi) return showImportError("Works only in Desktop App.");
  try {
    const employee = Object.fromEntries(new FormData(event.currentTarget).entries());
    state = await window.uniformManager.updateEmployee(employee);
    render();
    hideEmployeeModal();
    toast("Employee saved.");
  } catch (error) {
    showImportError(error.message || "Employee save failed.");
  }
});

document.getElementById("distributionForm")?.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!pendingDistributionEdit) return;
  const form = event.currentTarget;
  const quantities = {};
  (state.uniformIssueMatrix?.items || []).forEach((item) => {
    quantities[item] = Number(form.elements[item]?.value || 0);
  });
  try {
    state = await window.uniformManager.updateDistributionRow({
      key: distributionKey(pendingDistributionEdit),
      quantities,
    });
    hideDistributionModal();
    render();
    setView("issues");
    toast("Distribution row updated.");
  } catch (error) {
    showImportError(error.message || "Distribution update failed.");
  }
});

document.getElementById("reviewDecisionForm")?.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!desktopApi || !pendingReviewDecision) return;
  try {
    const form = event.currentTarget;
    const payload = Object.fromEntries(new FormData(form).entries());
    state = await window.uniformManager.updateReview(payload);
    render();
    hideReviewDecisionModal();
    toast(`Review #${payload.id} updated.`);
  } catch (error) {
    showImportError(error.message || "Review decision failed.");
  }
});

document.getElementById("resetDataBtn")?.addEventListener("click", async () => {
  if (!desktopApi) return showImportError("Works only in Desktop App.");
  try {
    const result = await window.uniformManager.resetOperationalData();
    if (result.canceled) {
      toast("Reset cancelled.");
      return;
    }
    state = result.state;
    document.getElementById("resetAcknowledge").checked = false;
    document.getElementById("resetDataBtn").disabled = true;
    render();
    setView("dashboard");
    toast("Imported data reset. You can import again now.");
  } catch (error) {
    showImportError(error.message || "Reset failed.");
  }
});

document.addEventListener("click", async (event) => {
  const editItemButton = event.target.closest("[data-edit-item]");
  if (editItemButton) {
    const item = state.items.find((row) => String(row.id) === editItemButton.dataset.editItem);
    if (item) {
      const form = document.getElementById("itemForm");
      setItemEditMode(item.id);
      form.querySelector('[name="id"]').value = item.id;
      form.elements.item_code.value = item.item_code || "";
      form.elements.item_name.value = item.item_name || "";
      form.elements.category.value = item.category || "";
      form.elements.size.value = item.size || "";
      form.elements.cost.value = item.cost || 0;
      form.elements.available_stock.value = item.available_stock || 0;
      form.elements.minimum_stock.value = item.minimum_stock || 0;
      form.elements.status.value = item.status || "Active";
      setView("items");
      toast("Item loaded for editing.");
    }
    return;
  }

  const deleteItemButton = event.target.closest("[data-delete-item]");
  if (deleteItemButton) {
    const item = state.items.find((row) => String(row.id) === deleteItemButton.dataset.deleteItem);
    const label = item ? `${item.item_code} - ${item.item_name}` : `#${deleteItemButton.dataset.deleteItem}`;
    if (!confirm(`Delete item ${label}?`)) return;
    try {
      state = await window.uniformManager.deleteItem(deleteItemButton.dataset.deleteItem);
      render();
      toast("Item deleted.");
    } catch (error) {
      showImportError(error.message || "Item delete failed.");
    }
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
      state = await window.uniformManager.deletePolicy(deletePolicyButton.dataset.deletePolicy);
      const result = await window.uniformManager.recalculateReviews();
      state = result.state;
      render();
      toast(`Policy deleted. Review queue recalculated: ${result.generated} pending rows.`);
    } catch (error) {
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

  const editButton = event.target.closest("[data-edit-employee]");
  if (editButton) {
    const employee = state.employees.find((row) => row.employee_code === editButton.dataset.editEmployee);
    if (employee) showEmployeeModal(employee);
    return;
  }

  const deleteButton = event.target.closest("[data-delete-employee]");
  if (deleteButton) {
    const employeeCode = deleteButton.dataset.deleteEmployee;
    const employee = state.employees.find((row) => row.employee_code === employeeCode);
    const label = employee ? `${employee.employee_code} - ${employee.employee_name}` : employeeCode;
    if (!confirm(`Delete employee ${label}?\n\nThis will remove the employee from master data and review queue.`)) return;
    try {
      state = await window.uniformManager.deleteEmployee(employeeCode);
      render();
      toast("Employee deleted.");
    } catch (error) {
      showImportError(error.message || "Delete failed.");
    }
    return;
  }

  const openReportButton = event.target.closest("[data-open-report]");
  if (openReportButton) {
    try {
      await window.uniformManager.openDeductionReport(openReportButton.dataset.openReport);
      toast("Opening deduction report.");
    } catch (error) {
      showImportError(error.message || "Could not open deduction report.");
    }
    return;
  }

  const button = event.target.closest("[data-review]");
  if (button) {
    if (!desktopApi) return showImportError("Desktop app required.");
    const review = state.reviews.find((row) => String(row.id) === String(button.dataset.review));
    if (review) showReviewDecisionModal(review, button.dataset.status);
    return;
  }

  const deleteReviewButton = event.target.closest("[data-delete-review]");
  if (deleteReviewButton) {
    const review = state.reviews.find((row) => String(row.id) === String(deleteReviewButton.dataset.deleteReview));
    const label = review ? `#${review.id} ${review.employee_code} - ${review.employee_name}` : `#${deleteReviewButton.dataset.deleteReview}`;
    if (!confirm(`Delete review queue entry ${label}?`)) return;
    try {
      state = await window.uniformManager.deleteReview(deleteReviewButton.dataset.deleteReview);
      render();
      toast("Review queue entry deleted.");
    } catch (error) {
      showImportError(error.message || "Review delete failed.");
    }
    return;
  }

  const editDistributionButton = event.target.closest("[data-edit-distribution]");
  if (editDistributionButton) {
    const row = state.uniformIssueMatrix?.rows?.[Number(editDistributionButton.dataset.editDistribution)];
    if (row) showDistributionModal(row);
    return;
  }

  const deleteDistributionButton = event.target.closest("[data-delete-distribution]");
  if (deleteDistributionButton) {
    const row = state.uniformIssueMatrix?.rows?.[Number(deleteDistributionButton.dataset.deleteDistribution)];
    if (!row) return;
    const label = `${row.employee_code} - ${row.employee_name} (${row.issue_period_label || "No period"})`;
    if (!confirm(`Delete distribution row ${label}?\n\nThis removes that employee/month distribution entry and recalculates review queue.`)) return;
    try {
      state = await window.uniformManager.deleteDistributionRow(distributionKey(row));
      render();
      setView("issues");
      toast("Distribution row deleted.");
    } catch (error) {
      showImportError(error.message || "Distribution row delete failed.");
    }
  }
});

loadState();