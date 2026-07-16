function showEmployeeModal(employee) {
  const form = document.getElementById("employeeForm");
  ["employee_code", "employee_name", "father_name", "unit", "godown", "mobile_number", "designation", "status"].forEach((field) => {
    form.elements[field].value = employee[field] || "";
  });
  document.getElementById("employeeModal").classList.add("show");
}

function hideEmployeeModal() {
  document.getElementById("employeeModal").classList.remove("show");
}

document.getElementById("closeEmployeeModal")?.addEventListener("click", hideEmployeeModal);