function reviewStatusLabel(status) {
  if (status === "Pending") return "Review Required";
  if (status === "Completed") return "Completed";
  return status;
}

async function renderReviewStage1() {
  document.getElementById("reviewStage1").style.display = "block";
  document.getElementById("reviewStage2").style.display = "none";

  const toolbar = document.querySelector("#reviewStage1 .toolbar");
  let searchInput = document.getElementById("reviewSearchInput");
  if (toolbar && !searchInput) {
    searchInput = document.createElement("input");
    searchInput.id = "reviewSearchInput";
    searchInput.placeholder = "Search by Code, Name, Unit";
    toolbar.appendChild(searchInput);
  }
  if (searchInput && !searchInput.dataset.bound) {
    searchInput.addEventListener("input", (e) => {
      reviewSearchText = e.target.value.toLowerCase();
      renderReviewStage1Rows(summaryCache);
    });
    searchInput.dataset.bound = "true";
  }

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

// ---------------------------------------------------------
// NEW UX REQUIREMENT: Dedicated Review Dialog Logic
// ---------------------------------------------------------

window.openIndividualReviewModal = function(reviewId) {
    const review = (currentStage2Items || []).find(r => String(r.id) === String(reviewId));
    if (!review) return;

    pendingReviewDecision = { review };
    const isReadonly = review.status !== 'Pending';
    const disableAttr = isReadonly ? 'disabled' : '';

    document.getElementById("indRevTitle").textContent = isReadonly ? "View Review Decisions" : "Review Excess Transactions";
    document.getElementById("indRevSubtitle").textContent = `${review.employee_code} - ${review.employee_name} | ${review.item_name}`;

    // Section 1: Employee Summary
    document.getElementById("indRevSummary").innerHTML = `
        <article style="background: var(--panel); padding: 14px; border: 1px solid var(--line); border-radius: 6px;">
            <span style="color: var(--muted); font-size: 12px;">Total Issued</span>
            <strong style="display: block; font-size: 20px; margin-top: 4px;">${Number(review.issued_qty || 0)}</strong>
        </article>
        <article style="background: var(--panel); padding: 14px; border: 1px solid var(--line); border-radius: 6px;">
            <span style="color: var(--muted); font-size: 12px;">Total Allowed</span>
            <strong style="display: block; font-size: 20px; margin-top: 4px;">${review.allowed_qty !== null ? Number(review.allowed_qty) : 'No Policy'}</strong>
        </article>
        <article style="background: var(--panel); padding: 14px; border: 1px solid var(--line); border-radius: 6px;">
            <span style="color: var(--muted); font-size: 12px;">Total Excess</span>
            <strong class="text-amber" style="display: block; font-size: 20px; margin-top: 4px;">${Number(review.excess_qty || 0)}</strong>
        </article>
    `;

    // Section 2: Past Two Year History
    const monthNames = ["", "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    const historyHtml = (review.history_items || []).map(hist => {
      const monthStr = hist.issue_month ? monthNames[Number(hist.issue_month)] : '-';
      return `
        <tr style="background: #111821;">
            <td style="padding: 10px; border: 1px solid var(--line);">${hist.issue_date ? hist.issue_date.split('T')[0] : '-'}</td>
            <td style="padding: 10px; border: 1px solid var(--line);"><strong>${Number(hist.quantity)}</strong></td>
            <td style="padding: 10px; border: 1px solid var(--line);">${escapeHtml(hist.unit || '-')}</td>
            <td style="padding: 10px; border: 1px solid var(--line);">${hist.issue_year || '-'} ${monthStr}</td>
            <td style="padding: 10px; border: 1px solid var(--line); color: var(--muted);">${escapeHtml(hist.remarks || '-')}</td>
        </tr>
      `;
    }).join('');
    document.getElementById("indRevHistoryRows").innerHTML = historyHtml || '<tr><td colspan="5" style="padding: 10px; border: 1px solid var(--line); color: var(--muted); text-align: center;">No history found.</td></tr>';

    // Section 3: Individual Excess Transaction Review
    if ((review.child_items || []).length === 0) {
       document.getElementById("indRevTransactions").innerHTML = `
          <div style="padding: 16px; background: #3a2027; color: var(--red); border-radius: 4px; border: 1px solid #69363c;">
              <strong>Notice:</strong> Transaction details are missing for this record. Please click <strong>Recalculate Reviews</strong> on the previous screen to rebuild individual transaction data.
          </div>
       `;
       document.getElementById("indRevSaveBtn").disabled = true;
    } else {
        const issuesHtml = (review.child_items || []).map((child, idx) => {
            const action = child.decision || 'Pending';
            const monthStr = child.issue_month ? monthNames[Number(child.issue_month)] : '-';
            
            return `
                <div class="panel flush" style="margin-bottom: 16px;">
                    <div style="padding: 16px; border-bottom: 1px solid var(--line); display: flex; justify-content: space-between; align-items: center; background: #131922;">
                        <span style="font-weight: bold; font-size: 14px; color: var(--ink);">Issue #${idx + 1}</span>
                        <span style="color: var(--muted); font-size: 13px;">${child.issue_date ? child.issue_date.split('T')[0] : '-'}</span>
                    </div>
                    <div style="padding: 16px; display: grid; grid-template-columns: 1fr 1fr; gap: 12px; font-size: 13px; background: var(--panel);">
                        <div><span style="color: var(--muted);">Excess Quantity:</span> <strong>${Number(child.quantity)}</strong></div>
                        ${child.issue_year ? `<div><span style="color: var(--muted);">Financial Year:</span> ${child.issue_year}</div>` : ''}
                        ${child.issue_month ? `<div><span style="color: var(--muted);">Distribution Month:</span> ${monthStr}</div>` : ''}
                        ${child.issue_remarks ? `<div style="grid-column: 1 / -1;"><span style="color: var(--muted);">Original Remarks:</span> ${escapeHtml(child.issue_remarks)}</div>` : ''}
                    </div>
                    <div style="padding: 16px; border-top: 1px solid var(--line); background: #0f141b;">
                        <div style="margin-bottom: 14px; display: flex; align-items: center; flex-wrap: wrap; font-size: 14px; font-weight: 600;">
                            <span style="color: var(--muted); margin-right: 16px;">Decision:</span>
                            <label style="margin-right: 16px; cursor: pointer; display: flex; align-items: center; gap: 6px;"><input type="radio" name="action_${review.id}_${child.id}" value="Pending" ${action==='Pending'?'checked':''} ${disableAttr} onchange="updateIndividualReviewSummary(${review.id})"> <span class="text-amber">Pending</span></label>
                            <label style="margin-right: 16px; cursor: pointer; display: flex; align-items: center; gap: 6px;"><input type="radio" name="action_${review.id}_${child.id}" value="Deduct" ${action==='Deduct'?'checked':''} ${disableAttr} onchange="updateIndividualReviewSummary(${review.id})"> <span class="text-red">Deduct</span></label>
                            <label style="margin-right: 16px; cursor: pointer; display: flex; align-items: center; gap: 6px;"><input type="radio" name="action_${review.id}_${child.id}" value="Waive" ${action==='Waive'?'checked':''} ${disableAttr} onchange="updateIndividualReviewSummary(${review.id})"> <span class="text-green">Waive</span></label>
                            <label style="cursor: pointer; display: flex; align-items: center; gap: 6px;"><input type="radio" name="action_${review.id}_${child.id}" value="Hold" ${action==='Hold'?'checked':''} ${disableAttr} onchange="updateIndividualReviewSummary(${review.id})"> <span class="text-blue">Hold</span></label>
                        </div>
                        <div style="display: flex; align-items: center; gap: 12px;">
                            <span style="color: var(--muted); font-size: 13px;">Remarks:</span>
                            <input type="text" id="remarks_${review.id}_${child.id}" value="${escapeHtml(child.remarks || '')}" placeholder="Optional justification for this transaction decision..." style="flex: 1; padding: 8px 12px; font-size: 13px; background: #111821; color: #fff; border: 1px solid var(--line); border-radius: 4px;" ${disableAttr}>
                        </div>
                    </div>
                </div>
            `;
        }).join('');
        document.getElementById("indRevTransactions").innerHTML = issuesHtml;
    }

    // Section 4 & 5 Init
    updateIndividualReviewSummary(review.id);

    document.getElementById("indRevGeneralReason").value = review.reason || '';
    document.getElementById("indRevGeneralReason").disabled = isReadonly;
    document.getElementById("indRevApprovedBy").disabled = isReadonly;
    
    // Hide save button entirely if readonly
    document.getElementById("indRevSaveBtn").style.display = isReadonly ? 'none' : 'block';

    document.getElementById("individualReviewModal").classList.add("show");
};

