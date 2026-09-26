const SECOND = 1_000;
const MINUTE = 60 * SECOND;

export const workspaceE2ETimeouts = {
  accessCodeActionBarrier: 40 * SECOND,
  accessCodeCase: 3 * MINUTE,
  accessCodeStaleBarrier: 60 * SECOND,
  // Original 8-minute account work budget plus one full 10-minute magic-link
  // quiet window: the limiter resets only after a full window of inactivity
  // since the last allowed request, so a case can spend that entire window
  // waiting before a rate-limited semantic operation starts
  // (see account/rate-budget.ts).
  accountCase: 18 * MINUTE,
  artifactCapture: 60 * SECOND,
  authDelivery: 2 * MINUTE,
  browserAction: 30 * SECOND,
  browserNavigation: 60 * SECOND,
  checkoutCase: 6 * MINUTE,
  checkoutStart: 2 * MINUTE,
  cleanupAction: 30 * SECOND,
  contactCase: 2 * MINUTE,
  datasource: 2 * MINUTE,
  hostedPayment: 3 * MINUTE,
  localeCase: 3 * MINUTE,
  paymentTerminalCase: 4 * MINUTE,
  providerTransition: 90 * SECOND,
  uiTransition: 45 * SECOND,
  zeroTotalCheckoutCase: 5 * MINUTE,
} as const;

// Keep the Playwright watchdog outside the longest semantic case plus the
// artifact-capture and cleanup budgets, for both the checkout lanes and the
// serial account lane whose cases also wait out the magic-link rate window.
const checkoutWatchdogRequirement =
  workspaceE2ETimeouts.checkoutCase * 2 +
  workspaceE2ETimeouts.artifactCapture +
  workspaceE2ETimeouts.cleanupAction +
  workspaceE2ETimeouts.datasource;
const accountWatchdogRequirement =
  workspaceE2ETimeouts.accountCase +
  workspaceE2ETimeouts.artifactCapture +
  workspaceE2ETimeouts.cleanupAction;

export const workspaceE2EPlaywrightCheckoutTimeout = Math.max(
  checkoutWatchdogRequirement,
  accountWatchdogRequirement
);

// The action-completion barrier aligns with the enforced sub-40-second provider
// bound; the stale barrier matches the application's 60-second attempt stale
// threshold, so cleanup never deletes while the last server write can still be
// in flight.
// Cleanup waits on one completion barrier per sequential mutation (initial
// form action + replayed action) plus the initial action's stale convergence
// fallback, so the barrier count must grow with every new mutation barrier.
export const workspaceE2EAccessCodeMutationBarrierCount = 2;

export const workspaceE2EAccessCodeCleanupTimeout =
  workspaceE2ETimeouts.accessCodeActionBarrier *
    workspaceE2EAccessCodeMutationBarrierCount +
  workspaceE2ETimeouts.accessCodeStaleBarrier +
  workspaceE2ETimeouts.cleanupAction +
  workspaceE2ETimeouts.datasource;

export const workspaceE2EAccessCodePlaywrightTimeout =
  workspaceE2ETimeouts.accessCodeCase + workspaceE2EAccessCodeCleanupTimeout;

export type WorkspaceE2ETimeouts = Readonly<
  Record<keyof typeof workspaceE2ETimeouts, number>
>;

export const workspaceE2EPollIntervalMs = {
  browser: SECOND,
  datasource: 5 * SECOND,
} as const;

export const formatWorkspaceE2EDuration = (durationMs: number) => {
  if (durationMs < SECOND) return `${durationMs}ms`;
  if (durationMs < MINUTE) return `${(durationMs / SECOND).toFixed(1)}s`;
  return `${(durationMs / MINUTE).toFixed(1)}m`;
};
