import type { E2EEnvironment } from "./e2e-env";

const SECOND = 1_000;
const MINUTE = 60 * SECOND;

const timeoutDefinitions = {
  artifactCapture: {
    env: "WORKSPACE_E2E_ARTIFACT_CAPTURE_TIMEOUT_MS",
    fallbackMs: 60 * SECOND,
  },
  browserAction: {
    env: "WORKSPACE_E2E_BROWSER_ACTION_TIMEOUT_MS",
    fallbackMs: 30 * SECOND,
  },
  browserNavigation: {
    env: "WORKSPACE_E2E_BROWSER_NAVIGATION_TIMEOUT_MS",
    fallbackMs: 60 * SECOND,
  },
  checkoutCase: {
    env: "WORKSPACE_E2E_CHECKOUT_CASE_TIMEOUT_MS",
    fallbackMs: 6 * MINUTE,
  },
  checkoutStart: {
    env: "WORKSPACE_E2E_CHECKOUT_START_TIMEOUT_MS",
    fallbackMs: 2 * MINUTE,
  },
  cleanupAction: {
    env: "WORKSPACE_E2E_CLEANUP_ACTION_TIMEOUT_MS",
    fallbackMs: 30 * SECOND,
  },
  contactCase: {
    env: "WORKSPACE_E2E_CONTACT_CASE_TIMEOUT_MS",
    fallbackMs: 2 * MINUTE,
  },
  datasource: {
    env: "WORKSPACE_E2E_DATASOURCE_TIMEOUT_MS",
    fallbackMs: 2 * MINUTE,
  },
  hostedPayment: {
    env: "WORKSPACE_E2E_HOSTED_PAYMENT_TIMEOUT_MS",
    fallbackMs: 3 * MINUTE,
  },
  localeCase: {
    env: "WORKSPACE_E2E_LOCALE_CASE_TIMEOUT_MS",
    fallbackMs: 2 * MINUTE,
  },
  paymentTerminalCase: {
    env: "WORKSPACE_E2E_PAYMENT_TERMINAL_CASE_TIMEOUT_MS",
    fallbackMs: 4 * MINUTE,
  },
  providerTransition: {
    env: "WORKSPACE_E2E_PROVIDER_TRANSITION_TIMEOUT_MS",
    fallbackMs: 90 * SECOND,
  },
  uiTransition: {
    env: "WORKSPACE_E2E_UI_TRANSITION_TIMEOUT_MS",
    fallbackMs: 45 * SECOND,
  },
} as const;

export type WorkspaceE2ETimeout = keyof typeof timeoutDefinitions;
export type WorkspaceE2ETimeouts = Readonly<
  Record<WorkspaceE2ETimeout, number>
>;

export const defaultWorkspaceE2ETimeouts = Object.fromEntries(
  Object.entries(timeoutDefinitions).map(([timeout, { fallbackMs }]) => [
    timeout,
    fallbackMs,
  ])
) as WorkspaceE2ETimeouts;

export const makeWorkspaceE2ETimeouts = (
  environment: E2EEnvironment
): WorkspaceE2ETimeouts =>
  Object.fromEntries(
    Object.entries(timeoutDefinitions).map(
      ([timeout, { env, fallbackMs }]) => [
        timeout,
        Math.min(environment[env] ?? fallbackMs, fallbackMs),
      ]
    )
  ) as WorkspaceE2ETimeouts;

export const workspaceE2EPollIntervalMs = {
  browser: SECOND,
  datasource: 5 * SECOND,
} as const;

export const formatWorkspaceE2EDuration = (durationMs: number) => {
  if (durationMs < SECOND) return `${durationMs}ms`;
  if (durationMs < MINUTE) return `${(durationMs / SECOND).toFixed(1)}s`;
  return `${(durationMs / MINUTE).toFixed(1)}m`;
};
