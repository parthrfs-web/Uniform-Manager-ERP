function showReviewDecisionModal(review, status) {
  pendingReviewDecision = { review, status };
  const labels = {
    Waived: "Waive Off",
    Held: "Hold",
    Deducted: "Deduct From Salary",
  };
  const form = document.getElementById("reviewDecisionForm");
  form.reset();
  form.elements.id.value = review.id;
  form.elements.status.value = status;
  document.getElementById("reviewDecisionTitle").textContent = labels[status] || "Review Decision";
  document.getElementById("decisionByLabel").textContent = status === "Waived" ? "Waived By" : status === "Held" ? "Held By" : "Approved By";
  document.getElementById("reviewDecisionSubtitle").textContent =
    `${review.employee_code} - ${review.employee_name} | ${review.category}: ${review.reason}`;
  form.elements.reason.required = status === "Waived" || status === "Deducted";
  document.getElementById("reviewDecisionModal").classList.add("show");
}

function hideReviewDecisionModal() {
  pendingReviewDecision = null;
  document.getElementById("reviewDecisionModal").classList.remove("show");
}

function reviewStatusLabel(status) {
  return status === "Pending" ? "Review Required" : status;
}

function decisionButtons(row) {
  if (row.status !== "Pending") {
    return `
      <div style="margin-top: auto; display: flex; flex-direction: column; gap: 8px;">
        <div style="color: var(--muted); font-size: 13px;"><em>${text(row.remarks)}</em></div>
        <div class="decision-buttons" style="display: flex; gap: 8px; flex-wrap: wrap;">
          <button data-review="${row.id}" data-status="Pending" class="secondary">Cancel</button>
        </div>
      </div>
    `;
  }
  return `
    <div class="decision-buttons" style="display: flex; gap: 8px; flex-wrap: wrap; margin-top: auto;">
      <button data-review="${row.id}" data-status="Deducted">Deduct</button>
      <button data-review="${row.id}" data-status="Waived">Waive</button>
      <button data-review="${row.id}" data-status="Held">Hold</button>
    </div>
  `;
}

async function renderReviewStage1() {
  document.getElementById("reviewStage1").style.display = "block";
  document.getElementById("reviewStage2").style.display = "none";
  document.getElementById("reviewStage3").style.display = "none";

  try {
    summaryCache = await window.uniformManager.getReviewQueueStage1();
    renderReviewStage1Rows(summaryCache);
  } catch (error) {
    showImportError(error.message || "Failed to load review summary.");
  }
}

function renderReviewStage1Rows(summaryList) {
  const filtered = summaryList.filter(emp => {
    if (!reviewSearchText) return true;
    const searchStr = `${text(emp.employee_code)} ${text(emp.employee_name)} ${text(emp.current_unit)}`.toLowerCase();
    return searchStr.includes(reviewSearchText);
  });

  document.getElementById("reviewStage1Rows").innerHTML = filtered.map(emp => {
    return `
      <tr class="clickable" data-review-stage1-emp="${escapeHtml(emp.employee_code)}">
        <td>${text(emp.employee_code)}</td>
        <td>${text(emp.employee_name)}</td>
        <td>${text(emp.current_unit)}</td>
        <td>${text(emp.payroll_month)}</td>
        <td>${text(emp.pending_item_count)}</td>
        <td>₹${Number(emp.estimated_deduction || 0).toFixed(2)}</td>
      </tr>
    `;
  }).join("") || `<tr><td colspan="6" class="empty">No pending reviews.</td></tr>`;
}

