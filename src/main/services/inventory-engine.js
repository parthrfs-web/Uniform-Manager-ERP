function getStockStatus(current, min, reorder) {
    if (current <= 0) return 'Out of Stock';
    if (current <= reorder) return 'Low Stock';
    return 'Normal';
}

function validateStockMovement(current, change) {
    if (current + change < 0) throw new Error("Insufficient stock for this movement.");
    return true;
}

module.exports = { getStockStatus, validateStockMovement };