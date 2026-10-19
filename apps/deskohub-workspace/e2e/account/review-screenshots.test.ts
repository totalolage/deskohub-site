import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import * as fsPromises from "node:fs/promises";
import { resolve } from "node:path";
import { testEmailAddress } from "@deskohub/test-email";
import type * as Playwright from "@playwright/test";
import { encodeAuthCallbackReturn } from "@/features/account/routes";
import { workspaceReservationIdSchema } from "@/features/reservation/persistence-contracts";
import { reservationStatusPath } from "@/features/reservation/routes";
import { workspaceE2ETimeouts } from "../timeouts";
import {
  type AccountReviewTarget,
  captureAccountReview,
  captureCallbackHandoffReview,
  captureReservationStatusReview,
  type LanguagePreferenceReviewCapture,
  persistCallbackDocumentReview,
  withLanguagePreferenceReview,
  withSignInPendingReview,
} from "./review-screenshots";
import type { LanguagePreferenceReviewStage } from "./review-targets";

const baseUrl = "https://deskohub-workspace-review.example.test";
const review = { baseUrl, screenshots: true } as const;
const reviewWithoutScreenshots = { baseUrl, screenshots: false } as const;
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
const attemptUuid = "0f0a9c1e-7b62-4c8d-9e21-53ab2f0d4c7a";
const englishCard = {
  body: "Taking you to your account…",
  label: "Loading sign-in…",
  title: "You are signed in",
} as const;
const czechCard = {
  body: "Vracíme vás tam, kde jste skončili. Dokončit můžete přímo v tomto prohlížeči.",
  label: "Načítání přihlášení…",
  title: "Jste přihlášeni",
} as const;
const selection = "/cs-CZ/reservation/cowork?selection=synthetic-1";
const enSelection = "/en-US/reservation/cowork?selection=synthetic-1";
const czechLanding = { locale: "cs-CZ", returnTo: selection } as const;
const czechCallbackUrl = `${baseUrl}/cs-CZ/auth/callback?attempt=${attemptUuid}&return=${encodeAuthCallbackReturn(selection)}`;
const reservationCustomerReviewTargets = [
  "reservation-customer-account-desktop",
  "reservation-customer-contact-desktop",
] as const;