window.updateIndividualReviewSummary = function(reviewId) {
    const review = (currentStage2Items || []).find(r => String(r.id) === String(reviewId));
    if (!review) return;
    
    let deductQty = 0;
    let waiveQty = 0;
    let holdQty = 0;
    let decidedCount = 0;
    
    (review.child_items || []).forEach(child => {
        const radios = document.getElementsByName(`action_${reviewId}_${child.id}`);
        let action = child.decision;
        if (radios.length > 0) {
            for (const r of radios) {
                if (r.checked) action = r.value;
            }
        }
        
        if (action === 'Deduct') { deductQty += Number(child.quantity); decidedCount++; }
        if (action === 'Waive') { waiveQty += Number(child.quantity); decidedCount++; }
        if (action === 'Hold') { holdQty += Number(child.quantity); decidedCount++; }
    });
    
    const rate = Number(review.live_rate !== undefined ? review.live_rate : (review.item_cost || 0));
    const amount = deductQty * rate;

    document.getElementById("indRevCalculatedTotals").innerHTML = `
        <div><span style="color: var(--muted); margin-right: 8px;">Total Deduct Qty:</span> <strong style="font-size: 16px;" id="indRevSumDeduct" class="text-red">${deductQty}</strong></div>
        <div><span style="color: var(--muted); margin-right: 8px;">Total Waive Qty:</span> <strong style="font-size: 16px;" id="indRevSumWaive" class="text-green">${waiveQty}</strong></div>
        <div><span style="color: var(--muted); margin-right: 8px;">Total Hold Qty:</span> <strong style="font-size: 16px;" id="indRevSumHold" class="text-blue">${holdQty}</strong></div>
        <div><span style="color: var(--muted); margin-right: 8px;">Total Recovery Amount:</span> <strong style="font-size: 16px;" id="indRevSumAmount" class="text-red">₹${amount.toFixed(2)}</strong></div>
    `;
    
    const saveBtn = document.getElementById("indRevSaveBtn");
    const msgEl = document.getElementById("indRevSaveMsg");
    if (saveBtn && review.status === 'Pending') {
        if (decidedCount === 0 && (review.child_items || []).length > 0) {
            saveBtn.disabled = true;
            if (msgEl) msgEl.textContent = "Please select a decision for at least one transaction.";
        } else {
            saveBtn.disabled = false;
            if (msgEl) msgEl.textContent = "";
        }
    }
};

