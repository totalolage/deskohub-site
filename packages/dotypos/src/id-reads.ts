/** Operational batch size, verified with bounded synthetic filters, not a provider ID/URL limit. */
export const dotyposIdReadBatchSize = 100;

/**
 * Requests for a nonnegative count of UNIQUE requested IDs. Exact for a
 * successful, unretried, single-page read; failures can stop unsent batches.
 * Access-token exchanges are excluded. Both ID operations use this rule.
 */
export const dotyposIdReadRequests = (uniqueIdCount: number): number =>
  Math.ceil(uniqueIdCount / dotyposIdReadBatchSize);
