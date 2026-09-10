import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  mock,
  test,
} from "bun:test";
import { cleanup, render } from "@testing-library/react";
import { Schema } from "effect";
import {
  isValidElement,
  type ReactElement,
  type ReactNode,
  Suspense,
} from "react";
import {
  registerWorkspaceComponentTestEnv,
  unregisterWorkspaceComponentTestEnv,
} from "@/shared/testing/workspace-component-test-env";
import type { SearchParamsRecord } from "@/shared/utils";

mock.module("server-only", () => ({}));
mock.module("next/headers", () => ({
  cookies: () => Promise.resolve({}),
}));
mock.module("next/navigation", () => ({
  notFound: () => {
    throw new Error("notFound");
  },
}));
mock.module("next/root-params", () => ({
  locale: () => Promise.resolve("en-US"),
}));
mock.module("next/server", () => ({ connection: () => Promise.resolve() }));
mock.module("@/features/i18n", () => ({ locales: ["en-US"], m: {} }));
mock.module("@/features/i18n/server/request-locale", () => ({
  runWithRequestLocale: (resolve: (locale: "en-US") => unknown) =>
    resolve("en-US"),
}));
mock.module("@/features/checkout/backend/checkout", () => ({
  CheckoutStatusService: { Live: undefined },
  loadCheckoutStatusPage: () => undefined,
}));
mock.module("@/features/checkout/checkout-status-refresh-policy", () => ({
  shouldAutoRefreshCheckoutStatus: () => false,
}));
mock.module("@/features/checkout/components/checkout-flow-layout", () => ({
  CheckoutFlowLayout: ({ children }: { readonly children: ReactNode }) => (
    <div data-testid="checkout-flow-layout">{children}</div>
  ),
}));
mock.module("@/features/checkout/components/checkout-payment-window", () => ({
  CheckoutPaymentWindowCoordinator: () => null,
}));
mock.module("@/features/checkout/components/checkout-status-page", () => ({
  CheckoutStatusPage: () => null,
}));
mock.module(
  "@/features/checkout/components/checkout-status-page-skeleton",
  () => ({
    CheckoutStatusPageSkeleton: ({
      presentation = "page",
    }: {
      readonly presentation?: "page" | "modal";
    }) => (
      <output
        data-presentation={presentation}
        data-testid="checkout-status-skeleton"
      />
    ),
  })
);
mock.module("@/features/reservation/backend/reservation-access-cookie", () => ({
  readReservationAccessCookie: () => undefined,
}));
mock.module(
  "@/features/reservation/backend/reservation-authorization.service",
  () => ({ ReservationAuthorizationService: { Live: undefined } })
);
mock.module(
  "@/features/reservation/components/reservation-details-modal",
  () => ({
    ReservationDetailsModal: ({
      children,
    }: {
      readonly children: ReactNode;
    }) => <div data-testid="reservation-details-modal">{children}</div>,
  })
);
mock.module("@/features/reservation/persistence-contracts", () => ({
  workspaceReservationIdSchema: Schema.NonEmptyString,
}));
mock.module("@/features/reservation/routes", () => ({
  reservationStatusPath: "/reservation/status",
}));
mock.module("@/shared/backend/workspace-effect", () => ({
  runWorkspaceEffect: () => () => undefined,
}));
mock.module("@/shared/components/route-auto-refresh", () => ({
  RouteAutoRefresh: () => null,
}));
mock.module("@/shared/utils", () => ({
  getSearchParamsDecoder: () => () => undefined,
  getWorkspaceLocalizedCanonicalUrl: () => "https://deskohub.local",
  workspaceSiteConstants: { brand: { name: "Deskohub" } },
}));

type CheckoutStatusRouteProps = {
  readonly params: Promise<{ orderId: string }>;
  readonly searchParams: Promise<SearchParamsRecord>;
  readonly presentation?: "page" | "modal";
};

type RouteElementProps = {
  readonly children?: ReactNode;
};

type SuspenseBoundaryProps = {
  readonly children?: ReactNode;
  readonly fallback: ReactNode;
};

