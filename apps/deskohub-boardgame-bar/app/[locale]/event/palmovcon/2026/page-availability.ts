export const PALMOVCON_PAGE_EXPIRES_AT = Date.UTC(2026, 6, 19, 22);

export const isPalmovconPageExpired = (nowMs = Date.now()) =>
  nowMs >= PALMOVCON_PAGE_EXPIRES_AT;
