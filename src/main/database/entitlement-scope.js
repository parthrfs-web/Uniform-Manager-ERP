function normalizeEntitlementLabel(value) {
  return String(value || '').trim().toLocaleLowerCase().replace(/\s+/g, ' ');
}

function getEntitlementFinancialYear(issue) {
  const year = Number(issue?.issue_year || 0);
  const month = Number(issue?.issue_month || 0);
  if (year && month >= 1 && month <= 12) return month >= 4 ? year : year - 1;

  const label = String(issue?.issue_period_label || '').trim();
  const fiscal = label.match(/\b((?:19|20)\d{2})\s*[-–—]\s*(?:\d{2}|(?:19|20)\d{2})\b/);
  if (fiscal) return Number(fiscal[1]);

  if (year && !month) return null;
  return null;
}

module.exports = { normalizeEntitlementLabel, getEntitlementFinancialYear };
