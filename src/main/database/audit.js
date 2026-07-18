module.exports = ({ all }) => ({
  getAuditLogs(filters = {}) {
    let query = "SELECT * FROM audit_log WHERE 1=1";
    const params = [];

    if (filters.startDate) {
      query += " AND date(created_at) >= date(?)";
      params.push(filters.startDate);
    }
    if (filters.endDate) {
      query += " AND date(created_at) <= date(?)";
      params.push(filters.endDate);
    }
    if (filters.actionType) {
      query += " AND action = ?";
      params.push(filters.actionType);
    }
    if (filters.entityType) {
      query += " AND entity_type = ?";
      params.push(filters.entityType);
    }
    if (filters.result) {
      query += " AND result = ?";
      params.push(filters.result);
    }

    query += " ORDER BY created_at DESC LIMIT 2000";
    return all(query, params);
  },
});
