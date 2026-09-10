import { expect, mock, test } from "bun:test";
import { Effect } from "effect";
import {
  type CheckoutStatusViewModel,
  loadCheckoutStatusPage,
} from "@/features/checkout/backend/checkout";
import { m } from "@/features/i18n";
import { workspaceReservationIdSchema } from "@/features/reservation/persistence-contracts";
import type {
  WorkspaceE2EReservationHistoryFailureKind,
  WorkspaceE2EReservationHistorySubstage,
} from "./reservation-navigation";

type FakeLocator = {
  readonly click: () => Promise<void>;
  readonly count: () => Promise<number>;
  readonly getByRole: (role: string, options?: unknown) => FakeLocator;
  readonly getByText: (text: string, options?: unknown) => FakeLocator;
  readonly locator: (selector: string) => FakeLocator;
};

const fakePlaywrightExpect = (locator: FakeLocator) => ({
  toBeVisible: async () => expect(await locator.count()).toBe(1),
  toHaveCount: async (count: number) =>
    expect(await locator.count()).toBe(count),
});

mock.module("@playwright/test", () => ({ expect: fakePlaywrightExpect }));

const {
  expectWorkspaceE2EReservationNotFound,
  makeWorkspaceE2EReservationHistoryUrls,
  runReservationHistoryStage,
  toWorkspaceE2EReservationHistoryFailure,
  verifyWorkspaceE2EReservationHistoryNavigation,
  WorkspaceE2EReservationHistoryNavigationError,
  workspaceE2EReservationStatusLinkHydrationPredicate,
} = await import("./reservation-navigation");

test("builds canonical status and access URLs from one exact reservation id", () => {
  const reservationId = workspaceReservationIdSchema.make(
    "account-history-reservation/with-special-value"
  );
  const urls = makeWorkspaceE2EReservationHistoryUrls(
    "https://workspace.example.test/",
    reservationId
  );

  expect(urls).toEqual({
    accessPath:
      "/en-US/reservation/access/account-history-reservation%2Fwith-special-value",
    accessUrl:
      "https://workspace.example.test/en-US/reservation/access/account-history-reservation%2Fwith-special-value",
    accountPath: "/en-US/account",
    accountUrl: "https://workspace.example.test/en-US/account",
    statusPath:
      "/en-US/reservation/status/account-history-reservation%2Fwith-special-value",
    statusUrl:
      "https://workspace.example.test/en-US/reservation/status/account-history-reservation%2Fwith-special-value",
  });
});

test("keeps account navigation on the English account route", () => {
  const urls = makeWorkspaceE2EReservationHistoryUrls(
    "https://workspace.example.test",
    workspaceReservationIdSchema.make("account-history-reservation")
  );

  expect(urls.accountPath).toBe("/en-US/account");
  expect(urls.statusPath).toContain("account-history-reservation");
  expect(urls.accessPath).toContain("account-history-reservation");
});

const makeStatusPage = (status: CheckoutStatusViewModel) => {
  const notFoundTitle = m.checkoutStatusNotFoundTitle({}, { locale: "en-US" });
  const locator = (count: number) => ({ count: async () => count });

  return {
    getByRole: (role: string, options?: unknown) => {
      const name =
        typeof options === "object" && options !== null && "name" in options
          ? String((options as { readonly name?: unknown }).name)
          : "";
      return locator(
        role === "heading" &&
          name === notFoundTitle &&
          status.status === "not_found"
          ? 1
          : 0
      );
    },
    getByText: (text: string) =>
      locator(status.status !== "not_found" && text === status.orderId ? 1 : 0),
    locator: (selector: string) =>
      locator(
        selector === "#checkout-status-access" && status.status === "fulfilled"
          ? 1
          : 0
      ),
  } as never;
};

