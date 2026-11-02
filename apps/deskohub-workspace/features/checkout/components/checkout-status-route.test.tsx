import "@/shared/polyfills/temporal";

import { afterEach, describe, expect, mock, spyOn, test } from "bun:test";
import { Context, Effect, Layer } from "effect";
import type { ReactNode } from "react";
import { prerender } from "react-dom/static";
import type { CheckoutStatusViewModel } from "@/features/checkout/backend/checkout";
import { getReservationAccessCookieName } from "@/features/reservation/backend/reservation-access-cookie";

mock.module("server-only", () => ({}));
let connections = 0;
const nextServer = await import("next/server");
mock.module("next/server", () => ({
  ...nextServer,
  connection: () => {
    connections += 1;
    return Promise.resolve();
  },
}));
mock.module("next/root-params", () => ({
  locale: () => Promise.resolve("en-US"),
}));

/** What `redirect` throws, carrying where it sends the visitor. */
class RedirectSignal extends Error {
  constructor(readonly location: string) {
    super(`Redirected to ${location}`);
  }
}
/** What `notFound` throws. */
class NotFoundSignal extends Error {}
const navigation = await import("next/navigation");
mock.module("next/navigation", () => ({
  ...navigation,
  notFound: () => {
    throw new NotFoundSignal("Not found");
  },
  redirect: (location: string) => {
    throw new RedirectSignal(location);
  },
}));

const requestHeaders = new Headers({ "user-agent": "status-route-test" });
const readCookieNames: string[] = [];
const cookieStore = {
  get: (name: string) => {
    readCookieNames.push(name);
    return { name, value: "access-cookie-value" };
  },
};
const nextHeaders = await import("next/headers");
mock.module("next/headers", () => ({
  ...nextHeaders,
  cookies: () => Promise.resolve(cookieStore),
  headers: () => Promise.resolve(requestHeaders),
}));

const statusService = { name: "checkout-status" };
const authorizationService = { name: "reservation-authorization" };

const checkoutBackend = await import("@/features/checkout/backend/checkout");
type StatusPageLoadInput = Parameters<
  typeof checkoutBackend.loadCheckoutStatusPage
>[2];

let loadResult: Effect.Effect<CheckoutStatusViewModel, Error>;
const loadCalls: {
  readonly service: typeof statusService;
  readonly authorization: typeof authorizationService;
  readonly input: StatusPageLoadInput;
}[] = [];
class CheckoutStatusService extends Context.Service<
  CheckoutStatusService,
  typeof statusService
>()("CheckoutStatusService") {
  static Live = Layer.succeed(this, statusService);
}
mock.module("@/features/checkout/backend/checkout", () => ({
  ...checkoutBackend,
  CheckoutStatusService,
  loadCheckoutStatusPage: (
    service: typeof statusService,
    authorization: typeof authorizationService,
    input: StatusPageLoadInput
  ) => {
    loadCalls.push({ service, authorization, input });
    return loadResult;
  },
}));

const authorizationModule = await import(
  "@/features/reservation/backend/reservation-authorization.service"
);
class ReservationAuthorizationService extends Context.Service<
  ReservationAuthorizationService,
  typeof authorizationService
>()("ReservationAuthorizationService") {
  static Live = Layer.succeed(this, authorizationService);
}
mock.module(
  "@/features/reservation/backend/reservation-authorization.service",
  () => ({ ...authorizationModule, ReservationAuthorizationService })
);

const contactModule = await import(
  "@/features/account/backend/customer-account-contact.service"
);
class CustomerAccountContactService extends Context.Service<
  CustomerAccountContactService,
  object
>()("CustomerAccountContactService") {
  static Live = Layer.succeed(this, {});
}
mock.module(
  "@/features/account/backend/customer-account-contact.service",
  () => ({ ...contactModule, CustomerAccountContactService })
);