window.closeIndividualReviewModal = function() {
    pendingReviewDecision = null;
    document.getElementById("individualReviewModal").classList.remove("show");
};

window.openItemReviewModal = function(...reviewIds) {
    const reviews = (currentStage2Items || []).filter((review) => reviewIds.map(String).includes(String(review.id)) && review.status === 'Pending');
    if (!reviews.length) return;

    pendingReviewDecision = { reviews };
    const firstReview = reviews[0];
    const issuedQty = reviews.reduce((sum, review) => sum + Number(review.issued_qty || 0), 0);
    const allowedQty = reviews.some((review) => review.allowed_qty === null) ? 'No Policy' : reviews.reduce((sum, review) => sum + Number(review.allowed_qty || 0), 0);
    const excessQty = reviews.reduce((sum, review) => sum + Number(review.excess_qty || 0), 0);

    document.getElementById("indRevTitle").textContent = "Review Excess Transactions";
    document.getElementById("indRevSubtitle").textContent = `${firstReview.employee_code} - ${firstReview.employee_name} | ${firstReview.item_name}`;
    document.getElementById("indRevSummary").innerHTML = `
        <article style="background: var(--panel); padding: 14px; border: 1px solid var(--line); border-radius: 6px;"><span style="color: var(--muted); font-size: 12px;">Total Issued</span><strong style="display: block; font-size: 20px; margin-top: 4px;">${issuedQty}</strong></article>
        <article style="background: var(--panel); padding: 14px; border: 1px solid var(--line); border-radius: 6px;"><span style="color: var(--muted); font-size: 12px;">Total Allowed</span><strong style="display: block; font-size: 20px; margin-top: 4px;">${allowedQty}</strong></article>
        <article style="background: var(--panel); padding: 14px; border: 1px solid var(--line); border-radius: 6px;"><span style="color: var(--muted); font-size: 12px;">Total Excess</span><strong class="text-amber" style="display: block; font-size: 20px; margin-top: 4px;">${excessQty}</strong></article>
    `;
    
    const monthNames = ["", "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    const historyHtml = (firstReview.history_items || []).map(hist => {
        const monthStr = hist.issue_month ? monthNames[Number(hist.issue_month)] : '-';
        return `
            <tr style="background: #111821;">
                <td style="padding: 10px; border: 1px solid var(--line);">${hist.issue_date ? hist.issue_date.split('T')[0] : '-'}</td>
                <td style="padding: 10px; border: 1px solid var(--line);"><strong>${Number(hist.quantity)}</strong></td>
                <td style="padding: 10px; border: 1px solid var(--line);">${escapeHtml(hist.unit || '-')}</td>
                <td style="padding: 10px; border: 1px solid var(--line);">${hist.issue_year || '-'} ${monthStr}</td>
                <td style="padding: 10px; border: 1px solid var(--line); color: var(--muted);">${escapeHtml(hist.remarks || '-')}</td>
            </tr>
        `;
    }).join('');
    
    document.getElementById("indRevHistoryRows").innerHTML = historyHtml || '<tr><td colspan="5" style="padding: 10px; border: 1px solid var(--line); color: var(--muted); text-align: center;">No history found for the previous two years.</td></tr>';

    document.getElementById("indRevTransactions").innerHTML = reviews.map((review, index) => {
        const child = (review.child_items || [])[0];
        if (!child) return '';
        return `
            <div class="panel flush" style="margin-bottom: 16px;">
                <div style="padding: 16px; border-bottom: 1px solid var(--line); background: #131922;"><span style="font-weight: bold; font-size: 14px; color: var(--ink);">Review ${index + 1}</span></div>
                <div style="padding: 16px; border-top: 1px solid var(--line); background: #0f141b;">
                    <div style="margin-bottom: 14px; display: flex; align-items: center; flex-wrap: wrap; font-size: 14px; font-weight: 600;">
                        <span style="color: var(--muted); margin-right: 16px;">Decision:</span>
                        <label style="margin-right: 16px; cursor: pointer;"><input type="radio" name="group_action_${review.id}" value="Deduct" onchange="updateGroupedReviewSummary()"> <span class="text-red">Deduct</span></label>
                        <label style="margin-right: 16px; cursor: pointer;"><input type="radio" name="group_action_${review.id}" value="Waive" onchange="updateGroupedReviewSummary()"> <span class="text-green">Waive</span></label>
                        <label style="cursor: pointer;"><input type="radio" name="group_action_${review.id}" value="Hold" onchange="updateGroupedReviewSummary()"> <span class="text-blue">Hold</span></label>
                    </div>
                    <input type="text" id="group_remarks_${review.id}" placeholder="Optional justification" style="width: 100%; box-sizing: border-box; padding: 8px 12px; font-size: 13px; background: #111821; color: #fff; border: 1px solid var(--line); border-radius: 4px;">
                    <div style="margin-top: 12px;">
                        <button type="button" class="primary" onclick="saveItemReviewDecision(${review.id})">Save</button>
                        <span id="group_save_msg_${review.id}" style="margin-left: 10px; color: var(--muted); font-size: 13px;"></span>
                    </div>
                </div>
            </div>
        `;
    }).join('');
    document.getElementById("indRevGeneralReason").value = firstReview.reason || '';
    document.getElementById("indRevGeneralReason").disabled = false;
    document.getElementById("indRevApprovedBy").disabled = false;
    document.getElementById("indRevSaveBtn").style.display = 'none';
    document.getElementById("indRevSaveMsg").textContent = "";
    window.updateGroupedReviewSummary();
    document.getElementById("individualReviewModal").classList.add("show");
};

