const SECOND = 1_000;
const MINUTE = 60 * SECOND;

export const workspaceE2ETimeouts = {
  accountCase: 8 * MINUTE,
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

export const workspaceE2EPlaywrightCheckoutTimeout =
  workspaceE2ETimeouts.checkoutCase * 2 +
  workspaceE2ETimeouts.artifactCapture +
  workspaceE2ETimeouts.cleanupAction +
  workspaceE2ETimeouts.datasource;

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
