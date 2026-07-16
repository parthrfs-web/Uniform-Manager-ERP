function distributionKey(row) {
  return {
    employee_code: row.employee_code,
    unit: row.unit || "",
    godown: row.godown || "",
    issue_month: row.issue_month || null,
    issue_year: row.issue_year || null,
    issue_period_label: row.issue_period_label || "",
  };
}

function showDistributionModal(row) {
  pendingDistributionEdit = row;
  document.getElementById("distributionModalTitle").textContent = `${row.employee_code} - ${row.employee_name}`;
  document.getElementById("distributionModalSubtitle").textContent =
    `${row.issue_period_label || (row.issue_month && row.issue_year ? `${row.issue_month}/${row.issue_year}` : "No period")} | ${row.unit || "-"} | ${row.godown || "-"}`;
  document.getElementById("distributionQuantityFields").innerHTML = (state.uniformIssueMatrix?.items || []).map((item) => `
    <label>${escapeHtml(item)}<input name="${escapeHtml(item)}" type="number" min="0" step="0.01" value="${Number(row.quantities?.[item] || 0)}" /></label>
  `).join("");
  document.getElementById("distributionModal").classList.add("show");
}

function hideDistributionModal() {
  pendingDistributionEdit = null;
  document.getElementById("distributionModal").classList.remove("show");
}

function setItemEditMode(itemId = null) {
  editingItemId = itemId ? String(itemId) : null;
  document.getElementById("saveItemBtn").textContent = editingItemId ? "Update Item" : "Save Item";
}

function renderIssues() {
  const matrix = state.uniformIssueMatrix || { items: [], rows: [] };
  document.getElementById("distributionVisibleCount").textContent = matrix.totalRows && matrix.totalRows !== matrix.rows.length
    ? `${matrix.rows.length} of ${matrix.totalRows}`
    : matrix.rows.length;
  document.getElementById("distributionEntryCount").textContent = Number(state.uniformIssueCount || state.uniformIssues.filter((row) => Number(row.quantity || 0) > 0).length);
  document.getElementById("distributionItemCount").textContent = matrix.items.length;
  document.getElementById("loadMoreDistributionBtn").disabled = matrix.rows.length >= Number(matrix.totalRows || 0);
  document.getElementById("loadAllDistributionBtn").disabled = matrix.rows.length >= Number(matrix.totalRows || 0);
  document.getElementById("issueMatrixHead").innerHTML = `
    <tr>
      <th>Employee Code</th>
      <th>Name</th>
      <th>Period</th>
      <th>Unit</th>
      <th>Godown</th>
      <th>Status</th>
      ${matrix.items.map((item) => `<th>${escapeHtml(item)}</th>`).join("")}
      <th>Allowed Qty</th>
      <th>Excess Qty</th>
      <th>Total Qty</th>
      <th>Actions</th>
    </tr>
  `;
  renderTableRows("issueSummaryRows", matrix.rows, (row, index) => `
    <tr>
      <td>${text(row.employee_code)}</td>
      <td>${text(row.employee_name)}</td>
      <td>${formatPeriod(row)}</td>
      <td>${text(row.unit)}</td>
      <td>${text(row.godown)}</td>
      <td><span class="badge ${escapeHtml(row.entitlement_status || "OK")}">${text(row.entitlement_status || "OK")}</span></td>
      ${matrix.items.map((item) => {
        const entitlement = row.entitlements?.[item] || {};
        const issued = Number(row.quantities?.[item] || 0);
        const allowed = entitlement.allowed;
        const label = allowed === null || allowed === undefined
          ? `${issued} / No Policy`
          : issued
            ? `${issued} / ${allowed}`
            : "0";
        return `<td><span class="qty-cell ${escapeHtml(entitlement.status || "None")}">${escapeHtml(label)}</span></td>`;
      }).join("")}
      <td>${Number(row.total_allowed || 0)}</td>
      <td>${Number(row.total_excess || 0)}</td>
      <td>${Number(row.total_quantity || 0)}</td>
      <td>
        <div class="row-actions">
          <button data-edit-distribution="${index}">Edit</button>
          <button class="danger" data-delete-distribution="${index}">Delete</button>
        </div>
      </td>
    </tr>
  `, "No employee distribution data available yet.", 9 + matrix.items.length);
}

function renderItems() {
  const itemRowsBody = document.getElementById("itemRows");
  if (itemRowsBody && state.items) {
    renderTableRows(itemRowsBody, state.items, (row) => `
      <tr>
        <td>${text(row.item_code)}</td>
        <td>${text(row.item_name)}</td>
        <td>${text(row.category)}</td>
        <td>${text(row.size)}</td>
        <td>${formatCompactMoney(row.cost)}</td>
        <td><span class="badge ${Number(row.is_low_stock) === 1 ? "low" : ""}">${text(row.available_stock)}</span></td>
        <td>${text(row.minimum_stock)}</td>
        <td>${text(row.status)}</td>
        <td>
          <div class="row-actions">
            <button data-edit-item="${row.id}">Edit</button>
            <button class="danger" data-delete-item="${row.id}">Delete</button>
          </div>
        </td>
      </tr>
    `, "No item records found.", 9);
  }

  const movementRowsBody = document.getElementById("movementRows");
  if (movementRowsBody && state.stockMovements) {
    renderTableRows(movementRowsBody, state.stockMovements, (row) => `
      <tr>
        <td>${text(row.item_name)}</td>
        <td>${text(row.movement_type)}</td>
        <td>${text(row.quantity)}</td>
        <td>${text(row.reference_type)} #${text(row.reference_id)}</td>
        <td>${text(row.notes)}</td>
        <td>${text(row.created_at)}</td>
      </tr>
    `, "No stock movement records yet.", 6);
  }
}