test("the not-found assertion rejects a status returned through broken authorization", async () => {
  const reservationId = workspaceReservationIdSchema.make(
    "known-local-terminal-reservation"
  );
  const localStatus = {
    fulfillmentStatus: "not_started",
    kind: "cowork",
    orderId: reservationId,
    paymentStatus: "expired",
    returnOutcome: "unknown",
    status: "expired",
  } satisfies CheckoutStatusViewModel;
  const statusService = {
    getStatus: () => Effect.succeed(localStatus),
    refreshStatus: () => Effect.succeed(localStatus),
  };
  const input = {
    accessCookie: undefined,
    locale: "en-US",
    orderId: reservationId,
    returnOutcome: "unknown",
  } as const;

  const denied = await Effect.runPromise(
    loadCheckoutStatusPage(
      statusService,
      { isAuthorized: () => Effect.succeed(false) },
      input
    )
  );
  expect(denied).toEqual({
    orderId: reservationId,
    returnOutcome: "unknown",
    status: "not_found",
  });
  await expect(
    expectWorkspaceE2EReservationNotFound(makeStatusPage(denied), reservationId)
  ).resolves.toBeUndefined();

  const leaked = await Effect.runPromise(
    loadCheckoutStatusPage(
      statusService,
      { isAuthorized: () => Effect.succeed(true) },
      input
    )
  );
  expect(leaked).toBe(localStatus);
  await expect(
    expectWorkspaceE2EReservationNotFound(makeStatusPage(leaked), reservationId)
  ).rejects.toThrow();
});

test("requires an exact hydrated click-handler table", () => {
  const statusPath = "/en-US/reservation/status/known-reservation";
  const link = {
    getAttribute: (name: string) => (name === "href" ? statusPath : undefined),
  } as Record<string, unknown>;
  const querySelectorAll = (() => [link]) as Document["querySelectorAll"];
  const documentObject = { querySelectorAll };

  const cases: readonly [string, unknown, boolean][] = [
    ["no React metadata", "missing", false],
    ["metadata undefined", undefined, false],
    ["metadata empty", {}, false],
    ["onClick undefined", { onClick: undefined }, false],
    ["onClick null", { onClick: null }, false],
    ["onClick string", { onClick: "click" }, false],
    ["onClick boolean", { onClick: true }, false],
    ["onClick function", { onClick: () => undefined }, true],
  ];

  for (const [label, reactProps, expected] of cases) {
    if (reactProps === "missing") {
      delete link.__reactProps$diagnostic;
    } else {
      Object.defineProperty(link, "__reactProps$diagnostic", {
        configurable: true,
        enumerable: true,
        value: reactProps,
        writable: true,
      });
    }

    expect(
      workspaceE2EReservationStatusLinkHydrationPredicate(
        statusPath,
        documentObject
      ),
      label
    ).toBe(expected);
  }
});

test("surfaces only the closed navigation stage through lane error mapping", async () => {
  const marker = "https://sensitive.example/reservation/secret-id";
  const failure = await runReservationHistoryStage(
    "modal-assert-content",
    async () => {
      throw new Error(marker);
    },
    "assertion"
  ).then(
    () => undefined,
    (cause) => cause
  );

  expect(failure).toBeInstanceOf(WorkspaceE2EReservationHistoryNavigationError);
  if (!(failure instanceof WorkspaceE2EReservationHistoryNavigationError)) {
    throw new Error("expected a reservation navigation failure");
  }
  expect(failure.kind).toBe("assertion");
  expect(failure.stage).toBe("modal-assert-content");
  expect(failure.message).not.toContain(marker);

  const laneFailure = await Effect.runPromise(
    Effect.tryPromise({
      catch: toWorkspaceE2EReservationHistoryFailure,
      try: async () => {
        throw failure;
      },
    })
  ).then(
    () => undefined,
    (cause) => cause
  );
  expect(laneFailure.message).toBe(
    "verify account reservation history navigation failed at modal-assert-content (assertion)"
  );
  expect(laneFailure.operation).toBe(
    "verify account reservation history navigation at modal-assert-content"
  );
  expect(laneFailure.cause).toBeUndefined();
  expect(JSON.stringify(laneFailure)).not.toContain(marker);
});

type NavigationHarnessOptions = {
  readonly accessReturnPresentation?: "modal" | "page";
  readonly failureMarker?: string;
  readonly failureStage?: WorkspaceE2EReservationHistorySubstage;
  readonly leakedAccessCode?: boolean;
  readonly missingActiveStatusAccessLink?: boolean;
};