window.updateGroupedReviewSummary = function() {
    const reviews = pendingReviewDecision?.reviews || [];
    let deductQty = 0;
    let waiveQty = 0;
    let holdQty = 0;
    let recoveryAmount = 0;

    reviews.forEach((review) => {
        const action = Array.from(document.getElementsByName(`group_action_${review.id}`)).find((radio) => radio.checked)?.value || 'Pending';
        const quantity = Number((review.child_items || [])[0]?.quantity || review.excess_qty || 0);
        if (action === 'Deduct') {
            deductQty += quantity;
            recoveryAmount += quantity * Number(review.live_rate !== undefined ? review.live_rate : (review.item_cost || 0));
        } else if (action === 'Waive') waiveQty += quantity;
        else if (action === 'Hold') holdQty += quantity;
    });

    document.getElementById("indRevCalculatedTotals").innerHTML = `<div><span style="color: var(--muted); margin-right: 8px;">Total Deduct Qty:</span> <strong class="text-red">${deductQty}</strong></div><div><span style="color: var(--muted); margin-right: 8px;">Total Waive Qty:</span> <strong class="text-green">${waiveQty}</strong></div><div><span style="color: var(--muted); margin-right: 8px;">Total Hold Qty:</span> <strong class="text-blue">${holdQty}</strong></div><div><span style="color: var(--muted); margin-right: 8px;">Total Recovery Amount:</span> <strong class="text-red">₹${recoveryAmount.toFixed(2)}</strong></div>`;
    const decided = deductQty + waiveQty + holdQty;
    document.getElementById("indRevSaveMsg").textContent = decided === 0 ? "Select a decision for a review below." : "";
};

