function showEmployeeModal(employee) {
  const form = document.getElementById("employeeForm");
  
  // NEW REQUIREMENT: Inject a hidden field to preserve the original code for replacements
  let origInput = form.querySelector('input[name="original_employee_code"]');
  if (!origInput) {
    origInput = document.createElement("input");
    origInput.type = "hidden";
    origInput.name = "original_employee_code";
    form.appendChild(origInput);
  }
  origInput.value = employee.employee_code;

  // NEW REQUIREMENT: Ensure the Employee Code input is editable
  const codeInput = form.elements["employee_code"];
  if (codeInput) {
    codeInput.removeAttribute("readonly");
  }

  ["employee_code", "employee_name", "father_name", "unit", "godown", "mobile_number", "designation", "status"].forEach((field) => {
    if (form.elements[field]) form.elements[field].value = employee[field] || "";
  });
  
  document.getElementById("employeeModal").classList.add("show");
}

function hideEmployeeModal() {
  document.getElementById("employeeModal").classList.remove("show");
}

document.getElementById("closeEmployeeModal")?.addEventListener("click", hideEmployeeModal);