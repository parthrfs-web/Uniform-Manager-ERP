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
  if (typeof desktopApi === 'undefined' || !desktopApi) {
    showImportError(
      "Uniform Manager was opened in a web browser, so Excel import and local database access are not available.\n\n" +
      "Please close this browser tab and start the desktop app using Start Uniform Manager.bat or run npm start from the Application folder."
    );
    const dbPathEl = document.getElementById("dbPath");
    if (dbPathEl) dbPathEl.textContent = "Desktop app not running";
    return;
  }
  
  try {
    state = await window.uniformManager.getState({ distributionLimit: typeof distributionLimit !== 'undefined' ? distributionLimit : 1000 });
    if (typeof render === "function") render();
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

        // 3. The Correction Modal Dialog (Fix for the broken click flow)
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
                        <form id="correctionForm">
                            <div class="employee-form-grid" style="grid-template-columns: 1fr;">
                                <input type="hidden" id="corrItemId" />
                                <label>Current Decision
                                    <div id="corrCurrentDecision" style="padding: 10px 12px; background: #202938; border-radius: 6px; color: var(--muted); font-weight: bold;"></div>
                                </label>
                                <label>New Decision
                                    <select id="corrNewDecision" required>
                                        <option value="">Select new decision...</option>
                                        <option value="Deduct">Deduct</option>
                                        <option value="Waive">Waive</option>
                                        <option value="Hold">Hold</option>
                                        <option value="No Action">Pending (No Action)</option>
                                    </select>
                                </label>
                                <label>Correction Reason (Mandatory)
                                    <input type="text" id="corrReason" placeholder="Enter reason for correction..." required />
                                </label>
                            </div>
                            <div class="modal-footer">
                                <button type="button" class="secondary" id="closeCorrectionModal">Cancel</button>
                                <button type="submit" class="primary">Save Correction</button>
                            </div>
                        </form>
                    </div>
                </div>
            `;
            document.body.appendChild(modalWrapper.firstElementChild);
        }

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
    }
}

function injectPayrollDeductionSummaryUI() {
    if (document.getElementById("payroll_deduction_summary")) return;

    const navMiddle = document.querySelector(".sidebar-section-middle");
    if (navMiddle) {
        const btn = document.createElement("button");
        btn.className = "nav-button";
        btn.dataset.view = "payroll_deduction_summary";
        btn.textContent = "Payroll Deduction Summary";

        const navHeaders = navMiddle.querySelectorAll(".nav-header");
        let placed = false;
        navHeaders.forEach(header => {
            if(header.textContent.toLowerCase().includes("report") || header.textContent.toLowerCase().includes("analytic")) {
                header.parentNode.insertBefore(btn, header.nextSibling);
                placed = true;
            }
        });
        if (!placed) {
            navMiddle.appendChild(btn);
        }
    }

    const main = document.querySelector("main");
    if (main) {
        const section = document.createElement("section");
        section.className = "view";
        section.id = "payroll_deduction_summary";
        section.innerHTML = `
            <div class="toolbar" style="display: flex; gap: 10px; background: #111821; padding: 12px; border-radius: 6px; border: 1px solid var(--line);">
                <select id="pds_month" style="flex: 1;">
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
                <input type="number" id="pds_fy" placeholder="Financial Year (e.g. 2026)" style="flex: 1;" />
                <button class="primary" id="pds_generate">Generate Report</button>
                <button class="secondary" id="pds_export" disabled>Export Excel</button>
                <button class="secondary" id="pds_print" disabled>Print</button>
            </div>
            <div class="panel flush" id="pds_print_area">
                <div class="table-wrap">
                    <table id="pds_table">
                        <thead id="pds_thead"></thead>
                        <tbody id="pds_tbody">
                            <tr><td class="empty">Click Generate Report to load data.</td></tr>
                        </tbody>
                    </table>
                </div>
            </div>
        `;
        main.appendChild(section);
    }
}

// Global Event Delegation for Payroll Deduction Summary UI logic
document.addEventListener('click', async (e) => {
    // Generate Report Action
    if (e.target.id === "pds_generate") {
        const month = document.getElementById("pds_month").value;
        const fy = document.getElementById("pds_fy").value;
        
        try {
            if (typeof startProgress === "function") startProgress();
            
            if (!state || !state.livePayrollRecords) {
                throw new Error("Application state is null or missing necessary data. Please wait for data to load.");
            }
            
            let deductionRecords = state.livePayrollRecords.filter(r => r.record_type === 'Deduct');
            if (month) deductionRecords = deductionRecords.filter(r => String(r.issue_month) === String(month));
            if (fy) deductionRecords = deductionRecords.filter(r => String(r.issue_year) === String(fy));
            
            const itemSet = new Set();
            deductionRecords.forEach(r => itemSet.add(String(r.item_name).trim()));
            if (state.uniformIssueMatrix && Array.isArray(state.uniformIssueMatrix.items)) {
                state.uniformIssueMatrix.items.forEach(i => itemSet.add(String(i).trim()));
            }
            if (state.items && Array.isArray(state.items)) {
                state.items.forEach(i => itemSet.add(String(i.item_name).trim()));
            }
            const registeredItems = Array.from(itemSet).filter(Boolean);
            
            const baseHeaders = ["Sr No", "Employee Code", "Employee Name", "Unit Name", "Payroll Month", "Total Deduction Amount (₹)"];
            const excelHeaders = [...baseHeaders, ...registeredItems];
            
            const matrix = {};
            const monthNames = ["", "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
            
            for (const record of deductionRecords) {
                const empCode = String(record.employee_code).trim();
                const payrollMonth = (record.issue_month && record.issue_year) ? `${monthNames[Number(record.issue_month)]} ${record.issue_year}` : (record.issue_period_label || '-');
                const groupKey = `${empCode}_${payrollMonth}`;
                
                if (!matrix[groupKey]) {
                    matrix[groupKey] = {
                        employeeCode: empCode,
                        employeeName: record.employee_name || '',
                        unitName: record.unit || '',
                        payrollMonth: payrollMonth,
                        totalDeductionAmount: 0.0,
                        items: {}
                    };
                    registeredItems.forEach(item => {
                        matrix[groupKey].items[item] = 0;
                    });
                }
                
                const itemName = String(record.item_name).trim();
                const quantity = Number(record.quantity) || 0;
                const rate = Number(record.rate) || 0;
                const amount = Number(record.amount) || (quantity * rate) || 0;
                
                if (matrix[groupKey].items.hasOwnProperty(itemName)) {
                    matrix[groupKey].items[itemName] += quantity;
                }
                matrix[groupKey].totalDeductionAmount += amount;
            }

            console.log("PAYROLL DEDUCTION SUMMARY MATRIX:", JSON.parse(JSON.stringify(matrix)));
            
            const sortedRows = Object.values(matrix).sort((a, b) => a.employeeCode.localeCompare(b.employeeCode));
            
            const excelData = [];
            let theadHtml = `<tr>${baseHeaders.map(h => `<th>${escapeHtml(h)}</th>`).join('')}${registeredItems.map(i => `<th>${escapeHtml(i)}</th>`).join('')}</tr>`;
            let tbodyHtml = "";
            
            if (sortedRows.length === 0) {
                tbodyHtml = `<tr><td colspan="${excelHeaders.length}" class="empty">No deductions found for the selected period.</td></tr>`;
                document.getElementById("pds_export").disabled = true;
                document.getElementById("pds_print").disabled = true;
            } else {
                let srNo = 1;
                for (const row of sortedRows) {
                    const rowData = [
                        srNo,
                        row.employeeCode,
                        row.employeeName,
                        row.unitName,
                        row.payrollMonth,
                        row.totalDeductionAmount
                    ];
                    
                    let rowHtml = `<tr>
                        <td>${srNo}</td>
                        <td>${escapeHtml(row.employeeCode)}</td>
                        <td>${escapeHtml(row.employeeName)}</td>
                        <td>${escapeHtml(row.unitName)}</td>
                        <td>${escapeHtml(row.payrollMonth)}</td>
                        <td class="text-red" style="font-weight:bold;">₹${row.totalDeductionAmount.toFixed(2)}</td>
                    `;
                    
                    registeredItems.forEach(item => {
                        const qty = row.items[item];
                        rowData.push(qty);
                        rowHtml += `<td>${qty}</td>`;
                    });
                    
                    rowHtml += "</tr>";
                    tbodyHtml += rowHtml;
                    excelData.push(rowData);
                    srNo++;
                }
                
                document.getElementById("pds_export").disabled = false;
                document.getElementById("pds_print").disabled = false;
                
                window.pdsExportConfig = {
                    filename: `Payroll_Deduction_Summary_${Date.now()}.xlsx`,
                    sheetName: "Deduction Summary",
                    headers: excelHeaders,
                    data: excelData
                };
            }
            
            document.getElementById("pds_thead").innerHTML = theadHtml;
            document.getElementById("pds_tbody").innerHTML = tbodyHtml;
            
            if (typeof stopProgress === "function") stopProgress();
            if (typeof toast === "function") toast("Matrix Report generated successfully.");
            
        } catch (err) {
            if (typeof stopProgress === "function") stopProgress();
            if (typeof showImportError === "function") showImportError("Generation failed: " + err.message);
        }
    } 
    
    // Export Action
    else if (e.target.id === "pds_export") {
        if (!window.pdsExportConfig) return;
        try {
            if (typeof startProgress === "function") startProgress();
            const res = await window.uniformManager.exportExcel(window.pdsExportConfig);
            if (typeof stopProgress === "function") stopProgress();
            if (!res.canceled && typeof toast === "function") toast("Excel exported successfully.");
        } catch (err) {
            if (typeof stopProgress === "function") stopProgress();
            if (typeof showImportError === "function") showImportError("Export failed: " + err.message);
        }
    } 
    
    // Print Action
    else if (e.target.id === "pds_print") {
        const printContent = document.getElementById("pds_print_area").innerHTML;
        const printWindow = window.open('', '', 'width=1200,height=800');
        printWindow.document.write(`
            <html>
                <head>
                    <title>Payroll Deduction Summary Matrix</title>
                    <style>
                        body { font-family: "Segoe UI", Arial, sans-serif; font-size: 12px; color: #000; padding: 20px; }
                        h2 { text-align: center; margin-bottom: 20px; }
                        table { width: 100%; border-collapse: collapse; }
                        th, td { padding: 8px; border: 1px solid #333; text-align: left; white-space: nowrap; }
                        th { background: #f4f4f4; font-weight: bold; }
                        .text-red { color: #d32f2f; }
                        @media print {
                            @page { size: landscape; margin: 10mm; }
                            body { padding: 0; }
                        }
                    </style>
                </head>
                <body>
                    <h2>Payroll Deduction Summary Matrix</h2>
                    ${printContent}
                </body>
            </html>
        `);
        printWindow.document.close();
        printWindow.focus();
        setTimeout(() => {
            printWindow.print();
            printWindow.close();
        }, 250);
    }
});

window.addEventListener("DOMContentLoaded", () => {
    injectCorrectionUI();
    injectPayrollDeductionSummaryUI();

    document.querySelectorAll(".nav-button").forEach((btn) => {
        btn.addEventListener("click", () => setView(btn.dataset.view));
    });

    loadState().then(() => setView("dashboard"));
});