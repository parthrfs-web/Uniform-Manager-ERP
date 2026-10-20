let heldRecordsCache = [];

function heldPeriod(record) {
  return record.distribution_period || record.issue_period_label || [record.issue_year, record.issue_month ? monthNames[Number(record.issue_month)] : ''].filter(Boolean).join(' ');
}

function heldFinancialYear(record) {
  const year = Number(record.issue_year);
  const month = Number(record.issue_month);
  if (!year) return '';
  return String(month >= 4 ? year : year - 1);
}

function fillHeldFilter(id, values, label) {
  const select = document.getElementById(id);
  if (!select) return;
  const previous = select.value;
  select.innerHTML = `<option value="">${label}</option>` + values.map((value) => `<option value="${escapeHtml(String(value))}">${escapeHtml(String(value))}</option>`).join('');
  if (values.map(String).includes(previous)) select.value = previous;
}

function heldMonthLabel(month) {
  return monthNames[Number(month)] || `Month ${month}`;
}

function filteredHeldRecords() {
  const employee = document.getElementById('heldSearchEmployee')?.value.trim().toLowerCase() || '';
  const unitSearch = document.getElementById('heldSearchUnit')?.value.trim().toLowerCase() || '';
  const itemSearch = document.getElementById('heldSearchItem')?.value.trim().toLowerCase() || '';
  const fy = document.getElementById('heldFilterYear')?.value || '';
  const month = document.getElementById('heldFilterMonth')?.value || '';
  const unit = document.getElementById('heldFilterUnit')?.value || '';
  const item = document.getElementById('heldFilterItem')?.value || '';
  const status = document.getElementById('heldFilterStatus')?.value || '';
  return heldRecordsCache.filter((record) => {
    if (employee && !`${record.employee_code} ${record.employee_name}`.toLowerCase().includes(employee)) return false;
    if (unitSearch && !String(record.unit || '').toLowerCase().includes(unitSearch)) return false;
    if (itemSearch && !String(record.item_name || '').toLowerCase().includes(itemSearch)) return false;
    if (fy && heldFinancialYear(record) !== fy) return false;
    if (month && String(record.issue_month || '') !== month) return false;
    if (unit && String(record.unit || '') !== unit) return false;
    if (item && String(record.item_name || '') !== item) return false;
    if (status === 'Held' && Number(record.held_quantity || 0) <= 0) return false;
    return Number(record.held_quantity || 0) > 0;
  });
}

function renderHeldRecords() {
  const records = filteredHeldRecords();
  document.getElementById('heldSummaryRecords').textContent = String(records.length);
  document.getElementById('heldSummaryQuantity').textContent = String(records.reduce((sum, row) => sum + Number(row.held_quantity || 0), 0));
  document.getElementById('heldSummaryEmployees').textContent = String(new Set(records.map((row) => row.employee_code)).size);
  document.getElementById('heldSummaryUnits').textContent = String(new Set(records.map((row) => String(row.unit || '').trim().toLowerCase()).filter(Boolean)).size);

  const rows = records.map((row, index) => `
    <tr>
      <td>${index + 1}</td><td>${escapeHtml(row.employee_code)}</td><td>${escapeHtml(row.employee_name)}</td>
      <td>${escapeHtml(row.unit || '-')}</td><td>${escapeHtml(row.item_name)}</td><td>${escapeHtml(heldPeriod(row) || '-')}</td>
      <td>${Number(row.original_excess_qty || 0)}</td><td class="text-red">${Number(row.deducted_quantity || 0)}</td>
      <td class="text-green">${Number(row.waived_quantity || 0)}</td><td class="text-blue"><strong>${Number(row.held_quantity || 0)}</strong></td>
      <td>${escapeHtml(row.hold_reason || '-')}</td><td>${row.reviewed_at ? escapeHtml(String(row.reviewed_at).split('T')[0]) : (row.hold_date ? escapeHtml(String(row.hold_date).split('T')[0]) : '-')}</td>
      <td><div class="row-actions"><button type="button" class="secondary" data-held-view="${row.review_id}:${row.item_id}">View Details</button><button type="button" class="primary" data-held-resolve="${row.review_id}:${row.item_id}">Resolve Hold</button></div></td>
    </tr>`).join('');
  document.getElementById('heldRecordsRows').innerHTML = rows || '<tr><td colspan="13" class="empty">No held records match these filters.</td></tr>';
}

