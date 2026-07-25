const views = {
  dashboard: ["Dashboard", "Import distribution data and review excess uniform cases."],
  import: ["Import Excel", "Inspect workbook sheets before importing distribution data."],
  employees: ["Employees", "Search and review imported employee records."],
  issues: ["Distribution Register", "Employee-wise uniform quantity matrix."],
  deductions: ["Payroll Register", "Live deduction, waive and hold registers from review decisions."],
  review: ["Review Queue", "Resolve records that need office staff attention."],
  correction: ["Correction Centre", "Correct finalized review decisions safely."],
  correction_history: ["Correction History", "Audit log of all corrected review decisions."],
  policies: ["Unit Entitlements", "Set allowed uniform quantity for each unit/company and item."],
  reset: ["Data Management", "Backup, restore, or securely reset application data."],
  
  // Analytics
  analytics_monthly: ["Monthly Analytics", "Analyze distribution data filtered strictly by Month & Year."],
  analytics_yearly: ["Yearly Analytics", "View global distribution operations overview across an entire year."],
  analytics_unit: ["Unit Wise Analytics", "Pinpoint distribution costs, trends, and top items by client branch."],
  analytics_item: ["Item Wise Analytics", "Track inventory item distribution lifecycles globally."],
  analytics_employee: ["Employee Wise Analytics", "Review long-term history and costs attached to specific personnel."],

  // Custom Reports
  payroll_deduction_summary: ["Payroll Deduction Summary", "Excel-style matrix summary of finalized payroll deductions."]
};

function setView(name) {
  if (!views[name]) return;
  
  document.querySelectorAll(".view").forEach((el) => {
      el.classList.toggle("active", el.id === name);
  });
  
  document.querySelectorAll(".nav-button").forEach((el) => {
      el.classList.toggle("active", el.dataset.view === name);
  });
  
  const titleEl = document.getElementById("viewTitle");
  const subtitleEl = document.getElementById("viewSubtitle");
  
  if (titleEl) titleEl.textContent = views[name][0];
  if (subtitleEl) subtitleEl.textContent = views[name][1];
  
  // Sub-module specific re-renders when navigating
  if (name === "deductions" && typeof state !== 'undefined' && typeof renderDeductions === "function") {
    renderDeductions();
  }
  if (name === "correction" && typeof state !== 'undefined' && typeof window.renderCorrectionCentre === "function") {
    window.renderCorrectionCentre();
  }
  if (name === "correction_history" && typeof state !== 'undefined' && typeof window.renderCorrectionHistory === "function") {
    window.renderCorrectionHistory();
  }
}

async function loadState() {
  if (typeof desktopApi === 'undefined' || !desktopApi) {
    if (typeof showImportError === 'function') {
        showImportError(
          "Uniform Manager was opened in a web browser, so Excel import and local database access are not available.\n\n" +
          "Please close this browser tab and start the desktop app using Start Uniform Manager.bat or run npm start from the Application folder."
        );
    }
    const dbPathEl = document.getElementById("dbPath");
    if (dbPathEl) dbPathEl.textContent = "Desktop app not running";
    return;
  }
  
  try {
    const distributionLimit = typeof window.distributionLimit !== 'undefined' ? window.distributionLimit : 1000;
    state = await window.uniformManager.getState({ distributionLimit });
    
    if (typeof render === "function") {
        render();
    }
  } catch (error) {
    if (typeof showImportError === 'function') {
        showImportError("Failed to load state: " + error.message);
    } else {
        console.error("Failed to load state:", error);
    }
  }
}

