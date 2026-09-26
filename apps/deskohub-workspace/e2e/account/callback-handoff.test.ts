import {
  afterEach,
  beforeEach,
  describe,
  expect,
  mock,
  spyOn,
  test,
} from "bun:test";
import * as fsPromises from "node:fs/promises";
import { resolve } from "node:path";
import type * as Playwright from "@playwright/test";
import { workspaceE2ETimeouts } from "../timeouts";

const baseUrl = "https://deskohub-workspace-review.example.test";
const accountUrl = `${baseUrl}/en-US/account?_rsc=synthetic-cache-key`;
const callbackUrl = `${baseUrl}/en-US/auth/callback`;
const attemptUuid = "0f0a9c1e-7b62-4c8d-9e21-53ab2f0d4c7a";
const fakeMainFrame = {} as Playwright.Frame;
const fakeSubFrame = {} as Playwright.Frame;
const callbackHandoffFailureMessage =
  "Account callback handoff verification failed";
const initialViewport = { height: 768, width: 1024 } as const;
const screenshotBuffer = Buffer.from("synthetic-png");
const accountReviewArtifactDirectory = resolve(
  import.meta.dir,
  "../../e2e-artifacts/account-review"
);

/**
 * Adapter seam control: the receipt-backed document review is mocked so the
 * wrapper's document branch can be exercised without a CDP session, while the
 * RSC branch keeps its locator-based fakes.
 */
const documentReviewControl = {
  captureCalls: 0,
  disposeCalls: 0,
  failCapture: false,
  failValidate: false,
  failValidateFromCall: Number.POSITIVE_INFINITY as number,
  pixels: Buffer.from("adapter-document-png"),
  prepareCalls: 0,
  preparedViewport: null as Playwright.ViewportSize | null,
  timeline: [] as string[],
  validateCalls: 0,
  reset: () => {
    documentReviewControl.captureCalls = 0;
    documentReviewControl.disposeCalls = 0;
    documentReviewControl.failCapture = false;
    documentReviewControl.failValidate = false;
    documentReviewControl.failValidateFromCall = Number.POSITIVE_INFINITY;
    documentReviewControl.prepareCalls = 0;
    documentReviewControl.preparedViewport = null;
    documentReviewControl.timeline = [];
    documentReviewControl.validateCalls = 0;
  },
};

mock.module("./callback-document-review", () => ({
  callbackDocumentReviewViewport: { width: 1440, height: 1000 },
  prepareCallbackDocumentReview: async (
    page: Playwright.Page,
    _baseOrigin: string,
    viewport: Playwright.ViewportSize
  ) => {
    documentReviewControl.prepareCalls += 1;
    documentReviewControl.preparedViewport = { ...viewport };
    documentReviewControl.timeline.push("adapter-prepare");
    await page.setViewportSize(viewport);
    return {
      validate: (): void => {
        documentReviewControl.validateCalls += 1;
        documentReviewControl.timeline.push("adapter-validate");
        if (
          documentReviewControl.failValidate ||
          documentReviewControl.validateCalls >=
            documentReviewControl.failValidateFromCall
        )
          throw new Error("receipt is not valid");
      },
      capture: async (): Promise<Buffer> => {
        documentReviewControl.captureCalls += 1;
        documentReviewControl.timeline.push("adapter-capture");
        if (documentReviewControl.failCapture)
          throw new Error("adapter capture failed");
        return documentReviewControl.pixels;
      },
      dispose: async (): Promise<void> => {
        documentReviewControl.disposeCalls += 1;
        documentReviewControl.timeline.push("adapter-dispose");
      },
    };
  },
}));

const { withCallbackHandoffReview } = await import("./callback-handoff");

type CallbackFakePageOptions = {
  readonly continueError?: Error;
  readonly deferContinue?: boolean;
  readonly deferLoadingEvaluation?: boolean;
  readonly deferRoute?: boolean;
  readonly deferUnroute?: boolean;
  readonly failLoadingWait?: boolean;
  readonly failScreenshot?: boolean;
  readonly loadingConnected?: boolean;
  readonly onFontsReady?: () => void;
  readonly onScreenshot?: () => Promise<void> | void;
  readonly routeError?: Error;
  readonly unrouteError?: Error;
};

