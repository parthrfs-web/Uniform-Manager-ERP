function employeeMatches(row) {
  return includesSearch([row.employee_code, row.employee_name, row.father_name, row.unit, row.godown, row.mobile_number], employeeFilter);
}

function renderEmployees() {
  const rows = state.employees.filter(employeeMatches);
  renderTableRows("employeeRows", rows, (row) => `
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
  `, "No employee records found.", 9);
}

document.getElementById("employeeSearch")?.addEventListener("input", (event) => {
  employeeFilter = event.target.value;
  renderEmployees();
});

document.getElementById("employeeForm")?.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!desktopApi) return showImportError("Works only in Desktop App.");
  try {
    const employee = Object.fromEntries(new FormData(event.currentTarget).entries());
    
    if (!employee.employee_code || !String(employee.employee_code).trim()) throw new Error("Employee Code cannot be blank.");

    startProgress();
    await window.uniformManager.updateEmployee(employee);
    await window.uniformManager.recalculateReviews();
    state = await window.uniformManager.getState({ distributionLimit });
    stopProgress();
    
    render();
    hideEmployeeModal();
    toast("Employee saved successfully. Review Queue recalculated.");
  } catch (error) {
    stopProgress();
    showImportError(error.message || "Employee save failed.");
  }
});

document.addEventListener("click", async (event) => {
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
    
    if (!confirm(`Delete employee ${label}?\n\nThis will remove the employee from master data and permanently delete all their uniform issue history and review records. This action cannot be undone.`)) return;
    
    try {
      startProgress();
      await window.uniformManager.deleteEmployee(employeeCode);
      await window.uniformManager.recalculateReviews();
      state = await window.uniformManager.getState({ distributionLimit });
      stopProgress();
      
      render();
      toast("Employee and linked history permanently deleted.");
    } catch (error) {
      stopProgress();
      showImportError(error.message || "Delete failed.");
    }
    return;
  }
});