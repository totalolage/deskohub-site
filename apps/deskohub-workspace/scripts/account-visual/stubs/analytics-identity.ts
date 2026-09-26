const anonymousIdentity = { status: "anonymous" } as const;

export function getAnalyticsAccountIdentity() {
  return anonymousIdentity;
}

export function subscribeAnalyticsAccountIdentity(listener: () => void) {
  listener();
  return () => undefined;
}

export function refreshAnalyticsAccountIdentity() {
  return Promise.resolve();
}

export function beginAnalyticsAccountTransition() {}

export function completeAnalyticsAccountSignOut() {}