window.loadHeldRecordsPage = async function() {
  if (!desktopApi) return;
  try {
    heldRecordsCache = await window.uniformManager.getHeldRecords();
    fillHeldFilter('heldFilterYear', [...new Set(heldRecordsCache.map(heldFinancialYear).filter(Boolean))].sort(), 'All Financial Years');
    fillHeldFilter('heldFilterMonth', [...new Set(heldRecordsCache.map((row) => String(row.issue_month || '')).filter(Boolean))].sort((a, b) => Number(a) - Number(b)).map((month) => month), 'All Payroll Months');
    const monthSelect = document.getElementById('heldFilterMonth');
    if (monthSelect) {
      const selected = monthSelect.value;
      monthSelect.innerHTML = '<option value="">All Payroll Months</option>' + [...new Set(heldRecordsCache.map((row) => Number(row.issue_month)).filter(Boolean))].sort((a, b) => a - b).map((month) => `<option value="${month}">${heldMonthLabel(month)}</option>`).join('');
      monthSelect.value = selected;
    }
    fillHeldFilter('heldFilterUnit', [...new Set(heldRecordsCache.map((row) => row.unit).filter(Boolean))].sort(), 'All Units');
    fillHeldFilter('heldFilterItem', [...new Set(heldRecordsCache.map((row) => row.item_name).filter(Boolean))].sort(), 'All Items');
    renderHeldRecords();
  } catch (error) {
    showImportError(error.message || 'Failed to load held records.');
  }
};

['heldSearchEmployee', 'heldSearchUnit', 'heldSearchItem', 'heldFilterYear', 'heldFilterMonth', 'heldFilterUnit', 'heldFilterItem', 'heldFilterStatus'].forEach((id) => {
  document.addEventListener('input', (event) => { if (event.target.id === id) renderHeldRecords(); });
  document.addEventListener('change', (event) => { if (event.target.id === id) renderHeldRecords(); });
});

document.getElementById('heldClearFilters')?.addEventListener('click', () => {
  ['heldSearchEmployee', 'heldSearchUnit', 'heldSearchItem', 'heldFilterYear', 'heldFilterMonth', 'heldFilterUnit', 'heldFilterItem', 'heldFilterStatus'].forEach((id) => { const input = document.getElementById(id); if (input) input.value = ''; });
  renderHeldRecords();
});

document.addEventListener('click', async (event) => {
  const detailButton = event.target.closest('[data-held-view]');
  const resolveButton = event.target.closest('[data-held-resolve]');
  const button = detailButton || resolveButton;
  if (!button) return;
  const [reviewIdText, itemIdText] = (detailButton ? detailButton.dataset.heldView : resolveButton.dataset.heldResolve).split(':');
  const row = heldRecordsCache.find((item) => String(item.review_id) === reviewIdText && String(item.item_id) === itemIdText);
  if (!row) return toast('This held record was already resolved. Refresh the page.');
  const [review] = await window.uniformManager.getReviewQueueStage2(row.employee_code).then((items) => items.filter((item) => String(item.id) === reviewIdText));
  const child = review?.child_items?.find((item) => String(item.id) === itemIdText);
  if (!review || !child) return toast('The held transaction could not be loaded.');
  if (detailButton) {
    window.showHeldRecordDetails(row, review, child);
    return;
  }
  window.openHeldRecordResolution(review, child);
});

window.refreshHeldRecords = window.loadHeldRecordsPage;