async function loadReviewStage2(emp) {
  selectedReviewEmployee = emp.employee_code;
  currentEmpData = emp;
  document.getElementById("reviewStage1").style.display = "none";
  document.getElementById("reviewStage2").style.display = "block";
  document.getElementById("reviewStage3").style.display = "none";

  document.getElementById("stg2Code").textContent = text(emp.employee_code);
  document.getElementById("stg2Name").textContent = text(emp.employee_name);
  document.getElementById("stg2Unit").textContent = text(emp.current_unit);
  document.getElementById("stg2Month").textContent = text(emp.payroll_month);
  document.getElementById("stg2Count").textContent = text(emp.pending_item_count);
  document.getElementById("stg2Amount").textContent = `₹${Number(emp.estimated_deduction || 0).toFixed(2)}`;

  document.getElementById("reviewStage2Loading").style.display = "block";
  document.getElementById("reviewStage2Content").style.display = "none";

  try {
    currentStage2Items = await window.uniformManager.getReviewQueueStage2(emp.employee_code);
    
    let counts = { Pending: 0, Deducted: 0, Waived: 0, Held: 0 };
    let amounts = { Pending: 0, Deducted: 0, Waived: 0, Held: 0 };
    let grandTotal = 0;

    document.getElementById("reviewStage2Cards").innerHTML = currentStage2Items.map(row => {
      const status = row.status || 'Pending';
      const isPending = status === 'Pending';
      
      const qty = Number(row.excess_qty || 0);
      const rate = Number(row.live_rate !== undefined ? row.live_rate : (row.item_cost || 0));
      const amount = qty * rate;
      
      if (counts[status] !== undefined) counts[status]++;
      if (amounts[status] !== undefined) amounts[status] += amount;
      grandTotal += amount;
      
      let borderColor = 'var(--line)';
      if (status === 'Pending') borderColor = 'var(--amber)';
      else if (status === 'Deducted') borderColor = 'var(--red)';
      else if (status === 'Waived') borderColor = 'var(--green)';
      else if (status === 'Held') borderColor = 'var(--blue)';

      return `
        <div class="panel review-card" style="margin: 0; padding: 16px; border-left: 4px solid ${borderColor}; display: flex; flex-direction: column;">
          <h4 style="margin: 0 0 12px 0; border-bottom: 1px solid var(--line); padding-bottom: 8px;">
            <span class="clickable" onclick="loadReviewStage3('${escapeHtml(emp.employee_code)}', '${escapeHtml(row.item_name)}')" style="text-decoration: underline;">${escapeHtml(row.item_name)}</span>
          </h4>
          <div style="font-size: 13px; line-height: 1.8; margin-bottom: 16px; flex-grow: 1;">
            <div><strong>Code :</strong> ${escapeHtml(row.employee_code)}</div>
            <div><strong>Name :</strong> ${escapeHtml(row.employee_name)}</div>
            <div><strong>Unit :</strong> ${escapeHtml(row.unit)}</div>
            <div><strong>Item :</strong> ${escapeHtml(row.item_name)}</div>
            
            <div style="display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 8px; margin: 12px 0; padding: 12px 0; border-top: 1px dashed var(--line); border-bottom: 1px dashed var(--line);">
              <div><small style="color:var(--muted); display:block; line-height: 1.2;">Issued</small><strong style="font-size: 15px;">${Number(row.issued_qty || 0)}</strong></div>
              <div><small style="color:var(--muted); display:block; line-height: 1.2;">Allowed</small><strong style="font-size: 15px;">${row.allowed_qty !== null ? Number(row.allowed_qty) : 'No Policy'}</strong></div>
              <div><small style="color:var(--muted); display:block; line-height: 1.2;">Excess</small><strong class="text-amber" style="font-size: 15px;">${qty}</strong></div>
            </div>
            
            <div style="margin-top: 6px;"><strong>Deduct Amount :</strong> ₹${amount.toFixed(2)}</div>
            <div><strong>Status :</strong> <span class="badge ${escapeHtml(status)}">${escapeHtml(reviewStatusLabel(status))}</span></div>
            ${row.reason ? `<div class="reason" style="margin-top: 8px; color: var(--muted);">${escapeHtml(row.reason)}</div>` : ''}
          </div>
          ${decisionButtons(row)}
        </div>
      `;
    }).join("") || `<div class="empty" style="grid-column: 1 / -1;">No review items found.</div>`;

    document.getElementById("sumCountPending").textContent = counts.Pending;
    document.getElementById("sumCountDeducted").textContent = counts.Deducted;
    document.getElementById("sumCountWaived").textContent = counts.Waived;
    document.getElementById("sumCountHeld").textContent = counts.Held;

    document.getElementById("sumAmtPending").textContent = `₹${amounts.Pending.toFixed(2)}`;
    document.getElementById("sumAmtDeducted").textContent = `₹${amounts.Deducted.toFixed(2)}`;
    document.getElementById("sumAmtWaived").textContent = `₹${amounts.Waived.toFixed(2)}`;
    document.getElementById("sumAmtHeld").textContent = `₹${amounts.Held.toFixed(2)}`;
    document.getElementById("sumAmtTotal").textContent = `₹${grandTotal.toFixed(2)}`;

  } catch (error) {
    showImportError(error.message || "Failed to load items.");
  } finally {
    document.getElementById("reviewStage2Loading").style.display = "none";
    document.getElementById("reviewStage2Content").style.display = "block";
  }
}

