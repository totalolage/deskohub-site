import { dotyposApiTimeoutDefaultMilliseconds } from "@deskohub/dotypos/api-timeout";
import { emailAutomationTickMinutes } from "@deskohub/workspace-admin-api";

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
  administratorAccessCase: 2 * MINUTE,
  // A seeded account connects the test agent (discovery, one consent round,
  // the code exchange), then lists and calls tools over MCP.
  administratorAgentToolsCase: 4 * MINUTE,
  artifactCapture: 60 * SECOND,
  // Each wait ticks the planner and lets the queue drain the units it
  // published: a dry run over 30 days of events, or one booked run through
  // intake, its condition, and delivery.
  automationEngine: 4 * MINUTE,
  // Admin setup, a dry run, activation, one zero-total checkout, up to one
  // engine tick interval before intake may take the booking, the engine
  // reaching a sent run, and the run log.
  automationReservationCase: 30 * MINUTE,
  // The longest wait from a booking to the engine tick that may take it.
  automationTick: emailAutomationTickMinutes * MINUTE,
  authDelivery: 2 * MINUTE,
  browserAction: 30 * SECOND,
  browserNavigation: 60 * SECOND,
  // Releasing a probe response's body, so a stuck release can't hold up the
  // session's cleanup.
  browserResponseDisposal: 30 * SECOND,
  // A case waiting for a second browser session it opened, such as a
  // signed-out visitor's, to close. Its failure is ignored, and the case's
  // Scope still closes a session that outlives the wait.
  browserSessionClose: 2 * MINUTE,
  // One MCP exchange, with room for a cold advisory snapshot to fill from
  // Dotypos (one full Dotypos request timeout).
  customerMcpRequest: 60 * SECOND,
  customerMcpCase: 4 * MINUTE,
  // One agent authorization round in the browser: the authorize redirect,
  // the consent page in the customer's locale, and the redirect back to the
  // agent.
  customerAgentConsent: 90 * SECOND,
  // The site tools register after hydration, the release gate's streamed
  // boundary, and one `tools/list` exchange.
  siteToolsRegistration: 60 * SECOND,
  // A page's own requests after load: long enough that a site tool request
  // would have started.
  siteToolsQuietPeriod: 5 * SECOND,
  // One reload of an advertised-pricing page, and the overall wait for the
  // advertisedPricingSources cache (60-second revalidation) to converge.
  calendarSaleAdvertisement: 2 * MINUTE,
  calendarSaleAdvertisementAttempt: 10 * SECOND,
  checkoutCase: 6 * MINUTE,
  // The pay page's consent and enabled pay button showing up, each.
  checkoutPayControl: 60 * SECOND,
  checkoutStart: 2 * MINUTE,
  // The original 30-second finalizer budget plus one full Dotypos request:
  // reservation cleanup cancels each reservation with a single unretried
  // request, so a slow but successful cancellation may use the whole
  // per-request timeout.
  cleanupAction: 30 * SECOND + dotyposApiTimeoutDefaultMilliseconds,
  contactCase: 2 * MINUTE,
  datasource: 2 * MINUTE,
  emailCampaignCase: 4 * MINUTE,
  hostedPayment: 3 * MINUTE,
  localeCase: 3 * MINUTE,
  // Profile creation, customer-page streaming, and profile expiration each
  // have independent bounded provider reads in the opt-in review capture.
  reviewScreenshotCapture: 2 * MINUTE,
  // How long the account locale-switch check holds the preference save and
  // the new-locale document, so whatever the old page renders in between
  // stays on screen long enough to observe.
  localeSwitchHeldResponse: 3 * SECOND,
  // Reading a failed page's state for its diagnostics. A wedged page then
  // reports its state as unavailable instead of hiding the failure.
  pageDiagnosticsRead: 5 * SECOND,
  paymentTerminalCase: 4 * MINUTE,
  providerTransition: 90 * SECOND,
  // Edits, reloads, and restoration checks on one reservation form, with no
  // submission: at most two edit-and-reload rounds or two page selections.
  reservationUrlStateCase: 4 * MINUTE,
  // How long the Temporal polyfill tests hold the polyfill response, so the
  // app's own scripts arrive first and have to wait for it.
  temporalPolyfillResponseDelay: 3 * SECOND,
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

// Cleanup closes the admin browser context, waits on one completion barrier
// per state-creating admin action (audience save, campaign draft creation),
// each with a bounded fallback that converges on the persisted row, then
// clears the Dotypos profile's tags, expires it, and deletes the synthetic
// rows.
export const workspaceE2EEmailCampaignMutationBarrierCount = 2;