document.getElementById("loadMoreDistributionBtn")?.addEventListener("click", async () => {
  distributionLimit += 1000;
  try {
    state = await window.uniformManager.getState({ distributionLimit });
    render();
    setView("issues");
  } catch (error) {
    showImportError(error.message);
  }
});

document.getElementById("loadAllDistributionBtn")?.addEventListener("click", async () => {
  distributionLimit = Number(state.uniformIssueMatrix?.totalRows || distributionLimit);
  try {
    state = await window.uniformManager.getState({ distributionLimit });
    render();
    setView("issues");
  } catch (error) {
    showImportError(error.message);
  }
});

document.getElementById("itemForm")?.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!desktopApi) return showImportError("Works only in Desktop App.");
  try {
    const form = event.currentTarget;
    const item = {
      id: editingItemId || form.elements.id.value || "",
      item_code: form.elements.item_code.value,
      item_name: form.elements.item_name.value,
      category: form.elements.category.value,
      size: form.elements.size.value,
      cost: form.elements.cost.value,
      available_stock: form.elements.available_stock.value,
      minimum_stock: form.elements.minimum_stock.value,
      status: form.elements.status.value,
    };
    await window.uniformManager.upsertItem(item);
    state = await window.uniformManager.getState({ distributionLimit });
    setItemEditMode(null);
    form.reset();
    render();
    setView("items");
    toast("Item saved.");
  } catch (error) {
    showImportError(error.message || "Item save failed.");
  }
});

document.getElementById("cancelItemEditBtn")?.addEventListener("click", () => {
  setItemEditMode(null);
  document.getElementById("itemForm").reset();
  toast("Item form cleared.");
});

document.getElementById("closeDistributionModal")?.addEventListener("click", hideDistributionModal);

document.getElementById("distributionForm")?.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!pendingDistributionEdit) return;
  const form = event.currentTarget;
  const quantities = {};
  (state.uniformIssueMatrix?.items || []).forEach((item) => {
    quantities[item] = Number(form.elements[item]?.value || 0);
  });
  try {
    startProgress();
    await window.uniformManager.updateDistributionRow({
      key: distributionKey(pendingDistributionEdit),
      quantities,
    });
    state = await window.uniformManager.getState({ distributionLimit });
    stopProgress();
    hideDistributionModal();
    render();
    setView("issues");
    toast("Distribution row updated.");
  } catch (error) {
    stopProgress();
    showImportError(error.message || "Distribution update failed.");
  }
});

document.addEventListener("click", async (event) => {
  const editItemButton = event.target.closest("[data-edit-item]");
  if (editItemButton) {
    const item = state.items.find((row) => String(row.id) === editItemButton.dataset.editItem);
    if (item) {
      const form = document.getElementById("itemForm");
      setItemEditMode(item.id);
      form.querySelector('[name="id"]').value = item.id;
      form.elements.item_code.value = item.item_code || "";
      form.elements.item_name.value = item.item_name || "";
      form.elements.category.value = item.category || "";
      form.elements.size.value = item.size || "";
      form.elements.cost.value = item.cost || 0;
      form.elements.available_stock.value = item.available_stock || 0;
      form.elements.minimum_stock.value = item.minimum_stock || 0;
      form.elements.status.value = item.status || "Active";
      setView("items");
      toast("Item loaded for editing.");
    }
    return;
  }

  const deleteItemButton = event.target.closest("[data-delete-item]");
  if (deleteItemButton) {
    const item = state.items.find((row) => String(row.id) === deleteItemButton.dataset.deleteItem);
    const label = item ? `${item.item_code} - ${item.item_name}` : `#${deleteItemButton.dataset.deleteItem}`;
    if (!confirm(`Delete item ${label}?`)) return;
    try {
      await window.uniformManager.deleteItem(deleteItemButton.dataset.deleteItem);
      state = await window.uniformManager.getState({ distributionLimit });
      render();
      toast("Item deleted.");
    } catch (error) {
      showImportError(error.message || "Item delete failed.");
    }
    return;
  }
});

document.addEventListener("click", async (event) => {
  const editDistributionButton = event.target.closest("[data-edit-distribution]");
  if (editDistributionButton) {
    const row = state.uniformIssueMatrix?.rows?.[Number(editDistributionButton.dataset.editDistribution)];
    if (row) showDistributionModal(row);
    return;
  }

  const deleteDistributionButton = event.target.closest("[data-delete-distribution]");
  if (deleteDistributionButton) {
    const row = state.uniformIssueMatrix?.rows?.[Number(deleteDistributionButton.dataset.deleteDistribution)];
    if (!row) return;
    const label = `${row.employee_code} - ${row.employee_name} (${row.issue_period_label || "No period"})`;
    if (!confirm(`Delete distribution row ${label}?\n\nThis removes that employee/month distribution entry and recalculates review queue.`)) return;
    try {
      startProgress();
      await window.uniformManager.deleteDistributionRow(distributionKey(row));
      state = await window.uniformManager.getState({ distributionLimit });
      stopProgress();
      render();
      setView("issues");
      toast("Distribution row deleted.");
    } catch (error) {
      stopProgress();
      showImportError(error.message || "Distribution row delete failed.");
    }
  }
});