window.saveItemReviewDecision = async function(reviewId) {
    if (!desktopApi || !pendingReviewDecision?.reviews) return;
    const review = pendingReviewDecision.reviews.find((row) => String(row.id) === String(reviewId));
    const child = (review?.child_items || [])[0];
    if (!review || !child) return;

    const action = Array.from(document.getElementsByName(`group_action_${review.id}`)).find((radio) => radio.checked)?.value || 'Pending';
    if (action === 'Pending') {
        const msg = document.getElementById(`group_save_msg_${review.id}`);
        if (msg) msg.textContent = "Select Deduct, Waive, or Hold.";
        return;
    }

    try {
        await window.uniformManager.updateReview({
            id: review.id,
            approved_by: document.getElementById("indRevApprovedBy").value,
            reason: document.getElementById("indRevGeneralReason").value,
            issue_decisions: [{
                id: child.id,
                decision: action,
                remarks: document.getElementById(`group_remarks_${review.id}`)?.value || '',
                quantity: child.quantity
            }],
            status: 'Completed'
        });
        state = await window.uniformManager.getState({ distributionLimit });
        pendingReviewDecision.reviews = pendingReviewDecision.reviews.filter((row) => String(row.id) !== String(review.id));
        await loadReviewStage2(currentEmpData);
        if (pendingReviewDecision.reviews.length) {
            openItemReviewModal(...pendingReviewDecision.reviews.map((row) => row.id));
        } else {
            closeIndividualReviewModal();
        }
        toast("Review decision saved.");
    } catch (error) {
        showImportError(error.message || "Review decision failed.");
    }
};

document.getElementById("individualReviewForm")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!desktopApi || !pendingReviewDecision) return;

    if (Array.isArray(pendingReviewDecision.reviews)) {
        return;
    }

    if (!pendingReviewDecision.review) return;
    
    const review = pendingReviewDecision.review;
    
    const decisions = [];
    let hasPending = false;
    
    (review.child_items || []).forEach(child => {
        const radios = document.getElementsByName(`action_${review.id}_${child.id}`);
        let action = child.decision || 'Pending';
        for (const r of radios) {
            if (r.checked) action = r.value;
        }
        const remarksInput = document.getElementById(`remarks_${review.id}_${child.id}`);
        
        decisions.push({
            id: child.id,
            decision: action,
            remarks: remarksInput ? remarksInput.value : '',
            quantity: child.quantity
        });
        
        if (action === 'Pending') hasPending = true;
    });
    
    if (hasPending) {
        if (!confirm("Some issue transactions are still marked as 'Pending'. Are you sure you want to save?")) {
            return;
        }
    }
    
    try {
        const payload = {
            id: review.id,
            approved_by: document.getElementById("indRevApprovedBy").value,
            reason: document.getElementById("indRevGeneralReason").value,
            issue_decisions: decisions,
            status: 'Completed'
        };
        
        await window.uniformManager.updateReview(payload);
        state = await window.uniformManager.getState({ distributionLimit });
        
        render();
        closeIndividualReviewModal();
        toast(`Decisions explicitly saved for Review #${review.id}.`);
    } catch (error) {
        showImportError(error.message || "Review decision failed.");
    }
});