export const workspaceE2EEmailCampaignCleanupTimeout =
  workspaceE2ETimeouts.browserAction +
  (workspaceE2ETimeouts.uiTransition + workspaceE2ETimeouts.datasource) *
    workspaceE2EEmailCampaignMutationBarrierCount +
  workspaceE2ETimeouts.cleanupAction * 2;

export const workspaceE2EEmailCampaignPlaywrightTimeout =
  workspaceE2ETimeouts.emailCampaignCase +
  workspaceE2EEmailCampaignCleanupTimeout;

// The automation journey's finalizer: the campaign fixture release plus
// clearing the booked customer's tag.
export const workspaceE2EAutomationJourneyCleanupTimeout =
  workspaceE2EEmailCampaignCleanupTimeout + workspaceE2ETimeouts.cleanupAction;

// The automation journey also runs in the checkout lanes, with its own
// finalizer inside the case.
const automationWatchdogRequirement =
  workspaceE2ETimeouts.automationReservationCase +
  workspaceE2EAutomationJourneyCleanupTimeout +
  workspaceE2ETimeouts.artifactCapture +
  workspaceE2ETimeouts.cleanupAction +
  workspaceE2ETimeouts.datasource;
export const workspaceE2EPlaywrightCheckoutTimeout = Math.max(
  checkoutWatchdogRequirement,
  automationWatchdogRequirement,
  accountWatchdogRequirement
);

// An administrator access case closes its own browser context in a bounded
// finalizer; suite cleanup deletes its seeded accounts.
export const workspaceE2EAdministratorAccessPlaywrightTimeout =
  workspaceE2ETimeouts.administratorAccessCase +
  workspaceE2ETimeouts.browserAction;

// The administrator agent tool cases share that project but need a longer
// watchdog; their finalizer closes the context the same way.
export const workspaceE2EAdministratorAgentToolsPlaywrightTimeout =
  workspaceE2ETimeouts.administratorAgentToolsCase +
  workspaceE2ETimeouts.browserAction;

// Agent evals give each agent a task budget; the harness gets SIGTERM a grace
// period after it and SIGKILL a kill grace later. Around that, a run seeds its account and picks its dates,
// checks the status page after a payment, and reconciles its journal.
export const workspaceAgentEvalTimeouts = {
  bookingTask: 10 * MINUTE,
  factsTask: 5 * MINUTE,
  harnessExitGrace: 30 * SECOND,
  harnessKillGrace: 10 * SECOND,
  paymentTask: 15 * MINUTE,
  runPreparation: 3 * MINUTE,
  statusPage: workspaceE2ETimeouts.providerTransition,
} as const;

const workspaceAgentEvalCleanupTimeout =
  workspaceE2ETimeouts.browserAction +
  workspaceE2ETimeouts.cleanupAction * 2 +
  workspaceE2ETimeouts.datasource;

export const workspaceAgentEvalPlaywrightTimeout = (taskBudgetMs: number) =>
  workspaceAgentEvalTimeouts.runPreparation +
  taskBudgetMs +
  workspaceAgentEvalTimeouts.harnessExitGrace +
  workspaceAgentEvalTimeouts.harnessKillGrace +
  workspaceAgentEvalTimeouts.statusPage +
  workspaceAgentEvalCleanupTimeout;

export type WorkspaceE2ETimeouts = Readonly<
  Record<keyof typeof workspaceE2ETimeouts, number>
>;

/** How long an argv runner command may run when its caller sets none. */
export const argvCommandTimeoutMs = 2 * MINUTE;

export const workspaceE2EPollIntervalMs = {
  advertisedPricing: 5 * SECOND,
  // Between automation planner ticks; each tick also reads the preview
  // database, never Dotypos.
  automationPlanner: 10 * SECOND,
  browser: SECOND,
  datasource: 5 * SECOND,
} as const;

// Postgres reads are not rate-limited, so database polls start here and back
// off to the datasource interval. Dotypos-backed polls keep fixed spacing
// because Dotypos answers bursts with 429.
export const workspaceE2EPollInitialIntervalMs = {
  database: 500,
} as const;

export const formatWorkspaceE2EDuration = (durationMs: number) => {
  if (durationMs < SECOND) return `${durationMs}ms`;
  if (durationMs < MINUTE) return `${(durationMs / SECOND).toFixed(1)}s`;
  return `${(durationMs / MINUTE).toFixed(1)}m`;
};