type FakePage = {
  readonly currentViewport: () => Playwright.ViewportSize | null;
  readonly fontReadyCalls: () => number;
  readonly locatorSelectors: readonly string[];
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
    /** The signed-in callback card; English account copy by default. */
    readonly card?: {
      readonly body: string;
      readonly label: string;
      readonly title: string;
    };
    readonly callbackLoadingPresent?: boolean;
    readonly failScreenshot?: boolean;
    readonly hiddenTitle?: boolean;
    readonly titleCount?: number;
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
  const locatorSelectors: string[] = [];
  const screenshotCalls: Record<string, unknown>[] = [];
  const viewportChanges: (Playwright.ViewportSize | null)[] = [];
  let resolveScreenshotStarted!: () => void;
  const screenshotStarted = new Promise<void>((resolve) => {
    resolveScreenshotStarted = resolve;
  });

  const card = options.card ?? englishCard;
  const makeLocator = (kind: string): Playwright.Locator =>
    Object.assign({} as Playwright.Locator, {
      boundingBox: async () => {
        if (kind === "main") return { height: 800, width: 1_000, x: 0, y: 0 };
        if (!callbackLoadingPresent) return null;
        return { height: 422, width: 512, x: 0, y: 0 };
      },
      count: async () => {
        if (kind === "loading-card" && !callbackLoadingPresent) return 0;
        return kind === "card-title" ? (options.titleCount ?? 1) : 1;
      },
      first: () => makeLocator(kind),
      locator: (selector: string) =>
        makeLocator(selector === "h1" ? "card-title" : "card-body"),
      // Surrounding whitespace is trimmed before comparison.
      textContent: async () =>
        ` ${kind === "card-title" ? card.title : card.body}\n`,
      waitFor: async () => {
        if (
          (kind === "loading-card" ||
            kind === "loading-status" ||
            kind === "card-title" ||
            kind === "card-body") &&
          !callbackLoadingPresent
        )
          throw new Error("callback loading state is not visible");
        if (kind === "card-title" && options.hiddenTitle)
          throw new Error("callback heading is not visible");
        if (kind === "other-status")
          throw new Error("callback status is not visible");
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
    getByRole: (role: string, roleOptions?: { readonly name?: string }) => {
      if (role !== "status") return makeLocator("landmark");
      return makeLocator(
        roleOptions?.name === card.label ? "loading-status" : "other-status"
      );
    },
    locator: (selector: string) => {
      locatorSelectors.push(selector);
      return makeLocator(selector === "main" ? "main" : "loading-card");
    },
    url: () => currentUrl,
    viewportSize: () => currentViewport,
  });

  return {
    currentViewport: () => currentViewport,
    fontReadyCalls: () => fontReadyCallCount,
    locatorSelectors,
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
      name: "a token query",
      target: "completion-mobile375x900",
      url: `${baseUrl}/en-US/account?token=synthetic-secret-token`,
    },
    {
      name: "linked legal at the private account path",
      target: "linked-legal-desktop",
      url: `${baseUrl}/en-US/account`,
    },
    {
      name: "linked legal with an extra query parameter",
      target: "linked-legal-desktop",
      url: `${baseUrl}/en-US/account/legal?view=private`,
    },
    {
      name: "the preference redirect capture at the unredirected en-US page",
      target: "locale-preference-redirect-desktop",
      url: `${baseUrl}/en-US/faq`,
    },
    {
      name: "the switcher capture at the Czech account it switched away from",
      target: "locale-switcher-saved-desktop",
      url: `${baseUrl}/cs-CZ/account`,
    },
    {
      name: "linked account with an extra query parameter",
      target: "linked-profile-desktop",
      url: `${baseUrl}/en-US/account/profile?view=private`,
    },
    {
      name: "linked account with a credential query",
      target: "linked-profile-desktop",
      url: `${baseUrl}/en-US/account/profile?token=synthetic-secret-token`,
    },
    {
      name: "linked account with a duplicate query parameter",
      target: "linked-profile-desktop",
      url: `${baseUrl}/en-US/account/profile?view=private&view=private`,
    },
    {
      name: "linked account with an unknown section path",
      target: "linked-profile-desktop",
      url: `${baseUrl}/en-US/account/unknown`,
    },
    {
      name: "the referrals section with a share-link code",
      target: "linked-referrals-desktop",
      url: `${baseUrl}/en-US/account/referrals?ref=RFL12345`,
    },
    {
      name: "a callback failure query with a non-canonical attempt parameter",
      target: "callback-failed-cs-desktop",
      url: `${baseUrl}/cs-CZ/auth/callback?error=INVALID_TOKEN&attempt=${attemptUuid.toUpperCase()}`,
    },
    {
      name: "a callback failure query with an extra parameter",
      target: "callback-failed-cs-desktop",
      url: `${baseUrl}/cs-CZ/auth/callback?error=INVALID_TOKEN&attempt=${attemptUuid}&extra=1`,
    },
    {
      name: "a callback failure query with a duplicated attempt parameter",
      target: "callback-failed-cs-desktop",
      url: `${baseUrl}/cs-CZ/auth/callback?error=INVALID_TOKEN&attempt=${attemptUuid}&attempt=${attemptUuid}`,
    },
    {
      name: "a callback query with another parameter",
      target: "callback-failed-cs-desktop",
      url: `${baseUrl}/cs-CZ/auth/callback?error=INVALID_TOKEN&token=synthetic-secret-token`,
    },
    {
      name: "the Czech callback failure at the English callback",
      target: "callback-failed-cs-desktop",
      url: `${baseUrl}/en-US/auth/callback?error=INVALID_TOKEN`,
    },
    {
      name: "the Czech callback failure without its failure parameter",
      target: "callback-failed-cs-desktop",
      url: `${baseUrl}/cs-CZ/auth/callback?attempt=${attemptUuid}`,
    },
    {
      name: "the Czech accepted sign-in at the English sign-in",
      target: "sign-in-accepted-cs-desktop",
      url: `${baseUrl}/en-US/auth/sign-in`,
    },
    {
      name: "the Czech accepted sign-in with a protocol-relative return",
      target: "sign-in-accepted-cs-desktop",
      url: `${baseUrl}/cs-CZ/auth/sign-in?returnTo=${encodeURIComponent("//evil.example/cs-CZ")}`,
    },
    {
      name: "the Czech accepted sign-in with an absolute return",
      target: "sign-in-accepted-cs-desktop",
      url: `${baseUrl}/cs-CZ/auth/sign-in?returnTo=${encodeURIComponent("https://evil.example/")}`,
    },
    {
      name: "the English accepted sign-in with an extra parameter",
      target: "sign-in-accepted-desktop",
      url: `${baseUrl}/en-US/auth/sign-in?returnTo=%2Fen-US&token=synthetic-secret-token`,
    },
    {
      name: "the Czech accepted sign-in with two returns",
      target: "sign-in-accepted-cs-desktop",
      url: `${baseUrl}/cs-CZ/auth/sign-in?returnTo=%2Fcs-CZ&returnTo=%2Fcs-CZ`,
    },
    {
      name: "the Czech accepted sign-in with an extra parameter",
      target: "sign-in-accepted-cs-desktop",
      url: `${baseUrl}/cs-CZ/auth/sign-in?returnTo=%2Fcs-CZ&token=synthetic-secret-token`,
    },
    {
      name: "the Czech accepted sign-in with another parameter name",
      target: "sign-in-accepted-cs-desktop",
      url: `${baseUrl}/cs-CZ/auth/sign-in?next=%2Fcs-CZ`,
    },
    {
      name: "the Czech returning callback without its exact return target",
      target: "callback-signed-in-cs-desktop",
      url: czechCallbackUrl,
    },
    {
      name: "a callback query",
      target: "callback-signed-in-desktop",
      url: `${baseUrl}/en-US/auth/callback?_rsc=synthetic-cache-key`,
    },
    {
      name: "a callback loading attempt UUID that is not canonical",
      target: "callback-signed-in-desktop",
      url: `${baseUrl}/en-US/auth/callback?attempt=${attemptUuid.toUpperCase()}`,
    },
    {
      name: "a callback loading attempt UUID with an extra parameter",
      target: "callback-signed-in-desktop",
      url: `${baseUrl}/en-US/auth/callback?attempt=${attemptUuid}&extra=1`,
    },
    {
      name: "a callback loading token parameter",
      target: "callback-signed-in-desktop",
      url: `${baseUrl}/en-US/auth/callback?token=synthetic-secret-token`,
    },
    {
      name: "a callback loading duplicated attempt parameter",
      target: "callback-signed-in-desktop",
      url: `${baseUrl}/en-US/auth/callback?attempt=${attemptUuid}&attempt=${attemptUuid}`,
    },
    {
      name: "a hash",
      target: "completion-mobile375x900",
      url: `${baseUrl}/en-US/account#review-state`,
    },
    ...reservationCustomerReviewTargets.flatMap((target) => [
      {
        name: `${target} with a prefilled contact query`,
        target,
        url: `${baseUrl}/en-US/reservation/cowork?email=${encodeURIComponent(testEmailAddress("synthetic"))}`,
      },
    ]),
  ] as const;

  for (const invalidPage of invalidPages) {
    test(`rejects ${invalidPage.name} before the screenshot`, async () => {
      const fakePage = makeFakePage(invalidPage.url);

      await expect(
        captureAccountReview(fakePage.page, review, invalidPage.target)
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
        review,
        "callback-signed-in-desktop"
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

  test("captures, persists, and restores the viewport through one shared pipeline", async () => {
    const fakePage = makeFakePage(`${baseUrl}/en-US/account`);

    await captureAccountReview(
      fakePage.page,
      review,
      "completion-mobile375x900"
    );

    expect(fakePage.screenshotCalls).toHaveLength(1);
    expect(fakePage.screenshotCalls[0]?.timeout).toBeGreaterThan(0);
    expect(fakePage.screenshotCalls[0]?.timeout).toBeLessThanOrEqual(
      workspaceE2ETimeouts.browserAction
    );
    expect(fakePage.viewportChanges).toHaveLength(2);
    expect(fakePage.viewportChanges[0]).not.toEqual(initialViewport);
    expect(fakePage.currentViewport()).toEqual(initialViewport);
    expect(fakePage.fontReadyCalls()).toBe(1);
    expect(writeFileSpy?.mock.calls).toHaveLength(1);
    expect(writeFileSpy?.mock.calls[0]?.[0]).toStartWith(
      `${accountReviewArtifactDirectory}/`
    );
    expect(writeFileSpy?.mock.calls[0]?.[1]).toBe(screenshotBuffer);
  });

  test.each([
    [
      "a private linked profile path",
      "linked-profile-desktop",
      "/en-US/account/profile",
    ],
    [
      "a bare callback loading page",
      "callback-signed-in-desktop",
      "/en-US/auth/callback",
    ],
    [
      "a canonical callback attempt",
      "callback-signed-in-desktop",
      `/en-US/auth/callback?attempt=${attemptUuid}`,
    ],
    [
      "the account sign-in handoff path",
      "sign-in-handoff-desktop",
      "/en-US/account",
    ],
    [
      "the sign-in page handoff path",
      "sign-in-handoff-desktop",
      "/en-US/auth/sign-in",
    ],
    [
      "the bare Czech accepted sign-in",
      "sign-in-accepted-cs-desktop",
      "/cs-CZ/auth/sign-in",
    ],
    [
      "the Czech accepted sign-in returning to a selection",
      "sign-in-accepted-cs-desktop",
      `/cs-CZ/auth/sign-in?${new URLSearchParams({ returnTo: selection })}`,
    ],
    [
      "the English accepted sign-in returning to a selection",
      "sign-in-accepted-desktop",
      `/en-US/auth/sign-in?${new URLSearchParams({ returnTo: enSelection })}`,
    ],
    [
      "the English pending sign-in returning to a selection",
      "sign-in-pending-desktop",
      `/en-US/auth/sign-in?${new URLSearchParams({ returnTo: enSelection })}`,
    ],
    [
      "the Czech callback failure",
      "callback-failed-cs-desktop",
      `/cs-CZ/auth/callback?error=INVALID_TOKEN&attempt=${attemptUuid}&return=${encodeAuthCallbackReturn(selection)}`,
    ],
  ] as const satisfies ReadonlyArray<
    readonly [string, AccountReviewTarget, string]
  >)("accepts %s", async (_name, target, pathAndQuery) => {
    const fakePage = makeFakePage(`${baseUrl}${pathAndQuery}`);

    await captureAccountReview(fakePage.page, review, target);

    expect(fakePage.screenshotCalls).toHaveLength(1);
    expect(writeFileSpy?.mock.calls).toHaveLength(1);
  });

  test("masks the referral code and share link in referral captures", async () => {
    const fakePage = makeFakePage(`${baseUrl}/en-US/account/referrals`);

    await captureAccountReview(
      fakePage.page,
      review,
      "referral-overview-positive-desktop"
    );

    expect(fakePage.screenshotCalls[0]?.mask).toEqual([expect.any(Object)]);
    expect(fakePage.locatorSelectors).toContain(
      '[data-screen="referrals-screen"] code, [data-screen="referrals-screen"] a[href*="ref="]'
    );
  });

  test("captures a reservation status target only at the exact fixture path", async () => {
    const reservationId = workspaceReservationIdSchema.make(
      "account-history-reservation/with-special-value"
    );
    const statusPath = `/en-US${reservationStatusPath}/${encodeURIComponent(reservationId)}`;
    const fakePage = makeFakePage(`${baseUrl}${statusPath}`);

    await captureReservationStatusReview(
      fakePage.page,
      review,
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
        review,
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
      `${baseUrl}/cs-CZ/auth/callback?error=INVALID_TOKEN`
    );

    await captureAccountReview(
      fakePage.page,
      review,
      "callback-failed-cs-desktop"
    );

    expect(fakePage.screenshotCalls).toHaveLength(1);
    expect(writeFileSpy?.mock.calls).toEqual([
      [
        resolve(
          accountReviewArtifactDirectory,
          "callback-failed-cs-desktop.png"
        ),
        screenshotBuffer,
      ],
    ]);
  });

  test("persists the Czech accepted sign-in under its own file", async () => {
    const fakePage = makeFakePage(`${baseUrl}/cs-CZ/auth/sign-in`);

    await captureAccountReview(
      fakePage.page,
      review,
      "sign-in-accepted-cs-desktop"
    );

    expect(fakePage.viewportChanges[0]).toEqual({ height: 1000, width: 1440 });
    expect(writeFileSpy?.mock.calls).toEqual([
      [
        resolve(
          accountReviewArtifactDirectory,
          "sign-in-accepted-cs-desktop.png"
        ),
        screenshotBuffer,
      ],
    ]);
  });

  for (const [name, options] of [
    ["no signed-in heading", { titleCount: 0 }],
    ["two headings", { titleCount: 2 }],
    ["a hidden heading", { hiddenTitle: true }],
    ["the wrong title", { card: { ...englishCard, title: "Signing you in" } }],
    [
      "the returning body without a return target",
      { card: { ...englishCard, body: czechCard.body } },
    ],
    ["the Czech card", { card: czechCard }],
  ] as const) {
    test(`does not write the English callback capture showing ${name}`, async () => {
      const fakePage = makeFakePage(`${baseUrl}/en-US/auth/callback`, options);

      await expect(
        captureAccountReview(
          fakePage.page,
          review,
          "callback-signed-in-desktop"
        )
      ).rejects.toThrow(captureFailureMessage);

      expect(writeFileSpy?.mock.calls).toHaveLength(0);
    });
  }

  test("captures the Czech returning callback against its exact landing", async () => {
    const fakePage = makeFakePage(czechCallbackUrl, { card: czechCard });

    await captureCallbackHandoffReview(
      fakePage.page,
      review,
      "callback-signed-in-cs-desktop",
      czechLanding
    );

    expect(fakePage.viewportChanges[0]).toEqual({ height: 1000, width: 1440 });
    expect(writeFileSpy?.mock.calls).toEqual([
      [
        resolve(
          accountReviewArtifactDirectory,
          "callback-signed-in-cs-desktop.png"
        ),
        screenshotBuffer,
      ],
    ]);
  });

  for (const [name, url, options] of [
    [
      "another return",
      `${baseUrl}/cs-CZ/auth/callback?return=${encodeAuthCallbackReturn("/cs-CZ/account")}`,
      { card: czechCard },
    ],
    [
      "no return",
      `${baseUrl}/cs-CZ/auth/callback?attempt=${attemptUuid}`,
      { card: czechCard },
    ],
    ["the English card", czechCallbackUrl, { card: englishCard }],
    [
      "the account body",
      czechCallbackUrl,
      { card: { ...czechCard, body: "Přesměrujeme vás na účet…" } },
    ],
    [
      "a hidden heading",
      czechCallbackUrl,
      { card: czechCard, hiddenTitle: true },
    ],
  ] as const) {
    test(`does not write the Czech returning callback with ${name}`, async () => {
      const fakePage = makeFakePage(url, options);

      await expect(
        captureCallbackHandoffReview(
          fakePage.page,
          review,
          "callback-signed-in-cs-desktop",
          czechLanding
        )
      ).rejects.toThrow(captureFailureMessage);

      expect(writeFileSpy?.mock.calls).toHaveLength(0);
    });
  }

  test("does not capture a held callback target under another landing's locale", async () => {
    const fakePage = makeFakePage(czechCallbackUrl, { card: czechCard });

    await expect(
      captureCallbackHandoffReview(
        fakePage.page,
        review,
        "callback-signed-in-desktop",
        czechLanding
      )
    ).rejects.toThrow(captureFailureMessage);

    expect(fakePage.screenshotCalls).toHaveLength(0);
    expect(writeFileSpy?.mock.calls).toHaveLength(0);
  });

  test("restores the previous viewport when screenshot capture fails", async () => {
    const fakePage = makeFakePage(`${baseUrl}/en-US/account/profile`, {
      failScreenshot: true,
    });

    await expect(
      captureAccountReview(fakePage.page, review, "linked-profile-desktop")
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
        const fakePage = makeFakePage(`${baseUrl}/en-US/account/profile`, {
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
          review,
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
    const fakePage = makeFakePage(`${baseUrl}/en-US/account/profile`, {
      onScreenshot: () => screenshotReady,
    });
    const controller = new AbortController();
    process.on("unhandledRejection", onUnhandledRejection);

    try {
      const capture = captureAccountReview(
        fakePage.page,
        review,
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
        const fakePage = makeFakePage(`${baseUrl}/en-US/account/profile`, {
          onScreenshot: () => screenshotReady,
        });
        const capture = captureAccountReview(
          fakePage.page,
          review,
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

  test("persists the fixed callback target with the supplied held-document validator", async () => {
    const fakePage = makeFakePage(
      `${baseUrl}/en-US/auth/callback?attempt=${attemptUuid}`
    );
    let validatorCalls = 0;
    const pixels = Buffer.from("held-document-png");

    await persistCallbackDocumentReview(
      fakePage.page,
      review,
      "callback-signed-in-desktop",
      { locale: "en-US" },
      pixels,
      () => {
        validatorCalls += 1;
      }
    );

    expect(validatorCalls).toBe(2);
    expect(fakePage.screenshotCalls).toHaveLength(0);
    expect(fakePage.viewportChanges).toHaveLength(0);
    expect(fakePage.fontReadyCalls()).toBe(0);
    expect(writeFileSpy?.mock.calls).toEqual([
      [
        resolve(
          accountReviewArtifactDirectory,
          "callback-signed-in-desktop.png"
        ),
        pixels,
      ],
    ]);
  });

  test("persists the Czech returning callback against its exact landing", async () => {
    const fakePage = makeFakePage(czechCallbackUrl);
    const pixels = Buffer.from("held-czech-document-png");

    await persistCallbackDocumentReview(
      fakePage.page,
      review,
      "callback-signed-in-cs-desktop",
      czechLanding,
      pixels,
      () => undefined
    );

    expect(writeFileSpy?.mock.calls).toEqual([
      [
        resolve(
          accountReviewArtifactDirectory,
          "callback-signed-in-cs-desktop.png"
        ),
        pixels,
      ],
    ]);
  });

  for (const [name, url] of [
    [
      "another return",
      `${baseUrl}/cs-CZ/auth/callback?return=${encodeAuthCallbackReturn("/cs-CZ/account")}`,
    ],
    ["no return", `${baseUrl}/cs-CZ/auth/callback`],
    [
      "the English callback",
      `${baseUrl}/en-US/auth/callback?return=${encodeAuthCallbackReturn(selection)}`,
    ],
  ] as const) {
    test(`does not persist the Czech returning callback with ${name}`, async () => {
      const fakePage = makeFakePage(url);

      await expect(
        persistCallbackDocumentReview(
          fakePage.page,
          review,
          "callback-signed-in-cs-desktop",
          czechLanding,
          screenshotBuffer,
          () => undefined
        )
      ).rejects.toThrow(captureFailureMessage);

      expect(writeFileSpy?.mock.calls).toHaveLength(0);
    });
  }

  test("does not write when the supplied held-document validator fails", async () => {
    const fakePage = makeFakePage(
      `${baseUrl}/en-US/auth/callback?attempt=${attemptUuid}`
    );

    await expect(
      persistCallbackDocumentReview(
        fakePage.page,
        review,
        "callback-signed-in-desktop",
        { locale: "en-US" },
        screenshotBuffer,
        () => {
          throw new Error("receipt is not valid");
        }
      )
    ).rejects.toThrow(captureFailureMessage);

    expect(fakePage.screenshotCalls).toHaveLength(0);
    expect(writeFileSpy?.mock.calls).toHaveLength(0);
  });

  test("keeps the shared URL checks before the held-document validator", async () => {
    const fakePage = makeFakePage(
      `${baseUrl}/en-US/auth/callback?attempt=not-a-uuid`
    );

    await expect(
      persistCallbackDocumentReview(
        fakePage.page,
        review,
        "callback-signed-in-desktop",
        { locale: "en-US" },
        screenshotBuffer,
        () => undefined
      )
    ).rejects.toThrow(captureFailureMessage);

    expect(writeFileSpy?.mock.calls).toHaveLength(0);
  });

  test("does not write after an aborted persistence", async () => {
    const fakePage = makeFakePage(
      `${baseUrl}/en-US/auth/callback?attempt=${attemptUuid}`
    );
    const controller = new AbortController();
    controller.abort();

    await expect(
      persistCallbackDocumentReview(
        fakePage.page,
        review,
        "callback-signed-in-desktop",
        { locale: "en-US" },
        screenshotBuffer,
        () => undefined,
        { signal: controller.signal }
      )
    ).rejects.toThrow(captureFailureMessage);

    expect(writeFileSpy?.mock.calls).toHaveLength(0);
  });

  test("revalidates before the write and does not write after mid-preparation invalidation", async () => {
    const fakePage = makeFakePage(
      `${baseUrl}/en-US/auth/callback?attempt=${attemptUuid}`
    );
    let validatorCalls = 0;

    await expect(
      persistCallbackDocumentReview(
        fakePage.page,
        review,
        "callback-signed-in-desktop",
        { locale: "en-US" },
        screenshotBuffer,
        () => {
          validatorCalls += 1;
          if (validatorCalls >= 2) throw new Error("context was invalidated");
        }
      )
    ).rejects.toThrow(captureFailureMessage);

    // The generic persistence preparation invokes the validator twice: once
    // before the mkdir and once between the mkdir and the write. The second
    // invocation observed the invalidated context, so nothing was written.
    expect(validatorCalls).toBe(2);
    expect(fakePage.screenshotCalls).toHaveLength(0);
    expect(writeFileSpy?.mock.calls).toHaveLength(0);
  });

  test("does not write when the callback loading status is removed after capture", async () => {
    let fakePage!: FakePage;
    fakePage = makeFakePage(`${baseUrl}/en-US/auth/callback`, {
      onScreenshot: () => {
        fakePage.setCallbackLoadingPresent(false);
      },
    });

    await expect(
      captureAccountReview(fakePage.page, review, "callback-signed-in-desktop")
    ).rejects.toThrow(captureFailureMessage);

    expect(fakePage.screenshotCalls).toHaveLength(1);
    expect(writeFileSpy?.mock.calls).toHaveLength(0);
  });

  test("installs one exact route and forwards the original request once", async () => {
    const clock = makeControlledClock();

    await withControlledDateNow(clock, async () => {
      const fakePage = makePendingReviewFakePage(clock);

      await withSignInPendingReview(fakePage.page, review, async () => {
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
          review,
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
      withSignInPendingReview(fakePage.page, review, async () => {
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
        review,
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
          withSignInPendingReview(fakePage.page, review, async () => {
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
        withSignInPendingReview(fakePage.page, review, async () => {
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

      await withSignInPendingReview(fakePage.page, review, async () => {
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
        withSignInPendingReview(fakePage.page, review, async () => {
          await fakePage.startPost();
        })
      ).rejects.toThrow(captureFailureMessage);

      expect(fakePage.screenshotCalls).toHaveLength(0);
      expect(fakePage.continueArguments).toEqual([[]]);
      expect(fakePage.continueCallCount()).toBe(1);
    });
  });
});

/**
 * The language case as the wrapper sees it: each genuine mid-case moment
 * handed to the capture hook on its own page, then the English profile the
 * case ends on.
 */
const runLanguageCaseMoments = async (
  fakePage: FakePage,
  capture: LanguagePreferenceReviewCapture,
  options: { readonly skip?: LanguagePreferenceReviewStage } = {}
) => {
  const captureUnlessSkipped = async (stage: LanguagePreferenceReviewStage) => {
    if (stage !== options.skip) await capture(stage);
  };
  fakePage.setUrl(`${baseUrl}/cs-CZ/account/profile`);
  await captureUnlessSkipped("czech-profile");
  fakePage.setUrl(`${baseUrl}/cs-CZ/faq`);
  await captureUnlessSkipped("preference-redirect");
  fakePage.setUrl(`${baseUrl}/en-US/account`);
  await captureUnlessSkipped("switcher-saved");
  fakePage.setUrl(`${baseUrl}/en-US/account/profile`);
};

const languageReviewFileNames = [
  "linked-profile-language-desktop-cs.png",
  "locale-preference-redirect-desktop.png",
  "locale-switcher-saved-desktop.png",
  "linked-profile-language-mobile.png",
];

describe("language preference review wrapper", () => {
  const createLanguageWriteFileSpy = () =>
    spyOn(fsPromises, "writeFile").mockImplementation(async () => undefined);
  let languageWriteFileSpy:
    | ReturnType<typeof createLanguageWriteFileSpy>
    | undefined;
  const writeFileNames = (): string[] =>
    (languageWriteFileSpy?.mock.calls ?? []).map(
      ([path]) => String(path).split(/[\\/]/).pop() ?? ""
    );

  beforeEach(() => {
    languageWriteFileSpy = createLanguageWriteFileSpy();
  });

  afterEach(() => {
    languageWriteFileSpy?.mockRestore();
    languageWriteFileSpy = undefined;
  });

  test("captures every mid-case moment, then the mobile language view", async () => {
    const fakePage = makeFakePage(`${baseUrl}/en-US/account/profile`);

    // The fake page has no route API: the wrapper holds no request, since a
    // language choice saves and navigates without a separate feedback state.
    await withLanguagePreferenceReview(fakePage.page, review, (capture) =>
      runLanguageCaseMoments(fakePage, capture)
    );

    expect(writeFileNames()).toEqual(languageReviewFileNames);
    expect(fakePage.currentViewport()).toEqual(initialViewport);
  });

  test("fails the review when the case skips a language moment", async () => {
    const fakePage = makeFakePage(`${baseUrl}/en-US/account/profile`);

    await expect(
      withLanguagePreferenceReview(fakePage.page, review, (capture) =>
        runLanguageCaseMoments(fakePage, capture, { skip: "switcher-saved" })
      )
    ).rejects.toThrow(captureFailureMessage);

    // Every genuine capture still lands; only the skipped one is missing.
    expect(writeFileNames()).toEqual(
      languageReviewFileNames.filter(
        (name) => name !== "locale-switcher-saved-desktop.png"
      )
    );
  });

  test("fails the review when a moment is captured off its page", async () => {
    const fakePage = makeFakePage(`${baseUrl}/en-US/account`);

    await expect(
      withLanguagePreferenceReview(fakePage.page, review, async (capture) => {
        // The Czech profile capture while the page is still the English
        // account must never be written.
        await capture("czech-profile");
        await runLanguageCaseMoments(fakePage, capture);
      })
    ).rejects.toThrow(captureFailureMessage);

    expect(writeFileNames()).toEqual(
      languageReviewFileNames.filter(
        (name) => name !== "linked-profile-language-desktop-cs.png"
      )
    );
  });

  test("fails the review when a moment is captured twice", async () => {
    const fakePage = makeFakePage(`${baseUrl}/en-US/account`);

    await expect(
      withLanguagePreferenceReview(fakePage.page, review, async (capture) => {
        await runLanguageCaseMoments(fakePage, capture);
        fakePage.setUrl(`${baseUrl}/en-US/account`);
        await capture("switcher-saved");
      })
    ).rejects.toThrow(captureFailureMessage);

    expect(
      writeFileNames().filter(
        (name) => name === "locale-switcher-saved-desktop.png"
      )
    ).toHaveLength(1);
  });

  test("rethrows the case failure without the post-case capture", async () => {
    const fakePage = makeFakePage(`${baseUrl}/en-US/account`);
    const caseFailure = new Error("synthetic language case failure");

    await expect(
      withLanguagePreferenceReview(fakePage.page, review, async (capture) => {
        fakePage.setUrl(`${baseUrl}/cs-CZ/account/profile`);
        await capture("czech-profile");
        throw caseFailure;
      })
    ).rejects.toBe(caseFailure);

    expect(writeFileNames()).toEqual([
      "linked-profile-language-desktop-cs.png",
    ]);
  });
});

describe("account review screenshots without the opt-in", () => {
  let writeFileSpy: ReturnType<typeof spyOn> | undefined;
  let mkdirSpy: ReturnType<typeof spyOn> | undefined;

  beforeEach(() => {
    writeFileSpy = spyOn(fsPromises, "writeFile").mockImplementation(
      async () => undefined
    );
    mkdirSpy = spyOn(fsPromises, "mkdir").mockImplementation(
      async () => undefined
    );
  });

  afterEach(() => {
    writeFileSpy?.mockRestore();
    mkdirSpy?.mockRestore();
  });

  const expectUntouched = (fakePage: FakePage) => {
    expect(fakePage.screenshotCalls).toHaveLength(0);
    expect(fakePage.viewportChanges).toHaveLength(0);
    expect(fakePage.fontReadyCalls()).toBe(0);
    expect(mkdirSpy?.mock.calls).toHaveLength(0);
    expect(writeFileSpy?.mock.calls).toHaveLength(0);
  };

  test("runs the sign-in case without holding its request", async () => {
    const clock = makeControlledClock();
    const fakePage = makePendingReviewFakePage(clock);
    let caseRuns = 0;

    await withSignInPendingReview(
      fakePage.page,
      reviewWithoutScreenshots,
      async () => {
        caseRuns += 1;
      }
    );

    expect(caseRuns).toBe(1);
    expect(fakePage.routeCalls).toHaveLength(0);
    expect(fakePage.unrouteCallCount()).toBe(0);
    expectUntouched(fakePage);
  });
});
