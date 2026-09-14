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

mock.module("next/headers", () => ({
  cookies: () => Promise.resolve({}),
}));
mock.module("next/navigation", () => ({
  notFound: () => {
    throw new Error("notFound");
  },
}));
mock.module("next/server", () => ({ connection: () => Promise.resolve() }));
mock.module("@/features/i18n", () => ({
  locales: ["en-US"],
  m: {
    reservationAccessMetadataTitle: () => "Reservation access",
  },
}));
mock.module("@/features/i18n/server/request-locale", () => ({
  runWithRequestLocale: (resolve: (locale: "en-US") => unknown) =>
    resolve("en-US"),
}));
mock.module(
  "@/features/checkout/components/checkout-flow-page-skeleton",
  () => ({
    CheckoutFlowPageSkeleton: ({ label }: { readonly label: string }) => (
      <div data-testid="checkout-flow-layout">
        <output
          data-testid="reservation-access-page-skeleton"
          aria-label={label}
        />
      </div>
    ),
  })
);
mock.module(
  "@/features/reservation/backend/reservation-access.service",
  () => ({
    ReservationAccessService: { Live: undefined },
  })
);
mock.module("@/features/reservation/backend/reservation-access-cookie", () => ({
  readReservationAccessCookie: () => undefined,
}));
mock.module(
  "@/features/reservation/components/reservation-access-page",
  () => ({
    ReservationAccessPage: ({
      presentation = "page",
    }: {
      readonly presentation?: "page" | "modal";
    }) => (
      <div
        data-presentation={presentation}
        data-testid="reservation-access-page"
      />
    ),
  })
);
mock.module("@/features/reservation/persistence-contracts", () => ({
  workspaceReservationIdSchema: Schema.NonEmptyString,
}));
mock.module("@/features/reservation/routes", () => ({
  reservationAccessPath: "/reservation/access",
}));
mock.module("@/shared/backend/workspace-effect", () => ({
  runWorkspaceEffect: () => () => undefined,
}));
mock.module("@/shared/components/ui/skeleton", () => ({
  Skeleton: ({ className }: { readonly className?: string }) => (
    <div
      className={className}
      data-testid="reservation-access-modal-skeleton"
    />
  ),
}));
mock.module("@/shared/utils", () => ({
  getWorkspaceLocalizedCanonicalUrl: () => "https://deskohub.local",
  workspaceSiteConstants: { brand: { name: "Deskohub" } },
}));
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

type ReservationAccessRouteProps = {
  readonly params: Promise<{ orderId: string }>;
  readonly presentation?: "page" | "modal";
};

type RouteElementProps = {
  readonly children?: ReactNode;
};

type SuspenseBoundaryProps = {
  readonly children?: ReactNode;
  readonly fallback: ReactNode;
};

const isSuspenseBoundary = (
  value: ReactNode
): value is ReactElement<SuspenseBoundaryProps> =>
  isValidElement<SuspenseBoundaryProps>(value) && value.type === Suspense;

const routeInput = {
  params: Promise.resolve({ orderId: "reservation-access-route" }),
} satisfies Pick<ReservationAccessRouteProps, "params">;

const getSuspenseBoundary = (route: ReactNode) => {
  if (!isValidElement<RouteElementProps>(route)) {
    throw new Error("ReservationAccessRoute did not return a React element");
  }

  if (isSuspenseBoundary(route)) return route;

  const routeChildren = route.props.children;
  const suspenseBoundary = Array.isArray(routeChildren)
    ? routeChildren.find((child) => isSuspenseBoundary(child))
    : routeChildren;

  if (!isSuspenseBoundary(suspenseBoundary)) {
    throw new Error(
      "ReservationAccessRoute did not render a Suspense boundary"
    );
  }

  return suspenseBoundary;
};

describe("ReservationAccessRoute", () => {
  beforeAll(() => registerWorkspaceComponentTestEnv());

  afterEach(() => {
    cleanup();
  });

  afterAll(() => unregisterWorkspaceComponentTestEnv());

  test("keeps the canonical page presentation inside the flow layout by default", async () => {
    const { ReservationAccessRoute } = await import(
      "./reservation-access-route"
    );
    const { default: LocalizedReservationAccessPage } = await import(
      "@/app/[locale]/(minimal-header)/reservation/access/[orderId]/page"
    );
    const canonicalRoute = LocalizedReservationAccessPage(routeInput);

    if (!isValidElement<ReservationAccessRouteProps>(canonicalRoute)) {
      throw new Error(
        "Canonical reservation access page did not return a route"
      );
    }

    expect(canonicalRoute.type).toBe(ReservationAccessRoute);
    expect(canonicalRoute.props.presentation).toBeUndefined();

    const route = await ReservationAccessRoute(canonicalRoute.props);
    const suspenseBoundary = getSuspenseBoundary(route);
    const fallbackView = render(suspenseBoundary.props.fallback);

    expect(fallbackView.getByTestId("checkout-flow-layout")).toBeDefined();
    expect(
      fallbackView.getByTestId("reservation-access-page-skeleton")
    ).toBeDefined();
  });

  test("forwards modal presentation and omits the flow layout from its fallback", async () => {
    const { ReservationAccessRoute } = await import(
      "./reservation-access-route"
    );
    const { default: ReservationAccessModalPage } = await import(
      "@/app/[locale]/(full-header)/account/@modal/(..)reservation/access/[orderId]/page"
    );
    const modalPage = await ReservationAccessModalPage({
      params: routeInput.params,
    });

    if (!isValidElement<RouteElementProps>(modalPage)) {
      throw new Error(
        "Reservation access modal did not return a React element"
      );
    }

    const modalRoute = modalPage.props.children;
    if (!isValidElement<ReservationAccessRouteProps>(modalRoute)) {
      throw new Error(
        "Reservation access modal did not render the shared route"
      );
    }

    expect(modalRoute.type).toBe(ReservationAccessRoute);
    expect(modalRoute.props.presentation).toBe("modal");

    const route = await ReservationAccessRoute(modalRoute.props);
    const suspenseBoundary = getSuspenseBoundary(route);
    const suspenseChildren = suspenseBoundary.props.children;
    expect(isValidElement<ReservationAccessRouteProps>(suspenseChildren)).toBe(
      true
    );
    if (!isValidElement<ReservationAccessRouteProps>(suspenseChildren)) {
      throw new Error("ReservationAccessRoute did not render route content");
    }
    expect(suspenseChildren.props.presentation).toBe("modal");

    const fallbackView = render(suspenseBoundary.props.fallback);

    expect(fallbackView.queryByTestId("checkout-flow-layout")).toBeNull();
    expect(
      fallbackView.getAllByTestId("reservation-access-modal-skeleton").length
    ).toBeGreaterThan(0);
    expect(fallbackView.container.querySelector("output")?.className).toContain(
      "bg-white"
    );
  });
});
