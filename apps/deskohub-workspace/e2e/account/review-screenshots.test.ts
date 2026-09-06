import { describe, expect, test } from "bun:test";
import { resolve } from "node:path";
import type * as Playwright from "@playwright/test";
import { workspaceE2ETimeouts } from "../timeouts";
import {
  type AccountReviewTarget,
  captureAccountReview,
  withSignInPendingReview,
} from "./review-screenshots";

const baseUrl = "https://deskohub-workspace-review.example.test";
const magicLinkUrl = new URL(
  "/api/auth/sign-in/magic-link",
  baseUrl
).toString();
const initialViewport = { height: 768, width: 1024 } as const;
const accountReviewArtifactDirectory = resolve(
  import.meta.dir,
  "../../e2e-artifacts/account-review"
);
const captureFailureMessage = "Account review screenshot capture failed";

const validTargets = [
  {
    filename: "completion-mobile375x900.png",
    path: "/en-US/account",
    query: "",
    target: "completion-mobile375x900",
    viewport: { height: 900, width: 375 },
  },
  {
    filename: "account-loading-desktop.png",
    path: "/en-US/account",
    query: "",
    target: "account-loading-desktop",
    viewport: { height: 1000, width: 1440 },
  },
  {
    filename: "linked-desktop1440x1000.png",
    path: "/en-US/account",
    query: "",
    target: "linked-desktop1440x1000",
    viewport: { height: 1000, width: 1440 },
  },
  {
    filename: "linked-history-desktop.png",
    path: "/en-US/account",
    query: "",
    target: "linked-history-desktop",
    viewport: { height: 1000, width: 1440 },
  },
  {
    filename: "support-desktop.png",
    path: "/en-US/account",
    query: "",
    target: "support-desktop",
    viewport: { height: 1000, width: 1440 },
  },
  {
    filename: "sign-in-accepted-desktop.png",
    path: "/en-US/auth/sign-in",
    query: "",
    target: "sign-in-accepted-desktop",
    viewport: { height: 1000, width: 1440 },
  },
  {
    filename: "sign-in-pending-desktop.png",
    path: "/en-US/auth/sign-in",
    query: "",
    target: "sign-in-pending-desktop",
    viewport: { height: 1000, width: 1440 },
  },
  {
    filename: "sign-in-desktop.png",
    path: "/en-US/auth/sign-in",
    query: "",
    target: "sign-in-desktop",
    viewport: { height: 1000, width: 1440 },
  },
  {
    filename: "callback-failed-desktop.png",
    path: "/en-US/auth/callback",
    query: "",
    target: "callback-failed-desktop",
    viewport: { height: 1000, width: 1440 },
  },
  {
    filename: "deleted-desktop.png",
    path: "/en-US/account/deleted",
    query: "",
    target: "deleted-desktop",
    viewport: { height: 1000, width: 1440 },
  },
] as const satisfies ReadonlyArray<{
  readonly filename: `${string}.png`;
  readonly path: string;
  readonly query: string;
  readonly target: AccountReviewTarget;
  readonly viewport: Playwright.ViewportSize;
}>;

type FakePage = {
  readonly currentViewport: () => Playwright.ViewportSize | null;
  readonly fontReadyCalls: () => number;
  readonly page: Playwright.Page;
  readonly screenshotCalls: readonly Record<string, unknown>[];
  readonly viewportChanges: readonly (Playwright.ViewportSize | null)[];
};

