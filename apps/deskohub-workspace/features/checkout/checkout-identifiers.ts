export const createCheckoutIdentifier = () =>
  globalThis.crypto?.randomUUID?.() ??
  `checkout-${Date.now()}-${Math.random().toString(36).slice(2)}`;