let signedOut = false;
let signedOutReads = 0;
const signIn = await import(
  "@/features/checkout/backend/checkout/checkout-status-sign-in"
);
mock.module(
  "@/features/checkout/backend/checkout/checkout-status-sign-in",
  () => ({
    ...signIn,
    isStatusViewerSignedOut: () =>
      Effect.sync(() => {
        signedOutReads += 1;
        return signedOut;
      }),
  })
);

mock.module("@/features/checkout/components/checkout-status-page", () => ({
  CheckoutStatusPage: ({
    locale,
    presentation,
    status,
  }: {
    readonly locale: string;
    readonly presentation: string;
    readonly status: CheckoutStatusViewModel;
  }) => (
    <article
      data-locale={locale}
      data-order={status.orderId}
      data-presentation={presentation}
      data-status={status.status}
    />
  ),
}));
mock.module("@/shared/components/route-auto-refresh", () => ({
  RouteAutoRefresh: ({ enabled }: { readonly enabled: boolean }) => (
    <meta data-auto-refresh={String(enabled)} />
  ),
}));
const referralSettlement = await import(
  "@/features/checkout/components/checkout-status-referral-code-settlement"
);
mock.module(
  "@/features/checkout/components/checkout-status-referral-code-settlement",
  () => ({
    ...referralSettlement,
    CheckoutStatusReferralCodeSettlement: ({
      status,
    }: {
      readonly status: string;
    }) => <i data-referral-settlement={status} />,
  })
);
const paymentWindow = await import(
  "@/features/checkout/components/checkout-payment-window"
);
mock.module("@/features/checkout/components/checkout-payment-window", () => ({
  ...paymentWindow,
  CheckoutPaymentWindowCoordinator: () => <b data-payment-window="" />,
}));
mock.module(
  "@/features/checkout/components/checkout-status-page-skeleton",
  () => ({
    CheckoutStatusPageSkeleton: ({
      presentation,
    }: {
      readonly presentation: string;
    }) => <div data-skeleton={presentation} />,
  })
);
const flowLayout = await import(
  "@/features/checkout/components/checkout-flow-layout"
);
mock.module("@/features/checkout/components/checkout-flow-layout", () => ({
  ...flowLayout,
  CheckoutFlowLayout: ({
    activeStepKey,
    children,
  }: {
    readonly activeStepKey: string;
    readonly children: ReactNode;
  }) => <main data-flow-step={activeStepKey}>{children}</main>,
}));

const { CheckoutStatusRoute } = await import("./checkout-status-route");
const { getReservationStatusSignInPath } = signIn;

const orderId = "reservation-route";

const statusOf = (
  status: CheckoutStatusViewModel["status"]
): CheckoutStatusViewModel =>
  (status === "not_found"
    ? { orderId, returnOutcome: "unknown", status }
    : {
        kind: "cowork",
        orderId,
        returnOutcome: "success",
        status,
        paymentStatus: "paid",
        fulfillmentStatus: "fulfilled",
      }) as CheckoutStatusViewModel;

const renderRoute = async ({
  order = orderId,
  presentation,
  searchParams = {},
}: {
  readonly order?: string;
  readonly presentation?: "page" | "modal";
  readonly searchParams?: Record<string, string>;
} = {}) => {
  const errors: unknown[] = [];
  const { prelude } = await prerender(
    await CheckoutStatusRoute({
      params: Promise.resolve({ orderId: order }),
      searchParams: Promise.resolve(searchParams),
      ...(presentation && { presentation }),
    }),
    {
      onError: (error) => {
        errors.push(error);
      },
    }
  );
  return { errors, html: await new Response(prelude).text() };
};

