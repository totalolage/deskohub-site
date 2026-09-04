import { describe, expect, test } from "bun:test";
import { resolve } from "node:path";
import { workspaceE2EAccountCaseIds } from "../e2e/account/catalog";

const repoFile = (relative: string) => resolve(import.meta.dir, "..", relative);

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

    expect(budget).toContain("magicLinkOperationsPerWindow = 4");
    expect(budget).toContain("magicLinkOperationWindowMs = 600_000");

    const cases = await Bun.file(repoFile("e2e/account/cases.ts")).text();
    const reserveIndents = cases
      .split("\n")
      .filter((line) => line.includes("rateBudget.reserve("))
      .map((line) => line.indexOf("yield* rateBudget.reserve("));
    expect(reserveIndents).toHaveLength(17);
    expect(new Set(reserveIndents).size).toBe(1);
    expect(cases.match(/rateBudget\.reserve\("send"\)/g)).toHaveLength(9);
    expect(cases.match(/rateBudget\.reserve\("verify"\)/g)).toHaveLength(8);

    // The rolling-window budget consumes the real spacing between delivered
    // links, so a fake-clock duration claim would have to assume provider
    // latency to separate a healthy lane from a blocked reserve; the count
    // and per-case shape below are the accurate regression instead.
    const deliveryCase = cases.slice(
      cases.indexOf('makeCase("account-magic-link-delivery"'),
      cases.indexOf('makeCase("account-profile-completion"')
    );
    expect(deliveryCase.match(/rateBudget\.reserve\("send"\)/g)).toHaveLength(
      1
    );
    expect(deliveryCase.match(/rateBudget\.reserve\("verify"\)/g)).toHaveLength(
      2
    );
    const afterDeliveryReplay = deliveryCase.slice(
      deliveryCase.indexOf("rejects the replayed link")
    );
    expect(afterDeliveryReplay).not.toContain("rateBudget.reserve(");

    const profileCompletionCase = cases.slice(
      cases.indexOf('makeCase("account-profile-completion"'),
      cases.indexOf('makeCase("account-reservation-transitions"')
    );
    expect(profileCompletionCase).not.toContain("rateBudget.reserve(");

    const markerCase = cases.slice(
      cases.indexOf('makeCase("account-deletion-marker-reauth"'),
      cases.indexOf('makeCase("account-deletion-and-reactivation"')
    );
    expect(markerCase.match(/rateBudget\.reserve\("send"\)/g)).toHaveLength(1);
    expect(markerCase.match(/rateBudget\.reserve\("verify"\)/g)).toHaveLength(
      1
    );
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
    expect(markerCase.slice(replayAt)).toContain("callbackFailedTitle");
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
