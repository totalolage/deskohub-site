import "../../shared/polyfills/temporal";

import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { DotyposCustomerIdSchema } from "@deskohub/dotypos";
import type { Page } from "@playwright/test";
import { Cause, Effect, Exit, Fiber } from "effect";
import {
  makeWorkspaceE2EMarketingPreferencesSeedRow,
  navigateAuthenticatedWorkspaceE2EMarketingPreferences,
  navigateWorkspaceE2EMarketingPreferences,
  runWorkspaceE2EMarketingBrowserOperation,
  verifyWorkspaceE2EMarketingPreferences,
} from "./marketing-preferences";

const baseUrl = "https://deskohub-workspace-marketing.example.test";
const customerId = DotyposCustomerIdSchema.make(
  "marketing-preferences-test-customer"
);
const rawLinkToken = Buffer.alloc(32, 0x37).toString("base64url");
const linkTokenHash = createHash("sha256")
  .update(rawLinkToken, "utf8")
  .digest("hex");
const now = Temporal.Instant.from("2030-01-01T03:04:05Z");
const browserFailureMessage =
  "Marketing preferences browser verification failed";

type GotoOptions = Parameters<Page["goto"]>[1];

const makeFakePage = (
  goto: (url: string, options: GotoOptions) => Promise<void>,
  initialUrl = ""
) => {
  let currentUrl = initialUrl;
  const gotoCalls: Array<{
    readonly options: GotoOptions;
    readonly url: string;
  }> = [];
  const page = Object.assign({} as Page, {
    goto: async (url: string, options: GotoOptions) => {
      gotoCalls.push({ options, url });
      await goto(url, options);
      currentUrl = url;
      return null;
    },
    url: () => currentUrl,
  });

  return { gotoCalls, page };
};

type PromiseGate = {
  readonly promise: Promise<void>;
  readonly resolve: () => void;
};

const makePromiseGate = (): PromiseGate => {
  let resolve!: () => void;
  const promise = new Promise<void>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
};

const flushMicrotasks = async (): Promise<void> => {
  for (let index = 0; index < 5; index += 1) await Promise.resolve();
};

type SyntheticMarketingConsent = {
  readonly dotyposCustomerId: string;
  readonly documentHash: string;
  readonly grantedAt: string;
  readonly locale: "en-US";
  readonly withdrawnAt: string | null;
};

type SyntheticMarketingFixtureState = {
  consent: SyntheticMarketingConsent;
  tokenHashes: string[];
};

const cloneSyntheticMarketingFixtureState = (
  state: SyntheticMarketingFixtureState
): SyntheticMarketingFixtureState => ({
  consent: { ...state.consent },
  tokenHashes: [...state.tokenHashes],
});

const makeSyntheticMarketingFixture = () => {
  const original: SyntheticMarketingFixtureState = {
    consent: {
      documentHash: "synthetic-marketing-document-hash",
      dotyposCustomerId: customerId,
      grantedAt: "2030-01-01T03:04:05Z",
      locale: "en-US",
      withdrawnAt: null,
    },
    tokenHashes: ["synthetic-existing-token-hash"],
  };
  const state = cloneSyntheticMarketingFixtureState(original);

  return {
    original,
    restore: () => {
      const restored = cloneSyntheticMarketingFixtureState(original);
      state.consent = restored.consent;
      state.tokenHashes = restored.tokenHashes;
    },
    state,
  };
};

