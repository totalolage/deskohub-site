import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { workspaceE2EAccountCaseIds } from "../e2e/account/catalog";
import {
  workspaceE2EPlaywrightCheckoutTimeout,
  workspaceE2ETimeouts,
} from "../e2e/timeouts";
import { countOccurrences } from "./shared/source-contract";

const repoFile = (relative: string) => resolve(import.meta.dir, "..", relative);

/**
 * Isolates one runStep block: from its unique step id to the next step's
 * admission, so content assertions cannot be satisfied by sibling steps.
 */
const isolatedStepBlock = (cases: string, stepId: string) => {
  const start = cases.indexOf(stepId);
  expect(start).toBeGreaterThan(-1);
  return cases.slice(start, cases.indexOf("yield* runStep(", start));
};

/**
 * Pins the page contract inside one isolated step: exactly one aria-snapshot
 * poll (never body-text or in-page waitForFunction channels) whose matcher
 * checks both expected displayed texts conjunctively.
 */
const expectSingleConjunctiveSnapshotMatcher = (
  stepBlock: string,
  firstName: string,
  secondName: string
) => {
  expect(countOccurrences(stepBlock, "waitForInteractiveSnapshot")).toBe(1);
  expect(countOccurrences(stepBlock, "waitForBrowserText")).toBe(0);
  expect(countOccurrences(stepBlock, "waitForBrowserCondition")).toBe(0);
  // waitText is a cases-local wrapper around waitForBrowserText, so its calls
  // must be rejected by their own name, not the wrapped helper's.
  expect(countOccurrences(stepBlock, "waitText(")).toBe(0);
  const firstAt = stepBlock.indexOf(`snapshot.includes(${firstName})`);
  const secondAt = stepBlock.indexOf(`snapshot.includes(${secondName})`);
  expect(firstAt).toBeGreaterThan(-1);
  expect(secondAt).toBeGreaterThan(-1);
  const [joinStart, joinEnd] =
    firstAt < secondAt ? [firstAt, secondAt] : [secondAt, firstAt];
  const join = stepBlock.slice(joinStart + 1, joinEnd);
  expect(join).toContain("&&");
  expect(join).not.toContain("||");
};

