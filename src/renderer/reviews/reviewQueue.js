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
    searchInput.setAttribute("data-smart-picker", "employees");
    searchInput.setAttribute("autocomplete", "off");
    searchInput.placeholder = "Search by Code or Name";
    toolbar.appendChild(searchInput);
  }
  if (searchInput && !searchInput.dataset.bound) {
    searchInput.addEventListener("input", (e) => {
      reviewSearchText = e.target.value.toLowerCase();
      renderReviewStage1Rows(summaryCache);
    });
    searchInput.addEventListener("change", (e) => {
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
    const searchStr = `${text(emp.employee_code)} ${text(emp.employee_name)}`.toLowerCase();
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
        const issuesHtml = (review.child_items || []).map((child) => {
            const action = child.decision || 'Pending';
            const monthStr = child.issue_month ? monthNames[Number(child.issue_month)] : '-';
            
            return `
                <div class="panel flush" style="margin-bottom: 16px;">
                    <div style="padding: 16px; border-bottom: 1px solid var(--line); display: flex; justify-content: space-between; align-items: center; background: #131922;">
                        <span style="font-weight: bold; font-size: 14px; color: var(--ink);">${escapeHtml(review.unit || 'Unknown Unit')} — ${escapeHtml(review.item_name || 'Item')}</span>
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
    const wasOpen = document.getElementById("individualReviewModal").classList.contains("show");
    pendingReviewDecision = null;
    reviewNowTarget = null;
    document.getElementById("individualReviewModal").classList.remove("show");
    if (wasOpen && currentEmpData && selectedReviewEmployee) {
        document.getElementById("reviewStage1").style.display = "none";
        document.getElementById("reviewStage2").style.display = "block";
        refreshReviewEmployeeSummary();
    }
};

async function refreshReviewEmployeeSummary() {
    const employeeCode = selectedReviewEmployee;
    if (!employeeCode || !currentEmpData) return;
    try {
        summaryCache = await window.uniformManager.getReviewQueueStage1();
        const refreshed = summaryCache.find((employee) => String(employee.employee_code) === String(employeeCode));
        currentEmpData = refreshed || { ...currentEmpData, pending_item_count: 0, estimated_deduction: 0 };
        document.getElementById("stg2Count").textContent = text(currentEmpData.pending_item_count || 0);
        document.getElementById("stg2Amount").textContent = `₹${Number(currentEmpData.estimated_deduction || 0).toFixed(2)}`;
        await loadReviewStage2(currentEmpData);
    } catch (error) {
        showImportError(error.message || "Failed to refresh the review summary.");
    }
}

window.openItemReviewModal = function(...reviewIds) {
    const requestedIds = reviewIds.map(String);
    let reviews = (currentStage2Items || []).filter((review) => requestedIds.includes(String(review.id)) && Number(review.remaining_qty ?? review.excess_qty ?? 0) > 0);
    const target = reviewNowTarget;
    if (target && requestedIds.includes(String(target.reviewId))) {
        reviews = reviews.filter((review) => String(review.id) === String(target.reviewId)).map((review) => {
            const child = (review.child_items || []).find((item) => String(item.id) === String(target.itemId));
            if (!child) return null;
            return { ...review, remaining_qty: Number(target.quantity), child_items: [{ ...child, remaining_quantity: Number(target.quantity), held_quantity: 0 }] };
        }).filter(Boolean);
    }
    if (!reviews.length) return;

    pendingReviewDecision = { reviews, reviewIds: requestedIds, target: target || null };
    const firstReview = reviews[0];
    const uniqueScopes = new Map();
    reviews.forEach((review) => {
        const key = review.calculation_scope_key || `${String(review.item_name || '').toLowerCase()}|${review.financial_year || review.issue_year || ''}|${String(review.unit || '').toLowerCase()}`;
        if (!uniqueScopes.has(key)) uniqueScopes.set(key, review);
    });
    const scopedReviews = [...uniqueScopes.values()];
    const issuedQty = scopedReviews.reduce((sum, review) => sum + Number(review.issued_qty || 0), 0);
    const allowedQty = scopedReviews.some((review) => review.allowed_qty === null) ? 'No Policy' : scopedReviews.reduce((sum, review) => sum + Number(review.allowed_qty || 0), 0);
    const excessQty = reviews.reduce((sum, review) => sum + Number(review.excess_qty || 0), 0);

    document.getElementById("indRevTitle").textContent = "Review Excess Transactions";
    document.getElementById("indRevSubtitle").textContent = `${firstReview.employee_code} - ${firstReview.employee_name} | ${firstReview.item_name}`;
    document.getElementById("indRevSummary").innerHTML = `
        <article style="background: var(--panel); padding: 14px; border: 1px solid var(--line); border-radius: 6px;"><span style="color: var(--muted); font-size: 12px;">Total Issued</span><strong style="display: block; font-size: 20px; margin-top: 4px;">${issuedQty}</strong></article>
        <article style="background: var(--panel); padding: 14px; border: 1px solid var(--line); border-radius: 6px;"><span style="color: var(--muted); font-size: 12px;">Total Allowed</span><strong style="display: block; font-size: 20px; margin-top: 4px;">${allowedQty}</strong></article>
        <article style="background: var(--panel); padding: 14px; border: 1px solid var(--line); border-radius: 6px;"><span style="color: var(--muted); font-size: 12px;">Total Excess</span><strong class="text-amber" style="display: block; font-size: 20px; margin-top: 4px;">${excessQty}</strong></article>
    `;
    
    const monthNames = ["", "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    const historyItems = [...new Map(reviews.flatMap((review) => review.history_items || []).map((hist) => [String(hist.id), hist])).values()];
    const historyTitle = document.getElementById("indRevHistoryTitle");
    if (historyTitle) {
        const years = [...new Set(reviews.map((review) => Number(review.financial_year)).filter(Number.isInteger))].sort((a, b) => a - b);
        historyTitle.textContent = years.length ? `Distribution History — FY ${years.map((year) => `${year}–${String(year + 1).slice(-2)}`).join(', FY ')}` : 'Distribution History';
    }
    const historyHtml = historyItems.map(hist => {
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
    
    document.getElementById("indRevHistoryRows").innerHTML = historyHtml || '<tr><td colspan="5" style="padding: 10px; border: 1px solid var(--line); color: var(--muted); text-align: center;">No distribution history found for this calculation scope.</td></tr>';

    document.getElementById("indRevTransactions").innerHTML = reviews.map((review) => {
        const unitName = review.unit || 'Unknown Unit';
        const itemName = review.item_name || 'Item';
        const issued = Number(review.issued_qty || 0);
        const allowed = review.allowed_qty !== null ? Number(review.allowed_qty) : 'No Policy';
        const excess = Number(review.excess_qty || 0);
        const distributionDates = [...new Set((review.child_items || []).map((child) => child.issue_date).filter(Boolean).map((date) => String(date).split('T')[0]))];
        const previouslyDeducted = Number(review.sum_deduct || 0);
        const previouslyWaived = Number(review.sum_waive || 0);
        const previouslyHeld = target ? 0 : Number(review.sum_hold || 0);
        const wasHeld = (review.child_items || []).some((child) => child.previously_held && Number(child.remaining_quantity || 0) > 0);
        const remainingQty = Math.max(0, Number(review.remaining_qty ?? (excess - previouslyDeducted - previouslyWaived - previouslyHeld)));

        const quickActions = remainingQty === 1
            ? `<button type="button" class="secondary" onclick="saveItemReviewDecision(${review.id}, 'Deduct')">Deduct</button>
               <button type="button" class="secondary" onclick="saveItemReviewDecision(${review.id}, 'Waive')">Waive</button>
               <button type="button" class="secondary" onclick="saveItemReviewDecision(${review.id}, 'Hold')">Hold</button>`
            : `<button type="button" class="secondary" onclick="saveItemReviewDecision(${review.id}, 'Deduct')">Deduct All</button>
               <button type="button" class="secondary" onclick="saveItemReviewDecision(${review.id}, 'Waive')">Waive All</button>
               <button type="button" class="secondary" onclick="saveItemReviewDecision(${review.id}, 'Hold')">Hold All</button>
               <button type="button" class="secondary" onclick="toggleReviewSplit(${review.id}, true)">Split Decision</button>`;

        return `
            <div class="panel flush" style="margin-bottom: 16px;">
                <div style="padding: 16px; border-bottom: 1px solid var(--line); background: #131922; display: flex; justify-content: space-between; align-items: center;">
                    <span style="font-weight: bold; font-size: 15px; color: var(--ink);">${target || wasHeld ? 'Previously Held — Review Required · ' : ''}${escapeHtml(unitName)} — ${escapeHtml(itemName)}</span>
                    ${distributionDates.length ? `<span style="color: var(--muted); font-size: 12px;">Distribution${distributionDates.length > 1 ? ' dates' : ' date'}: ${escapeHtml(distributionDates.join(', '))}</span>` : ''}
                </div>
                <div style="padding: 16px; display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 12px; font-size: 13px; background: var(--panel);">
                    <div><span style="color: var(--muted); display: block; margin-bottom: 4px;">Issued Quantity</span><strong style="font-size: 16px;">${issued}</strong></div>
                    <div><span style="color: var(--muted); display: block; margin-bottom: 4px;">Allowed Quantity</span><strong style="font-size: 16px;">${allowed}</strong></div>
                    <div><span style="color: var(--muted); display: block; margin-bottom: 4px;">Original Excess Quantity</span><strong class="text-amber" style="font-size: 16px;">${excess}</strong></div>
                </div>
                <div style="padding: 16px; border-top: 1px solid var(--line); background: #0f141b;">
                    <div style="display: flex; gap: 16px; flex-wrap: wrap; color: var(--muted); font-size: 12px; margin-bottom: 14px;">
                        <span>Previously deducted: <strong class="text-red">${previouslyDeducted}</strong></span>
                        <span>Previously waived: <strong class="text-green">${previouslyWaived}</strong></span>
                        <span>Previously held: <strong class="text-blue">${previouslyHeld}</strong></span>
                        <span>Remaining undecided: <strong id="group_remaining_${review.id}" class="text-amber">${remainingQty}</strong></span>
                    </div>
                    ${remainingQty > 0 ? `<div id="group_quick_${review.id}" style="display:flex; gap:8px; flex-wrap:wrap; margin-bottom:14px;">${quickActions}</div>` : '<div style="color:var(--muted); margin-bottom:14px;">All excess quantity has been processed.</div>'}
                    <div id="group_split_${review.id}" style="display:none;">
                    <div style="display: grid; grid-template-columns: repeat(3, minmax(120px, 1fr)); gap: 12px; margin-bottom: 14px;">
                        <label class="text-red">Deduct Quantity<input type="number" id="group_deduct_${review.id}" min="0" step="1" value="0" oninput="updateGroupedReviewSummary()" style="display:block; width:100%; box-sizing:border-box; margin-top:6px; padding:8px 10px; background:#111821; color:#fff; border:1px solid var(--line); border-radius:4px;"></label>
                        <label class="text-green">Waive Quantity<input type="number" id="group_waive_${review.id}" min="0" step="1" value="0" oninput="updateGroupedReviewSummary()" style="display:block; width:100%; box-sizing:border-box; margin-top:6px; padding:8px 10px; background:#111821; color:#fff; border:1px solid var(--line); border-radius:4px;"></label>
                        <label class="text-blue">Hold Quantity<input type="number" id="group_hold_${review.id}" min="0" step="1" value="0" oninput="updateGroupedReviewSummary()" style="display:block; width:100%; box-sizing:border-box; margin-top:6px; padding:8px 10px; background:#111821; color:#fff; border:1px solid var(--line); border-radius:4px;"></label>
                    </div>
                    <div id="group_validation_${review.id}" style="font-size:12px; color:var(--muted); margin-bottom:10px;">Allocate all ${remainingQty} remaining units to save.</div>
                    <div style="margin-top: 12px;">
                        <button type="button" class="primary" id="group_save_${review.id}" onclick="saveItemReviewDecision(${review.id})" ${remainingQty === 0 ? 'disabled' : ''}>Save Split Decision</button>
                        <button type="button" class="secondary" onclick="toggleReviewSplit(${review.id}, false)">Cancel Split</button>
                        <span id="group_save_msg_${review.id}" style="margin-left: 10px; color: var(--muted); font-size: 13px;"></span>
                    </div>
                    </div>
                    ${remainingQty > 0 ? `<input type="text" id="group_remarks_${review.id}" placeholder="Optional justification" style="width: 100%; box-sizing: border-box; padding: 8px 12px; font-size: 13px; background: #111821; color: #fff; border: 1px solid var(--line); border-radius: 4px;">` : ''}
                </div>
            </div>
        `;
    }).join('');
    
    document.getElementById("indRevGeneralReason").value = firstReview.reason || '';
    document.getElementById("indRevGeneralReason").disabled = false;
    document.getElementById("indRevApprovedBy").disabled = false;
    document.getElementById("indRevSaveBtn").style.display = 'none';
    document.getElementById("indRevSaveMsg").textContent = "";
    document.getElementById("indRevSaveBtn").style.display = 'inline-block';
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
        const values = ['deduct', 'waive', 'hold'].map((kind) => document.getElementById(`group_${kind}_${review.id}`)?.value ?? '0');
        const quantities = values.map((value) => value === '' ? NaN : Number(value));
        const selected = quantities.reduce((sum, value) => sum + (Number.isFinite(value) ? value : 0), 0);
        const remaining = Math.max(0, Number(review.remaining_qty ?? review.excess_qty));
        const validWhole = quantities.every((value) => Number.isInteger(value) && value >= 0);
        const valid = validWhole && selected === remaining && remaining > 0;
        const validation = document.getElementById(`group_validation_${review.id}`);
        const saveButton = document.getElementById(`group_save_${review.id}`);
        if (validation) validation.textContent = remaining === 0 ? 'Completed: all excess quantity has been processed.' : (!validWhole ? 'Enter non-negative whole numbers only.' : (selected > remaining ? `Selected total exceeds the ${remaining} remaining units.` : (selected < remaining ? `${remaining - selected} excess quantity remains undecided.` : 'Ready to save.')));
        if (saveButton) saveButton.disabled = !valid;
        if (validWhole) {
            deductQty += quantities[0];
            waiveQty += quantities[1];
            holdQty += quantities[2];
            recoveryAmount += quantities[0] * Number(review.live_rate !== undefined ? review.live_rate : (review.item_cost || 0));
        }
        const remainingLabel = document.getElementById(`group_remaining_${review.id}`);
        if (remainingLabel && validWhole) {
            const unallocated = remaining - selected;
            remainingLabel.textContent = unallocated < 0 ? `Over by ${Math.abs(unallocated)}` : String(unallocated);
        }
    });

    document.getElementById("indRevCalculatedTotals").innerHTML = `<div><span style="color: var(--muted); margin-right: 8px;">Total Deduct Qty:</span> <strong class="text-red">${deductQty}</strong></div><div><span style="color: var(--muted); margin-right: 8px;">Total Waive Qty:</span> <strong class="text-green">${waiveQty}</strong></div><div><span style="color: var(--muted); margin-right: 8px;">Total Hold Qty:</span> <strong class="text-blue">${holdQty}</strong></div><div><span style="color: var(--muted); margin-right: 8px;">Total Recovery Amount:</span> <strong class="text-red">₹${recoveryAmount.toFixed(2)}</strong></div>`;
    if (reviews.length) document.getElementById("indRevSaveMsg").textContent = "Each card must allocate its full remaining undecided quantity before saving.";
};

function renderReviewSession() {
    const ids = pendingReviewDecision?.reviewIds || [];
    const pending = (currentStage2Items || []).filter((review) => ids.includes(String(review.id)) && Number(review.remaining_qty ?? review.excess_qty ?? 0) > 0);
    if (pending.length) {
        window.openItemReviewModal(...pending.map((review) => review.id));
        return;
    }
    pendingReviewDecision = { reviews: [], reviewIds: ids };
    document.getElementById("indRevTitle").textContent = "Review Excess Transactions";
    const employee = currentEmpData || currentStage2Items[0] || {};
    document.getElementById("indRevSubtitle").textContent = `${employee.employee_code || ''} - ${employee.employee_name || ''} | Review session`;
    document.getElementById("indRevSummary").innerHTML = '<article style="background:var(--panel);padding:14px;border:1px solid var(--line);border-radius:6px;"><span style="color:var(--muted);font-size:12px;">Session Status</span><strong class="text-green" style="display:block;font-size:20px;margin-top:4px;">Completed</strong></article>';
    document.getElementById("indRevTransactions").innerHTML = '<div class="panel" style="padding:18px;color:var(--green);font-weight:600;">All reviews completed. You can close this window when ready.</div>';
    document.getElementById("indRevCalculatedTotals").innerHTML = '<div class="text-green" style="font-weight:600;">All selected review quantities have been processed.</div>';
    document.getElementById("indRevSaveMsg").textContent = "All reviews completed. Close this window when ready.";
    document.getElementById("indRevSaveBtn").style.display = 'none';
    document.getElementById("individualReviewModal").classList.add("show");
}

window.toggleReviewSplit = function(reviewId, show) {
    const split = document.getElementById(`group_split_${reviewId}`);
    const quick = document.getElementById(`group_quick_${reviewId}`);
    if (split) split.style.display = show ? 'block' : 'none';
    if (quick) quick.style.display = show ? 'none' : 'flex';
    if (!show) {
        ['deduct', 'waive', 'hold'].forEach((kind) => {
            const input = document.getElementById(`group_${kind}_${reviewId}`);
            if (input) input.value = '0';
        });
        const msg = document.getElementById(`group_save_msg_${reviewId}`);
        if (msg) msg.textContent = '';
        window.updateGroupedReviewSummary();
    }
};

window.saveItemReviewDecision = async function(reviewId, quickDecision = null) {
    if (!desktopApi || !pendingReviewDecision?.reviews) return;
    const review = pendingReviewDecision.reviews.find((row) => String(row.id) === String(reviewId));
    if (!review) return;
    if (document.getElementById("indRevApprovedBy").value.trim() === '' || document.getElementById("indRevGeneralReason").value.trim() === '') {
        document.getElementById("indRevSaveMsg").textContent = 'Enter the approval name and general reason before saving.';
        return;
    }

    const remainingQty = Math.max(0, Number(review.remaining_qty ?? review.excess_qty));
    const quantities = { deduct: 0, waive: 0, hold: 0 };
    if (quickDecision) {
        const key = String(quickDecision).toLowerCase();
        if (!['deduct', 'waive', 'hold'].includes(key) || remainingQty < 1) return;
        quantities[key] = remainingQty;
    } else {
        quantities.deduct = document.getElementById(`group_deduct_${review.id}`)?.value;
        quantities.waive = document.getElementById(`group_waive_${review.id}`)?.value;
        quantities.hold = document.getElementById(`group_hold_${review.id}`)?.value;
    }
    const nums = Object.values(quantities).map((value) => value === '' ? NaN : Number(value));
    const total = nums.reduce((sum, value) => sum + (Number.isFinite(value) ? value : 0), 0);
    const remaining = Number(review.remaining_qty ?? review.excess_qty);
    if (nums.some((value) => !Number.isInteger(value) || value < 0) || total !== remaining) {
        const msg = document.getElementById(`group_save_msg_${review.id}`);
        if (msg) msg.textContent = total > remaining ? 'Selected quantity exceeds the remaining excess.' : `${Math.max(0, remaining - total)} quantity remains undecided.`;
        return;
    }

    try {
        const target = pendingReviewDecision.target;
        const payload = {
            id: review.id,
            approved_by: document.getElementById("indRevApprovedBy").value,
            reason: document.getElementById("indRevGeneralReason").value,
            remarks: document.getElementById(`group_remarks_${review.id}`)?.value || '',
            status: 'Completed',
        };
        if (target) {
            payload.issue_decisions = [{ id: Number(target.itemId), quantity: remaining, decision: 'Pending', allocations: { Deduct: Number(quantities.deduct), Waive: Number(quantities.waive), Hold: Number(quantities.hold) } }];
        } else {
            payload.quantity_decisions = Object.fromEntries(Object.entries(quantities).map(([kind, value]) => [kind, Number(value)]));
        }
        await window.uniformManager.updateReview(payload);
        state = await window.uniformManager.getState({ distributionLimit });
        if (typeof renderDeductions === "function") renderDeductions();
        const sessionIds = pendingReviewDecision.reviewIds || pendingReviewDecision.reviews.map((row) => String(row.id));
        await loadReviewStage2(currentEmpData, { preserveModal: true });
        if (target) {
            reviewNowTarget = { ...target, completed: true };
            pendingReviewDecision = { reviews: [], reviewIds: sessionIds, target: reviewNowTarget };
            document.getElementById("indRevTransactions").innerHTML = '<div class="panel" style="padding:18px;color:var(--green);font-weight:600;">The selected held quantity has been processed. Close this window when ready.</div>';
            document.getElementById("indRevCalculatedTotals").innerHTML = '<div class="text-green" style="font-weight:600;">Selected held quantity reviewed and saved.</div>';
            document.getElementById("indRevSaveMsg").textContent = 'This selected held quantity is complete. Close the window when ready.';
            document.getElementById("indRevSaveBtn").style.display = 'none';
            await window.loadHeldRecordsPage?.();
        } else {
            pendingReviewDecision = { reviews: [], reviewIds: sessionIds };
            renderReviewSession();
        }
        toast("Review decision saved.");
    } catch (error) {
        showImportError(error.message || "Review decision failed.");
    }
};

window.openHeldQuantityReview = async function({ reviewId, itemId, quantity, employeeCode }) {
    try {
        startProgress();
        const stage1 = await window.uniformManager.getReviewQueueStage1();
        const summary = stage1.find((item) => String(item.employee_code) === String(employeeCode));
        const rows = await window.uniformManager.getReviewQueueStage2(employeeCode);
        const review = rows.find((item) => String(item.id) === String(reviewId));
        const child = review?.child_items?.find((item) => String(item.id) === String(itemId));
        if (!review || !child || Number(child.held_quantity || 0) < Number(quantity)) throw new Error('Held quantity changed. Refresh Held Records and try again.');
        const emp = summary || { employee_code: review.employee_code, employee_name: review.employee_name, current_unit: review.unit, payroll_month: review.issue_period_label, pending_item_count: 1, estimated_deduction: 0 };
        await loadReviewStage2(emp);
        reviewNowTarget = { reviewId: Number(reviewId), itemId: Number(itemId), quantity: Number(quantity) };
        window.setView?.('review');
        window.openItemReviewModal(Number(reviewId));
    } catch (error) {
        showImportError(error.message || 'Unable to open the held quantity for review.');
    } finally {
        stopProgress();
    }
};

window.openManageHoldModal = function(...reviewIds) {
    const heldItems = (currentStage2Items || []).flatMap((review) => {
        if (!reviewIds.map(String).includes(String(review.id))) return [];
        return (review.child_items || [])
            .filter((child) => Number(child.held_quantity || 0) > 0)
            .map((child) => ({ review, child }));
    });
    if (!heldItems.length) return toast('No held quantity remains. Refresh the Review Queue.');

    const employee = heldItems[0].review;
    const overallHeld = heldItems.reduce((sum, { child }) => sum + Number(child.held_quantity || 0), 0);
    document.getElementById('manageHoldDetails').innerHTML = `
        <div style="color:var(--muted); margin-bottom:12px;">${escapeHtml(employee.employee_code)} — ${escapeHtml(employee.employee_name)} · ${escapeHtml(employee.item_name)}</div>
        ${heldItems.map(({ review, child }) => `
          <article class="panel flush" style="padding:12px; margin:10px 0;">
            <div><strong>${escapeHtml(review.unit || 'Unknown Unit')}</strong> · ${child.issue_date ? escapeHtml(String(child.issue_date).split('T')[0]) : 'No distribution date'} · Transaction #${Number(child.id)}</div>
            <div style="display:grid; grid-template-columns:repeat(auto-fit,minmax(115px,1fr)); gap:8px; margin-top:10px; font-size:12px;">
              <span>Original excess: <strong>${Number(review.excess_qty || 0)}</strong></span>
              <span>Deducted: <strong class="text-red">${Number(review.sum_deduct || 0)}</strong></span>
              <span>Waived: <strong class="text-green">${Number(review.sum_waive || 0)}</strong></span>
              <span>Held here: <strong class="text-blue">${Number(child.held_quantity || 0)}</strong></span>
              <span>Item held total: <strong class="text-blue">${overallHeld}</strong></span>
              <span>Remaining undecided: <strong class="text-amber">${Number(child.remaining_quantity || 0)}</strong></span>
            </div>
          </article>`).join('')}
    `;
    const form = document.getElementById('manageHoldForm');
    const selected = heldItems[0];
    document.getElementById('manageHoldReviewId').value = selected.review.id;
    document.getElementById('manageHoldItemId').value = selected.child.id;
    const quantityInput = document.getElementById('manageHoldQuantity');
    quantityInput.max = String(Number(selected.child.held_quantity));
    quantityInput.value = String(Number(selected.child.held_quantity));
    document.getElementById('manageHoldReason').value = '';
    form.dataset.heldItems = JSON.stringify(heldItems.map(({ review, child }) => ({ reviewId: review.id, itemId: child.id, max: Number(child.held_quantity) })));
    const modal = document.getElementById('manageHoldModal');
    modal.classList.add('show');
    modal.setAttribute('aria-hidden', 'false');
};

window.closeManageHoldModal = function() {
    const modal = document.getElementById('manageHoldModal');
    modal.classList.remove('show');
    modal.setAttribute('aria-hidden', 'true');
    document.getElementById('manageHoldReviewId').value = '';
    document.getElementById('manageHoldItemId').value = '';
    document.getElementById('manageHoldDetails').innerHTML = '';
    document.getElementById('manageHoldReason').value = '';
};
document.getElementById('closeManageHoldModal')?.addEventListener('click', window.closeManageHoldModal);
document.getElementById('manageHoldModal')?.addEventListener('click', (event) => {
    if (event.target.id === 'manageHoldModal') window.closeManageHoldModal();
});
document.getElementById('manageHoldForm')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const submitter = event.submitter;
    const decision = submitter?.dataset.holdResolution;
    const reviewId = Number(document.getElementById('manageHoldReviewId').value);
    const itemId = Number(document.getElementById('manageHoldItemId').value);
    const quantity = Number(document.getElementById('manageHoldQuantity').value);
    const max = Number(document.getElementById('manageHoldQuantity').max);
    const reason = document.getElementById('manageHoldReason').value.trim();
    if (!['Deduct', 'Waive', 'Hold'].includes(decision)) return;
    if (!Number.isInteger(quantity) || quantity <= 0 || quantity > max) return toast(`Enter a whole quantity between 1 and ${max}.`);
    if (!reason) return toast('A reason is required.');
    try {
        startProgress();
        state = await window.uniformManager.resolveHeldQuantity({ reviewId, itemId, quantity, decision, reason, resolvedBy: 'Admin' });
        stopProgress();
        window.closeManageHoldModal();
        if (currentEmpData) await loadReviewStage2(currentEmpData);
        if (typeof renderDeductions === 'function') renderDeductions();
        if (typeof window.renderCorrectionCentre === 'function') window.renderCorrectionCentre();
        if (typeof window.renderCorrectionHistory === 'function') window.renderCorrectionHistory();
        toast('Held quantity updated and recorded in correction history.');
    } catch (error) {
        stopProgress();
        showImportError(error.message || 'Failed to resolve held quantity.');
    }
});

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
        const sessionIds = pendingReviewDecision.reviewIds || [String(review.id)];
        await loadReviewStage2(currentEmpData, { preserveModal: true });
        pendingReviewDecision = { reviews: [], reviewIds: sessionIds };
        renderReviewSession();
        toast(`Decisions explicitly saved for Review #${review.id}.`);
    } catch (error) {
        showImportError(error.message || "Review decision failed.");
    }
});

async function loadReviewStage2(emp, { preserveModal = false } = {}) {
  const reviewModal = document.getElementById("individualReviewModal");
  const modalWasOpen = reviewModal?.classList.contains("show");
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
    const refreshedSummary = await window.uniformManager.getReviewQueueStage1();
    const refreshedEmployee = refreshedSummary.find((row) => String(row.employee_code) === String(emp.employee_code));
    currentEmpData = refreshedEmployee || { ...emp, pending_item_count: 0, estimated_deduction: 0 };
    emp = currentEmpData;
    document.getElementById("stg2Count").textContent = text(emp.pending_item_count || 0);
    document.getElementById("stg2Amount").textContent = `₹${Number(emp.estimated_deduction || 0).toFixed(2)}`;
    
    let counts = { Pending: 0, Deducted: 0, Waived: 0, Held: 0, Completed: 0 };
    let amounts = { Pending: 0, Deducted: 0, Waived: 0, Held: 0, Completed: 0 };
    let grandTotal = 0;

    const reviewRows = currentStage2Items;
    reviewRows.forEach((row) => {
      const remaining = Math.max(0, Number(row.remaining_qty ?? row.excess_qty ?? 0));
      const status = remaining > 0 ? "Pending" : (Number(row.sum_hold || 0) > 0 ? "Held" : "Completed");
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
      const uniqueScopes = new Map();
      rows.forEach((row) => {
        const key = row.calculation_scope_key || `${String(row.item_name || '').toLowerCase()}|${row.financial_year || row.issue_year || ''}|${String(row.unit || '').toLowerCase()}`;
        if (!uniqueScopes.has(key)) uniqueScopes.set(key, row);
      });
      const scopeRows = [...uniqueScopes.values()];
      const pendingRows = rows.filter((row) => Math.max(0, Number(row.remaining_qty ?? row.excess_qty ?? 0)) > 0);
      const heldQty = rows.reduce((sum, row) => sum + Number(row.sum_hold || 0), 0);
      const remainingQty = rows.reduce((sum, row) => sum + Math.max(0, Number(row.remaining_qty ?? row.excess_qty ?? 0)), 0);
      const reviewAmount = rows.reduce((sum, row) => {
        const rate = Number(row.live_rate !== undefined ? row.live_rate : (row.item_cost || 0));
        return sum + (Number(row.sum_deduct || 0) * rate);
      }, 0);

      return {
        ...firstRow,
        status: remainingQty > 0 ? "Pending" : (heldQty > 0 ? "Held" : "Completed"),
        issued_qty: scopeRows.reduce((sum, row) => sum + Number(row.issued_qty || 0), 0),
        allowed_qty: scopeRows.some((row) => row.allowed_qty === null) ? null : scopeRows.reduce((sum, row) => sum + Number(row.allowed_qty || 0), 0),
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
      
      const pendingReviewRows = row.reviewRows.filter((review) => Math.max(0, Number(review.remaining_qty ?? review.excess_qty ?? 0)) > 0);
      const pendingReviewCount = pendingReviewRows.length;
      const heldRows = row.reviewRows.filter((review) => Number(review.sum_hold || 0) > 0 && (review.child_items || []).some((child) => Number(child.held_quantity || 0) > 0));
      const reviewIds = pendingReviewRows.map((review) => review.id).join(', ');
      const actionsHtml = pendingReviewCount
        ? `<button type="button" class="primary" onclick="openItemReviewModal(${reviewIds})" style="width: 100%;">Review</button>`
        : '';
      const manageHoldHtml = heldRows.length
        ? `<button type="button" class="secondary" onclick="openManageHoldModal(${heldRows.map((review) => review.id).join(',')})" style="width:100%; ${pendingReviewCount ? 'margin-top:8px;' : ''}">Manage Hold</button>`
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
              ${manageHoldHtml}
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
    if (preserveModal && modalWasOpen) reviewModal.classList.add("show");
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
      loadReviewStage2(empData, { preserveModal: document.getElementById("individualReviewModal")?.classList.contains("show") });
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
window.refreshReviewQueue = renderReviews;

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

// ---------------------------------------------------------
// CORRECTION CENTRE & CORRECTION HISTORY LOGIC
// ---------------------------------------------------------

let corrEmpSearch = "";
let corrUnitSearch = "";
let corrItemSearch = "";
let corrFySearch = "";
let corrMonthSearch = "";
let corrDecisionSearch = "";

let histEmpSearch = "";
let histUnitSearch = "";
let histItemSearch = "";
let histFySearch = "";
let histMonthSearch = "";
let histDecisionSearch = "";

const monthNames = ["", "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

window.renderCorrectionCentre = function() {
    const records = (state.correctionCentreRecords || []).filter(r => {
        if (corrEmpSearch && !String(r.employee_code).toLowerCase().includes(corrEmpSearch) && !String(r.employee_name).toLowerCase().includes(corrEmpSearch)) return false;
        if (corrUnitSearch && !String(r.unit).toLowerCase().includes(corrUnitSearch)) return false;
        if (corrItemSearch && !String(r.item_name).toLowerCase().includes(corrItemSearch)) return false;
        if (corrFySearch && String(r.issue_year || "") !== corrFySearch) return false;
        if (corrMonthSearch && String(r.issue_month || "") !== corrMonthSearch) return false;
        if (corrDecisionSearch && String(r.record_type || "") !== corrDecisionSearch) return false;
        return true;
    });

    const html = records.map(r => `
        <tr>
            <td>${text(r.employee_code)}</td>
            <td>${text(r.employee_name)}</td>
            <td>${text(r.unit)}</td>
            <td>${text(r.item_name)}</td>
            <td>${r.issue_month ? monthNames[Number(r.issue_month)] : '-'}</td>
            <td>${text(r.issue_year || '-')}</td>
            <td><span class="badge ${r.record_type}">${text(r.record_type)}</span></td>
            <td>${r.reviewed_at ? r.reviewed_at.split('T')[0] : '-'}</td>
            <td class="reason">${text(r.remarks)}</td>
            <td>
                <div class="row-actions">
                    <button class="primary" data-correct-item="${r.id}">Correct</button>
                </div>
            </td>
        </tr>
    `).join('') || `<tr><td colspan="10" class="empty">No correctable decisions found.</td></tr>`;

    const tbody = document.getElementById("correctionRows");
    if (tbody) tbody.innerHTML = html;
};

window.renderCorrectionHistory = function() {
    const records = (state.correctionHistory || []).filter(r => {
        if (histEmpSearch && !String(r.employee_code).toLowerCase().includes(histEmpSearch) && !String(r.employee_name).toLowerCase().includes(histEmpSearch)) return false;
        if (histUnitSearch && !String(r.unit).toLowerCase().includes(histUnitSearch)) return false;
        if (histItemSearch && !String(r.item_name).toLowerCase().includes(histItemSearch)) return false;
        if (histFySearch && String(r.issue_year || "") !== histFySearch) return false;
        if (histMonthSearch && String(r.issue_month || "") !== histMonthSearch) return false;
        
        if (histDecisionSearch && String(r.new_decision || "") !== histDecisionSearch && String(r.old_decision || "") !== histDecisionSearch) return false;
        
        return true;
    });

    const html = records.map(r => {
        const dateObj = r.created_at ? new Date(r.created_at) : null;
        const dateStr = dateObj ? dateObj.toISOString().split('T')[0] : '-';
        const timeStr = dateObj ? dateObj.toLocaleTimeString() : '-';

        return `
        <tr>
            <td>${text(r.employee_code)}</td>
            <td>${text(r.employee_name)}</td>
            <td>${text(r.unit)}</td>
            <td>${text(r.item_name)}</td>
            <td>${r.issue_month ? monthNames[Number(r.issue_month)] : '-'}</td>
            <td>${text(r.issue_year || '-')}</td>
            <td><span class="badge ${r.old_decision}">${text(r.old_decision)}</span></td>
            <td><span class="badge ${r.new_decision}">${text(r.new_decision)}</span></td>
            <td class="reason">${text(r.reason)}${r.old_quantity !== null && r.old_quantity !== undefined ? `<br><small>Quantity: ${Number(r.old_quantity)} → ${Number(r.new_quantity || 0)}</small>` : ''}</td>
            <td>${dateStr}</td>
            <td>${timeStr}</td>
        </tr>
    `}).join('') || `<tr><td colspan="11" class="empty">No corrections have been made yet.</td></tr>`;

    const tbody = document.getElementById("correctionHistoryRows");
    if (tbody) tbody.innerHTML = html;
};

document.addEventListener("input", (e) => {
    if (e.target.id === "correction_search_emp") { corrEmpSearch = e.target.value.toLowerCase(); window.renderCorrectionCentre(); }
    else if (e.target.id === "correction_search_unit") { corrUnitSearch = e.target.value.toLowerCase(); window.renderCorrectionCentre(); }
    else if (e.target.id === "correction_search_item") { corrItemSearch = e.target.value.toLowerCase(); window.renderCorrectionCentre(); }
    else if (e.target.id === "correction_search_fy") { corrFySearch = e.target.value.trim(); window.renderCorrectionCentre(); }
    
    else if (e.target.id === "history_search_emp") { histEmpSearch = e.target.value.toLowerCase(); window.renderCorrectionHistory(); }
    else if (e.target.id === "history_search_unit") { histUnitSearch = e.target.value.toLowerCase(); window.renderCorrectionHistory(); }
    else if (e.target.id === "history_search_item") { histItemSearch = e.target.value.toLowerCase(); window.renderCorrectionHistory(); }
    else if (e.target.id === "history_search_fy") { histFySearch = e.target.value.trim(); window.renderCorrectionHistory(); }
});

document.addEventListener("change", (e) => {
    if (e.target.id === "correction_search_emp") { corrEmpSearch = e.target.value.toLowerCase(); window.renderCorrectionCentre(); }
    else if (e.target.id === "correction_search_unit") { corrUnitSearch = e.target.value.toLowerCase(); window.renderCorrectionCentre(); }
    else if (e.target.id === "correction_search_item") { corrItemSearch = e.target.value.toLowerCase(); window.renderCorrectionCentre(); }
    else if (e.target.id === "correction_search_fy") { corrFySearch = e.target.value.trim(); window.renderCorrectionCentre(); }
    else if (e.target.id === "correction_search_month") { corrMonthSearch = e.target.value; window.renderCorrectionCentre(); }
    else if (e.target.id === "correction_search_decision") { corrDecisionSearch = e.target.value; window.renderCorrectionCentre(); }

    else if (e.target.id === "history_search_emp") { histEmpSearch = e.target.value.toLowerCase(); window.renderCorrectionHistory(); }
    else if (e.target.id === "history_search_unit") { histUnitSearch = e.target.value.toLowerCase(); window.renderCorrectionHistory(); }
    else if (e.target.id === "history_search_item") { histItemSearch = e.target.value.toLowerCase(); window.renderCorrectionHistory(); }
    else if (e.target.id === "history_search_fy") { histFySearch = e.target.value.trim(); window.renderCorrectionHistory(); }
    else if (e.target.id === "history_search_month") { histMonthSearch = e.target.value; window.renderCorrectionHistory(); }
    else if (e.target.id === "history_search_decision") { histDecisionSearch = e.target.value; window.renderCorrectionHistory(); }
});

document.addEventListener("click", (e) => {
    if (e.target.id === "correction_clear_filters") {
        const ids = ["correction_search_emp", "correction_search_unit", "correction_search_item", "correction_search_fy", "correction_search_month", "correction_search_decision"];
        ids.forEach(id => { const el = document.getElementById(id); if (el) el.value = ""; });
        corrEmpSearch = corrUnitSearch = corrItemSearch = corrFySearch = corrMonthSearch = corrDecisionSearch = "";
        if (typeof window.renderCorrectionCentre === "function") window.renderCorrectionCentre();
    }
    else if (e.target.id === "history_clear_filters") {
        const ids = ["history_search_emp", "history_search_unit", "history_search_item", "history_search_fy", "history_search_month", "history_search_decision"];
        ids.forEach(id => { const el = document.getElementById(id); if (el) el.value = ""; });
        histEmpSearch = histUnitSearch = histItemSearch = histFySearch = histMonthSearch = histDecisionSearch = "";
        if (typeof window.renderCorrectionHistory === "function") window.renderCorrectionHistory();
    }

    const btn = e.target.closest("[data-correct-item]");
    if (btn) {
        const itemId = btn.dataset.correctItem;
        const record = (state.correctionCentreRecords || []).find(r => String(r.id) === itemId);
        if (record) {
            document.getElementById("corrItemId").value = record.id;
            document.getElementById("corrCurrentDecision").textContent = record.record_type;
            document.getElementById("corrNewDecision").value = "";
            document.getElementById("corrReason").value = "";
            document.getElementById("correctionModal").classList.add("show");
        }
    }

    if (e.target.closest("#closeCorrectionModal")) {
        document.getElementById("correctionModal").classList.remove("show");
    }
});

document.addEventListener("submit", async (e) => {
    if (e.target.id === "correctionForm") {
        e.preventDefault();
        const itemId = document.getElementById("corrItemId").value;
        const newDecision = document.getElementById("corrNewDecision").value;
        const reason = document.getElementById("corrReason").value;

        if (!reason.trim()) return toast("Correction reason is mandatory.");
        if (!newDecision) return toast("Please select a new decision.");

        try {
            startProgress();
            state = await window.uniformManager.correctDecision({ itemId, newDecision, reason, correctedBy: 'Admin' });
            stopProgress();
            document.getElementById("correctionModal").classList.remove("show");
            
            if (typeof window.renderCorrectionCentre === "function") window.renderCorrectionCentre();
            if (typeof window.renderCorrectionHistory === "function") window.renderCorrectionHistory();
            if (typeof renderDeductions === "function") renderDeductions();
            toast("Correction successfully recorded and locked.");
        } catch (err) {
            stopProgress();
            showImportError(err.message || "Failed to apply correction.");
        }
    }
});