type NavigationScope = "dialog" | "main" | "page";
type NavigationQuery =
  | "access"
  | "access-code"
  | "access-link"
  | "close"
  | "dialog"
  | "history-link"
  | "invalid-heading"
  | "main"
  | "none"
  | "not-found-heading"
  | "reservation-id"
  | "status-access"
  | "unavailable-heading";

const makeNavigationHarness = (options: NavigationHarnessOptions = {}) => {
  const reservationId = workspaceReservationIdSchema.make(
    "account-history-reservation"
  );
  const urls = makeWorkspaceE2EReservationHistoryUrls(
    "https://workspace.example.test",
    reservationId
  );
  const actions: string[] = [];
  const navigationOperations: Promise<unknown>[] = [];
  const failureMarker =
    options.failureMarker ??
    "https://private.example.test/reservation/private-id?cookie=private-cookie-token";
  const failFor = (stage: WorkspaceE2EReservationHistorySubstage) => {
    if (options.failureStage === stage) throw new Error(failureMarker);
  };
  const runNavigationOperation = <A>(
    operation: () => A | Promise<A>
  ): Promise<A> => {
    const promise = (async () => operation())();
    navigationOperations.push(promise.catch(() => undefined));
    return promise;
  };
  type NavigationMode =
    | "account"
    | "access-invalid"
    | "access-unavailable"
    | "modal"
    | "not-found"
    | "status";
  type Entry = { readonly url: string; readonly mode: NavigationMode };

  const makePage = (privatePage = false) => {
    let accountLoaded = false;
    const history: Entry[] = [
      {
        mode: privatePage ? "not-found" : "account",
        url: urls.accountUrl,
      },
    ];
    let historyIndex = 0;
    const current = () => history[historyIndex]!;
    const record = (action: string) => {
      if (!privatePage) actions.push(action);
    };
    const push = (entry: Entry) => {
      history.splice(historyIndex + 1);
      history.push(entry);
      historyIndex += 1;
    };
    const modeForUrl = (url: string): NavigationMode => {
      if (privatePage) {
        if (url === urls.accessUrl) return "access-invalid";
        return "not-found";
      }
      if (url === urls.accountUrl) return "account";
      if (url === urls.accessUrl) return "access-unavailable";
      if (url === urls.statusUrl) return "status";
      return "not-found";
    };
    const notFoundTitle = m.checkoutStatusNotFoundTitle(
      {},
      { locale: "en-US" }
    );
    const invalidLinkTitle = m.reservationAccessInvalidLinkTitle(
      {},
      { locale: "en-US" }
    );
    const unavailableTitle = m.reservationAccessUnavailableTitle(
      {},
      { locale: "en-US" }
    );
    const nameFromOptions = (options: unknown) =>
      typeof options === "object" && options !== null && "name" in options
        ? String((options as { readonly name?: unknown }).name)
        : "";
    const countFor = (scope: NavigationScope, query: NavigationQuery) => {
      const mode = current().mode;
      if (query === "dialog")
        return (scope === "page" || scope === "dialog") && mode === "modal"
          ? 1
          : 0;
      if (query === "main")
        return (scope === "page" || scope === "main") && mode === "status"
          ? 1
          : 0;
      if (query === "close")
        return scope === "dialog" && mode === "modal" ? 1 : 0;
      if (query === "history-link") {
        return scope === "page" &&
          accountLoaded &&
          (mode === "account" || mode === "access-unavailable")
          ? 1
          : 0;
      }
      if (query === "reservation-id") {
        if (mode === "modal") {
          if (scope === "dialog") return 1;
          if (scope === "page") return 2;
          return 0;
        }
        return mode === "status" && (scope === "main" || scope === "page")
          ? 1
          : 0;
      }
      if (query === "status-access" || query === "access-link") {
        if (mode === "modal") {
          if (scope === "dialog")
            return options.missingActiveStatusAccessLink ? 0 : 1;
          return scope === "page" ? 1 : 0;
        }
        return mode === "status" && (scope === "main" || scope === "page")
          ? 1
          : 0;
      }
      if (query === "access-code")
        return scope === "page" && options.leakedAccessCode && mode === "modal"
          ? 1
          : 0;
      if (query === "access")
        return scope === "page" &&
          (mode === "access-invalid" || mode === "access-unavailable")
          ? 1
          : 0;
      if (query === "not-found-heading")
        return scope === "page" && mode === "not-found" ? 1 : 0;
      if (query === "invalid-heading")
        return scope === "page" && mode === "access-invalid" ? 1 : 0;
      if (query === "unavailable-heading")
        return scope === "page" && mode === "access-unavailable" ? 1 : 0;
      return 0;
    };
    const makeLocator = (
      scope: NavigationScope,
      query: NavigationQuery
    ): FakeLocator => ({
      click: () =>
        runNavigationOperation(async () => {
          if (query === "history-link") {
            failFor("history-open-click");
            record(
              current().mode === "account" ? "click:history" : "click:status"
            );
            const presentation =
              current().mode === "account"
                ? "modal"
                : (options.accessReturnPresentation ?? "page");
            push({
              mode: presentation === "modal" ? "modal" : "status",
              url: urls.statusUrl,
            });
            return;
          }
          if (query === "close") {
            record("click:close");
            historyIndex -= 1;
            record("back");
            return;
          }
          if (query === "access-link") {
            record("click:access");
            push({ mode: "access-unavailable", url: urls.accessUrl });
          }
        }),
      count: async () => countFor(scope, query),
      getByRole: (role, roleOptions) => {
        if (role === "dialog") return makeLocator("dialog", "dialog");
        if (role === "main") return makeLocator("main", "main");
        if (role === "button") {
          return makeLocator(
            scope,
            nameFromOptions(roleOptions) === "Close" ? "close" : "none"
          );
        }
        if (role === "heading") {
          const name = nameFromOptions(roleOptions);
          let headingQuery: NavigationQuery = "none";
          if (name === notFoundTitle) headingQuery = "not-found-heading";
          else if (name === invalidLinkTitle) headingQuery = "invalid-heading";
          else if (name === unavailableTitle)
            headingQuery = "unavailable-heading";
          return makeLocator(scope, headingQuery);
        }
        return makeLocator(scope, "none");
      },
      getByText: (text) =>
        makeLocator(scope, text === reservationId ? "reservation-id" : "none"),
      locator: (selector) => {
        if (selector === "#checkout-status-access") {
          return makeLocator(
            scope,
            scope === "page" ? "access-link" : "status-access"
          );
        }
        if (selector === "[data-reservation-access]")
          return makeLocator(scope, "access");
        if (selector === "[data-reservation-access-code]")
          return makeLocator(scope, "access-code");
        if (selector === `a[href="${urls.statusPath}"]`)
          return makeLocator(scope, "history-link");
        return makeLocator(scope, "none");
      },
    });
    const page = makeLocator("page", "none") as FakeLocator & {
      readonly goBack: () => Promise<void>;
      readonly goForward: () => Promise<void>;
      readonly goto: (
        url: string
      ) => Promise<{ readonly status: () => number }>;
      readonly reload: () => Promise<void>;
      readonly url: () => string;
      readonly waitForFunction: (...args: readonly unknown[]) => Promise<void>;
      readonly waitForURL: (...args: readonly unknown[]) => Promise<void>;
    };
    Object.assign(page, {
      goBack: () =>
        runNavigationOperation(async () => {
          record("back");
          historyIndex -= 1;
        }),
      goForward: () =>
        runNavigationOperation(async () => {
          record("forward");
          historyIndex += 1;
        }),
      goto: (url: string) =>
        runNavigationOperation(async () => {
          if (!privatePage && url === urls.accountUrl && !accountLoaded)
            failFor("history-load");
          if (privatePage && url === urls.statusUrl)
            failFor("anonymous-status-load");
          if (privatePage && url === urls.accessUrl)
            failFor("anonymous-access-load");
          record(`goto:${url}`);
          if (url === urls.accountUrl) accountLoaded = true;
          push({
            mode:
              privatePage && url === urls.accessUrl
                ? "access-invalid"
                : modeForUrl(url),
            url,
          });
          return { status: () => 200 };
        }),
      reload: () =>
        runNavigationOperation(async () => {
          record("reload");
          history[historyIndex] = { mode: "status", url: urls.statusUrl };
        }),
      url: () => current().url,
      waitForFunction: (...args: readonly unknown[]) =>
        runNavigationOperation(async () => {
          const statusPath = args[1];
          if (statusPath === urls.statusPath)
            failFor(
              historyIndex > 0 && current().mode === "account"
                ? "history-open-hydration"
                : "history-reopen-hydration"
            );
          record("wait:history-link-hydration");
        }),
      waitForURL: () =>
        runNavigationOperation(async () => {
          failFor("history-open-url");
        }),
    });
    return page;
  };

  const page = makePage();
  const browser = {
    newContext: async () => {
      const privatePage = makePage(true);
      return {
        close: async () => undefined,
        newPage: async () => privatePage,
        request: {
          get: async () => ({
            dispose: async () => undefined,
            ok: () => true,
          }),
        },
      };
    },
  };

  return {
    actions,
    browser,
    page,
    reservationId,
    urls,
    waitForNavigationOperations: async () => {
      await Promise.all(navigationOperations);
    },
  };
};