const makeFakePage = (
  url: string,
  options: {
    readonly failScreenshot?: boolean;
    readonly onFontsReady?: () => void;
    readonly onScreenshot?: () => void;
    readonly onViewportChange?: (
      viewport: Playwright.ViewportSize | null
    ) => Promise<void> | void;
  } = {}
): FakePage => {
  let currentViewport: Playwright.ViewportSize | null = { ...initialViewport };
  let fontReadyCallCount = 0;
  const screenshotCalls: Record<string, unknown>[] = [];
  const viewportChanges: (Playwright.ViewportSize | null)[] = [];

  const page = Object.assign({} as Playwright.Page, {
    evaluate: async () => {
      fontReadyCallCount += 1;
      options.onFontsReady?.();
    },
    screenshot: async (screenshotOptions: Record<string, unknown>) => {
      screenshotCalls.push(screenshotOptions);
      options.onScreenshot?.();
      if (options.failScreenshot)
        throw new Error(`screenshot failed for ${url}`);
    },
    setViewportSize: async (viewport: Playwright.ViewportSize | null) => {
      viewportChanges.push(viewport);
      currentViewport = viewport;
      await options.onViewportChange?.(viewport);
    },
    url: () => url,
    viewportSize: () => currentViewport,
  });

  return {
    currentViewport: () => currentViewport,
    fontReadyCalls: () => fontReadyCallCount,
    page,
    screenshotCalls,
    viewportChanges,
  };
};

const makeControlledClock = (initial = 0) => {
  let nowMs = initial;
  return {
    advanceTo: (next: number) => {
      nowMs = next;
    },
    now: () => nowMs,
  };
};

const withControlledDateNow = async (
  clock: ReturnType<typeof makeControlledClock>,
  operation: () => Promise<void>
): Promise<void> => {
  const originalNow = Date.now;
  Date.now = clock.now;
  try {
    await operation();
  } finally {
    Date.now = originalNow;
  }
};

const flushMicrotasks = async () => {
  for (let index = 0; index < 5; index += 1) await Promise.resolve();
};

type PendingReviewFakePageOptions = {
  readonly advanceFontsTo?: number;
  readonly advancePendingTo?: number;
  readonly continueError?: Error;
  readonly deferContinue?: boolean;
  readonly deferRestore?: boolean;
  readonly failScreenshot?: boolean;
  readonly unrouteError?: Error;
};

type PendingReviewFakePage = FakePage & {
  readonly continueArguments: readonly unknown[][];
  readonly continueCallCount: () => number;
  readonly continueComplete: Promise<void>;
  readonly captureComplete: Promise<void>;
  readonly events: () => readonly string[];
  readonly releaseContinue: () => void;
  readonly releaseRestore: () => void;
  readonly restoreComplete: Promise<void>;
  readonly routeCalls: readonly {
    readonly times?: number;
    readonly url: string;
  }[];
  readonly startPost: () => Promise<void>;
  readonly unrouteCallCount: () => number;
  readonly pendingWaitTimeouts: readonly number[];
};

