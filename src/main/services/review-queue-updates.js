async function applyBulkPolicyChange(db, payload, onProgress) {
  const result = db.bulkUpdatePolicy(payload);
  const affectsReviewCalculations = Number(result.updated || 0) > 0
    && Boolean(payload.update_price || payload.update_qty);
  const generated = affectsReviewCalculations
    ? await db.recalculateReviews(onProgress)
    : 0;
  return {
    ...result,
    generated,
    recalculated: affectsReviewCalculations,
    state: db.getState(),
  };
}

async function persistThenRecalculate(db, persistChange, onProgress) {
  const result = persistChange();
  const generated = await db.recalculateReviews(onProgress);
  return { result, generated, state: db.getState() };
}

module.exports = { applyBulkPolicyChange, persistThenRecalculate };