describe("workspace marketing preferences helper", () => {
  test("computes a 720-hour expiry and preserves a hash-only link seed row", () => {
    const row = makeWorkspaceE2EMarketingPreferencesSeedRow({
      customerId,
      now,
      tokenHash: linkTokenHash,
    });

    expect(row).toEqual({
      dotyposCustomerId: customerId,
      expiresAt: now.add({ hours: 720 }),
      purpose: "link",
      revokedAt: null,
      tokenHash: linkTokenHash,
    });
    expect(row.expiresAt.since(now, { largestUnit: "hours" }).hours).toBe(720);
    expect(row.tokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(row.tokenHash).toBe(linkTokenHash);
    expect(row.tokenHash).not.toBe(rawLinkToken);
    expect(JSON.stringify(row)).not.toContain(rawLinkToken);
    expect(row).not.toHaveProperty("rawLinkToken");
  });

  test("uses the link purpose and leaves a seeded link unrevoked", () => {
    const row = makeWorkspaceE2EMarketingPreferencesSeedRow({
      customerId,
      now,
      tokenHash: linkTokenHash,
    });

    expect(row.purpose).toBe("link");
    expect(row.revokedAt).toBeNull();
  });

  test("waits for interrupted browser preparation before fixture cleanup", async () => {
    const fixture = makeSyntheticMarketingFixture();
    const preparationStarted = makePromiseGate();
    const releasePreparation = makePromiseGate();
    const abortObserved = makePromiseGate();
    let cleanupRan = false;
    let cleanupSawOperationSettled = false;
    let operationSettled = false;
    let submitCount = 0;
    const operation = runWorkspaceE2EMarketingBrowserOperation(
      "interrupted marketing browser preparation",
      async (signal) => {
        signal.addEventListener("abort", () => abortObserved.resolve(), {
          once: true,
        });
        preparationStarted.resolve();
        try {
          await releasePreparation.promise;
          signal.throwIfAborted();
          submitCount += 1;
          fixture.state.consent = {
            ...fixture.state.consent,
            withdrawnAt: "2030-01-01T04:04:05Z",
          };
          fixture.state.tokenHashes.push("synthetic-new-token-hash");
        } finally {
          operationSettled = true;
        }
      }
    );
    const outerFixture = Effect.acquireUseRelease(
      Effect.succeed(fixture),
      () => operation,
      () =>
        Effect.sync(() => {
          cleanupRan = true;
          cleanupSawOperationSettled = operationSettled;
          fixture.restore();
        })
    );
    const unhandledRejections: unknown[] = [];
    const onUnhandledRejection = (reason: unknown) => {
      unhandledRejections.push(reason);
    };
    process.on("unhandledRejection", onUnhandledRejection);

    try {
      await Effect.runPromise(
        Effect.gen(function* () {
          const fiber = yield* Effect.forkChild(outerFixture);
          yield* Effect.promise(() => preparationStarted.promise);

          const interruption = yield* Effect.forkChild(Fiber.interrupt(fiber));
          yield* Effect.promise(() => abortObserved.promise);
          yield* Effect.yieldNow;

          expect(cleanupRan).toBe(false);
          expect(operationSettled).toBe(false);
          expect(submitCount).toBe(0);
          expect(fixture.state).toEqual(fixture.original);

          releasePreparation.resolve();
          yield* Fiber.join(interruption);
          const exit = yield* Fiber.await(fiber);
          expect(Exit.isFailure(exit)).toBe(true);
          if (Exit.isFailure(exit))
            expect(Cause.hasInterruptsOnly(exit.cause)).toBe(true);
        })
      );
    } finally {
      releasePreparation.resolve();
      await flushMicrotasks();
      process.off("unhandledRejection", onUnhandledRejection);
    }

    expect(cleanupRan).toBe(true);
    expect(cleanupSawOperationSettled).toBe(true);
    expect(operationSettled).toBe(true);
    expect(submitCount).toBe(0);
    expect(fixture.state).toEqual(fixture.original);
    expect(unhandledRejections).toHaveLength(0);
  });

  test("waits for a delayed submitted action and terminal state before fixture cleanup", async () => {
    const fixture = makeSyntheticMarketingFixture();
    const clickResolved = makePromiseGate();
    const releaseAction = makePromiseGate();
    const terminalStateResolved = makePromiseGate();
    const abortObserved = makePromiseGate();
    let cleanupRan = false;
    let cleanupSawOperationSettled = false;
    let operationSettled = false;
    let clickCount = 0;
    const operation = runWorkspaceE2EMarketingBrowserOperation(
      "delayed submitted marketing browser operation",
      async (signal) => {
        signal.addEventListener("abort", () => abortObserved.resolve(), {
          once: true,
        });
        signal.throwIfAborted();
        clickCount += 1;
        clickResolved.resolve();
        try {
          await releaseAction.promise;
          fixture.state.consent = {
            ...fixture.state.consent,
            withdrawnAt: "2030-01-01T04:04:05Z",
          };
          fixture.state.tokenHashes.push("synthetic-new-token-hash");
          terminalStateResolved.resolve();
          await terminalStateResolved.promise;
        } finally {
          operationSettled = true;
        }
      }
    );
    const outerFixture = Effect.acquireUseRelease(
      Effect.succeed(fixture),
      () => operation,
      () =>
        Effect.sync(() => {
          cleanupRan = true;
          cleanupSawOperationSettled = operationSettled;
          fixture.restore();
        })
    );
    const unhandledRejections: unknown[] = [];
    const onUnhandledRejection = (reason: unknown) => {
      unhandledRejections.push(reason);
    };
    process.on("unhandledRejection", onUnhandledRejection);

    try {
      await Effect.runPromise(
        Effect.gen(function* () {
          const fiber = yield* Effect.forkChild(outerFixture);
          yield* Effect.promise(() => clickResolved.promise);

          const interruption = yield* Effect.forkChild(Fiber.interrupt(fiber));
          yield* Effect.promise(() => abortObserved.promise);
          yield* Effect.yieldNow;

          expect(cleanupRan).toBe(false);
          expect(operationSettled).toBe(false);
          expect(clickCount).toBe(1);
          expect(fixture.state).toEqual(fixture.original);

          releaseAction.resolve();
          yield* Effect.promise(() => terminalStateResolved.promise);
          yield* Fiber.join(interruption);
          const exit = yield* Fiber.await(fiber);
          expect(Exit.isFailure(exit)).toBe(true);
          if (Exit.isFailure(exit))
            expect(Cause.hasInterruptsOnly(exit.cause)).toBe(true);
        })
      );
    } finally {
      releaseAction.resolve();
      await flushMicrotasks();
      process.off("unhandledRejection", onUnhandledRejection);
    }

    expect(cleanupRan).toBe(true);
    expect(cleanupSawOperationSettled).toBe(true);
    expect(operationSettled).toBe(true);
    expect(clickCount).toBe(1);
    expect(fixture.state).toEqual(fixture.original);
    expect(unhandledRejections).toHaveLength(0);
  });

  test("passes the access URL to Playwright with a bounded load wait", async () => {
    const accessUrl = `${baseUrl}/en-US/marketing-preferences/access?token=${rawLinkToken}`;
    const fakePage = makeFakePage(async () => undefined);

    await navigateWorkspaceE2EMarketingPreferences(fakePage.page, accessUrl);

    expect(fakePage.gotoCalls).toEqual([
      {
        options: {
          timeout: expect.any(Number),
          waitUntil: "load",
        },
        url: accessUrl,
      },
    ]);
    expect(fakePage.gotoCalls[0]?.options?.timeout).toBeGreaterThan(0);
  });

  test("navigates an authenticated page from another account route to clean legal URL", async () => {
    const accountLegalUrl = `${baseUrl}/en-US/account/legal`;
    const fakePage = makeFakePage(
      async () => undefined,
      `${baseUrl}/en-US/account`
    );

    await navigateAuthenticatedWorkspaceE2EMarketingPreferences(
      fakePage.page,
      accountLegalUrl
    );

    expect(fakePage.page.url()).toBe(accountLegalUrl);
    expect(fakePage.gotoCalls).toEqual([
      {
        options: {
          timeout: expect.any(Number),
          waitUntil: "load",
        },
        url: accountLegalUrl,
      },
    ]);
  });

  test("turns navigation failures into a fixed error without a cause or raw URL", async () => {
    const unsafeUrl = `${baseUrl}/en-US/marketing-preferences/access?token=${rawLinkToken}`;
    const rawFailure = new Error(`raw navigation failure for ${unsafeUrl}`);
    const fakePage = makeFakePage(async () => {
      throw rawFailure;
    });
    let failure: unknown;

    try {
      await navigateWorkspaceE2EMarketingPreferences(fakePage.page, unsafeUrl);
    } catch (cause) {
      failure = cause;
    }

    expect(failure).toBeInstanceOf(Error);
    const safeFailure = failure as Error;
    expect(safeFailure.message).toBe(browserFailureMessage);
    expect("cause" in safeFailure).toBe(false);
    expect(String(safeFailure)).not.toContain(unsafeUrl);
    expect(String(safeFailure)).not.toContain(rawLinkToken);
    expect(safeFailure.stack).not.toContain(unsafeUrl);
    expect(JSON.stringify(safeFailure)).not.toContain(unsafeUrl);
    expect(fakePage.gotoCalls).toHaveLength(1);
  });

  test("keeps the helper out of auth sends, rate budgets, provider concurrency, and unapproved screenshot IDs", async () => {
    expect(typeof verifyWorkspaceE2EMarketingPreferences).toBe("function");

    const source = await Bun.file(
      new URL("./marketing-preferences.ts", import.meta.url)
    ).text();

    for (const forbidden of [
      /\/api\/auth/i,
      /sign[-_]in/i,
      /magic[-_]link/i,
      /\bsignIn\b/i,
      /\bsendMagicLink\b/i,
      /rate[-_]budget/i,
      /\brateBudget\b/i,
      /\bconcurrency\b/i,
      /provider[\s\S]{0,80}concurrency/i,
    ]) {
      expect(source).not.toMatch(forbidden);
    }

    const screenshotCallIds = Array.from(
      source.matchAll(
        /captureMarketingReview\(\s*[\s\S]*?["']([^"']+)["']\s*\)/g
      )
    ).map((match) => match[1]);
    const expectedScreenshotCallIds = [
      "account-marketing-active-mobile",
      "account-marketing-withdrawn-desktop",
      "marketing-link-active-desktop",
      "marketing-link-active-mobile",
      "marketing-link-invalid-desktop",
      "marketing-link-invalid-mobile",
      "marketing-link-pending-desktop",
      "marketing-link-pending-mobile",
      "marketing-link-withdrawn-desktop",
      "marketing-link-withdrawn-mobile",
    ];

    expect(screenshotCallIds).toHaveLength(expectedScreenshotCallIds.length);
    expect([...screenshotCallIds].sort()).toEqual(
      [...expectedScreenshotCallIds].sort()
    );
  });
});
