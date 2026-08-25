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
import type { AdministrationCustomerActivity } from "@/features/administration/administration.service";
import {
  registerWorkspaceComponentTestEnv,
  unregisterWorkspaceComponentTestEnv,
} from "@/shared/testing/workspace-component-test-env";

mock.module("server-only", () => ({}));

const activity: AdministrationCustomerActivity = {
  reservations: Array.from({ length: 24 }, (_, index) => ({
    id: `reservation-${index}`,
    customerId: "customer-one",
    customer: null,
    liveDetailsAvailable: false,
    startsAt: null,
    endsAt: null,
    date: null,
    type: "cowork" as const,
    typeLabel: "Cowork Basic",
    purpose: null,
    status: { group: "in_progress" as const, label: "Awaiting payment" },
    statusNote: null,
    createdAt: "2026-08-10T08:00:00Z",
    latestPayment: null,
    updatedAt: "2026-08-10T08:00:00Z",
  })),
  reservationHistoryTruncated: true,
  transactions: [],
  transactionHistoryTruncated: false,
  stats: {
    reservationCount: 25,
    favoriteProduct: "Cowork Basic",
    revenue: [],
    discountSavings: [],
  },
  marketingConsent: null,
};

mock.module("@/features/administration/page-data.server", () => ({
  loadAdministrationCustomerActivity: () => Promise.resolve(activity),
  loadAdministrationCustomerReservationActivity: () =>
    Promise.resolve({
      from: "2025-08-25",
      to: "2026-08-24",
      dates: [],
    }),
}));

mock.module("@/features/discounts/admin/page-data.server", () => ({
  loadOptionalDiscountAdminCustomerPageData: () =>
    Promise.resolve({ notice: undefined, profile: null }),
}));

mock.module("@/features/discounts/admin/customer-admin-components", () => ({
  CustomerAdministrationDetailPage: () => null,
}));

describe("DiscountCustomerAdminDetailPage", () => {
  beforeAll(() => registerWorkspaceComponentTestEnv());
  afterEach(cleanup);
  afterAll(() => unregisterWorkspaceComponentTestEnv());

  test("links to all reservations when the unavailable profile fallback is truncated", async () => {
    const { DiscountCustomerAdminDetail } = await import("./page");
    const view = render(
      await DiscountCustomerAdminDetail({
        params: Promise.resolve({ customerId: "customer-one" }),
        searchParams: Promise.resolve({}),
      })
    );

    expect(
      view.getByText("Showing the 24 most recently updated reservations.")
    ).toBeDefined();
    expect(
      view
        .getByRole("link", { name: "View all reservations" })
        .getAttribute("href")
    ).toBe("/admin/reservations?customerId=customer-one");
  });
});
