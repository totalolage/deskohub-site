import { describe, expect, test } from "bun:test";
import { resolve } from "node:path";
import { workspaceE2EAccountCaseIds } from "../e2e/account/catalog";

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

const countOccurrences = (text: string, needle: string) =>
  text.split(needle).length - 1;

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
    const config = await Bun.file(repoFile("playwright.e2e.config.ts")).text();

    expect(config).toContain('name: "account-auth"');
    expect(config).toContain('testDir: "./e2e/account"');
    expect(config).toContain('dependencies: ["checkout-setup"]');
    expect(config).not.toContain('name: "account-auth-setup"');
    const checkoutEntry = await Bun.file(
      repoFile("scripts/workspace-e2e.ts")
    ).text();
    expect(checkoutEntry).toContain("playwright.e2e.config.ts");
  });

  test("keeps account cases free of screenshots, traces, videos, and HARs", async () => {
    const config = await Bun.file(repoFile("playwright.e2e.config.ts")).text();
    const projectBlock = config.slice(
      config.indexOf('name: "account-auth"'),
      config.indexOf("checkout-availability")
    );

    expect(projectBlock).toContain('screenshot: "off"');
    expect(projectBlock).toContain('trace: "off"');
    expect(projectBlock).toContain('video: "off"');

    const lane = await Bun.file(
      repoFile("e2e/account/account-lane.pw.ts")
    ).text();
    expect(lane).toContain("recordHar: false");

    const runner = await Bun.file(repoFile("e2e/account/runner.ts")).text();
    expect(runner).not.toContain("captureBrowserFailureArtifacts");
    expect(runner).not.toContain("startBrowserDiagnostics");
    expect(runner).not.toContain("stopBrowserHar");
  });

  test("registers the complete serial lifecycle in a stable order", async () => {
    expect(workspaceE2EAccountCaseIds).toEqual([
      "account-anonymous-redirect",
      "account-sign-in-form",
      "account-magic-link-delivery",
      "account-profile-completion",
      "account-reservation-transitions",
      "account-deletion-marker-reauth",
      "account-deletion-and-reactivation",
      "account-session-lifecycle",
      "account-linking-variants",
    ]);

    const lane = await Bun.file(
      repoFile("e2e/account/account-lane.pw.ts")
    ).text();
    expect(lane).toContain('mode: "serial"');
  });

  test("reconciles the account lane during suite cleanup", async () => {
    const cleanup = await Bun.file(
      repoFile("e2e/playwright-checkout/cleanup.pw.ts")
    ).text();
    expect(cleanup).toContain("reconcileWorkspaceE2EAccountLane");
  });

  test("keeps the magic-link operation budget below the deployed limiter", async () => {
    const budget = await Bun.file(
      repoFile("e2e/account/rate-budget.ts")
    ).text();
    const budgetSource = budget.replace(/\s+/g, " ");

    // The budget must derive both constants from the deployed production
    // options so the E2E window and one-request headroom cannot drift from
    // the real limiter; numeric literals would pin a stale contract.
    expect(budgetSource).toContain(
      'import { betterAuthMagicLinkOptions } from "@/features/account/backend/auth/auth-options";'
    );
    expect(budgetSource).toContain(
      "export const magicLinkOperationWindowMs = betterAuthMagicLinkOptions.rateLimit.window * 1000;"
    );
    expect(budgetSource).toContain(
      "export const magicLinkOperationsPerWindow = betterAuthMagicLinkOptions.rateLimit.max - 1;"
    );
    expect(budgetSource).not.toMatch(/magicLinkOperationsPerWindow\s*=\s*\d/);
    expect(budgetSource).not.toMatch(/magicLinkOperationWindowMs\s*=\s*\d/);

    const cases = await Bun.file(repoFile("e2e/account/cases.ts")).text();
    expect(countOccurrences(cases, "rateBudget.run(")).toBe(17);
    expect((cases.match(/rateBudget\.run\(\s*"send"/g) ?? []).length).toBe(9);
    expect((cases.match(/rateBudget\.run\(\s*"verify"/g) ?? []).length).toBe(8);
    expect(cases).not.toContain(".reserve(");
    expect(cases).not.toContain("tryReserve");

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
      expect(between).toContain(`"${operation}"`);
      expect(between).not.toContain(
        operation === "send" ? '"verify"' : '"send"'
      );
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
    expectBudgetedStep("requests the synthetic magic link", "send");
    expectBudgetedStep("consumes the link into the completion state", "verify");
    expectBudgetedStep("sends the reauthentication link", "send");
    expectBudgetedStep(
      "keeps the deletion marker state after reauthentication",
      "verify"
    );
    expectBudgetedStep(
      "rejects the already-consumed reauthentication link",
      "verify"
    );
    expectBudgetedStep("requests the reactivation sign-in link", "send");
    expectBudgetedStep(
      "reactivates the retained profile under a new Better Auth identity",
      "verify"
    );
    expectBudgetedStep("requests the returning sign-in link", "send");
    expectBudgetedStep("signs the same account back in", "verify");
    expectBudgetedStep("requests the active-profile sign-in link", "send");
    expectBudgetedStep(
      "links the active provider profile without completion",
      "verify"
    );
    expectBudgetedStep("requests the expired-profile sign-in link", "send");
    expectBudgetedStep(
      "reactivates the expired provider profile on linking",
      "verify"
    );
    expectBudgetedStep("requests the support-state sign-in link", "send");
    expectBudgetedStep(
      "requires support for an ambiguous provider profile",
      "verify"
    );

    expectUnbudgetedStep("rejects an invalid email without requesting a link");
    expectUnbudgetedStep("retrieves the delivered single-use link");
    expectUnbudgetedStep("retrieves the delivered reauthentication link");
    expectUnbudgetedStep("retrieves the reactivation link");
    expectUnbudgetedStep("retrieves the returning sign-in link");
    expectUnbudgetedStep("retrieves the active-profile sign-in link");
    expectUnbudgetedStep("retrieves the expired-profile sign-in link");
    expectUnbudgetedStep("retrieves the support-state sign-in link");

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
    ).toBe(1);
    expect(
      (deliveryCase.match(/rateBudget\.run\(\s*"verify"/g) ?? []).length
    ).toBe(1);
    expect(deliveryCase).not.toContain("callbackFailedTitle");
    expect(deliveryCase).not.toContain("rejects the replayed link");
    expect(deliveryCase.match(/openPage\(link\)/g)).toHaveLength(1);

    const profileCompletionCase = cases.slice(
      cases.indexOf('makeCase("account-profile-completion"'),
      cases.indexOf('makeCase("account-reservation-transitions"')
    );
    expect(profileCompletionCase).not.toContain("rateBudget.");

    const markerCase = cases.slice(
      cases.indexOf('makeCase("account-deletion-marker-reauth"'),
      cases.indexOf('makeCase("account-deletion-and-reactivation"')
    );
    expect((markerCase.match(/rateBudget\.run\(\s*"send"/g) ?? []).length).toBe(
      1
    );
    expect(
      (markerCase.match(/rateBudget\.run\(\s*"verify"/g) ?? []).length
    ).toBe(2);
  });

  test("waits for the durable linked edit state instead of the transient completion feedback", async () => {
    const cases = await Bun.file(repoFile("e2e/account/cases.ts")).text();
    const completionCase = cases.slice(
      cases.indexOf('makeCase("account-profile-completion"'),
      cases.indexOf('makeCase("account-reservation-transitions"')
    );

    expect(cases).not.toContain("created and linked");
    expect(cases).toContain('const linkedEditSubmitLabel = "Save profile";');
    expect(completionCase).toContain("waitForBrowserCondition");
    expect(completionCase).toContain("JSON.stringify(linkedEditSubmitLabel)");
    expect(completionCase).toContain(
      'waitText("profile update saved", profileSaved)'
    );
  });

  test("compares the provider profile phone by canonical normalized value", async () => {
    const cases = await Bun.file(repoFile("e2e/account/cases.ts")).text();
    const completionCase = cases.slice(
      cases.indexOf('makeCase("account-profile-completion"'),
      cases.indexOf('makeCase("account-reservation-transitions"')
    );

    expect(cases).toContain('const profilePhoneFixture = "+420 555 000 111";');
    expect(completionCase).toContain("normalizePhoneNumber(customer.phone)");
    expect(completionCase).toContain(
      "normalizePhoneNumber(profilePhoneFixture)"
    );
    expect(completionCase).not.toContain('includes("555 000 111")');
  });

  test("bounds the confirmed-reservations step as one combined condition", async () => {
    const cases = await Bun.file(repoFile("e2e/account/cases.ts")).text();
    expect(cases).toContain(
      "const accountPageLoadTimeout = browserTimeout + datasourceTimeout;"
    );
    const stepBlock = isolatedStepBlock(
      cases,
      '"shows the confirmed reservations in the current group"'
    );

    expect(stepBlock).not.toContain("cancelSyntheticReservation");
    expectSingleConjunctiveSnapshotMatcher(
      stepBlock,
      "currentReservationsTitle",
      "confirmedStatus"
    );
    expect(stepBlock).toContain("timeoutMs: datasourceTimeout");
    expect(countOccurrences(stepBlock, "accountPageLoadTimeout")).toBe(1);
  });

  test("keeps cancellation a standalone datasource step before the past page", async () => {
    const cases = await Bun.file(repoFile("e2e/account/cases.ts")).text();
    const cancellationId = '"cancels the second synthetic reservation"';
    const pastPageId = '"moves the cancelled reservation to the past group"';
    const cancellationBlock = isolatedStepBlock(cases, cancellationId);

    expect(cases.indexOf(cancellationId)).toBeLessThan(
      cases.indexOf(pastPageId)
    );
    expect(cancellationBlock).toContain("cancelSyntheticReservation");
    expect(cancellationBlock).not.toContain("waitForBrowserCondition");
    expect(cancellationBlock).not.toContain("openPage(");
    expect(cancellationBlock.split("datasourceTimeout").length - 1).toBe(1);
  });

  test("bounds the past-reservations page step as one combined condition", async () => {
    const cases = await Bun.file(repoFile("e2e/account/cases.ts")).text();
    const stepBlock = isolatedStepBlock(
      cases,
      '"moves the cancelled reservation to the past group"'
    );

    expect(stepBlock).not.toContain("cancelSyntheticReservation");
    expectSingleConjunctiveSnapshotMatcher(
      stepBlock,
      "pastReservationsTitle",
      "cancelledStatus"
    );
    expect(stepBlock).toContain("timeoutMs: datasourceTimeout");
    expect(countOccurrences(stepBlock, "accountPageLoadTimeout")).toBe(1);
  });

  test("bounds the retained-history page step as one combined condition", async () => {
    const cases = await Bun.file(repoFile("e2e/account/cases.ts")).text();
    const stepBlock = isolatedStepBlock(
      cases,
      '"keeps the retained reservation history across reactivation"'
    );

    expect(stepBlock).not.toContain("cancelSyntheticReservation");
    expectSingleConjunctiveSnapshotMatcher(
      stepBlock,
      "pastReservationsTitle",
      "cancelledStatus"
    );
    expect(stepBlock).toContain("timeoutMs: datasourceTimeout");
    expect(countOccurrences(stepBlock, "accountPageLoadTimeout")).toBe(1);
  });

  test("completes the stale deletion through the delivered reauthentication link", async () => {
    const cases = await Bun.file(repoFile("e2e/account/cases.ts")).text();
    const markerCase = cases.slice(
      cases.indexOf('makeCase("account-deletion-marker-reauth"'),
      cases.indexOf('makeCase("account-deletion-and-reactivation"')
    );

    expect(markerCase).toContain("retrieveSignInLink");
    expect(markerCase).toContain("openPage(reauthenticationLink)");
    expect(markerCase).toContain("deleted page");
    expect(markerCase).not.toContain("setDeletionRequestedAt(userId, null)");
    expect(markerCase).not.toContain("linked account restored");
    expect(markerCase.match(/setDeletionRequestedAt\(/g) ?? []).toHaveLength(1);
  });

  test("replays the consumed deletion link after proving anonymous access", async () => {
    const cases = await Bun.file(repoFile("e2e/account/cases.ts")).text();

    const deliveryCase = cases.slice(
      cases.indexOf('makeCase("account-magic-link-delivery"'),
      cases.indexOf('makeCase("account-profile-completion"')
    );
    expect(deliveryCase).not.toContain("callbackFailedTitle");
    expect(deliveryCase.match(/openPage\(link\)/g)).toHaveLength(1);

    const markerCase = cases.slice(
      cases.indexOf('makeCase("account-deletion-marker-reauth"'),
      cases.indexOf('makeCase("account-deletion-and-reactivation"')
    );
    const consumptions = markerCase.match(/openPage\(reauthenticationLink\)/g);
    expect(consumptions).toHaveLength(2);

    const consumedAt = markerCase.indexOf("openPage(reauthenticationLink)");
    const deletedAt = markerCase.indexOf("deleted page");
    const anonymousAt = markerCase.indexOf(
      "anonymous account redirect after deletion"
    );
    const replayAt = markerCase.lastIndexOf("openPage(reauthenticationLink)");
    expect(deletedAt).toBeGreaterThan(consumedAt);
    expect(anonymousAt).toBeGreaterThan(deletedAt);
    expect(replayAt).toBeGreaterThan(anonymousAt);
    const replayStep = markerCase.slice(replayAt);
    expect(replayStep).toContain("findAuthUserIdByEmail(recipient)");
    expect(replayStep).toContain("authUserIds: [replayedUserId]");
    const cleanupAt = replayStep.indexOf("findAuthUserIdByEmail");
    const assertionAt = replayStep.indexOf(
      "replayed reauthentication failure state"
    );
    expect(cleanupAt).toBeGreaterThan(-1);
    expect(assertionAt).toBeGreaterThan(cleanupAt);
    expect(replayStep).toContain("callbackFailedTitle");
  });

  test("hands the completed deletion through the worker-scoped lane fixture", async () => {
    const lane = await Bun.file(
      repoFile("e2e/account/account-lane.pw.ts")
    ).text();
    const cases = await Bun.file(repoFile("e2e/account/cases.ts")).text();

    const perTestLoopAt = lane.indexOf("for (const caseId");
    const fixtureScope = lane.slice(0, perTestLoopAt);
    expect(fixtureScope).toContain(
      "deletionHandoff: WorkspaceE2EAccountDeletionHandoff"
    );
    expect(fixtureScope).toContain("const deletionHandoff");
    expect(fixtureScope).toContain("deletionHandoff,");

    const factoryCall = lane.slice(
      lane.indexOf("makeWorkspaceE2EAccountCases({")
    );
    expect(factoryCall).toContain(
      "deletionHandoff: accountLane.deletionHandoff"
    );

    expect(cases).toContain(
      "readonly deletionHandoff: WorkspaceE2EAccountDeletionHandoff"
    );
    expect(cases).not.toContain("completedDeletion");
  });

  test("disambiguates repeated sign-ins by excluding observed messages", async () => {
    const retrieval = await Bun.file(
      repoFile("e2e/account/resend-retrieval.ts")
    ).text();

    expect(retrieval).toContain("listSyntheticMessageIds");
    expect(retrieval).toContain("excludeMessageIds");
    expect(retrieval).toContain("multiple synthetic messages");
  });

  test("shares the fixed correlation tags with the deployed magic-link sender", async () => {
    const sender = await Bun.file(
      repoFile("features/account/backend/auth/send-magic-link-email.ts")
    ).text();
    const accountConfig = await Bun.file(
      repoFile("e2e/account/config.ts")
    ).text();

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
    const reconcile = await Bun.file(
      repoFile("e2e/account/reconcile.ts")
    ).text();
    const fixtures = await Bun.file(repoFile("e2e/account/fixtures.ts")).text();

    expect(reconcile).toContain("expireSyntheticCustomerProfile");
    expect(reconcile).toContain("removeSyntheticAuthUser");
    expect(fixtures).toContain("expireDate: new Date(Date.now() - 60_000)");
    expect(fixtures).not.toContain("deleteCustomer");
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