test("runs the reservation verifier actions and captures both live stages", async () => {
  const harness = makeNavigationHarness();
  const stages: string[] = [];

  expect(
    await harness.page.locator(`a[href="${harness.urls.statusPath}"]`).count()
  ).toBe(0);

  await verifyWorkspaceE2EReservationHistoryNavigation({
    baseUrl: "https://workspace.example.test",
    browser: harness.browser as never,
    bypassSecret: undefined,
    captureStatusReview: async (stage) => {
      stages.push(stage);
      const page = harness.page;
      const activeRoot = page.getByRole(stage === "modal" ? "dialog" : "main");
      expect(
        await page.getByText(harness.reservationId, { exact: true }).count()
      ).toBe(stage === "modal" ? 2 : 1);
      expect(
        await activeRoot
          .getByText(harness.reservationId, { exact: true })
          .count()
      ).toBe(1);
      expect(await activeRoot.locator("#checkout-status-access").count()).toBe(
        1
      );
      if (stage === "modal") {
        await expect(
          fakePlaywrightExpect(
            page.getByText(harness.reservationId, { exact: true })
          ).toBeVisible()
        ).rejects.toThrow();
      }
    },
    fixture: {
      accessGrantId: "grant",
      dotyposReservationId: "dotypos-reservation",
      paymentAttemptId: "payment",
      reservationId: harness.reservationId,
    },
    page: harness.page as never,
  });

  expect(stages).toEqual(["modal", "details"]);
  expect(harness.actions).toEqual([
    `goto:${harness.urls.accountUrl}`,
    "wait:history-link-hydration",
    "click:history",
    "click:close",
    "back",
    `goto:${harness.urls.statusUrl}`,
    `goto:${harness.urls.accountUrl}`,
    "wait:history-link-hydration",
    "click:history",
    "back",
    "forward",
    "reload",
    "click:access",
    "wait:history-link-hydration",
    "click:status",
    `goto:${harness.urls.accountUrl}`,
  ]);
  expect(harness.page.url()).toBe(harness.urls.accountUrl);
});