// ---------------------------------------------------------
// COMPACT SUMMARY CARDS LOGIC
// ---------------------------------------------------------

async function loadReviewStage2(emp) {
  selectedReviewEmployee = emp.employee_code;
  currentEmpData = emp;
  document.getElementById("reviewStage1").style.display = "none";
  document.getElementById("reviewStage2").style.display = "block";

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
    
    let counts = { Pending: 0, Deducted: 0, Waived: 0, Held: 0, Completed: 0 };
    let amounts = { Pending: 0, Deducted: 0, Waived: 0, Held: 0, Completed: 0 };
    let grandTotal = 0;

    const reviewRows = currentStage2Items;
    reviewRows.forEach((row) => {
      const status = row.status || "Pending";
      const rate = Number(row.live_rate !== undefined ? row.live_rate : (row.item_cost || 0));
      const amount = Number(row.sum_deduct || 0) * rate;
      if (counts[status] !== undefined) counts[status]++;
      if (amounts[status] !== undefined) amounts[status] += amount;
      grandTotal += amount;
    });

    const itemGroups = new Map();
    reviewRows.forEach((row) => {
      const key = String(row.item_name || "").trim().toLowerCase();
      if (!itemGroups.has(key)) itemGroups.set(key, []);
      itemGroups.get(key).push(row);
    });

    const groupedReviewItems = Array.from(itemGroups.values()).map((rows) => {
      const firstRow = rows[0];
      const pendingRows = rows.filter((row) => (row.status || "Pending") === "Pending");
      const reviewAmount = rows.reduce((sum, row) => {
        const rate = Number(row.live_rate !== undefined ? row.live_rate : (row.item_cost || 0));
        return sum + (Number(row.sum_deduct || 0) * rate);
      }, 0);

      return {
        ...firstRow,
        status: pendingRows.length ? "Pending" : (firstRow.status || "Completed"),
        issued_qty: rows.reduce((sum, row) => sum + Number(row.issued_qty || 0), 0),
        allowed_qty: rows.some((row) => row.allowed_qty === null) ? null : rows.reduce((sum, row) => sum + Number(row.allowed_qty || 0), 0),
        excess_qty: rows.reduce((sum, row) => sum + Number(row.excess_qty || 0), 0),
        sum_deduct: rows.reduce((sum, row) => sum + Number(row.sum_deduct || 0), 0),
        sum_waive: rows.reduce((sum, row) => sum + Number(row.sum_waive || 0), 0),
        sum_hold: rows.reduce((sum, row) => sum + Number(row.sum_hold || 0), 0),
        units: Array.from(new Set(rows.map((row) => String(row.unit || "").trim()).filter(Boolean))).join(", "),
        reviewRows: rows,
        reviewAmount,
      };
    });

    document.getElementById("reviewStage2Cards").innerHTML = groupedReviewItems.map(row => {
      const status = row.status || 'Pending';
      const rate = Number(row.live_rate !== undefined ? row.live_rate : (row.item_cost || 0));
      
      let borderColor = 'var(--line)';
      if (status === 'Pending') borderColor = 'var(--amber)';
      else if (status === 'Deducted') borderColor = 'var(--red)';
      else if (status === 'Waived' || status === 'Completed') borderColor = 'var(--green)';
      else if (status === 'Held') borderColor = 'var(--blue)';

      const initialDeductQty = Number(row.sum_deduct || 0);
      const initialWaiveQty = Number(row.sum_waive || 0);
      const initialHoldQty = Number(row.sum_hold || 0);
      
      const amount = row.reviewAmount;
      
      const pendingReviewCount = row.reviewRows.filter((review) => (review.status || 'Pending') === 'Pending').length;
      const reviewIds = row.reviewRows.map((review) => review.id).join(', ');
      const actionsHtml = pendingReviewCount
        ? `<button type="button" class="primary" onclick="openItemReviewModal(${reviewIds})" style="width: 100%;">Review</button>`
        : '';

      return `
        <div class="panel review-card" style="margin: 0; padding: 18px; border-left: 4px solid ${borderColor}; display: flex; flex-direction: column;">
          <h4 style="margin: 0 0 16px 0; border-bottom: 1px solid var(--line); padding-bottom: 12px; font-size: 16px; color: var(--ink);">
            ${escapeHtml(row.item_name)}
          </h4>
          <div style="font-size: 13px; line-height: 1.8; flex-grow: 1;">
            <div><span style="color: var(--muted);">Employee:</span> <strong>${escapeHtml(row.employee_name)}</strong> <span style="color: var(--muted);">(${escapeHtml(row.employee_code)})</span></div>
            <div><span style="color: var(--muted);">Unit:</span> ${escapeHtml(row.units)}</div>
            <div style="display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 8px; margin: 16px 0; padding: 16px 0; border-top: 1px dashed var(--line); border-bottom: 1px dashed var(--line); background: #111821; border-radius: 6px;">
              <div style="text-align: center;"><small style="color:var(--muted); display:block; line-height: 1.2; text-transform: uppercase; font-size: 11px; margin-bottom: 4px;">Issued</small><strong style="font-size: 16px;">${Number(row.issued_qty || 0)}</strong></div>
              <div style="text-align: center; border-left: 1px solid var(--line); border-right: 1px solid var(--line);"><small style="color:var(--muted); display:block; line-height: 1.2; text-transform: uppercase; font-size: 11px; margin-bottom: 4px;">Allowed</small><strong style="font-size: 16px;">${row.allowed_qty !== null ? Number(row.allowed_qty) : 'No Policy'}</strong></div>
              <div style="text-align: center;"><small style="color:var(--muted); display:block; line-height: 1.2; text-transform: uppercase; font-size: 11px; margin-bottom: 4px;">Excess</small><strong class="text-amber" style="font-size: 16px;">${Number(row.excess_qty || 0)}</strong></div>
            </div>
            
            <div style="display: flex; justify-content: space-between; align-items: center;">
                <div><span style="color: var(--muted);">Recovery:</span> <strong class="text-red" style="font-size: 15px;">₹${amount.toFixed(2)}</strong></div>
                <div><span class="badge ${escapeHtml(status)}">${escapeHtml(reviewStatusLabel(status))}</span></div>
            </div>
            
            <div style="display: flex; justify-content: space-between; gap: 16px; margin-top: 16px; padding-top: 16px; border-top: 1px dashed var(--line); color: var(--muted); font-size: 12px; text-transform: uppercase;">
               <span>Deduct: <strong class="text-red" style="font-size: 14px;">${initialDeductQty}</strong></span>
               <span>Waive: <strong class="text-green" style="font-size: 14px;">${initialWaiveQty}</strong></span>
               <span>Hold: <strong class="text-blue" style="font-size: 14px;">${initialHoldQty}</strong></span>
            </div>
          </div>
          
          <div style="margin-top: 20px; border-top: 1px solid var(--line); padding-top: 16px;">
             <strong style="display: block; margin-bottom: 10px;">Pending Reviews: ${pendingReviewCount}</strong>
              ${actionsHtml}
          </div>
        </div>
      `;
    }).join("") || `<div class="empty" style="grid-column: 1 / -1;">No review items found.</div>`;

    document.getElementById("sumCountPending").textContent = counts.Pending;
    document.getElementById("sumCountCompleted").textContent = counts.Completed;
    document.getElementById("sumCountDeducted").textContent = counts.Deducted;
    document.getElementById("sumCountWaived").textContent = counts.Waived;
    document.getElementById("sumCountHeld").textContent = counts.Held;

    document.getElementById("sumAmtPending").textContent = `₹${amounts.Pending.toFixed(2)}`;
    document.getElementById("sumAmtCompleted").textContent = `₹${amounts.Completed.toFixed(2)}`;
    document.getElementById("sumAmtDeducted").textContent = `₹${amounts.Deducted.toFixed(2)}`;
    document.getElementById("sumAmtTotal").textContent = `₹${grandTotal.toFixed(2)}`;

  } catch (error) {
    showImportError(error.message || "Failed to load items.");
  } finally {
    document.getElementById("reviewStage2Loading").style.display = "none";
    document.getElementById("reviewStage2Content").style.display = "block";
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

document.getElementById("recalculateReviewsBtn")?.addEventListener("click", async () => {
  if (!desktopApi) return showImportError("Works only in Desktop App.");
  try {
    startProgress();
    const result = await window.uniformManager.recalculateReviews();
    state = await window.uniformManager.getState({ distributionLimit });
    stopProgress();
    render();
    setView("review");
    toast(`Review queue recalculated.`);
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