describe("CheckoutStatusRoute", () => {
  afterEach(() => {
    loadCalls.length = 0;
    readCookieNames.length = 0;
    connections = 0;
    signedOut = false;
    signedOutReads = 0;
  });

  test("loads the order's status with its access cookie and request headers", async () => {
    loadResult = Effect.succeed(statusOf("pending"));

    const { errors, html } = await renderRoute({
      searchParams: { outcome: "success" },
    });

    expect(errors).toEqual([]);
    expect(connections).toBe(1);
    expect(readCookieNames).toEqual([
      getReservationAccessCookieName(
        orderId as Parameters<typeof getReservationAccessCookieName>[0]
      ),
    ]);
    expect(loadCalls).toEqual([
      {
        service: statusService,
        authorization: authorizationService,
        input: {
          accessCookie: "access-cookie-value",
          locale: "en-US",
          orderId,
          requestHeaders,
          returnOutcome: "success",
        },
      },
    ]);
    expect(html).toContain('data-payment-window=""');
    expect(html).toContain('data-auto-refresh="true"');
    expect(html).toContain('data-referral-settlement="pending"');
    expect(html).toContain(
      `data-locale="en-US" data-order="${orderId}" data-presentation="page" data-status="pending"`
    );
    expect(signedOutReads).toBe(0);
  });

  test.each([
    ["no outcome", {}],
    ["an unknown outcome", { outcome: "refunded" }],
  ])("treats %s as an unknown return", async (_name, searchParams) => {
    loadResult = Effect.succeed(statusOf("fulfilled"));

    const { html } = await renderRoute({ searchParams });

    expect(loadCalls[0]?.input.returnOutcome).toBe("unknown");
    expect(html).toContain('data-auto-refresh="false"');
  });

  test("passes the modal presentation to the status page", async () => {
    loadResult = Effect.succeed(statusOf("fulfilled"));

    const { html } = await renderRoute({ presentation: "modal" });

    expect(html).toContain('data-presentation="modal"');
  });

  test("sends a signed-out visitor of an unknown order to sign in and back", async () => {
    loadResult = Effect.succeed(statusOf("not_found"));
    signedOut = true;

    const { errors, html } = await renderRoute({
      searchParams: { outcome: "cancelled" },
    });

    expect(signedOutReads).toBe(1);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toBeInstanceOf(RedirectSignal);
    expect((errors[0] as RedirectSignal).location).toBe(
      getReservationStatusSignInPath(
        "en-US",
        orderId as Parameters<typeof getReservationStatusSignInPath>[1],
        "cancelled"
      )
    );
    expect(html).not.toContain("data-status=");
  });

  test("shows a signed-in visitor that the order was not found", async () => {
    loadResult = Effect.succeed(statusOf("not_found"));

    const { errors, html } = await renderRoute();

    expect(signedOutReads).toBe(1);
    expect(errors).toEqual([]);
    expect(html).toContain('data-status="not_found"');
  });

  test("answers an invalid order id with not found before loading", async () => {
    const { errors, html } = await renderRoute({ order: "" });

    expect(errors).toHaveLength(1);
    expect(errors[0]).toBeInstanceOf(NotFoundSignal);
    expect(loadCalls).toEqual([]);
    expect(html).toContain('data-flow-step="complete"');
    expect(html).toContain('data-skeleton="page"');
  });

  test("shows the bare skeleton while a modal status can't render", async () => {
    const { html } = await renderRoute({ order: "", presentation: "modal" });

    expect(html).toContain('data-skeleton="modal"');
    expect(html).not.toContain("data-flow-step");
  });

  test("fails the render when the status can't load", async () => {
    loadResult = Effect.fail(new Error("Status database unavailable."));
    const logged = [
      spyOn(console, "error"),
      spyOn(console, "log"),
      spyOn(console, "warn"),
    ];

    const { errors, html } = await renderRoute();

    const failureLogs = logged
      .flatMap((spy) => spy.mock.calls)
      .map((args) => args.map(String).join(" "))
      .filter((line) => line.includes("Checkout status load failed"));
    for (const spy of logged) spy.mockRestore();
    expect(failureLogs).toHaveLength(1);
    expect(failureLogs[0]).toContain("level=Error");
    expect(failureLogs[0]).toContain(orderId);
    expect(failureLogs[0]).toContain("operation=checkout.status.load");

    expect(loadCalls).toHaveLength(1);
    expect(errors).toHaveLength(1);
    expect(html).not.toContain("data-status=");
    expect(signedOutReads).toBe(0);
  });
});