type MappedNavigationFailure = {
  readonly cause?: unknown;
  readonly message: string;
  readonly operation: string;
};

const runMappedVerifierFailure = async (options: NavigationHarnessOptions) => {
  const harness = makeNavigationHarness(options);
  const failure = await Effect.runPromise(
    Effect.tryPromise({
      catch: toWorkspaceE2EReservationHistoryFailure,
      try: () =>
        verifyWorkspaceE2EReservationHistoryNavigation({
          baseUrl: "https://workspace.example.test",
          browser: harness.browser as never,
          bypassSecret: undefined,
          captureStatusReview: async () => undefined,
          fixture: {
            accessGrantId: "grant",
            dotyposReservationId: "dotypos-reservation",
            paymentAttemptId: "payment",
            reservationId: harness.reservationId,
          },
          page: harness.page as never,
        }),
    })
  ).then(
    () => {
      throw new Error("expected reservation history verification to fail");
    },
    (cause) => cause
  );
  await harness.waitForNavigationOperations();
  return {
    failure: failure as MappedNavigationFailure,
    harness,
  };
};

const assertMappedVerifierFailure = (
  failure: MappedNavigationFailure,
  stage: WorkspaceE2EReservationHistorySubstage,
  kind: WorkspaceE2EReservationHistoryFailureKind,
  marker: string
) => {
  expect(failure.message).toBe(
    `verify account reservation history navigation failed at ${stage} (${kind})`
  );
  expect(failure.operation).toBe(
    `verify account reservation history navigation at ${stage}`
  );
  expect(failure.message).not.toContain(marker);
  expect(failure.operation).not.toContain(marker);
  expect(JSON.stringify(failure)).not.toContain(marker);
  expect(String(failure)).not.toContain(marker);
  expect(failure.cause).toBeUndefined();
};