async function loadReviewStage3(employeeCode, itemName) {
  document.getElementById("reviewStage2").style.display = "none";
  document.getElementById("reviewStage3").style.display = "block";
  document.getElementById("stage3Title").textContent = `History (Last 2 Years): ${itemName}`;
  try {
    const history = await window.uniformManager.getReviewQueueStage3({ code: employeeCode, item: itemName });
    const monthNames = ["", "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

    document.getElementById("reviewStage3Rows").innerHTML = history.map(row => {
      const monthStr = monthNames[Number(row.month)] || text(row.month);
      return `
        <tr>
          <td>${text(row.issue_date).split('T')[0]}</td>
          <td>${monthStr}</td>
          <td>${text(row.year)}</td>
          <td>${text(row.unit)}</td>
          <td>${text(row.issued_qty)}</td>
          <td>${text(row.allowed_qty)}</td>
          <td>${text(row.previous_decision)}</td>
        </tr>
      `;
    }).join("") || `<tr><td colspan="7" class="empty">No previous issue history found.</td></tr>`;
  } catch (error) {
    showImportError(error.message || "Failed to load history.");
  }
}

async function renderReviews() {
  if (document.getElementById("reviewStage2")?.style.display === "block" && selectedReviewEmployee) {
    summaryCache = await window.uniformManager.getReviewQueueStage1();
    let empData = summaryCache.find(e => e.employee_code === selectedReviewEmployee);
    if (!empData && currentEmpData) {
      empData = { ...currentEmpData, pending_item_count: 0, estimated_deduction: 0 };
    }
    if (empData) {
      loadReviewStage2(empData);
    } else {
      selectedReviewEmployee = null;
      currentEmpData = null;
      renderReviewStage1();
    }
  } else if (document.getElementById("reviewStage3")?.style.display === "block") {
    // Keep Stage 3 visible
  } else {
    selectedReviewEmployee = null;
    currentEmpData = null;
    renderReviewStage1();
  }
}

document.getElementById("backToStage1Btn")?.addEventListener("click", () => {
  selectedReviewEmployee = null;
  currentEmpData = null;
  renderReviewStage1();
});

document.getElementById("backToStage2Btn")?.addEventListener("click", () => {
  if (selectedReviewEmployee && currentEmpData) {
    loadReviewStage2(currentEmpData);
  }
});

document.getElementById("recalculateReviewsBtn")?.addEventListener("click", async () => {
  if (!desktopApi) return showImportError("Works only in Desktop App.");
  try {
    startProgress();
    const result = await window.uniformManager.recalculateReviews();
    state = await window.uniformManager.getState({ distributionLimit });
    stopProgress();
    render();
    setView("review");
    toast(`Review queue recalculated: ${result.generated} pending rows.`);
  } catch (error) {
    stopProgress();
    try {
      state = await window.uniformManager.getState({ distributionLimit });
      render();
    } catch (e) {}
    setView("review");
    showImportError(error.message || "Review recalculation failed.");
  }
});

document.getElementById("closeReviewDecisionModal")?.addEventListener("click", hideReviewDecisionModal);

document.getElementById("reviewDecisionForm")?.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!desktopApi || !pendingReviewDecision) return;
  try {
    const form = event.currentTarget;
    const payload = Object.fromEntries(new FormData(form).entries());
    
    await window.uniformManager.updateReview(payload);
    state = await window.uniformManager.getState({ distributionLimit });
    
    render();
    hideReviewDecisionModal();
    toast(`Review #${payload.id} updated.`);
  } catch (error) {
    showImportError(error.message || "Review decision failed.");
  }
});

document.addEventListener("click", async (event) => {
  const stage1Row = event.target.closest("[data-review-stage1-emp]");
  if (stage1Row) {
    selectedReviewEmployee = stage1Row.dataset.reviewStage1Emp;
    const empData = summaryCache.find(e => e.employee_code === selectedReviewEmployee);
    if (empData) loadReviewStage2(empData);
    return;
  }
});

document.addEventListener("click", async (event) => {
  const button = event.target.closest("[data-review]");
  if (button) {
    if (!desktopApi) return showImportError("Desktop app required.");
    
    const reviewId = String(button.dataset.review);
    const status = button.dataset.status;
    
    const review = (currentStage2Items || []).find((row) => String(row.id) === reviewId) 
                || (state?.reviews || []).find((row) => String(row.id) === reviewId);
    
    if (review) {
        if (status === "Pending") {
            window.uniformManager.updateReview({ id: review.id, status: "Pending" })
              .then(async () => {
                  state = await window.uniformManager.getState({ distributionLimit });
                  render(); 
                  toast("Review reverted to Pending.");
              })
              .catch(err => showImportError(err.message));
        } else {
            showReviewDecisionModal(review, status);
        }
    }
    return;
  }

  const deleteReviewButton = event.target.closest("[data-delete-review]");
  if (deleteReviewButton) {
    const review = state.reviews.find((row) => String(row.id) === String(deleteReviewButton.dataset.deleteReview));
    const label = review ? `#${review.id} ${review.employee_code} - ${review.employee_name}` : `#${deleteReviewButton.dataset.deleteReview}`;
    if (!confirm(`Delete review queue entry ${label}?`)) return;
    try {
      await window.uniformManager.deleteReview(deleteReviewButton.dataset.deleteReview);
      state = await window.uniformManager.getState({ distributionLimit });
      render();
      toast("Review queue entry deleted.");
    } catch (error) {
      showImportError(error.message || "Review delete failed.");
    }
    return;
  }
});

document.getElementById("reviewSearchInput")?.addEventListener("input", (e) => {
  reviewSearchText = e.target.value.toLowerCase();
  renderReviewStage1Rows(summaryCache);
});