type CallbackFakePage = {
  readonly continueArguments: readonly unknown[][];
  readonly continueCallCount: () => number;
  readonly dispatch: (
    url: string,
    options?: {
      readonly frame?: Playwright.Frame;
      readonly headers?: Record<string, string>;
      readonly isNavigationRequest?: boolean;
      readonly method?: string;
      readonly pageUrl?: string;
      readonly resourceType?: string;
    }
  ) => Promise<boolean>;
  readonly events: () => readonly string[];
  readonly loadingEvaluationStarted: Promise<void>;
  readonly page: Playwright.Page;
  readonly releaseRoute: () => void;
  readonly routeInstallArguments: readonly unknown[][];
  readonly routeStarted: Promise<void>;
  readonly releaseContinue: () => void;
  readonly releaseLoadingEvaluation: () => void;
  readonly releaseUnroute: () => void;
  readonly setUrl: (url: string) => void;
  readonly continueStarted: Promise<void>;
  readonly screenshotCalls: readonly Record<string, unknown>[];
  readonly screenshotStarted: Promise<void>;
  readonly unrouteArguments: readonly unknown[][];
  readonly unrouteStarted: Promise<void>;
  readonly unrouteCallCount: () => number;
  readonly waitTimeouts: readonly number[];
};

const makeCallbackFakePage = (
  options: CallbackFakePageOptions = {}
): CallbackFakePage => {
  let currentViewport: Playwright.ViewportSize | null = {
    ...initialViewport,
  };
  let routeMatcher: ((url: URL) => boolean) | undefined;
  let routeHandler: Parameters<Playwright.Page["route"]>[1] | undefined;
  let continueCallCount = 0;
  let unrouteCallCount = 0;
  let currentUrl = callbackUrl;
  const continueArguments: unknown[][] = [];
  const events: string[] = [];
  const screenshotCalls: Record<string, unknown>[] = [];
  const routeInstallArguments: unknown[][] = [];
  const unrouteArguments: unknown[][] = [];
  const waitTimeouts: number[] = [];
  let resolveContinue!: () => void;
  let continueReleased = !options.deferContinue;
  const continueReady = new Promise<void>((resolve) => {
    resolveContinue = resolve;
  });
  let resolveContinueStarted!: () => void;
  const continueStarted = new Promise<void>((resolve) => {
    resolveContinueStarted = resolve;
  });
  let resolveRoute!: () => void;
  let routeReleased = !options.deferRoute;
  const routeReady = new Promise<void>((resolve) => {
    resolveRoute = resolve;
  });
  let resolveRouteStarted!: () => void;
  const routeStarted = new Promise<void>((resolve) => {
    resolveRouteStarted = resolve;
  });
  let resolveLoadingEvaluation!: () => void;
  let loadingEvaluationReleased = !options.deferLoadingEvaluation;
  const loadingEvaluationReady = new Promise<void>((resolve) => {
    resolveLoadingEvaluation = resolve;
  });
  let resolveLoadingEvaluationStarted!: () => void;
  const loadingEvaluationStarted = new Promise<void>((resolve) => {
    resolveLoadingEvaluationStarted = resolve;
  });
  let resolveScreenshotStarted!: () => void;
  const screenshotStarted = new Promise<void>((resolve) => {
    resolveScreenshotStarted = resolve;
  });
  let resolveUnroute!: () => void;
  let unrouteReleased = !options.deferUnroute;
  const unrouteReady = new Promise<void>((resolve) => {
    resolveUnroute = resolve;
  });
  let resolveUnrouteStarted!: () => void;
  const unrouteStarted = new Promise<void>((resolve) => {
    resolveUnrouteStarted = resolve;
  });

  const loadingElement = Object.assign(
    {} as Playwright.ElementHandle<HTMLElement>,
    {
      evaluate: async () => {
        events.push("dom-check");
        resolveLoadingEvaluationStarted();
        if (!loadingEvaluationReleased) await loadingEvaluationReady;
        return options.loadingConnected !== false;
      },
    }
  );
  const makeLocator = (kind: string): Playwright.Locator =>
    Object.assign({} as Playwright.Locator, {
      boundingBox: async () => {
        if (kind === "main") return { height: 800, width: 1_000, x: 0, y: 0 };
        return { height: 422, width: 512, x: 0, y: 0 };
      },
      count: async () => 1,
      elementHandle: async () => loadingElement,
      getByText: () => makeLocator("loading-text"),
      waitFor: async (waitOptions: { readonly timeout?: number }) => {
        events.push(`wait:${kind}`);
        waitTimeouts.push(waitOptions.timeout ?? -1);
        if (kind === "loading-card" && options.failLoadingWait)
          throw new Error("raw locator failure");
      },
    });

  const page = Object.assign({} as Playwright.Page, {
    evaluate: async () => {
      events.push("fonts-ready");
      options.onFontsReady?.();
    },
    getByRole: (role: string) =>
      makeLocator(role === "status" ? "loading-status" : "landmark"),
    locator: (selector: string) =>
      makeLocator(selector === "main" ? "main" : "loading-card"),
    route: async (
      matcher: unknown,
      handler: Parameters<Playwright.Page["route"]>[1]
    ) => {
      events.push("route-install");
      routeInstallArguments.push([matcher, handler]);
      routeMatcher = matcher as (url: URL) => boolean;
      routeHandler = handler;
      resolveRouteStarted();
      if (!routeReleased) await routeReady;
      if (options.routeError) throw options.routeError;
    },
    screenshot: async (screenshotOptions: Record<string, unknown>) => {
      events.push("screenshot");
      screenshotCalls.push(screenshotOptions);
      resolveScreenshotStarted();
      await options.onScreenshot?.();
      if (options.failScreenshot) throw new Error("raw screenshot failure");
      return screenshotBuffer;
    },
    setViewportSize: async (viewport: Playwright.ViewportSize | null) => {
      currentViewport = viewport;
    },
    unroute: async (...args: unknown[]) => {
      unrouteCallCount += 1;
      unrouteArguments.push(args);
      events.push("unroute");
      resolveUnrouteStarted();
      if (args[0] === routeMatcher && args[1] === routeHandler) {
        routeMatcher = undefined;
        routeHandler = undefined;
      }
      if (!unrouteReleased) await unrouteReady;
      if (options.unrouteError) throw options.unrouteError;
    },
    url: () => currentUrl,
    viewportSize: () => currentViewport,
    mainFrame: () => fakeMainFrame,
  });

  const dispatch: CallbackFakePage["dispatch"] = async (
    url,
    requestOptions = {}
  ) => {
    if (!routeMatcher?.(new URL(url))) return false;
    const route = Object.assign({} as Playwright.Route, {
      continue: async (...args: unknown[]) => {
        continueCallCount += 1;
        continueArguments.push(args);
        events.push("continue");
        resolveContinueStarted();
        if (!continueReleased) await continueReady;
        if (options.continueError) throw options.continueError;
      },
    });
    const request = Object.assign({} as Playwright.Request, {
      frame: () => requestOptions.frame ?? fakeMainFrame,
      headers: () => requestOptions.headers ?? { rsc: "1" },
      isNavigationRequest: () => requestOptions.isNavigationRequest ?? false,
      method: () => requestOptions.method ?? "GET",
      resourceType: () => requestOptions.resourceType ?? "fetch",
    });
    if (!routeHandler)
      throw new Error("callback handoff route was not installed");
    currentUrl = requestOptions.pageUrl ?? callbackUrl;
    await routeHandler(route, request);
    return true;
  };

  return {
    continueArguments,
    continueCallCount: () => continueCallCount,
    dispatch,
    events: () => events,
    page,
    releaseRoute: () => {
      if (routeReleased) return;
      routeReleased = true;
      resolveRoute();
    },
    routeInstallArguments,
    routeStarted,
    unrouteArguments,
    releaseContinue: () => {
      if (continueReleased) return;
      continueReleased = true;
      resolveContinue();
    },
    loadingEvaluationStarted,
    releaseLoadingEvaluation: () => {
      if (loadingEvaluationReleased) return;
      loadingEvaluationReleased = true;
      resolveLoadingEvaluation();
    },
    releaseUnroute: () => {
      if (unrouteReleased) return;
      unrouteReleased = true;
      resolveUnroute();
    },
    setUrl: (url) => {
      currentUrl = url;
    },
    continueStarted,
    screenshotCalls,
    screenshotStarted,
    unrouteStarted,
    unrouteCallCount: () => unrouteCallCount,
    waitTimeouts,
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
) => {
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

describe("account callback handoff review", () => {
  const createWriteFileSpy = () =>
    spyOn(fsPromises, "writeFile").mockImplementation(async () => undefined);
  let writeFileSpy: ReturnType<typeof createWriteFileSpy> | undefined;

  beforeEach(() => {
    writeFileSpy = createWriteFileSpy();
    documentReviewControl.reset();
  });

  afterEach(() => {
    writeFileSpy?.mockRestore();
    writeFileSpy = undefined;
  });

  test("captures only the first qualifying GET before forwarding it", async () => {
    const fakePage = makeCallbackFakePage();

    await withCallbackHandoffReview(fakePage.page, baseUrl, async () => {
      await fakePage.dispatch(accountUrl);
      await fakePage.dispatch(`${baseUrl}/en-US/account?_rsc=second`);
    });

    expect(fakePage.screenshotCalls).toHaveLength(1);
    expect(fakePage.screenshotCalls[0]).toEqual({
      animations: "disabled",
      fullPage: true,
      timeout: expect.any(Number),
    });
    expect(writeFileSpy?.mock.calls).toEqual([
      [
        resolve(accountReviewArtifactDirectory, "callback-loading-desktop.png"),
        screenshotBuffer,
      ],
    ]);
    expect(fakePage.continueArguments).toEqual([[], []]);
    expect(fakePage.continueCallCount()).toBe(2);
    expect(fakePage.events().indexOf("screenshot")).toBeLessThan(
      fakePage.events().indexOf("continue")
    );
    expect(fakePage.unrouteCallCount()).toBe(1);
  });

  test("aborts capture when the case returns before the handler", async () => {
    const fakePage = makeCallbackFakePage();

    await expect(
      withCallbackHandoffReview(fakePage.page, baseUrl, async () => {
        void fakePage.dispatch(accountUrl);
      })
    ).rejects.toThrow(callbackHandoffFailureMessage);

    expect(fakePage.screenshotCalls).toHaveLength(0);
    expect(fakePage.continueCallCount()).toBe(1);
    expect(fakePage.unrouteCallCount()).toBe(1);
  });

  test("aborts a pending DOM evaluation when the case fails", async () => {
    const fakePage = makeCallbackFakePage({ deferLoadingEvaluation: true });
    const runCaseFailure = new Error("original run case failure");
    const unhandledRejections: unknown[] = [];
    const onUnhandledRejection = (reason: unknown) => {
      unhandledRejections.push(reason);
    };
    process.on("unhandledRejection", onUnhandledRejection);

    try {
      await expect(
        withCallbackHandoffReview(fakePage.page, baseUrl, async () => {
          void fakePage.dispatch(accountUrl);
          await fakePage.loadingEvaluationStarted;
          throw runCaseFailure;
        })
      ).rejects.toBe(runCaseFailure);

      expect(fakePage.events()).toContain("wait:loading-card");
      expect(fakePage.screenshotCalls).toHaveLength(1);
      expect(fakePage.continueCallCount()).toBe(1);

      fakePage.releaseLoadingEvaluation();
      await flushMicrotasks();
      expect(fakePage.screenshotCalls).toHaveLength(1);
      expect(unhandledRejections).toHaveLength(0);
    } finally {
      process.off("unhandledRejection", onUnhandledRejection);
    }
  });

  test("discards a late screenshot and preserves the case failure", async () => {
    let resolveScreenshot!: () => void;
    const screenshotReady = new Promise<void>((resolve) => {
      resolveScreenshot = resolve;
    });
    const fakePage = makeCallbackFakePage({
      onScreenshot: () => screenshotReady,
    });
    const runCaseFailure = new Error("original run case failure");
    const unhandledRejections: unknown[] = [];
    const onUnhandledRejection = (reason: unknown) => {
      unhandledRejections.push(reason);
    };
    process.on("unhandledRejection", onUnhandledRejection);

    try {
      const wrapped = withCallbackHandoffReview(
        fakePage.page,
        baseUrl,
        async () => {
          void fakePage.dispatch(accountUrl);
          await fakePage.screenshotStarted;
          fakePage.setUrl(`${baseUrl}/en-US/account`);
          throw runCaseFailure;
        }
      );

      await expect(wrapped).rejects.toBe(runCaseFailure);
      expect(fakePage.screenshotCalls).toHaveLength(1);
      expect(fakePage.continueCallCount()).toBe(1);
      expect(fakePage.unrouteCallCount()).toBe(1);
      expect(writeFileSpy?.mock.calls).toHaveLength(0);

      resolveScreenshot();
      await flushMicrotasks();
      expect(writeFileSpy?.mock.calls).toHaveLength(0);
      expect(unhandledRejections).toHaveLength(0);
    } finally {
      resolveScreenshot();
      process.off("unhandledRejection", onUnhandledRejection);
    }
  });

  test("qualifies only a real GET without prefetch headers", async () => {
    const fakePage = makeCallbackFakePage();

    await withCallbackHandoffReview(fakePage.page, baseUrl, async () => {
      await fakePage.dispatch(accountUrl, {
        headers: { rsc: "1" },
        method: "POST",
      });
      for (const prefetchValue of ["1", "2", "3", ""]) {
        await fakePage.dispatch(accountUrl, {
          headers: { "next-router-prefetch": prefetchValue, rsc: "1" },
        });
      }
      await fakePage.dispatch(accountUrl, {
        headers: { purpose: "prefetch", rsc: "1" },
      });
      expect(
        await fakePage.dispatch(`${baseUrl}/en-US/auth/sign-in`, {
          headers: { rsc: "1" },
        })
      ).toBe(false);
      await fakePage.dispatch(accountUrl, { headers: { rsc: "1" } });
    });

    expect(fakePage.screenshotCalls).toHaveLength(1);
    expect(fakePage.continueCallCount()).toBe(7);
    expect(fakePage.unrouteCallCount()).toBe(1);
  });

  for (const [name, requestOverrides] of [
    [
      "a contradictory RSC navigation document",
      {
        headers: { rsc: "1" },
        isNavigationRequest: true,
        resourceType: "document",
      },
    ],
    [
      "a subframe document navigation",
      {
        frame: fakeSubFrame,
        headers: {},
        isNavigationRequest: true,
        resourceType: "document",
      },
    ],
    ["a plain fetch without rsc", { headers: {}, resourceType: "fetch" }],
    [
      "a prefetched document navigation",
      {
        headers: { "next-router-prefetch": "1" },
        isNavigationRequest: true,
        resourceType: "document",
      },
    ],
  ] as const) {
    test(`rejects ${name}`, async () => {
      const fakePage = makeCallbackFakePage();

      await expect(
        withCallbackHandoffReview(fakePage.page, baseUrl, async () => {
          await fakePage.dispatch(accountUrl, requestOverrides);
        })
      ).rejects.toThrow(callbackHandoffFailureMessage);

      expect(fakePage.screenshotCalls).toHaveLength(0);
      expect(fakePage.continueCallCount()).toBe(1);
      expect(fakePage.unrouteCallCount()).toBe(1);
    });
  }

  test("reviews a held main-frame document through the adapter before forwarding", async () => {
    const fakePage = makeCallbackFakePage();
    documentReviewControl.timeline = fakePage.events() as string[];

    await withCallbackHandoffReview(fakePage.page, baseUrl, async () => {
      documentReviewControl.timeline.push("run-case");
      await fakePage.dispatch(accountUrl, {
        headers: {},
        isNavigationRequest: true,
        resourceType: "document",
      });
    });

    expect(documentReviewControl.prepareCalls).toBe(1);
    expect(documentReviewControl.preparedViewport).toEqual({
      width: 1440,
      height: 1000,
    });
    const timeline = fakePage.events();
    expect(timeline.indexOf("adapter-prepare")).toBeLessThan(
      timeline.indexOf("run-case")
    );
    expect(timeline.indexOf("adapter-validate")).toBeLessThan(
      timeline.indexOf("adapter-capture")
    );
    expect(timeline.indexOf("adapter-capture")).toBeLessThan(
      timeline.indexOf("continue")
    );
    expect(timeline.indexOf("continue")).toBeLessThan(
      timeline.indexOf("adapter-dispose")
    );
    expect(documentReviewControl.captureCalls).toBe(1);
    expect(documentReviewControl.disposeCalls).toBe(1);
    expect(fakePage.screenshotCalls).toHaveLength(0);
    expect(writeFileSpy?.mock.calls).toEqual([
      [
        resolve(accountReviewArtifactDirectory, "callback-loading-desktop.png"),
        documentReviewControl.pixels,
      ],
    ]);
    expect(fakePage.continueCallCount()).toBe(1);
    expect(fakePage.unrouteCallCount()).toBe(1);
  });

  test("fails closed on a failed adapter receipt and still forwards once", async () => {
    const fakePage = makeCallbackFakePage();
    documentReviewControl.failValidate = true;
    documentReviewControl.timeline = fakePage.events() as string[];

    await expect(
      withCallbackHandoffReview(fakePage.page, baseUrl, async () => {
        await fakePage.dispatch(accountUrl, {
          headers: {},
          isNavigationRequest: true,
          resourceType: "document",
        });
      })
    ).rejects.toThrow(callbackHandoffFailureMessage);

    expect(fakePage.events().indexOf("continue")).toBeLessThan(
      fakePage.events().indexOf("adapter-dispose")
    );
    expect(documentReviewControl.validateCalls).toBeGreaterThan(0);
    expect(documentReviewControl.captureCalls).toBe(0);
    expect(documentReviewControl.disposeCalls).toBe(1);
    expect(fakePage.screenshotCalls).toHaveLength(0);
    expect(writeFileSpy?.mock.calls).toHaveLength(0);
    expect(fakePage.continueCallCount()).toBe(1);
    expect(fakePage.unrouteCallCount()).toBe(1);
  });

  test("does not persist when the context is invalidated between capture and persistence", async () => {
    const fakePage = makeCallbackFakePage();
    documentReviewControl.failValidateFromCall = 2;
    documentReviewControl.timeline = fakePage.events() as string[];

    await expect(
      withCallbackHandoffReview(fakePage.page, baseUrl, async () => {
        await fakePage.dispatch(accountUrl, {
          headers: {},
          isNavigationRequest: true,
          resourceType: "document",
        });
      })
    ).rejects.toThrow(callbackHandoffFailureMessage);

    expect(documentReviewControl.validateCalls).toBeGreaterThanOrEqual(2);
    expect(documentReviewControl.captureCalls).toBe(1);
    expect(fakePage.events().indexOf("continue")).toBeLessThan(
      fakePage.events().indexOf("adapter-dispose")
    );
    expect(documentReviewControl.disposeCalls).toBe(1);
    expect(fakePage.screenshotCalls).toHaveLength(0);
    expect(writeFileSpy?.mock.calls).toHaveLength(0);
    expect(fakePage.continueCallCount()).toBe(1);
    expect(fakePage.unrouteCallCount()).toBe(1);
  });

  test("does not persist when the context is invalidated between mkdir and write", async () => {
    const fakePage = makeCallbackFakePage();
    documentReviewControl.failValidateFromCall = 3;
    documentReviewControl.timeline = fakePage.events() as string[];

    await expect(
      withCallbackHandoffReview(fakePage.page, baseUrl, async () => {
        await fakePage.dispatch(accountUrl, {
          headers: {},
          isNavigationRequest: true,
          resourceType: "document",
        });
      })
    ).rejects.toThrow(callbackHandoffFailureMessage);

    // Calls 1-2 passed (pre-capture and pre-mkdir); only the final
    // revalidation before the write observes the invalidated context.
    expect(documentReviewControl.validateCalls).toBe(3);
    expect(documentReviewControl.captureCalls).toBe(1);
    expect(fakePage.events().indexOf("continue")).toBeLessThan(
      fakePage.events().indexOf("adapter-dispose")
    );
    expect(documentReviewControl.disposeCalls).toBe(1);
    expect(fakePage.screenshotCalls).toHaveLength(0);
    expect(writeFileSpy?.mock.calls).toHaveLength(0);
    expect(fakePage.continueCallCount()).toBe(1);
    expect(fakePage.unrouteCallCount()).toBe(1);
  });

  test("fails closed on an adapter capture failure and still forwards once", async () => {
    const fakePage = makeCallbackFakePage();
    documentReviewControl.failCapture = true;
    documentReviewControl.timeline = fakePage.events() as string[];

    await expect(
      withCallbackHandoffReview(fakePage.page, baseUrl, async () => {
        await fakePage.dispatch(accountUrl, {
          headers: {},
          isNavigationRequest: true,
          resourceType: "document",
        });
      })
    ).rejects.toThrow(callbackHandoffFailureMessage);

    expect(fakePage.events().indexOf("continue")).toBeLessThan(
      fakePage.events().indexOf("adapter-dispose")
    );
    expect(documentReviewControl.captureCalls).toBe(1);
    expect(documentReviewControl.disposeCalls).toBe(1);
    expect(fakePage.screenshotCalls).toHaveLength(0);
    expect(writeFileSpy?.mock.calls).toHaveLength(0);
    expect(fakePage.continueCallCount()).toBe(1);
    expect(fakePage.unrouteCallCount()).toBe(1);
  });

  test("preserves the run case failure over document review failure", async () => {
    const fakePage = makeCallbackFakePage();
    documentReviewControl.failValidate = true;
    const runCaseFailure = new Error("original run case failure");

    await expect(
      withCallbackHandoffReview(fakePage.page, baseUrl, async () => {
        await fakePage.dispatch(accountUrl, {
          headers: {},
          isNavigationRequest: true,
          resourceType: "document",
        });
        throw runCaseFailure;
      })
    ).rejects.toBe(runCaseFailure);

    expect(fakePage.continueCallCount()).toBe(1);
    expect(documentReviewControl.disposeCalls).toBe(1);
    expect(fakePage.unrouteCallCount()).toBe(1);
  });

  test("accepts a callback URL with exactly one canonical attempt parameter", async () => {
    const fakePage = makeCallbackFakePage();

    await withCallbackHandoffReview(fakePage.page, baseUrl, async () => {
      await fakePage.dispatch(accountUrl, {
        pageUrl: `${callbackUrl}?attempt=${attemptUuid}`,
      });
    });

    expect(fakePage.screenshotCalls).toHaveLength(1);
    expect(fakePage.continueCallCount()).toBe(1);
    expect(fakePage.unrouteCallCount()).toBe(1);
  });

  for (const [name, pageUrl] of [
    ["a malformed attempt UUID", `${callbackUrl}?attempt=not-a-uuid`],
    [
      "a non-canonical uppercase attempt UUID",
      `${callbackUrl}?attempt=${attemptUuid.toUpperCase()}`,
    ],
    ["an unknown parameter", `${callbackUrl}?unknown=synthetic-value`],
    ["a token parameter", `${callbackUrl}?token=synthetic-secret-token`],
    [
      "a duplicated attempt parameter",
      `${callbackUrl}?attempt=${attemptUuid}&attempt=${attemptUuid}`,
    ],
    [
      "an attempt parameter with an extra parameter",
      `${callbackUrl}?attempt=${attemptUuid}&extra=1`,
    ],
    ["a fragment", `${callbackUrl}#review-state`],
    [
      "a foreign origin",
      `https://other.example.test/en-US/auth/callback?attempt=${attemptUuid}`,
    ],
  ] as const) {
    test(`rejects ${name} before capture`, async () => {
      const fakePage = makeCallbackFakePage();

      await expect(
        withCallbackHandoffReview(fakePage.page, baseUrl, async () => {
          await fakePage.dispatch(accountUrl, { pageUrl });
        })
      ).rejects.toThrow(callbackHandoffFailureMessage);

      expect(fakePage.screenshotCalls).toHaveLength(0);
      expect(fakePage.continueCallCount()).toBe(1);
      expect(fakePage.unrouteCallCount()).toBe(1);
    });
  }

  test("fails closed when no qualifying request is observed", async () => {
    const fakePage = makeCallbackFakePage();

    await expect(
      withCallbackHandoffReview(fakePage.page, baseUrl, async () => undefined)
    ).rejects.toThrow(callbackHandoffFailureMessage);

    expect(fakePage.screenshotCalls).toHaveLength(0);
    expect(fakePage.unrouteCallCount()).toBe(1);
  });

  test("unroutes a synchronously registered handler after route ack timeout", async () => {
    const clock = makeControlledClock();
    const unhandledRejections: unknown[] = [];
    const onUnhandledRejection = (reason: unknown) => {
      unhandledRejections.push(reason);
    };

    await withControlledDateNow(clock, async () => {
      await withControlledTimers(clock, async (advanceTo) => {
        const fakePage = makeCallbackFakePage({ deferRoute: true });
        let runCaseCalls = 0;
        process.on("unhandledRejection", onUnhandledRejection);

        try {
          const wrapped = withCallbackHandoffReview(
            fakePage.page,
            baseUrl,
            async () => {
              runCaseCalls += 1;
            }
          );
          await fakePage.routeStarted;
          await advanceTo(workspaceE2ETimeouts.browserAction);
          await expect(wrapped).rejects.toThrow(callbackHandoffFailureMessage);

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
          expect(await fakePage.dispatch(accountUrl)).toBe(false);
          expect(unhandledRejections).toHaveLength(0);
        } finally {
          fakePage.releaseRoute();
          process.off("unhandledRejection", onUnhandledRejection);
        }
      });
    });
  });

  test("unroutes a synchronously registered handler after route ack rejection", async () => {
    const fakePage = makeCallbackFakePage({
      routeError: new Error("raw route install failure"),
    });
    let runCaseCalls = 0;

    await expect(
      withCallbackHandoffReview(fakePage.page, baseUrl, async () => {
        runCaseCalls += 1;
      })
    ).rejects.toThrow(callbackHandoffFailureMessage);

    expect(runCaseCalls).toBe(0);
    expect(fakePage.unrouteCallCount()).toBe(1);
    expect(fakePage.unrouteArguments[0]?.[0]).toBe(
      fakePage.routeInstallArguments[0]?.[0]
    );
    expect(fakePage.unrouteArguments[0]?.[1]).toBe(
      fakePage.routeInstallArguments[0]?.[1]
    );
  });

  test("releases and unroutes after locator or capture errors", async () => {
    for (const options of [
      { failLoadingWait: true },
      { failScreenshot: true },
      { unrouteError: new Error("raw unroute failure") },
    ]) {
      const fakePage = makeCallbackFakePage(options);

      await expect(
        withCallbackHandoffReview(fakePage.page, baseUrl, async () => {
          await fakePage.dispatch(accountUrl);
        })
      ).rejects.toThrow(callbackHandoffFailureMessage);

      expect(fakePage.continueCallCount()).toBe(1);
      expect(fakePage.unrouteCallCount()).toBe(1);
    }
  });

  test("preserves the run case failure over cleanup failures", async () => {
    const fakePage = makeCallbackFakePage({
      continueError: new Error("raw route continuation failure"),
      unrouteError: new Error("raw unroute failure"),
    });
    const runCaseFailure = new Error("original run case failure");

    await expect(
      withCallbackHandoffReview(fakePage.page, baseUrl, async () => {
        await fakePage.dispatch(accountUrl);
        throw runCaseFailure;
      })
    ).rejects.toBe(runCaseFailure);

    expect(fakePage.continueCallCount()).toBe(1);
    expect(fakePage.unrouteCallCount()).toBe(1);
  });

  test("catches loading DOM removal before forwarding", async () => {
    const fakePage = makeCallbackFakePage({ loadingConnected: false });

    await expect(
      withCallbackHandoffReview(fakePage.page, baseUrl, async () => {
        await fakePage.dispatch(accountUrl);
      })
    ).rejects.toThrow(callbackHandoffFailureMessage);

    expect(fakePage.events().indexOf("dom-check")).toBeLessThan(
      fakePage.events().indexOf("continue")
    );
    expect(fakePage.continueCallCount()).toBe(1);
  });

  test("uses one browser action deadline across waits and capture", async () => {
    const clock = makeControlledClock();

    await withControlledDateNow(clock, async () => {
      const fakePage = makeCallbackFakePage({
        onFontsReady: () => clock.advanceTo(workspaceE2ETimeouts.browserAction),
      });

      await expect(
        withCallbackHandoffReview(fakePage.page, baseUrl, async () => {
          await fakePage.dispatch(accountUrl);
        })
      ).rejects.toThrow(callbackHandoffFailureMessage);

      expect(fakePage.waitTimeouts.length).toBeGreaterThan(0);
      expect(
        fakePage.waitTimeouts.every(
          (timeout) => timeout <= workspaceE2ETimeouts.browserAction
        )
      ).toBe(true);
      expect(fakePage.screenshotCalls).toHaveLength(0);
      expect(fakePage.continueCallCount()).toBe(1);
    });
  });

  test("bounds unresolved continuation and unroute with one cleanup budget", async () => {
    const clock = makeControlledClock();
    const runCaseFailure = new Error("original run case failure");

    await withControlledDateNow(clock, async () => {
      await withControlledTimers(clock, async (advanceTo) => {
        const fakePage = makeCallbackFakePage({
          deferContinue: true,
          deferUnroute: true,
        });
        const unhandledRejections: unknown[] = [];
        const onUnhandledRejection = (reason: unknown) => {
          unhandledRejections.push(reason);
        };
        process.on("unhandledRejection", onUnhandledRejection);

        try {
          const wrapped = withCallbackHandoffReview(
            fakePage.page,
            baseUrl,
            async () => {
              void fakePage.dispatch(accountUrl);
              await fakePage.screenshotStarted;
              throw runCaseFailure;
            }
          );
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

          await Promise.all([
            fakePage.continueStarted,
            fakePage.unrouteStarted,
          ]);
          expect(fakePage.continueCallCount()).toBe(1);
          expect(fakePage.unrouteCallCount()).toBe(1);
          expect(settled).toBe(false);

          await advanceTo(workspaceE2ETimeouts.cleanupAction - 1);
          expect(settled).toBe(false);
          await advanceTo(workspaceE2ETimeouts.cleanupAction);
          await expect(wrapped).rejects.toBe(runCaseFailure);
          expect(fakePage.continueCallCount()).toBe(1);
          expect(fakePage.unrouteCallCount()).toBe(1);
          expect(unhandledRejections).toHaveLength(0);
        } finally {
          fakePage.releaseContinue();
          fakePage.releaseUnroute();
          await flushMicrotasks();
          process.off("unhandledRejection", onUnhandledRejection);
        }
      });
    });
  });
});
