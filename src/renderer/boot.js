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
  analytics_employee: ["Employee Wise Analytics", "Review long-term history and costs attached to specific personnel."]
};

function setView(name) {
  if (!views[name]) return;
  document.querySelectorAll(".view").forEach((el) => el.classList.toggle("active", el.id === name));
  document.querySelectorAll(".nav-button").forEach((el) => el.classList.toggle("active", el.dataset.view === name));
  document.getElementById("viewTitle").textContent = views[name][0];
  document.getElementById("viewSubtitle").textContent = views[name][1];
  
  if (name === "deductions" && state && typeof renderDeductions === "function") {
    renderDeductions();
  }
  if (name === "correction" && state && typeof window.renderCorrectionCentre === "function") {
    window.renderCorrectionCentre();
  }
  if (name === "correction_history" && state && typeof window.renderCorrectionHistory === "function") {
    window.renderCorrectionHistory();
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
            <div class="toolbar" style="display: flex; gap: 10px; background: #111821; padding: 12px; border-radius: 6px; border: 1px solid var(--line);">
                <input type="text" id="correction_search_emp" data-smart-picker="employees" autocomplete="off" placeholder="Employee Code or Name" style="flex: 1;" />
                <input type="text" id="correction_search_unit" data-smart-picker="units" autocomplete="off" placeholder="Unit" style="flex: 1;" />
                <input type="text" id="correction_search_item" data-smart-picker="items" autocomplete="off" placeholder="Item" style="flex: 1;" />
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
            <div class="toolbar" style="display: flex; gap: 10px; background: #111821; padding: 12px; border-radius: 6px; border: 1px solid var(--line);">
                <input type="text" id="history_search_emp" data-smart-picker="employees" autocomplete="off" placeholder="Employee Code or Name" style="flex: 1;" />
                <input type="text" id="history_search_unit" data-smart-picker="units" autocomplete="off" placeholder="Unit" style="flex: 1;" />
                <input type="text" id="history_search_item" data-smart-picker="items" autocomplete="off" placeholder="Item" style="flex: 1;" />
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

        document.addEventListener('input', (e) => {
            if (e.target.id === 'history_search_emp') { window.corrEmpSearch = e.target.value.toLowerCase(); window.renderCorrectionHistory(); }
            if (e.target.id === 'history_search_unit') { window.corrUnitSearch = e.target.value.toLowerCase(); window.renderCorrectionHistory(); }
            if (e.target.id === 'history_search_item') { window.corrItemSearch = e.target.value.toLowerCase(); window.renderCorrectionHistory(); }
        });
        document.addEventListener('change', (e) => {
            if (e.target.id === 'history_search_emp') { window.corrEmpSearch = e.target.value.toLowerCase(); window.renderCorrectionHistory(); }
            if (e.target.id === 'history_search_unit') { window.corrUnitSearch = e.target.value.toLowerCase(); window.renderCorrectionHistory(); }
            if (e.target.id === 'history_search_item') { window.corrItemSearch = e.target.value.toLowerCase(); window.renderCorrectionHistory(); }
        });

        // 3. Correction Modal
        const modalHtml = `
        <div class="modal-backdrop" id="correctionModal">
            <div class="modal" style="width: 480px;">
            <div class="modal-header">
                <div>
                <h3>Correct Decision</h3>
                <p>Modify a finalized review decision safely.</p>
                </div>
                <button id="closeCorrectionModal" class="secondary" type="button">✕</button>
            </div>
            <div style="padding: 18px;">
                <form id="correctionForm" style="display: grid; gap: 14px;">
                <input type="hidden" id="corrItemId" />
                <div>
                    <label style="color: var(--muted); font-size: 12px;">Current Decision</label>
                    <strong style="display: block; font-size: 16px; margin-top: 4px;" id="corrCurrentDecision">-</strong>
                </div>
                <div>
                    <label style="color: var(--muted); font-size: 12px; margin-bottom: 4px; display: block;">New Decision</label>
                    <select id="corrNewDecision" required style="width: 100%; background: #111821; color: var(--ink);">
                        <option value="">-- Select --</option>
                        <option value="Deduct">Deduct</option>
                        <option value="Waive">Waive</option>
                        <option value="Hold">Hold</option>
                        <option value="Pending">No Action</option>
                    </select>
                </div>
                <div>
                    <label style="color: var(--muted); font-size: 12px; margin-bottom: 4px; display: block;">Correction Reason (Mandatory)</label>
                    <input type="text" id="corrReason" required placeholder="Mandatory: Why is this being corrected?" style="width: 100%; background: #111821; color: var(--ink);" />
                </div>
                <button type="submit" class="primary" style="margin-top: 8px;">Apply Correction</button>
                </form>
            </div>
            </div>
        </div>`;
        document.body.insertAdjacentHTML('beforeend', modalHtml);
    }
}

function initializeNavigation() {
  injectCorrectionUI();
  document.querySelectorAll(".nav-button").forEach((button) => {
    button.addEventListener("click", (e) => {
      e.preventDefault(); 
      setView(button.dataset.view);
    });
  });
}

function bootRenderer() {
  initializeNavigation();
  loadState();
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", bootRenderer);
} else {
  bootRenderer();
}