const makePendingReviewFakePage = (
  clock: ReturnType<typeof makeControlledClock>,
  options: PendingReviewFakePageOptions = {}
): PendingReviewFakePage => {
  const events: string[] = [];
  let resolveCaptureComplete!: () => void;
  const captureComplete = new Promise<void>((resolve) => {
    resolveCaptureComplete = resolve;
  });
  let resolveContinueComplete!: () => void;
  const continueComplete = new Promise<void>((resolve) => {
    resolveContinueComplete = resolve;
  });
  let resolveRestoreComplete!: () => void;
  const restoreComplete = new Promise<void>((resolve) => {
    resolveRestoreComplete = resolve;
  });
  let releaseRestorePromise!: () => void;
  let restoreReleased = !options.deferRestore;
  const restoreReady = new Promise<void>((resolve) => {
    releaseRestorePromise = resolve;
  });
  const releaseRestore = () => {
    if (restoreReleased) return;
    restoreReleased = true;
    releaseRestorePromise();
  };
  const fakePage = makeFakePage(`${baseUrl}/en-US/auth/sign-in`, {
    failScreenshot: options.failScreenshot,
    onFontsReady: () => {
      events.push("fonts-ready");
      if (options.advanceFontsTo !== undefined)
        clock.advanceTo(options.advanceFontsTo);
    },
    onScreenshot: () => {
      events.push("screenshot");
      resolveCaptureComplete();
    },
    onViewportChange: async (viewport) => {
      if (
        viewport?.height === initialViewport.height &&
        viewport.width === initialViewport.width
      ) {
        events.push("restore-start");
        if (!restoreReleased) await restoreReady;
        events.push("restore-complete");
        resolveRestoreComplete();
      } else {
        events.push("prepare");
      }
    },
  });
  const routeCalls: { times?: number; url: string }[] = [];
  const pendingWaitTimeouts: number[] = [];
  const continueArguments: unknown[][] = [];
  let continueCallCount = 0;
  let unrouteCallCount = 0;
  let routeHandler: Parameters<Playwright.Page["route"]>[1] | undefined;
  let releaseContinuePromise!: () => void;
  let continueReleased = !options.deferContinue;
  const continueReady = new Promise<void>((resolve) => {
    releaseContinuePromise = resolve;
  });
  const releaseContinue = () => {
    if (continueReleased) return;
    continueReleased = true;
    releaseContinuePromise();
  };
  const route = Object.assign({} as Playwright.Route, {
    continue: async (...args: unknown[]) => {
      continueCallCount += 1;
      continueArguments.push(args);
      events.push("continue-start");
      if (!continueReleased) await continueReady;
      events.push("continue-complete");
      resolveContinueComplete();
      if (options.continueError) throw options.continueError;
    },
  });
  const request = Object.assign({} as Playwright.Request, {
    method: () => "POST",
  });
  const page = Object.assign(fakePage.page, {
    locator: () =>
      Object.assign({} as Playwright.Locator, {
        waitFor: async (waitOptions: { readonly timeout?: number }) => {
          pendingWaitTimeouts.push(waitOptions.timeout ?? -1);
          if (options.advancePendingTo !== undefined)
            clock.advanceTo(options.advancePendingTo);
        },
      }),
    route: async (
      url: unknown,
      handler: Parameters<Playwright.Page["route"]>[1],
      routeOptions?: { readonly times?: number }
    ) => {
      events.push("route-install");
      routeCalls.push({ times: routeOptions?.times, url: String(url) });
      routeHandler = handler;
    },
    unroute: async () => {
      unrouteCallCount += 1;
      if (options.unrouteError) throw options.unrouteError;
    },
  });

  return {
    ...fakePage,
    captureComplete,
    continueArguments,
    continueCallCount: () => continueCallCount,
    continueComplete,
    events: () => events,
    page,
    pendingWaitTimeouts,
    releaseContinue,
    releaseRestore,
    restoreComplete,
    routeCalls,
    startPost: () => {
      if (!routeHandler)
        throw new Error("pending review route was not installed");
      return Promise.resolve(routeHandler(route, request));
    },
    unrouteCallCount: () => unrouteCallCount,
  };
};

