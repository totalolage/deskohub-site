import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import * as fsPromises from "node:fs/promises";
import { resolve } from "node:path";
import type * as Playwright from "@playwright/test";
import { workspaceReservationIdSchema } from "@/features/reservation/persistence-contracts";
import { reservationStatusPath } from "@/features/reservation/routes";
import { workspaceE2ETimeouts } from "../timeouts";
import {
  type AccountReviewTarget,
  captureAccountReview,
  captureReservationStatusReview,
  withSignInPendingReview,
} from "./review-screenshots";

const baseUrl = "https://deskohub-workspace-review.example.test";
const magicLinkUrl = new URL(
  "/api/auth/sign-in/magic-link",
  baseUrl
).toString();
const initialViewport = { height: 768, width: 1024 } as const;
const screenshotBuffer = Buffer.from("synthetic-png");
const accountReviewArtifactDirectory = resolve(
  import.meta.dir,
  "../../e2e-artifacts/account-review"
);
const captureFailureMessage = "Account review screenshot capture failed";
const privateLinkedAccountQueries = [
  "",
  "?section=reservations",
  "?section=profile",
  "?section=billing",
  "?section=danger",
] as const;

const validTargets = [
  {
    filename: "completion-mobile375x900.png",
    path: "/en-US/account",
    query: "",
    target: "completion-mobile375x900",
    viewport: { height: 900, width: 375 },
    fullPage: true,
  },
  {
    filename: "account-loading-desktop.png",
    path: "/en-US/account",
    query: "",
    target: "account-loading-desktop",
    viewport: { height: 1000, width: 1440 },
    fullPage: true,
  },
  {
    filename: "callback-loading-desktop.png",
    path: "/en-US/auth/callback",
    query: "",
    target: "callback-loading-desktop",
    viewport: { height: 1000, width: 1440 },
    fullPage: true,
  },
  {
    filename: "sign-in-handoff-desktop.png",
    path: ["/en-US/account", "/en-US/auth/sign-in"],
    query: "",
    target: "sign-in-handoff-desktop",
    viewport: { height: 1000, width: 1440 },
    fullPage: true,
  },
  {
    filename: "linked-reservations-desktop.png",
    path: "/en-US/account",
    query: "",
    queries: privateLinkedAccountQueries,
    target: "linked-reservations-desktop",
    viewport: { height: 1000, width: 1440 },
    fullPage: true,
  },
  {
    filename: "linked-profile-desktop.png",
    path: "/en-US/account",
    query: "",
    queries: privateLinkedAccountQueries,
    target: "linked-profile-desktop",
    viewport: { height: 1000, width: 1440 },
    fullPage: true,
  },
  {
    filename: "linked-billing-desktop.png",
    path: "/en-US/account",
    query: "",
    queries: privateLinkedAccountQueries,
    target: "linked-billing-desktop",
    viewport: { height: 1000, width: 1440 },
    fullPage: true,
  },
  {
    filename: "linked-legal-desktop.png",
    path: "/en-US/account/legal",
    query: "",
    target: "linked-legal-desktop",
    viewport: { height: 1000, width: 1440 },
    fullPage: true,
  },
  {
    filename: "public-legal-desktop.png",
    path: "/en-US/account/legal",
    query: "",
    target: "public-legal-desktop",
    viewport: { height: 1000, width: 1440 },
    fullPage: true,
  },
  {
    filename: "public-legal-mobile.png",
    path: "/en-US/account/legal",
    query: "",
    target: "public-legal-mobile",
    viewport: { height: 900, width: 375 },
    fullPage: true,
  },
  {
    filename: "linked-danger-desktop.png",
    path: "/en-US/account",
    query: "",
    queries: privateLinkedAccountQueries,
    target: "linked-danger-desktop",
    viewport: { height: 1000, width: 1440 },
    fullPage: true,
  },
  {
    filename: "support-desktop.png",
    path: "/en-US/account",
    query: "",
    target: "support-desktop",
    viewport: { height: 1000, width: 1440 },
    fullPage: true,
  },
  {
    filename: "sign-in-accepted-desktop.png",
    path: "/en-US/auth/sign-in",
    query: "",
    target: "sign-in-accepted-desktop",
    viewport: { height: 1000, width: 1440 },
    fullPage: true,
  },
  {
    filename: "sign-in-pending-desktop.png",
    path: "/en-US/auth/sign-in",
    query: "",
    target: "sign-in-pending-desktop",
    viewport: { height: 1000, width: 1440 },
    fullPage: true,
  },
  {
    filename: "sign-in-desktop.png",
    path: "/en-US/auth/sign-in",
    query: "",
    target: "sign-in-desktop",
    viewport: { height: 1000, width: 1440 },
    fullPage: true,
  },
  {
    filename: "callback-failed-desktop.png",
    path: "/en-US/auth/callback",
    query: "",
    target: "callback-failed-desktop",
    viewport: { height: 1000, width: 1440 },
    fullPage: true,
  },
  {
    filename: "deleted-desktop.png",
    path: "/en-US/account/deleted",
    query: "",
    target: "deleted-desktop",
    viewport: { height: 1000, width: 1440 },
    fullPage: true,
  },
] as const satisfies ReadonlyArray<{
  readonly filename: `${string}.png`;
  readonly fullPage: boolean;
  readonly path: string | readonly string[];
  readonly query: string;
  readonly queries?: readonly string[];
  readonly target: AccountReviewTarget;
  readonly viewport: Playwright.ViewportSize;
}>;

