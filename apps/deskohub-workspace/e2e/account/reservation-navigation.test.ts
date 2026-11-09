import { expect, mock, test } from "bun:test";
import { Effect } from "effect";
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
  makeWorkspaceE2EReservationHistoryUrls,
  toWorkspaceE2EReservationHistoryFailure,
  verifyWorkspaceE2EReservationHistoryNavigation,
} = await import("./reservation-navigation");

type NavigationHarnessOptions = {
  readonly accessReturnPresentation?: "modal" | "page";
  readonly failureMarker?: string;
  readonly failureStage?: WorkspaceE2EReservationHistorySubstage;
  readonly leakedAccessCode?: boolean;
  readonly missingActiveStatusAccessLink?: boolean;
};

type NavigationScope = "dialog" | "main" | "page";
type NavigationQuery =
  | "account"
  | "account-access"
  | "access"
  | "access-code"
  | "access-status"
  | "close"
  | "dialog"
  | "history-link"
  | "invalid-heading"
  | "main"
  | "none"
  | "not-found-heading"
  | "reservation-id"
  | "sign-in-heading"
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
    | "sign-in"
    | "status";
  type BackgroundOrigin = "account" | "standalone";
  type Entry = {
    readonly backgroundOrigin: BackgroundOrigin;
    readonly mode: NavigationMode;
    readonly url: string;
  };

  const makePage = (privatePage = false) => {
    let accountLoaded = false;
    const history: Entry[] = [
      {
        backgroundOrigin: privatePage ? "standalone" : "account",
        mode: privatePage ? "not-found" : "account",
        url: urls.accountUrl,
      },
    ];
    let historyIndex = 0;
    const current = () => history[historyIndex]!;
    let backgroundOrigin = current().backgroundOrigin;
    const syncBackgroundOrigin = () => {
      backgroundOrigin = current().backgroundOrigin;
    };
    const push = (entry: Entry) => {
      history.splice(historyIndex + 1);
      history.push(entry);
      historyIndex += 1;
      syncBackgroundOrigin();
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
    const reservationSignInTitle = m.accountSignInReservationTitle(
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
      const accountBackgroundMounted =
        !privatePage && accountLoaded && backgroundOrigin === "account";
      const modalOpen = mode === "modal" || mode === "access-modal";
      if (query === "dialog")
        return (scope === "page" || scope === "dialog") && modalOpen ? 1 : 0;
      if (query === "main")
        return (scope === "page" || scope === "main") &&
          (mode === "status" || accountBackgroundMounted)
          ? 1
          : 0;
      if (query === "close") return scope === "dialog" && modalOpen ? 1 : 0;
      if (query === "account")
        return scope === "page" && accountBackgroundMounted ? 1 : 0;
      if (query === "account-access")
        return scope === "page" && accountBackgroundMounted ? 1 : 0;
      if (query === "history-link") {
        if (scope === "dialog" && mode === "access-modal") return 1;
        return scope === "page" &&
          ((accountBackgroundMounted && mode === "account") ||
            mode === "access-unavailable")
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
      if (query === "status-access") {
        if (mode === "modal") {
          if (scope === "dialog")
            return options.missingActiveStatusAccessLink ? 0 : 1;
          return scope === "page" ? 1 : 0;
        }
        return mode === "status" && (scope === "main" || scope === "page")
          ? 1
          : 0;
      }
      if (query === "access-status") {
        if (mode === "access-modal") return scope === "dialog" ? 1 : 0;
        return mode === "access-unavailable" &&
          (scope === "main" || scope === "page")
          ? 1
          : 0;
      }
      if (query === "access-code")
        return scope === "page" && options.leakedAccessCode && mode === "modal"
          ? 1
          : 0;
      if (query === "access")
        return (scope === "page" || scope === "dialog") &&
          (mode === "access-invalid" ||
            mode === "access-unavailable" ||
            mode === "access-modal")
          ? 1
          : 0;
      if (query === "not-found-heading")
        return scope === "page" && mode === "not-found" ? 1 : 0;
      if (query === "sign-in-heading")
        return scope === "page" && mode === "sign-in" ? 1 : 0;
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
            const presentation =
              current().mode === "account" ||
              (current().mode === "access-modal" &&
                current().backgroundOrigin === "account")
                ? "modal"
                : (options.accessReturnPresentation ?? "page");
            push({
              backgroundOrigin:
                current().mode === "account" ||
                (current().mode === "access-modal" &&
                  current().backgroundOrigin === "account")
                  ? "account"
                  : "standalone",
              mode: presentation === "modal" ? "modal" : "status",
              url: urls.statusUrl,
            });
            return;
          }
          if (query === "account-access") {
            push({
              backgroundOrigin: "account",
              mode: "access-modal",
              url: urls.accessUrl,
            });
            return;
          }
          if (query === "status-access") {
            push({
              backgroundOrigin:
                current().mode === "modal" &&
                current().backgroundOrigin === "account"
                  ? "account"
                  : "standalone",
              mode:
                current().mode === "modal" &&
                current().backgroundOrigin === "account"
                  ? "access-modal"
                  : "access-unavailable",
              url: urls.accessUrl,
            });
            return;
          }
          if (query === "access-status") {
            const accountModal =
              current().mode === "access-modal" &&
              current().backgroundOrigin === "account";
            const presentation = accountModal
              ? "modal"
              : (options.accessReturnPresentation ?? "page");
            push({
              backgroundOrigin: accountModal ? "account" : "standalone",
              mode: presentation === "modal" ? "modal" : "status",
              url: urls.statusUrl,
            });
            return;
          }
          if (query === "close") {
            historyIndex -= 1;
            syncBackgroundOrigin();
            return;
          }
        }),
      count: async () => countFor(scope, query),
      getByRole: (role, roleOptions) => {
        if (role === "dialog") return makeLocator("dialog", "dialog");
        if (role === "main") return makeLocator("main", "main");
        if (role === "link") {
          const name = nameFromOptions(roleOptions);
          if (name === "Access instructions") {
            return makeLocator(
              scope,
              scope === "dialog" ? "status-access" : "account-access"
            );
          }
          if (name === "Reservation details") {
            return makeLocator(
              scope,
              scope === "dialog" ? "access-status" : "history-link"
            );
          }
        }
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
          else if (name === reservationSignInTitle)
            headingQuery = "sign-in-heading";
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
          return makeLocator(scope, "status-access");
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
          historyIndex -= 1;
          syncBackgroundOrigin();
        }),
      goForward: () =>
        runNavigationOperation(async () => {
          historyIndex += 1;
          syncBackgroundOrigin();
        }),
      goto: (url: string) =>
        runNavigationOperation(async () => {
          if (!privatePage && url === urls.accountUrl && !accountLoaded)
            failFor("history-load");
          if (privatePage && url === urls.statusUrl)
            failFor("anonymous-status-load");
          if (privatePage && url === urls.accessUrl)
            failFor("anonymous-access-load");
          if (url === urls.accountUrl) accountLoaded = true;
          // A signed-out status visit streams a redirect to sign-in.
          if (privatePage && url === urls.statusUrl) {
            push({
              backgroundOrigin: "standalone",
              mode: "sign-in",
              url: new URL(
                `/en-US/auth/sign-in?${new URLSearchParams({
                  returnTo: urls.statusPath,
                  for: "reservation",
                })}`,
                url
              ).toString(),
            });
            return { status: () => 200 };
          }
          push({
            backgroundOrigin:
              url === urls.accountUrl ? "account" : "standalone",
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
          const url = current().url;
          history[historyIndex] = {
            backgroundOrigin:
              url === urls.accountUrl ? "account" : "standalone",
            mode:
              privatePage && url === urls.accessUrl
                ? "access-invalid"
                : modeForUrl(url),
            url,
          };
          syncBackgroundOrigin();
        }),
      url: () => current().url,
      waitForFunction: (...args: readonly unknown[]) =>
        runNavigationOperation(async () => {
          const statusPath = args[1];
          if (statusPath === urls.statusPath)
            failFor(
              historyIndex === 1 && current().mode === "account"
                ? "history-open-hydration"
                : "history-reopen-hydration"
            );
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
    browser,
    page,
    reservationId,
    urls,
    waitForNavigationOperations: async () => {
      await Promise.all(navigationOperations);
    },
  };
};

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