type CheckoutStatusPageProps = {
  readonly presentation?: "page" | "modal";
};

const isSuspenseBoundary = (
  value: ReactNode
): value is ReactElement<SuspenseBoundaryProps> =>
  isValidElement<SuspenseBoundaryProps>(value) && value.type === Suspense;

const routeInput = {
  params: Promise.resolve({ orderId: "reservation-status-route" }),
  searchParams: Promise.resolve({}),
} satisfies Pick<CheckoutStatusRouteProps, "params" | "searchParams">;

const getSuspenseBoundary = (route: ReactNode) => {
  if (!isValidElement<RouteElementProps>(route)) {
    throw new Error("CheckoutStatusRoute did not return a React element");
  }

  const routeChildren = route.props.children;
  const suspenseBoundary = Array.isArray(routeChildren)
    ? routeChildren.find((child) => isSuspenseBoundary(child))
    : routeChildren;

  if (!isSuspenseBoundary(suspenseBoundary)) {
    throw new Error("CheckoutStatusRoute did not render a Suspense boundary");
  }

  return suspenseBoundary;
};

describe("CheckoutStatusRoute", () => {
  beforeAll(() => registerWorkspaceComponentTestEnv());

  afterEach(() => {
    cleanup();
  });

  afterAll(() => unregisterWorkspaceComponentTestEnv());

  test("keeps the canonical page presentation inside the flow layout by default", async () => {
    const { CheckoutStatusRoute } = await import("./checkout-status-route");
    const { default: LocalizedCheckoutStatusPage } = await import(
      "@/app/[locale]/(minimal-header)/reservation/status/[orderId]/page"
    );
    const canonicalRoute = LocalizedCheckoutStatusPage(routeInput);

    if (!isValidElement<CheckoutStatusRouteProps>(canonicalRoute)) {
      throw new Error("Canonical checkout status page did not return a route");
    }

    expect(canonicalRoute.type).toBe(CheckoutStatusRoute);
    expect(canonicalRoute.props.presentation).toBeUndefined();

    const route = await CheckoutStatusRoute(canonicalRoute.props);
    const suspenseBoundary = getSuspenseBoundary(route);
    const fallbackView = render(suspenseBoundary.props.fallback);

    expect(fallbackView.getByTestId("checkout-flow-layout")).toBeDefined();
    expect(
      fallbackView
        .getByTestId("checkout-status-skeleton")
        .getAttribute("data-presentation")
    ).toBe("page");
  });

  test("forwards modal presentation and omits the flow layout from its fallback", async () => {
    const { CheckoutStatusRoute } = await import("./checkout-status-route");
    const { default: ReservationStatusModalPage } = await import(
      "@/app/[locale]/@modal/(.)reservation/status/[orderId]/page"
    );
    const modalPage = await ReservationStatusModalPage({
      params: routeInput.params,
    });

    if (!isValidElement<RouteElementProps>(modalPage)) {
      throw new Error(
        "Reservation status modal did not return a React element"
      );
    }

    const modalRoute = modalPage.props.children;
    if (!isValidElement<CheckoutStatusRouteProps>(modalRoute)) {
      throw new Error(
        "Reservation status modal did not render the shared route"
      );
    }

    expect(modalRoute.type).toBe(CheckoutStatusRoute);
    expect(modalRoute.props.presentation).toBe("modal");

    const route = await CheckoutStatusRoute(modalRoute.props);
    const suspenseBoundary = getSuspenseBoundary(route);
    const suspenseChildren = suspenseBoundary.props.children;
    expect(isValidElement(suspenseChildren)).toBe(true);
    if (!isValidElement<CheckoutStatusPageProps>(suspenseChildren)) {
      throw new Error("CheckoutStatusRoute did not render the status page");
    }
    expect(suspenseChildren.props.presentation).toBe("modal");

    const fallbackView = render(suspenseBoundary.props.fallback);

    expect(fallbackView.queryByTestId("checkout-flow-layout")).toBeNull();
    expect(
      fallbackView
        .getByTestId("checkout-status-skeleton")
        .getAttribute("data-presentation")
    ).toBe("modal");
  });
});