type FakePage = {
  readonly currentViewport: () => Playwright.ViewportSize | null;
  readonly fontReadyCalls: () => number;
  readonly page: Playwright.Page;
  readonly setCallbackLoadingPresent: (present: boolean) => void;
  readonly setUrl: (url: string) => void;
  readonly screenshotStarted: Promise<void>;
  readonly screenshotCalls: readonly Record<string, unknown>[];
  readonly viewportChanges: readonly (Playwright.ViewportSize | null)[];
};

const makeFakePage = (
  url: string,
  options: {
    readonly callbackLoadingPresent?: boolean;
    readonly failScreenshot?: boolean;
    readonly onFontsReady?: () => Promise<void> | void;
    readonly onScreenshot?: () => Promise<void> | void;
    readonly onViewportChange?: (
      viewport: Playwright.ViewportSize | null
    ) => Promise<void> | void;
  } = {}
): FakePage => {
  let currentViewport: Playwright.ViewportSize | null = { ...initialViewport };
  let currentUrl = url;
  let callbackLoadingPresent = options.callbackLoadingPresent ?? true;
  let fontReadyCallCount = 0;
  const screenshotCalls: Record<string, unknown>[] = [];
  const viewportChanges: (Playwright.ViewportSize | null)[] = [];
  let resolveScreenshotStarted!: () => void;
  const screenshotStarted = new Promise<void>((resolve) => {
    resolveScreenshotStarted = resolve;
  });

  const makeLocator = (kind: string): Playwright.Locator =>
    Object.assign({} as Playwright.Locator, {
      boundingBox: async () => {
        if (kind === "main") return { height: 800, width: 1_000, x: 0, y: 0 };
        if (!callbackLoadingPresent) return null;
        return { height: 422, width: 512, x: 0, y: 0 };
      },
      count: async () =>
        kind === "loading-card" && !callbackLoadingPresent ? 0 : 1,
      getByText: () => makeLocator("loading-text"),
      waitFor: async () => {
        if (
          (kind === "loading-card" ||
            kind === "loading-status" ||
            kind === "loading-text") &&
          !callbackLoadingPresent
        )
          throw new Error("callback loading state is not visible");
      },
    });

  const page = Object.assign({} as Playwright.Page, {
    evaluate: async () => {
      fontReadyCallCount += 1;
      await options.onFontsReady?.();
    },
    screenshot: async (screenshotOptions: Record<string, unknown>) => {
      screenshotCalls.push(screenshotOptions);
      resolveScreenshotStarted();
      await options.onScreenshot?.();
      if (options.failScreenshot)
        throw new Error(`screenshot failed for ${url}`);
      return screenshotBuffer;
    },
    setViewportSize: async (viewport: Playwright.ViewportSize | null) => {
      viewportChanges.push(viewport);
      currentViewport = viewport;
      await options.onViewportChange?.(viewport);
    },
    getByRole: (role: string) =>
      makeLocator(role === "status" ? "loading-status" : "landmark"),
    locator: (selector: string) =>
      makeLocator(selector === "main" ? "main" : "loading-card"),
    url: () => currentUrl,
    viewportSize: () => currentViewport,
  });

  return {
    currentViewport: () => currentViewport,
    fontReadyCalls: () => fontReadyCallCount,
    page,
    setCallbackLoadingPresent: (present) => {
      callbackLoadingPresent = present;
    },
    setUrl: (nextUrl) => {
      currentUrl = nextUrl;
    },
    screenshotStarted,
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

const withControlledTimers = async (
  clock: ReturnType<typeof makeControlledClock>,
  operation: (advanceTo: (next: number) => Promise<void>) => Promise<void>
): Promise<void> => {
  const realSetTimeout = globalThis.setTimeout;
  const realClearTimeout = globalThis.clearTimeout;
  let nextTimerId = 0;
  const timers = new Map<
    number,
    { readonly callback: () => void; readonly dueAt: number }
  >();
  globalThis.setTimeout = ((callback: () => void, delay?: number) => {
    const id = nextTimerId++;
    timers.set(id, {
      callback,
      dueAt: clock.now() + Math.max(0, delay ?? 0),
    });
    return id;
  }) as typeof setTimeout;
  globalThis.clearTimeout = ((id: ReturnType<typeof setTimeout>) => {
    timers.delete(Number(id));
  }) as typeof clearTimeout;

  const advanceTo = async (next: number) => {
    clock.advanceTo(next);
    for (const [id, timer] of [...timers]) {
      if (timer.dueAt > next || !timers.delete(id)) continue;
      timer.callback();
      await flushMicrotasks();
    }
  };

  try {
    await operation(advanceTo);
  } finally {
    globalThis.setTimeout = realSetTimeout;
    globalThis.clearTimeout = realClearTimeout;
  }
};

type PendingReviewFakePageOptions = {
  readonly advanceFontsTo?: number;
  readonly advancePendingTo?: number;
  readonly continueError?: Error;
  readonly deferContinue?: boolean;
  readonly deferRestore?: boolean;
  readonly deferRoute?: boolean;
  readonly failScreenshot?: boolean;
  readonly routeError?: Error;
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
  readonly releaseRoute: () => void;
  readonly restoreComplete: Promise<void>;
  readonly routeInstallArguments: readonly unknown[][];
  readonly routeStarted: Promise<void>;
  readonly routeCalls: readonly {
    readonly times?: number;
    readonly url: string;
  }[];
  readonly startPost: () => Promise<void>;
  readonly unrouteArguments: readonly unknown[][];
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
  let resolveRoute!: () => void;
  let routeReleased = !options.deferRoute;
  const routeReady = new Promise<void>((resolve) => {
    resolveRoute = resolve;
  });
  let resolveRouteStarted!: () => void;
  const routeStarted = new Promise<void>((resolve) => {
    resolveRouteStarted = resolve;
  });
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
  const routeInstallArguments: unknown[][] = [];
  const pendingWaitTimeouts: number[] = [];
  const continueArguments: unknown[][] = [];
  const unrouteArguments: unknown[][] = [];
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
      routeInstallArguments.push([url, handler]);
      routeHandler = handler;
      resolveRouteStarted();
      if (!routeReleased) await routeReady;
      if (options.routeError) throw options.routeError;
    },
    unroute: async (...args: unknown[]) => {
      unrouteCallCount += 1;
      unrouteArguments.push(args);
      if (args[0] === routeCalls[0]?.url && args[1] === routeHandler)
        routeHandler = undefined;
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
    releaseRoute: () => {
      if (routeReleased) return;
      routeReleased = true;
      resolveRoute();
    },
    releaseContinue,
    releaseRestore,
    restoreComplete,
    routeInstallArguments,
    routeStarted,
    routeCalls,
    startPost: () => {
      if (!routeHandler)
        throw new Error("pending review route was not installed");
      return Promise.resolve(routeHandler(route, request));
    },
    unrouteArguments,
    unrouteCallCount: () => unrouteCallCount,
  };
};

describe("account review screenshot capture", () => {
  const createWriteFileSpy = () =>
    spyOn(fsPromises, "writeFile").mockImplementation(async () => undefined);
  let writeFileSpy: ReturnType<typeof createWriteFileSpy> | undefined;

  beforeEach(() => {
    writeFileSpy = createWriteFileSpy();
  });

  afterEach(() => {
    writeFileSpy?.mockRestore();
    writeFileSpy = undefined;
  });

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
      name: "a sign-in handoff at a foreign origin",
      target: "sign-in-handoff-desktop",
      url: `https://other.example.test/en-US/auth/sign-in`,
    },
    {
      name: "a token query",
      target: "completion-mobile375x900",
      url: `${baseUrl}/en-US/account?token=synthetic-secret-token`,
    },
    {
      name: "a sign-in handoff with a query",
      target: "sign-in-handoff-desktop",
      url: `${baseUrl}/en-US/auth/sign-in?token=synthetic-secret-token`,
    },
    {
      name: "linked legal at the private account path",
      target: "linked-legal-desktop",
      url: `${baseUrl}/en-US/account`,
    },
    {
      name: "linked legal with a private section query",
      target: "linked-legal-desktop",
      url: `${baseUrl}/en-US/account/legal?section=profile`,
    },
    {
      name: "linked account with an extra query parameter",
      target: "linked-profile-desktop",
      url: `${baseUrl}/en-US/account?section=profile&view=private`,
    },
    {
      name: "linked account with a credential query",
      target: "linked-profile-desktop",
      url: `${baseUrl}/en-US/account?section=profile&token=synthetic-secret-token`,
    },
    {
      name: "linked account with a duplicate section query",
      target: "linked-profile-desktop",
      url: `${baseUrl}/en-US/account?section=profile&section=profile`,
    },
    {
      name: "linked account with an unknown section query",
      target: "linked-profile-desktop",
      url: `${baseUrl}/en-US/account?section=unknown`,
    },
    {
      name: "a callback query with another parameter",
      target: "callback-failed-desktop",
      url: `${baseUrl}/en-US/auth/callback?error=INVALID_TOKEN&token=synthetic-secret-token`,
    },
    {
      name: "a callback query",
      target: "callback-loading-desktop",
      url: `${baseUrl}/en-US/auth/callback?_rsc=synthetic-cache-key`,
    },
    {
      name: "a callback hash",
      target: "callback-loading-desktop",
      url: `${baseUrl}/en-US/auth/callback#review-state`,
    },
    {
      name: "a callback foreign origin",
      target: "callback-loading-desktop",
      url: "https://other.example.test/en-US/auth/callback",
    },
    {
      name: "a hash",
      target: "completion-mobile375x900",
      url: `${baseUrl}/en-US/account#review-state`,
    },
    {
      name: "linked legal at a foreign origin",
      target: "linked-legal-desktop",
      url: "https://other.example.test/en-US/account/legal",
    },
    {
      name: "public legal at a foreign origin",
      target: "public-legal-desktop",
      url: "https://other.example.test/en-US/account/legal",
    },
    {
      name: "public legal with a credential query",
      target: "public-legal-desktop",
      url: `${baseUrl}/en-US/account/legal?token=synthetic-secret-token`,
    },
    {
      name: "linked legal with a hash",
      target: "linked-legal-desktop",
      url: `${baseUrl}/en-US/account/legal#review-state`,
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
      expect(writeFileSpy?.mock.calls).toHaveLength(0);
    });
  }

  test("does not include the rejected URL in its fixed error", async () => {
    const unsafeUrl = `${baseUrl}/en-US/auth/callback?token=synthetic-secret-token`;
    const fakePage = makeFakePage(unsafeUrl);
    let failure: unknown;

    try {
      await captureAccountReview(
        fakePage.page,
        baseUrl,
        "callback-loading-desktop"
      );
    } catch (cause) {
      failure = cause;
    }

    expect(failure).toBeInstanceOf(Error);
    expect((failure as Error).message).toBe(captureFailureMessage);
    expect((failure as Error).message).not.toContain(unsafeUrl);
    expect((failure as Error).message).not.toContain("synthetic-secret-token");
    expect(writeFileSpy?.mock.calls).toHaveLength(0);
  });

  for (const expected of validTargets) {
    const expectedPaths = Array.isArray(expected.path)
      ? expected.path
      : [expected.path];
    for (const expectedPath of expectedPaths) {
      for (const expectedQuery of expected.queries ?? [expected.query]) {
        test(`captures fixed metadata for ${expected.target} at ${expectedPath}${expectedQuery}`, async () => {
          const fakePage = makeFakePage(
            `${baseUrl}${expectedPath}${expectedQuery}`
          );

          await captureAccountReview(fakePage.page, baseUrl, expected.target);

          expect(fakePage.screenshotCalls).toHaveLength(1);
          expect(fakePage.screenshotCalls[0]).toEqual({
            animations: "disabled",
            fullPage: expected.fullPage,
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
          expect(writeFileSpy?.mock.calls).toEqual([
            [
              resolve(accountReviewArtifactDirectory, expected.filename),
              screenshotBuffer,
            ],
          ]);
        });
      }
    }
  }

  test("captures a reservation status target only at the exact fixture path", async () => {
    const reservationId = workspaceReservationIdSchema.make(
      "account-history-reservation/with-special-value"
    );
    const statusPath = `/en-US${reservationStatusPath}/${encodeURIComponent(reservationId)}`;
    const fakePage = makeFakePage(`${baseUrl}${statusPath}`);

    await captureReservationStatusReview(
      fakePage.page,
      baseUrl,
      "reservation-status-modal-desktop",
      reservationId
    );

    expect(fakePage.screenshotCalls).toHaveLength(1);
    expect(fakePage.viewportChanges).toEqual([
      { height: 1000, width: 1440 },
      initialViewport,
    ]);
    expect(writeFileSpy?.mock.calls).toEqual([
      [
        resolve(
          accountReviewArtifactDirectory,
          "reservation-status-modal-desktop.png"
        ),
        screenshotBuffer,
      ],
    ]);
  });

  test("rejects a reservation status capture for another reservation", async () => {
    const fixtureReservationId = workspaceReservationIdSchema.make(
      "account-history-reservation"
    );
    const otherReservationId = workspaceReservationIdSchema.make(
      "different-reservation"
    );
    const fakePage = makeFakePage(
      `${baseUrl}/en-US${reservationStatusPath}/${encodeURIComponent(otherReservationId)}`
    );

    await expect(
      captureReservationStatusReview(
        fakePage.page,
        baseUrl,
        "reservation-status-details-desktop",
        fixtureReservationId
      )
    ).rejects.toThrow(captureFailureMessage);

    expect(fakePage.screenshotCalls).toHaveLength(0);
    expect(fakePage.viewportChanges).toHaveLength(0);
    expect(writeFileSpy?.mock.calls).toHaveLength(0);
  });

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
    expect(writeFileSpy?.mock.calls).toEqual([
      [
        resolve(accountReviewArtifactDirectory, "callback-failed-desktop.png"),
        screenshotBuffer,
      ],
    ]);
  });

  test("restores the previous viewport when screenshot capture fails", async () => {
    const fakePage = makeFakePage(`${baseUrl}/en-US/account`, {
      failScreenshot: true,
    });

    await expect(
      captureAccountReview(fakePage.page, baseUrl, "linked-profile-desktop")
    ).rejects.toThrow(captureFailureMessage);

    expect(fakePage.viewportChanges).toEqual([
      { height: 1000, width: 1440 },
      initialViewport,
    ]);
    expect(fakePage.currentViewport()).toEqual(initialViewport);
    expect(writeFileSpy?.mock.calls).toHaveLength(0);
  });

  test("does not start a late screenshot after aborted preparation", async () => {
    const unhandledRejections: unknown[] = [];
    const onUnhandledRejection = (reason: unknown) => {
      unhandledRejections.push(reason);
    };
    process.on("unhandledRejection", onUnhandledRejection);

    try {
      for (const phase of ["viewport", "fonts"] as const) {
        let resolvePreparation!: () => void;
        const preparation = new Promise<void>((resolve) => {
          resolvePreparation = resolve;
        });
        let resolvePreparationStarted!: () => void;
        const preparationStarted = new Promise<void>((resolve) => {
          resolvePreparationStarted = resolve;
        });
        const fakePage = makeFakePage(`${baseUrl}/en-US/account`, {
          onFontsReady: () => {
            if (phase !== "fonts") return;
            resolvePreparationStarted();
            return preparation;
          },
          onViewportChange: (viewport) => {
            if (
              phase !== "viewport" ||
              viewport?.height !== 1000 ||
              viewport.width !== 1440
            )
              return;
            resolvePreparationStarted();
            return preparation;
          },
        });
        const controller = new AbortController();
        const capture = captureAccountReview(
          fakePage.page,
          baseUrl,
          "linked-profile-desktop",
          { signal: controller.signal }
        );

        await preparationStarted;
        controller.abort();
        await expect(capture).rejects.toThrow(captureFailureMessage);

        resolvePreparation();
        await flushMicrotasks();
        expect(fakePage.screenshotCalls).toHaveLength(0);
      }

      expect(unhandledRejections).toHaveLength(0);
    } finally {
      process.off("unhandledRejection", onUnhandledRejection);
    }
  });

  test("discards a screenshot that resolves after cancellation and URL change", async () => {
    let resolveScreenshot!: () => void;
    const screenshotReady = new Promise<void>((resolve) => {
      resolveScreenshot = resolve;
    });
    const unhandledRejections: unknown[] = [];
    const onUnhandledRejection = (reason: unknown) => {
      unhandledRejections.push(reason);
    };
    const fakePage = makeFakePage(`${baseUrl}/en-US/account`, {
      onScreenshot: () => screenshotReady,
    });
    const controller = new AbortController();
    process.on("unhandledRejection", onUnhandledRejection);

    try {
      const capture = captureAccountReview(
        fakePage.page,
        baseUrl,
        "linked-profile-desktop",
        { signal: controller.signal }
      );
      await fakePage.screenshotStarted;
      fakePage.setUrl(`${baseUrl}/en-US/auth/sign-in`);
      controller.abort();
      await expect(capture).rejects.toThrow(captureFailureMessage);

      resolveScreenshot();
      await flushMicrotasks();
      expect(fakePage.screenshotCalls).toHaveLength(1);
      expect(writeFileSpy?.mock.calls).toHaveLength(0);
      expect(unhandledRejections).toHaveLength(0);
    } finally {
      process.off("unhandledRejection", onUnhandledRejection);
      resolveScreenshot();
    }
  });

  test("discards a screenshot that resolves after its deadline", async () => {
    const clock = makeControlledClock();
    let resolveScreenshot!: () => void;
    const screenshotReady = new Promise<void>((resolve) => {
      resolveScreenshot = resolve;
    });

    await withControlledDateNow(clock, async () => {
      await withControlledTimers(clock, async (advanceTo) => {
        const fakePage = makeFakePage(`${baseUrl}/en-US/account`, {
          onScreenshot: () => screenshotReady,
        });
        const capture = captureAccountReview(
          fakePage.page,
          baseUrl,
          "linked-profile-desktop",
          { deadline: workspaceE2ETimeouts.browserAction }
        );

        await fakePage.screenshotStarted;
        await advanceTo(workspaceE2ETimeouts.browserAction);
        await expect(capture).rejects.toThrow(captureFailureMessage);

        resolveScreenshot();
        await flushMicrotasks();
        expect(fakePage.screenshotCalls).toHaveLength(1);
        expect(writeFileSpy?.mock.calls).toHaveLength(0);
      });
    });
  });

  test("does not write when the callback loading status is removed after capture", async () => {
    let fakePage!: FakePage;
    fakePage = makeFakePage(`${baseUrl}/en-US/auth/callback`, {
      onScreenshot: () => {
        fakePage.setCallbackLoadingPresent(false);
      },
    });

    await expect(
      captureAccountReview(fakePage.page, baseUrl, "callback-loading-desktop")
    ).rejects.toThrow(captureFailureMessage);

    expect(fakePage.screenshotCalls).toHaveLength(1);
    expect(writeFileSpy?.mock.calls).toHaveLength(0);
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

  test("unroutes a synchronously registered pending route after ack timeout", async () => {
    const clock = makeControlledClock();

    await withControlledDateNow(clock, async () => {
      await withControlledTimers(clock, async (advanceTo) => {
        const fakePage = makePendingReviewFakePage(clock, {
          deferRoute: true,
        });
        let runCaseCalls = 0;
        const wrapped = withSignInPendingReview(
          fakePage.page,
          baseUrl,
          async () => {
            runCaseCalls += 1;
          }
        );

        await fakePage.routeStarted;
        await advanceTo(workspaceE2ETimeouts.browserAction);
        await expect(wrapped).rejects.toThrow(captureFailureMessage);

        expect(runCaseCalls).toBe(0);
        expect(fakePage.unrouteCallCount()).toBe(1);
        expect(fakePage.unrouteArguments[0]?.[0]).toBe(
          fakePage.routeInstallArguments[0]?.[0]
        );
        expect(fakePage.unrouteArguments[0]?.[1]).toBe(
          fakePage.routeInstallArguments[0]?.[1]
        );

        fakePage.releaseRoute();
        await flushMicrotasks();
        expect(fakePage.startPost).toThrow(
          "pending review route was not installed"
        );
      });
    });
  });

  test("unroutes a synchronously registered pending route after ack rejection", async () => {
    const clock = makeControlledClock();
    const fakePage = makePendingReviewFakePage(clock, {
      routeError: new Error("raw route install failure"),
    });
    let runCaseCalls = 0;

    await expect(
      withSignInPendingReview(fakePage.page, baseUrl, async () => {
        runCaseCalls += 1;
      })
    ).rejects.toThrow(captureFailureMessage);

    expect(runCaseCalls).toBe(0);
    expect(fakePage.unrouteCallCount()).toBe(1);
    expect(fakePage.unrouteArguments[0]?.[0]).toBe(
      fakePage.routeInstallArguments[0]?.[0]
    );
    expect(fakePage.unrouteArguments[0]?.[1]).toBe(
      fakePage.routeInstallArguments[0]?.[1]
    );
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
