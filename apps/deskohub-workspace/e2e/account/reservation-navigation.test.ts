import { expect, mock, test } from "bun:test";
import { Effect } from "effect";
import {
  type CheckoutStatusViewModel,
  loadCheckoutStatusPage,
} from "@/features/checkout/backend/checkout";
import { m } from "@/features/i18n";
import { workspaceReservationIdSchema } from "@/features/reservation/persistence-contracts";

type FakeLocator = {
  readonly click: () => Promise<void>;
  readonly count: () => Promise<number>;
  readonly getByRole: (role: string, options?: unknown) => FakeLocator;
};

const fakePlaywrightExpect = (locator: FakeLocator) => ({
  toBeVisible: async () => expect(await locator.count()).toBeGreaterThan(0),
  toHaveCount: async (count: number) =>
    expect(await locator.count()).toBe(count),
});

mock.module("@playwright/test", () => ({ expect: fakePlaywrightExpect }));

const {
  expectWorkspaceE2EReservationNotFound,
  makeWorkspaceE2EReservationHistoryUrls,
  verifyWorkspaceE2EReservationHistoryNavigation,
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

const makeNavigationHarness = () => {
  const reservationId = workspaceReservationIdSchema.make(
    "account-history-reservation"
  );
  const urls = makeWorkspaceE2EReservationHistoryUrls(
    "https://workspace.example.test",
    reservationId
  );
  const actions: string[] = [];
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
    const makeLocator = (kind: string): FakeLocator => ({
      click: async () => {
        if (kind === "history-link") {
          record(
            current().mode === "account" ? "click:history" : "click:status"
          );
          push({ mode: "modal", url: urls.statusUrl });
          return;
        }
        if (kind === "close") {
          record("click:close");
          historyIndex -= 1;
          record("back");
          return;
        }
        if (kind === "access-link") {
          record("click:access");
          push({ mode: "access-unavailable", url: urls.accessUrl });
        }
      },
      count: async () => {
        const mode = current().mode;
        if (kind === "history-link")
          return accountLoaded &&
            (mode === "account" || mode === "access-unavailable")
            ? 1
            : 0;
        if (kind === "dialog") return mode === "modal" ? 1 : 0;
        if (kind === "close") return mode === "modal" ? 1 : 0;
        if (kind === "status-heading")
          return mode === "status" || mode === "modal" || mode === "not-found"
            ? 1
            : 0;
        if (kind === "invalid-heading")
          return mode === "access-invalid" ? 1 : 0;
        if (kind === "unavailable-heading")
          return mode === "access-unavailable" ? 1 : 0;
        if (kind === "access")
          return mode === "access-invalid" || mode === "access-unavailable"
            ? 1
            : 0;
        if (kind === "access-code") return 0;
        if (kind === "reservation-id")
          return mode === "status" || mode === "modal" ? 1 : 0;
        if (kind === "status-access" || kind === "access-link")
          return mode === "status" || mode === "modal" ? 1 : 0;
        return 0;
      },
      getByRole: (role, options) => {
        if (role === "button") return makeLocator("close");
        if (role === "dialog") return makeLocator("dialog");
        if (role === "heading") {
          const name =
            typeof options === "object" && options !== null && "name" in options
              ? String((options as { readonly name?: unknown }).name)
              : "";
          if (name.includes("reservation access link"))
            return makeLocator("invalid-heading");
          if (name.includes("unavailable"))
            return makeLocator("unavailable-heading");
          return makeLocator("status-heading");
        }
        return makeLocator("none");
      },
    });
    const page = {
      getByRole: (role: string, options?: unknown) =>
        makeLocator("none").getByRole(role, options),
      getByText: () => makeLocator("reservation-id"),
      goBack: async () => {
        record("back");
        historyIndex -= 1;
      },
      goForward: async () => {
        record("forward");
        historyIndex += 1;
      },
      goto: async (url: string) => {
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
      },
      locator: (selector: string) => {
        if (selector === "[data-reservation-access]")
          return makeLocator("access");
        if (selector === "[data-reservation-access-code]")
          return makeLocator("access-code");
        if (selector === "#checkout-status-access")
          return makeLocator("access-link");
        if (selector.startsWith('a[href="')) {
          return makeLocator(
            selector.includes(urls.statusPath) ? "history-link" : "none"
          );
        }
        return makeLocator("none");
      },
      reload: async () => {
        record("reload");
        history[historyIndex] = { mode: "status", url: urls.statusUrl };
      },
      url: () => current().url,
      waitForURL: async () => undefined,
    };
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

  return { actions, browser, page, reservationId, urls };
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
    "click:history",
    "click:close",
    "back",
    `goto:${harness.urls.statusUrl}`,
    `goto:${harness.urls.accountUrl}`,
    "click:history",
    "back",
    "forward",
    "reload",
    "click:access",
    "click:status",
    `goto:${harness.urls.accountUrl}`,
  ]);
  expect(harness.page.url()).toBe(harness.urls.accountUrl);
});