test("rejects an access-origin modal and accepts the canonical page", async () => {
  const runVerifier = (harness: ReturnType<typeof makeNavigationHarness>) =>
    verifyWorkspaceE2EReservationHistoryNavigation({
      baseUrl: "https://workspace.example.test",
      browser: harness.browser as never,
      bypassSecret: undefined,
      captureStatusReview: async () => undefined,
      fixture: {
        accessGrantId: "grant",
        dotyposReservationId: "dotypos-reservation",
        paymentAttemptId: "payment",
        reservationId: harness.reservationId,
      },
      page: harness.page as never,
    });

  const canonicalPage = makeNavigationHarness();
  await expect(runVerifier(canonicalPage)).resolves.toBeUndefined();

  const marker = "access-return-modal-marker";
  const wrongModal = await runMappedVerifierFailure({
    accessReturnPresentation: "modal",
    failureMarker: marker,
  });
  assertMappedVerifierFailure(
    wrongModal.failure,
    "access-details-return-dialog",
    "assertion",
    marker
  );
});

test("rejects status assertions that escape the active presentation root", async () => {
  const missingAccessLink = await runMappedVerifierFailure({
    missingActiveStatusAccessLink: true,
  });
  expect(
    await missingAccessLink.harness.page
      .locator("#checkout-status-access")
      .count()
  ).toBe(1);
  expect(
    await missingAccessLink.harness.page
      .getByRole("dialog")
      .locator("#checkout-status-access")
      .count()
  ).toBe(0);
  assertMappedVerifierFailure(
    missingAccessLink.failure,
    "modal-assert-content",
    "assertion",
    "https://private.example.test"
  );

  const leakedCode = await runMappedVerifierFailure({ leakedAccessCode: true });
  expect(
    await leakedCode.harness.page
      .getByRole("dialog")
      .locator("[data-reservation-access-code]")
      .count()
  ).toBe(0);
  expect(
    await leakedCode.harness.page
      .locator("[data-reservation-access-code]")
      .count()
  ).toBe(1);
  assertMappedVerifierFailure(
    leakedCode.failure,
    "modal-assert-content",
    "assertion",
    "https://private.example.test"
  );
});

test("maps serial and navigation-pair failures from the actual verifier", async () => {
  const marker =
    "https://private.example.test/reservation/private-id?cookie=private-cookie-token";
  const cases: readonly {
    readonly stage: WorkspaceE2EReservationHistorySubstage;
    readonly kind: WorkspaceE2EReservationHistoryFailureKind;
  }[] = [
    { kind: "error", stage: "history-load" },
    { kind: "error", stage: "history-open-url" },
    { kind: "error", stage: "history-open-click" },
  ];

  for (const failureCase of cases) {
    const result = await runMappedVerifierFailure({
      failureMarker: marker,
      failureStage: failureCase.stage,
    });
    assertMappedVerifierFailure(
      result.failure,
      failureCase.stage,
      failureCase.kind,
      marker
    );
  }
});