function injectCorrectionUI() {
    if (document.getElementById("correction")) return;
    
    const navMiddle = document.querySelector(".sidebar-section-middle");
    if (navMiddle) {
        const btnCorrection = document.createElement("button");
        btnCorrection.className = "nav-button";
        btnCorrection.dataset.view = "correction";
        btnCorrection.textContent = "Correction Centre";
        
        const btnHistory = document.createElement("button");
        btnHistory.className = "nav-button";
        btnHistory.dataset.view = "correction_history";
        btnHistory.textContent = "Correction History";

        const analyticsHeader = navMiddle.querySelector(".nav-header");
        if (analyticsHeader) {
            navMiddle.insertBefore(btnCorrection, analyticsHeader);
            navMiddle.insertBefore(btnHistory, analyticsHeader);
        } else {
            navMiddle.appendChild(btnCorrection);
            navMiddle.appendChild(btnHistory);
        }
    }

    const main = document.querySelector("main");
    if (main) {
        // 1. Correction Centre
        const correctionSection = document.createElement("section");
        correctionSection.className = "view";
        correctionSection.id = "correction";
        correctionSection.innerHTML = `
            <div class="toolbar" style="display: flex; gap: 10px; background: #111821; padding: 12px; border-radius: 6px; border: 1px solid var(--line); flex-wrap: wrap; align-items: center;">
                <input type="text" id="correction_search_emp" data-smart-picker="employees" autocomplete="off" placeholder="Employee Code or Name" style="flex: 1; min-width: 160px;" />
                <input type="text" id="correction_search_unit" data-smart-picker="units" autocomplete="off" placeholder="Unit" style="flex: 1; min-width: 120px;" />
                <input type="text" id="correction_search_item" data-smart-picker="items" autocomplete="off" placeholder="Item" style="flex: 1; min-width: 120px;" />
                
                <input type="text" id="correction_search_fy" data-smart-picker="fys" autocomplete="off" placeholder="Fin. Year" style="width: 100px;" />
                <select id="correction_search_month" style="width: 130px;">
                    <option value="">All Months</option>
                    <option value="1">January</option>
                    <option value="2">February</option>
                    <option value="3">March</option>
                    <option value="4">April</option>
                    <option value="5">May</option>
                    <option value="6">June</option>
                    <option value="7">July</option>
                    <option value="8">August</option>
                    <option value="9">September</option>
                    <option value="10">October</option>
                    <option value="11">November</option>
                    <option value="12">December</option>
                </select>
                <select id="correction_search_decision" style="width: 140px;">
                    <option value="">All Decisions</option>
                    <option value="Deduct">Deduct</option>
                    <option value="Waive">Waive</option>
                    <option value="Hold">Hold</option>
                </select>
                <button type="button" class="secondary" id="correction_clear_filters" style="white-space: nowrap;">Clear Filters</button>
            </div>
            <div class="panel flush">
                <div class="table-wrap">
                    <table>
                        <thead>
                            <tr>
                                <th>Employee Code</th>
                                <th>Name</th>
                                <th>Unit</th>
                                <th>Item</th>
                                <th>Month</th>
                                <th>Financial Year</th>
                                <th>Decision</th>
                                <th>Decision Date</th>
                                <th>Reason</th>
                                <th>Action</th>
                            </tr>
                        </thead>
                        <tbody id="correctionRows"></tbody>
                    </table>
                </div>
            </div>
        `;
        main.appendChild(correctionSection);
        
        // 2. Correction History
        const historySection = document.createElement("section");
        historySection.className = "view";
        historySection.id = "correction_history";
        historySection.innerHTML = `
            <div class="toolbar" style="display: flex; gap: 10px; background: #111821; padding: 12px; border-radius: 6px; border: 1px solid var(--line); flex-wrap: wrap; align-items: center;">
                <input type="text" id="history_search_emp" data-smart-picker="employees" autocomplete="off" placeholder="Employee Code or Name" style="flex: 1; min-width: 160px;" />
                <input type="text" id="history_search_unit" data-smart-picker="units" autocomplete="off" placeholder="Unit" style="flex: 1; min-width: 120px;" />
                <input type="text" id="history_search_item" data-smart-picker="items" autocomplete="off" placeholder="Item" style="flex: 1; min-width: 120px;" />
                
                <input type="text" id="history_search_fy" data-smart-picker="fys" autocomplete="off" placeholder="Fin. Year" style="width: 100px;" />
                <select id="history_search_month" style="width: 130px;">
                    <option value="">All Months</option>
                    <option value="1">January</option>
                    <option value="2">February</option>
                    <option value="3">March</option>
                    <option value="4">April</option>
                    <option value="5">May</option>
                    <option value="6">June</option>
                    <option value="7">July</option>
                    <option value="8">August</option>
                    <option value="9">September</option>
                    <option value="10">October</option>
                    <option value="11">November</option>
                    <option value="12">December</option>
                </select>
                <select id="history_search_decision" style="width: 140px;">
                    <option value="">All Decisions</option>
                    <option value="Deduct">Deduct</option>
                    <option value="Waive">Waive</option>
                    <option value="Hold">Hold</option>
                </select>
                <button type="button" class="secondary" id="history_clear_filters" style="white-space: nowrap;">Clear Filters</button>
            </div>
            <div class="panel flush">
                <div class="table-wrap">
                    <table>
                        <thead>
                            <tr>
                                <th>Employee Code</th>
                                <th>Name</th>
                                <th>Unit</th>
                                <th>Item</th>
                                <th>Month</th>
                                <th>Financial Year</th>
                                <th>Original Decision</th>
                                <th>Corrected Decision</th>
                                <th>Correction Reason</th>
                                <th>Correction Date</th>
                                <th>Correction Time</th>
                            </tr>
                        </thead>
                        <tbody id="correctionHistoryRows"></tbody>
                    </table>
                </div>
            </div>
        `;
        main.appendChild(historySection);

        // 3. The Correction Modal Dialog
        if (!document.getElementById("correctionModal")) {
            const modalWrapper = document.createElement("div");
            modalWrapper.innerHTML = `
                <div class="modal-backdrop" id="correctionModal">
                    <div class="modal employee-modal" style="width: min(500px, 94vw);">
                        <div class="modal-header">
                            <div>
                                <h3>Correct Finalized Decision</h3>
                                <p>Update a previously finalized review decision safely.</p>
                            </div>
                        </div>
                        <div class="modal-body" style="padding: 18px; max-height: 70vh; overflow: auto;">
                            <form id="correctionForm" style="display: grid; gap: 16px;">
                                <input type="hidden" id="corrItemId" />
                                
                                <div style="display: flex; justify-content: space-between; align-items: center; padding: 12px; background: #111821; border-radius: 6px; border: 1px solid var(--line);">
                                    <span style="color: var(--muted); font-weight: 600;">Current Decision:</span>
                                    <span id="corrCurrentDecision" class="badge" style="font-size: 14px;"></span>
                                </div>

                                <label style="display: grid; gap: 6px; color: var(--muted); font-weight: 600;">
                                    New Decision
                                    <select id="corrNewDecision" required style="width: 100%;">
                                        <option value="">Select new decision...</option>
                                        <option value="Deduct">Deduct</option>
                                        <option value="Waive">Waive</option>
                                        <option value="Hold">Hold</option>
                                        <option value="Pending">Revert to Pending</option>
                                    </select>
                                </label>

                                <label style="display: grid; gap: 6px; color: var(--muted); font-weight: 600;">
                                    Correction Reason (Mandatory)
                                    <textarea id="corrReason" required placeholder="Why is this decision being corrected?" style="width: 100%; min-height: 80px; background: #111821; color: var(--ink); border: 1px solid var(--line); border-radius: 6px; padding: 10px; font-family: inherit; resize: vertical;"></textarea>
                                </label>

                                <div class="danger-zone" style="margin-top: 10px; padding: 12px; font-size: 12px;">
                                    <strong>Audit Warning:</strong> This action will permanently lock the previous transaction. An explicit correction trail will be created and original payroll records will be marked inactive.
                                </div>
                                
                                <div style="display: flex; justify-content: flex-end; gap: 12px; margin-top: 10px;">
                                    <button type="button" class="secondary" id="closeCorrectionModal">Cancel</button>
                                    <button type="submit" class="primary">Apply Correction</button>
                                </div>
                            </form>
                        </div>
                    </div>
                </div>
            `;
            document.body.appendChild(modalWrapper.firstElementChild);
        }
    }
}

// Attach listeners for dynamic views
document.addEventListener("click", (e) => {
    // Handle Navigation routing
    const targetView = e.target.closest("[data-view]");
    if (targetView && targetView.dataset.view) {
        setView(targetView.dataset.view);
    }
});

// App Boot Sequence
window.addEventListener("DOMContentLoaded", () => {
    
    // Auto-detect the desktop API flag by checking the exposed IPC bridge
    window.desktopApi = typeof window.uniformManager !== 'undefined';
    
    loadState().then(() => {
        
        injectCorrectionUI();
        
        if (typeof window.renderCorrectionCentre === "function") {
            window.renderCorrectionCentre();
        }
        if (typeof window.renderCorrectionHistory === "function") {
            window.renderCorrectionHistory();
        }

        // Initialize default view to Dashboard
        setView("dashboard");
        
    }).catch(err => {
        console.error("Boot sequence failed:", err);
    });
});