window.showHeldRecordDetails = function(row, review, child) {
  document.getElementById('heldDetailsText').innerHTML = `
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:12px;">
      <div><small>Employee</small><br><strong>${escapeHtml(row.employee_code)} — ${escapeHtml(row.employee_name)}</strong></div>
      <div><small>Item / Unit</small><br><strong>${escapeHtml(row.item_name)} · ${escapeHtml(row.unit || '-')}</strong></div>
      <div><small>Payroll / Distribution Period</small><br><strong>${escapeHtml(heldPeriod(row) || '-')}</strong></div>
      <div><small>Original Excess</small><br><strong>${Number(row.original_excess_qty || 0)}</strong></div>
      <div><small>Previously Deducted</small><br><strong class="text-red">${Number(row.deducted_quantity || 0)}</strong></div>
      <div><small>Previously Waived</small><br><strong class="text-green">${Number(row.waived_quantity || 0)}</strong></div>
      <div><small>Currently Held</small><br><strong class="text-blue">${Number(child.held_quantity || 0)}</strong></div>
      <div><small>Remaining Undecided</small><br><strong class="text-amber">${Number(child.remaining_quantity || 0)}</strong></div>
      <div><small>Distribution Date</small><br><strong>${escapeHtml(child.issue_date || '-')}</strong></div>
      <div><small>Hold Date</small><br><strong>${escapeHtml(row.reviewed_at || '-')}</strong></div>
    </div>
    <div style="margin-top:16px;"><small>Hold Reason</small><div>${escapeHtml(row.hold_reason || 'Not recorded')}</div></div>
    <div style="margin-top:12px;"><small>Distribution Remarks</small><div>${escapeHtml(child.issue_remarks || 'Not recorded')}</div></div>`;
  document.getElementById('heldDetailsModal').classList.add('show');
};

window.openHeldRecordResolution = function(review, child) {
  document.getElementById('heldResolveDetails').innerHTML = `<strong>${escapeHtml(review.employee_code)} — ${escapeHtml(review.employee_name)}</strong><div style="color:var(--muted);margin-top:6px;">${escapeHtml(review.item_name)} · ${escapeHtml(review.unit || '')} · Currently held: <strong class="text-blue">${Number(child.held_quantity)}</strong></div>`;
  document.getElementById('heldResolveReviewId').value = review.id;
  document.getElementById('heldResolveItemId').value = child.id;
  const qty = document.getElementById('heldResolveQuantity');
  qty.max = String(Number(child.held_quantity));
  qty.value = String(Number(child.held_quantity));
  document.getElementById('heldResolveReason').value = '';
  document.getElementById('heldResolveModal').classList.add('show');
};

document.addEventListener('click', (event) => {
  if (event.target.closest('[data-close-held-modal]')) event.target.closest('.modal-backdrop')?.classList.remove('show');
});

document.getElementById('heldResolveForm')?.addEventListener('submit', async (event) => {
  event.preventDefault();
  const decision = event.submitter?.dataset.heldDecision;
  const reviewId = Number(document.getElementById('heldResolveReviewId').value);
  const itemId = Number(document.getElementById('heldResolveItemId').value);
  const quantity = Number(document.getElementById('heldResolveQuantity').value);
  const max = Number(document.getElementById('heldResolveQuantity').max);
  const reason = document.getElementById('heldResolveReason').value.trim();
  if (!['Deduct', 'Waive', 'Hold'].includes(decision)) return;
  if (!Number.isInteger(quantity) || quantity <= 0 || quantity > max) return toast(`Enter a whole quantity between 1 and ${max}.`);
  if (!reason) return toast('A reason is required.');
  try {
    startProgress();
    state = await window.uniformManager.resolveHeldQuantity({ reviewId, itemId, quantity, decision, reason, resolvedBy: 'Admin' });
    stopProgress();
    document.getElementById('heldResolveModal').classList.remove('show');
    await window.loadHeldRecordsPage();
    if (typeof renderDeductions === 'function') renderDeductions();
    if (typeof window.renderCorrectionCentre === 'function') window.renderCorrectionCentre();
    if (typeof window.renderCorrectionHistory === 'function') window.renderCorrectionHistory();
    toast('Held record updated and audit history saved.');
  } catch (error) {
    stopProgress();
    showImportError(error.message || 'Failed to resolve held record.');
  }
});