describe("workspace account e2e graph", () => {
  test("runs account cases as one project in the existing Playwright graph", async () => {
    const config = readFileSync(repoFile("playwright.e2e.config.ts"), "utf8");
    const accountNameAt = config.indexOf('name: "account-auth"');
    const accountProject = config.slice(
      config.lastIndexOf("    {", accountNameAt),
      config.indexOf('name: "checkout-availability"')
    );

    expect(
      countOccurrences(accountProject, 'name: "account-auth"')
    ).toBeGreaterThan(0);
    expect(
      countOccurrences(accountProject, 'testDir: "./e2e/account"')
    ).toBeGreaterThan(0);
    expect(
      countOccurrences(accountProject, 'dependencies: ["checkout-plan"]')
    ).toBeGreaterThan(0);
    expect(countOccurrences(config, 'name: "account-auth-setup"')).toBe(0);
    const checkoutEntry = readFileSync(
      repoFile("scripts/workspace-e2e.ts"),
      "utf8"
    );
    expect(
      countOccurrences(checkoutEntry, "playwright.e2e.config.ts")
    ).toBeGreaterThan(0);
  });

  test("keeps account cases free of screenshots, traces, videos, and HARs", async () => {
    const config = readFileSync(repoFile("playwright.e2e.config.ts"), "utf8");
    const projectBlock = config.slice(
      config.indexOf('name: "account-auth"'),
      config.indexOf("checkout-availability")
    );

    expect(countOccurrences(projectBlock, 'screenshot: "off"')).toBeGreaterThan(
      0
    );
    expect(countOccurrences(projectBlock, 'trace: "off"')).toBeGreaterThan(0);
    expect(countOccurrences(projectBlock, 'video: "off"')).toBeGreaterThan(0);

    const lane = readFileSync(
      repoFile("e2e/account/account-lane.pw.ts"),
      "utf8"
    );
    expect(countOccurrences(lane, "recordHar: false")).toBeGreaterThan(0);

    const runner = readFileSync(repoFile("e2e/account/runner.ts"), "utf8");
    expect(countOccurrences(runner, "captureBrowserFailureArtifacts")).toBe(0);
    expect(countOccurrences(runner, "startBrowserDiagnostics")).toBe(0);
    expect(countOccurrences(runner, "stopBrowserHar")).toBe(0);
  });

  test("registers the complete serial lifecycle in a stable order", async () => {
    expect(workspaceE2EAccountCaseIds).toEqual([
      "account-anonymous-redirect",
      "account-sign-in-form",
      "account-magic-link-delivery",
      "account-profile-completion",
      "account-reservation-transitions",
      "account-deletion-marker-reauth",
      "account-session-lifecycle",
      "account-deletion-and-reactivation",
      "account-linking-variants",
    ]);

    const lane = readFileSync(
      repoFile("e2e/account/account-lane.pw.ts"),
      "utf8"
    );
    expect(countOccurrences(lane, 'mode: "serial"')).toBeGreaterThan(0);
    expect(
      countOccurrences(
        lane,
        '"account-session-lifecycle": "callback-failed-desktop"'
      )
    ).toBeGreaterThan(0);
    expect(
      countOccurrences(
        lane,
        '"account-deletion-marker-reauth": "callback-failed-desktop"'
      )
    ).toBe(0);
  });

  test("reconciles the account lane during suite cleanup", async () => {
    const cleanup = readFileSync(
      repoFile("e2e/playwright-checkout/cleanup.pw.ts"),
      "utf8"
    );
    expect(
      countOccurrences(cleanup, "reconcileWorkspaceE2EAccountLane")
    ).toBeGreaterThan(0);
  });

  test("keeps the magic-link operation budget below the deployed limiter", async () => {
    // The budget must derive both constants from the deployed production
    // options so the E2E window and one-request headroom cannot drift from
    // the real limiter; assert the real configured values, not declarations.
    const {
      magicLinkOperationWindowMs,
      magicLinkOperationsPerWindow,
    } = await import("../e2e/account/rate-budget");
    const { betterAuthMagicLinkOptions } = await import(
      "@/features/account/backend/auth/auth-options"
    );

    expect(magicLinkOperationWindowMs).toBe(
      betterAuthMagicLinkOptions.rateLimit.window * 1000
    );
    expect(magicLinkOperationsPerWindow).toBe(
      betterAuthMagicLinkOptions.rateLimit.max - 1
    );
    expect(magicLinkOperationsPerWindow).toBeGreaterThan(0);

    const cases = readFileSync(repoFile("e2e/account/cases.ts"), "utf8");
    expect(countOccurrences(cases, "rateBudget.run(")).toBe(8);
    expect((cases.match(/rateBudget\.run\(\s*"send"/g) ?? []).length).toBe(4);
    expect((cases.match(/rateBudget\.run\(\s*"verify"/g) ?? []).length).toBe(4);
    expect(countOccurrences(cases, ".reserve(")).toBe(0);
    expect(countOccurrences(cases, "tryReserve")).toBe(0);

    // Each wrapper must hug its exact semantic endpoint: the nearest
    // preceding rateBudget.run carries the expected operation and directly
    // wraps this runStep, so a quiet-window wait consumes the case budget,
    // never the inner semantic step budget.
    const budgetedCases = cases;
    const expectBudgetedStep = (
      stepId: string,
      operation: "send" | "verify"
    ) => {
      const idAt = budgetedCases.indexOf(`"${stepId}"`);
      expect(idAt).toBeGreaterThan(-1);
      const wrapperAt = budgetedCases.lastIndexOf("rateBudget.run(", idAt);
      expect(wrapperAt).toBeGreaterThan(-1);
      const between = budgetedCases.slice(wrapperAt, idAt);
      expect(countOccurrences(between, `"${operation}"`)).toBeGreaterThan(0);
      expect(
        countOccurrences(between, operation === "send" ? '"verify"' : '"send"')
      ).toBe(0);
      expect(countOccurrences(between, "rateBudget.run(")).toBe(1);
      expect(countOccurrences(between, "runStep(")).toBe(1);
      expect(countOccurrences(between, "step(")).toBe(1);
    };

    // Non-endpoints stay outside the budget: the nearest preceding wrapper
    // must belong to an earlier step, never to this one. No preceding wrapper
    // at all is trivially unbudgeted.
    const expectUnbudgetedStep = (stepId: string) => {
      const idAt = budgetedCases.indexOf(`"${stepId}"`);
      expect(idAt).toBeGreaterThan(-1);
      const wrapperAt = budgetedCases.lastIndexOf("rateBudget.run(", idAt);
      if (wrapperAt === -1) return;
      const between = budgetedCases.slice(wrapperAt, idAt);
      expect(countOccurrences(between, "step(")).toBeGreaterThan(1);
    };

    expectBudgetedStep("accepts a first unknown email generically", "send");
    expectBudgetedStep(
      "accepts a second unknown email with an identical response",
      "send"
    );
    expectBudgetedStep("consumes the link into the completion state", "verify");
    expectBudgetedStep("sends the reauthentication link", "send");
    expectBudgetedStep(
      "rejects the already-consumed reauthentication link",
      "verify"
    );
    expectBudgetedStep("requests the reactivation sign-in link", "send");
    expectBudgetedStep(
      "reactivates the retained profile under a new Better Auth identity",
      "verify"
    );
    expectBudgetedStep("signs the same account back in", "verify");

    expectUnbudgetedStep("rejects an invalid email without requesting a link");
    expectUnbudgetedStep("requires the first accepted main request handoff");
    expectUnbudgetedStep("retrieves the delivered single-use link");
    expectUnbudgetedStep("retrieves the delivered reauthentication link");
    expectUnbudgetedStep("retrieves the reactivation link");

    // The quiet-window budget consumes the real spacing between delivered
    // links, so a fake-clock duration claim would have to assume provider
    // latency to separate a healthy lane from a blocked reserve; the count
    // and per-case shape below are the accurate regression instead.
    const deliveryCase = cases.slice(
      cases.indexOf('makeCase("account-magic-link-delivery"'),
      cases.indexOf('makeCase("account-profile-completion"')
    );
    expect(
      (deliveryCase.match(/rateBudget\.run\(\s*"send"/g) ?? []).length
    ).toBe(0);
    expect(
      (deliveryCase.match(/rateBudget\.run\(\s*"verify"/g) ?? []).length
    ).toBe(1);
    expect(countOccurrences(deliveryCase, "callbackFailedTitle")).toBe(0);
    expect(countOccurrences(deliveryCase, "rejects the replayed link")).toBe(0);
    expect(
      countOccurrences(deliveryCase, "requests the synthetic magic link")
    ).toBe(0);
    expect(deliveryCase.match(/openPage\(link\)/g)).toHaveLength(1);
    expect(
      countOccurrences(deliveryCase, "firstAcceptedRequestedAt")
    ).toBeGreaterThan(0);

    const signInCase = cases.slice(
      cases.indexOf('makeCase("account-sign-in-form"'),
      cases.indexOf('makeCase("account-magic-link-delivery"')
    );
    const handoffAt = signInCase.indexOf(
      "lifecycleHandoff.firstAcceptedRequestedAt = startedAt"
    );
    const submitAt = signInCase.indexOf("fillAndSubmitEmail(recipient)");
    expect(handoffAt).toBeGreaterThan(-1);
    expect(submitAt).toBeGreaterThan(handoffAt);
    expect(countOccurrences(signInCase, "accepted-a")).toBe(0);

    const profileCompletionCase = cases.slice(
      cases.indexOf('makeCase("account-profile-completion"'),
      cases.indexOf('makeCase("account-reservation-transitions"')
    );
    expect(countOccurrences(profileCompletionCase, "rateBudget.")).toBe(0);

    const markerCase = cases.slice(
      cases.indexOf('makeCase("account-deletion-marker-reauth"'),
      cases.indexOf('makeCase("account-session-lifecycle"')
    );
    expect((markerCase.match(/rateBudget\.run\(\s*"send"/g) ?? []).length).toBe(
      1
    );
    expect(
      (markerCase.match(/rateBudget\.run\(\s*"verify"/g) ?? []).length
    ).toBe(0);

    const linkingCase = cases.slice(
      cases.indexOf('makeCase("account-linking-variants"')
    );
    expect(countOccurrences(linkingCase, "rateBudget.")).toBe(0);
    expect(countOccurrences(linkingCase, "signOutAndRequireAnonymous")).toBe(0);
    expect(countOccurrences(linkingCase, "requestSignInLink")).toBe(0);
    expect(countOccurrences(linkingCase, "retrieveSignInLink")).toBe(0);
    expect(linkingCase.match(/localized\("\/contact"\)/g)).toHaveLength(3);
    expect(linkingCase.match(/removeSyntheticAccountLink\(/g)).toHaveLength(3);
    expect(countOccurrences(linkingCase, "email: recipient")).toBeGreaterThan(
      0
    );
    expect(
      countOccurrences(linkingCase, "dotyposCustomerIds: [duplicateCustomerId]")
    ).toBeGreaterThan(0);
  });

  // The durable linked-edit wait for account-profile-completion (button text
  // compared against the linkedEditSubmitLabel constant, never the transient
  // completion feedback) is covered behaviorally: the account lane executes
  // the full case in every protected-preview E2E run, and the
  // expectSingleConjunctiveSnapshotMatcher scans below enforce the same
  // "durable state, one conjunctive wait" convention on the sibling
  // reservation steps.

  // The canonical phone comparison for account-profile-completion (provider
  // phone and profile fixture both run through normalizePhoneNumber before
  // equality) is covered behaviorally: the account lane executes the full
  // case in every protected-preview E2E run, and the recorded synthetic
  // profile carries the formatted "+420 555 000 111" fixture value so a
  // raw-string comparison could never converge.

  test("bounds the confirmed-reservations step as one combined condition", async () => {
    const cases = readFileSync(repoFile("e2e/account/cases.ts"), "utf8");
    const stepBlock = isolatedStepBlock(
      cases,
      '"shows the confirmed reservations in the current group"'
    );

    expect(countOccurrences(stepBlock, "cancelSyntheticReservation")).toBe(0);
    expectSingleConjunctiveSnapshotMatcher(
      stepBlock,
      "currentReservationsTitle",
      "confirmedStatus"
    );

    // The page-load budget is the configured browser-action and datasource
    // timeouts combined (see accountPageLoadTimeout in cases.ts); it must fit
    // inside the overall Playwright checkout budget.
    expect(workspaceE2ETimeouts.browserAction).toBeGreaterThan(0);
    expect(workspaceE2EPlaywrightCheckoutTimeout).toBeGreaterThanOrEqual(
      workspaceE2ETimeouts.browserAction + workspaceE2ETimeouts.datasource
    );
  });

  test("keeps cancellation a standalone datasource step before the past page", async () => {
    const cases = readFileSync(repoFile("e2e/account/cases.ts"), "utf8");
    const cancellationId = '"cancels the second synthetic reservation"';
    const pastPageId = '"moves the cancelled reservation to the past group"';
    const cancellationBlock = isolatedStepBlock(cases, cancellationId);

    expect(cases.indexOf(cancellationId)).toBeLessThan(
      cases.indexOf(pastPageId)
    );
    expect(
      countOccurrences(cancellationBlock, "cancelSyntheticReservation")
    ).toBeGreaterThan(0);
    expect(countOccurrences(cancellationBlock, "waitForBrowserCondition")).toBe(
      0
    );
    expect(countOccurrences(cancellationBlock, "openPage(")).toBe(0);
    expect(cancellationBlock.split("datasourceTimeout").length - 1).toBe(1);
  });

  test("bounds the past-reservations page step as one combined condition", async () => {
    const cases = readFileSync(repoFile("e2e/account/cases.ts"), "utf8");
    const stepBlock = isolatedStepBlock(
      cases,
      '"moves the cancelled reservation to the past group"'
    );

    expect(countOccurrences(stepBlock, "cancelSyntheticReservation")).toBe(0);
    expectSingleConjunctiveSnapshotMatcher(
      stepBlock,
      "pastReservationsTitle",
      "cancelledStatus"
    );
  });

  test("bounds the retained-history page step as one combined condition", async () => {
    const cases = readFileSync(repoFile("e2e/account/cases.ts"), "utf8");
    const stepBlock = isolatedStepBlock(
      cases,
      '"keeps the retained reservation history across reactivation"'
    );

    expect(countOccurrences(stepBlock, "cancelSyntheticReservation")).toBe(0);
    expectSingleConjunctiveSnapshotMatcher(
      stepBlock,
      "pastReservationsTitle",
      "cancelledStatus"
    );
  });

  // The reauthentication-link handoff (marker case retrieves the link and
  // hands lifecycleHandoff.reauthentication; the session-lifecycle case
  // consumes it twice around sign-out, deletion proof, anonymous access,
  // and the replay with per-user cleanup) is covered behaviorally: the
  // protected-preview account lane executes the full
  // deletion-marker-reauth and session-lifecycle cases end to end, and
  // the serial lifecycle registration is pinned via the imported
  // workspaceE2EAccountCaseIds catalog above.
  test("hands the account lifecycle through the worker-scoped lane fixture", async () => {
    const lane = readFileSync(
      repoFile("e2e/account/account-lane.pw.ts"),
      "utf8"
    );
    const cases = readFileSync(repoFile("e2e/account/cases.ts"), "utf8");

    const perTestLoopAt = lane.indexOf("for (const caseId");
    const fixtureScope = lane.slice(0, perTestLoopAt);
    expect(
      countOccurrences(
        fixtureScope,
        "lifecycleHandoff: WorkspaceE2EAccountLifecycleHandoff"
      )
    ).toBeGreaterThan(0);
    expect(
      countOccurrences(fixtureScope, "const lifecycleHandoff")
    ).toBeGreaterThan(0);
    expect(countOccurrences(fixtureScope, "lifecycleHandoff,")).toBeGreaterThan(
      0
    );

    const factoryCall = lane.slice(
      lane.indexOf("makeWorkspaceE2EAccountCases({")
    );
    expect(
      countOccurrences(
        factoryCall,
        "lifecycleHandoff: accountLane.lifecycleHandoff"
      )
    ).toBeGreaterThan(0);

    expect(
      countOccurrences(
        cases,
        "readonly lifecycleHandoff: WorkspaceE2EAccountLifecycleHandoff"
      )
    ).toBeGreaterThan(0);
    expect(countOccurrences(cases, "completedDeletion")).toBe(0);

    const types = readFileSync(repoFile("e2e/account/types.ts"), "utf8");
    expect(
      countOccurrences(types, "WorkspaceE2EAccountLifecycleHandoff")
    ).toBeGreaterThan(0);
    expect(
      countOccurrences(types, "firstAcceptedRequestedAt?: Date")
    ).toBeGreaterThan(0);
    expect(countOccurrences(types, "reauthentication?:")).toBeGreaterThan(0);
    expect(countOccurrences(types, "link: string")).toBeGreaterThan(0);
    expect(countOccurrences(types, "linkedCustomerId: string")).toBeGreaterThan(
      0
    );
  });

  test("disambiguates repeated sign-ins by excluding observed messages", async () => {
    const retrieval = readFileSync(
      repoFile("e2e/account/resend-retrieval.ts"),
      "utf8"
    );

    expect(
      countOccurrences(retrieval, "listSyntheticMessageIds")
    ).toBeGreaterThan(0);
    expect(countOccurrences(retrieval, "excludeMessageIds")).toBeGreaterThan(0);
    expect(
      countOccurrences(retrieval, "multiple synthetic messages")
    ).toBeGreaterThan(0);
  });

  test("shares the fixed correlation tags with the deployed magic-link sender", async () => {
    const sender = readFileSync(
      repoFile("features/account/backend/auth/send-magic-link-email.ts"),
      "utf8"
    );
    const accountConfig = readFileSync(
      repoFile("e2e/account/config.ts"),
      "utf8"
    );

    for (const marker of [
      '"category"',
      '"account-magic-link"',
      '"surface"',
      '"workspace"',
    ]) {
      expect(sender).toContain(marker);
      expect(accountConfig).toContain(marker);
    }
  });

  test("expires synthetic Dotypos profiles instead of deleting them", async () => {
    const reconcile = readFileSync(
      repoFile("e2e/account/reconcile.ts"),
      "utf8"
    );
    const fixtures = readFileSync(repoFile("e2e/account/fixtures.ts"), "utf8");

    expect(
      countOccurrences(reconcile, "expireSyntheticCustomerProfile")
    ).toBeGreaterThan(0);
    expect(
      countOccurrences(reconcile, "removeSyntheticAuthUser")
    ).toBeGreaterThan(0);
    expect(
      countOccurrences(fixtures, "expireDate: new Date(Date.now() - 60_000)")
    ).toBeGreaterThan(0);
    expect(countOccurrences(fixtures, "deleteCustomer")).toBe(0);
  });

  test("journals only exact identifiers", async () => {
    const { emptyWorkspaceE2EAccountJournal } = await import(
      "../e2e/account/journal"
    );
    const fields = Object.keys(emptyWorkspaceE2EAccountJournal());

    expect(fields).toEqual([
      "authUserIds",
      "completed",
      "dotyposCustomerIds",
      "dotyposReservationIds",
      "laneId",
      "startedAt",
      "version",
    ]);
    expect(fields.join(",")).not.toMatch(/email|recipient|url|token|cookie/i);
  });
});
