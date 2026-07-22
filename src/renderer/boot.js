const views = {
  dashboard: ["Dashboard", "Import distribution data and review excess uniform cases."],
  import: ["Import Excel", "Inspect workbook sheets before importing distribution data."],
  employees: ["Employees", "Search and review imported employee records."],
  issues: ["Distribution Register", "Employee-wise uniform quantity matrix."],
  deductions: ["Payroll Register", "Live deduction, waive and hold registers from review decisions."],
  review: ["Review Queue", "Resolve records that need office staff attention."],
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

function initializeNavigation() {
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