describe("account review screenshot capture", () => {
  const invalidPages = [
    {
      name: "a foreign origin",
      target: "completion-mobile375x900",
      url: "https://other.example.test/en-US/account",
    },
    {
      name: "a different path",
      target: "completion-mobile375x900",
      url: `${baseUrl}/en-US/auth/sign-in`,
    },
    {
      name: "a token query",
      target: "completion-mobile375x900",
      url: `${baseUrl}/en-US/account?token=synthetic-secret-token`,
    },
    {
      name: "a callback query with another parameter",
      target: "callback-failed-desktop",
      url: `${baseUrl}/en-US/auth/callback?error=INVALID_TOKEN&token=synthetic-secret-token`,
    },
    {
      name: "a hash",
      target: "completion-mobile375x900",
      url: `${baseUrl}/en-US/account#review-state`,
    },
  ] as const;

  for (const invalidPage of invalidPages) {
    test(`rejects ${invalidPage.name} before the screenshot`, async () => {
      const fakePage = makeFakePage(invalidPage.url);

      await expect(
        captureAccountReview(fakePage.page, baseUrl, invalidPage.target)
      ).rejects.toThrow(captureFailureMessage);

      expect(fakePage.screenshotCalls).toHaveLength(0);
      expect(fakePage.viewportChanges).toHaveLength(0);
    });
  }

  test("does not include the rejected URL in its fixed error", async () => {
    const unsafeUrl = `${baseUrl}/en-US/account?token=synthetic-secret-token`;
    const fakePage = makeFakePage(unsafeUrl);
    let failure: unknown;

    try {
      await captureAccountReview(
        fakePage.page,
        baseUrl,
        "completion-mobile375x900"
      );
    } catch (cause) {
      failure = cause;
    }

    expect(failure).toBeInstanceOf(Error);
    expect((failure as Error).message).toBe(captureFailureMessage);
    expect((failure as Error).message).not.toContain(unsafeUrl);
    expect((failure as Error).message).not.toContain("synthetic-secret-token");
  });

  for (const expected of validTargets) {
    test(`captures fixed metadata for ${expected.target}`, async () => {
      const fakePage = makeFakePage(
        `${baseUrl}${expected.path}${expected.query}`
      );

      await captureAccountReview(fakePage.page, baseUrl, expected.target);

      expect(fakePage.screenshotCalls).toHaveLength(1);
      expect(fakePage.screenshotCalls[0]).toEqual({
        animations: "disabled",
        fullPage: true,
        path: resolve(accountReviewArtifactDirectory, expected.filename),
        timeout: expect.any(Number),
      });
      expect(fakePage.screenshotCalls[0]?.timeout).toBeGreaterThan(0);
      expect(fakePage.screenshotCalls[0]?.timeout).toBeLessThanOrEqual(
        workspaceE2ETimeouts.browserAction
      );
      expect(fakePage.viewportChanges).toEqual([
        expected.viewport,
        initialViewport,
      ]);
      expect(fakePage.currentViewport()).toEqual(initialViewport);
      expect(fakePage.fontReadyCalls()).toBe(1);
    });
  }

  test("allows the closed invalid-token callback query", async () => {
    const fakePage = makeFakePage(
      `${baseUrl}/en-US/auth/callback?error=INVALID_TOKEN`
    );

    await captureAccountReview(
      fakePage.page,
      baseUrl,
      "callback-failed-desktop"
    );

    expect(fakePage.screenshotCalls).toHaveLength(1);
  });

  test("restores the previous viewport when screenshot capture fails", async () => {
    const fakePage = makeFakePage(`${baseUrl}/en-US/account`, {
      failScreenshot: true,
    });

    await expect(
      captureAccountReview(fakePage.page, baseUrl, "linked-desktop1440x1000")
    ).rejects.toThrow(captureFailureMessage);

    expect(fakePage.viewportChanges).toEqual([
      { height: 1000, width: 1440 },
      initialViewport,
    ]);
    expect(fakePage.currentViewport()).toEqual(initialViewport);
  });

  test("installs one exact route and forwards the original request once", async () => {
    const clock = makeControlledClock();

    await withControlledDateNow(clock, async () => {
      const fakePage = makePendingReviewFakePage(clock);

      await withSignInPendingReview(fakePage.page, baseUrl, async () => {
        await fakePage.startPost();
      });

      expect(fakePage.routeCalls).toEqual([{ times: 1, url: magicLinkUrl }]);
      expect(fakePage.continueArguments).toEqual([[]]);
      expect(fakePage.continueCallCount()).toBe(1);
    });
  });

  test("waits for deferred forwarding after a failed capture", async () => {
    const clock = makeControlledClock();

    await withControlledDateNow(clock, async () => {
      const fakePage = makePendingReviewFakePage(clock, {
        deferContinue: true,
        deferRestore: true,
        failScreenshot: true,
      });
      const wrapped = withSignInPendingReview(
        fakePage.page,
        baseUrl,
        async () => {
          void fakePage.startPost();
          await fakePage.captureComplete;
        }
      );

      await fakePage.captureComplete;
      await flushMicrotasks();

      expect(fakePage.unrouteCallCount()).toBe(1);
      expect(fakePage.continueCallCount()).toBe(1);
      expect(fakePage.events()).toContain("prepare");
      expect(fakePage.events()).toContain("route-install");
      expect(fakePage.events().indexOf("prepare")).toBeLessThan(
        fakePage.events().indexOf("route-install")
      );
      expect(fakePage.events()).not.toContain("restore-start");
      let settled = false;
      void wrapped.then(
        () => {
          settled = true;
        },
        () => {
          settled = true;
        }
      );
      await flushMicrotasks();
      expect(settled).toBe(false);

      fakePage.releaseContinue();
      await fakePage.continueComplete;
      await flushMicrotasks();
      expect(fakePage.events()).toContain("restore-start");
      expect(fakePage.events()).not.toContain("restore-complete");
      expect(fakePage.events().indexOf("continue-complete")).toBeLessThan(
        fakePage.events().indexOf("restore-start")
      );
      expect(settled).toBe(false);

      fakePage.releaseRestore();
      await fakePage.restoreComplete;
      await expect(wrapped).rejects.toThrow(captureFailureMessage);
      expect(fakePage.events().indexOf("continue-complete")).toBeLessThan(
        fakePage.events().indexOf("restore-complete")
      );
    });
  });

  test("turns capture and forwarding failures into the fixed screenshot error", async () => {
    const clock = makeControlledClock();

    await withControlledDateNow(clock, async () => {
      for (const options of [
        { failScreenshot: true },
        { continueError: new Error("raw route continuation failure") },
      ]) {
        const fakePage = makePendingReviewFakePage(clock, options);

        await expect(
          withSignInPendingReview(fakePage.page, baseUrl, async () => {
            await fakePage.startPost();
          })
        ).rejects.toThrow(captureFailureMessage);
        expect(fakePage.continueCallCount()).toBe(1);
      }
    });
  });

  test("preserves the run case failure when cleanup also fails", async () => {
    const clock = makeControlledClock();
    const runCaseFailure = new Error("original run case failure");

    await withControlledDateNow(clock, async () => {
      const fakePage = makePendingReviewFakePage(clock, {
        continueError: new Error("raw route continuation failure"),
        unrouteError: new Error("raw unroute failure"),
      });

      await expect(
        withSignInPendingReview(fakePage.page, baseUrl, async () => {
          await fakePage.startPost();
          throw runCaseFailure;
        })
      ).rejects.toBe(runCaseFailure);
    });
  });

  test("shares one deadline across pending control, fonts, and screenshot", async () => {
    const clock = makeControlledClock();

    await withControlledDateNow(clock, async () => {
      const fakePage = makePendingReviewFakePage(clock, {
        advanceFontsTo: 12_000,
        advancePendingTo: 5_000,
      });

      await withSignInPendingReview(fakePage.page, baseUrl, async () => {
        await fakePage.startPost();
      });

      expect(fakePage.pendingWaitTimeouts).toEqual([
        workspaceE2ETimeouts.browserAction,
      ]);
      expect(fakePage.screenshotCalls[0]?.timeout).toBe(
        workspaceE2ETimeouts.browserAction - 12_000
      );
    });
  });

  test("continues an expired pending request without taking a screenshot", async () => {
    const clock = makeControlledClock();

    await withControlledDateNow(clock, async () => {
      const fakePage = makePendingReviewFakePage(clock, {
        advancePendingTo: workspaceE2ETimeouts.browserAction,
      });

      await expect(
        withSignInPendingReview(fakePage.page, baseUrl, async () => {
          await fakePage.startPost();
        })
      ).rejects.toThrow(captureFailureMessage);

      expect(fakePage.screenshotCalls).toHaveLength(0);
      expect(fakePage.continueArguments).toEqual([[]]);
      expect(fakePage.continueCallCount()).toBe(1);
    });
  });
});
