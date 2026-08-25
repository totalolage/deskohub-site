import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  mock,
  test,
} from "bun:test";
import { cleanup, render, within } from "@testing-library/react";
import {
  registerWorkspaceComponentTestEnv,
  unregisterWorkspaceComponentTestEnv,
} from "@/shared/testing/workspace-component-test-env";

mock.module("server-only", () => ({}));
mock.module("next/server", () => ({ connection: () => Promise.resolve() }));

const makeCustomer = (id: string, displayName: string) => ({
  customer: { id, displayName, email: null, phone: null },
  customerId: id,
});

const makeOverview = () => ({
  ranges: {
    today: { from: "2026-08-11", to: "2026-08-11" },
    upcoming: { from: "2026-08-12", to: "2026-09-10" },
    lastSevenDays: { from: "2026-08-05", to: "2026-08-11" },
  },
  today: { completed: 1, unavailable: false, value: 2 },
  upcoming: { completed: 2, unavailable: false, value: 3 },
  lastSevenDays: { completed: 3, unavailable: false, value: 4 },
  uniqueCustomers: {
    customers: [
      makeCustomer("customer-alex", "Alex Morgan"),
      makeCustomer("customer-jordan", "Jordan Lee"),
      makeCustomer("customer-sam", "Sam Taylor"),
    ],
    unavailable: false,
    value: 4,
  },
  newCustomers: {
    customers: [
      makeCustomer("customer-riley", "Riley Chen"),
      makeCustomer("customer-casey", "Casey Smith"),
      makeCustomer("customer-drew", "Drew Jones"),
    ],
    unavailable: false,
    value: 3,
  },
});

let overview = makeOverview();

mock.module("@/features/administration/page-data.server", () => ({
  loadAdministrationOverview: () => Promise.resolve(overview),
}));

mock.module("@/features/administration/reservation-lookup", () => ({
  ReservationLookup: () => null,
}));

mock.module("@/features/discounts/admin/customer-admin-client", () => ({
  CustomerSearch: () => null,
}));

describe("AdminPage", () => {
  const originalNow = Temporal.Now.instant;

  beforeAll(() => registerWorkspaceComponentTestEnv());
  beforeEach(() => {
    Temporal.Now.instant = () => Temporal.Instant.from("2026-08-12T10:00:00Z");
  });
  afterEach(() => {
    cleanup();
    Temporal.Now.instant = originalNow;
    overview = makeOverview();
  });
  afterAll(() => unregisterWorkspaceComponentTestEnv());

  test("links reservation activity to its inclusive start-date range", async () => {
    const { ReservationActivity } = await import(
      "@/features/administration/overview-activity"
    );
    const view = render(
      await ReservationActivity({ overview: Promise.resolve(overview) })
    );

    expect(view.getByRole("link", { name: /Today/ }).getAttribute("href")).toBe(
      "/admin/reservations?from=2026-08-11&to=2026-08-11"
    );
    expect(
      view.getByRole("link", { name: /Upcoming/ }).getAttribute("href")
    ).toBe("/admin/reservations?from=2026-08-12&to=2026-09-10");
    expect(
      view.getByRole("link", { name: /Last 7 days/ }).getAttribute("href")
    ).toBe("/admin/reservations?from=2026-08-05&to=2026-08-11");
  });

  test("emphasizes completed reservations before the total", async () => {
    const { ReservationActivity } = await import(
      "@/features/administration/overview-activity"
    );
    const view = render(
      await ReservationActivity({ overview: Promise.resolve(overview) })
    );
    const today = view.getByText("1 completed out of 2 total reservations");

    expect(today.className).toContain("sr-only");
    expect(view.getByText("1").className).toContain("text-aquamarine-ink");
    expect(view.getByText("/ 2").className).toContain("text-navy-blue/58");
  });

  test("keeps an unavailable reservation activity range linked", async () => {
    overview = {
      ...overview,
      upcoming: { completed: 0, unavailable: true, value: 0 },
    };
    const { ReservationActivity } = await import(
      "@/features/administration/overview-activity"
    );
    const view = render(
      await ReservationActivity({ overview: Promise.resolve(overview) })
    );

    expect(
      view.getByRole("link", { name: /Upcoming/ }).getAttribute("href")
    ).toBe("/admin/reservations?from=2026-08-12&to=2026-09-10");
    expect(view.getByText("Live booking dates unavailable")).toBeDefined();
  });

  test("lists three customers or two followed by the remaining count", async () => {
    const { CustomerActivity } = await import(
      "@/features/administration/overview-activity"
    );
    const view = render(
      await CustomerActivity({ overview: Promise.resolve(overview) })
    );
    const uniqueCard = view.getByText("Unique customers").closest("div");
    const newCard = view.getByText("New customers").closest("div");

    expect(uniqueCard).not.toBeNull();
    expect(newCard).not.toBeNull();
    if (!(uniqueCard && newCard)) return;

    expect(within(uniqueCard).getByText("Alex Morgan")).toBeDefined();
    expect(within(uniqueCard).getByText("Jordan Lee")).toBeDefined();
    expect(within(uniqueCard).queryByText("Sam Taylor")).toBeNull();
    expect(within(uniqueCard).getByText("… and 2 more")).toBeDefined();
    expect(
      within(uniqueCard)
        .getByRole("link", { name: "Alex Morgan" })
        .getAttribute("href")
    ).toBe("/admin/customers/customer-alex");

    expect(within(newCard).getByText("Riley Chen")).toBeDefined();
    expect(within(newCard).getByText("Casey Smith")).toBeDefined();
    expect(within(newCard).getByText("Drew Jones")).toBeDefined();
    expect(within(newCard).queryByText(/more/)).toBeNull();
  });

  test("shows unavailable customer metrics without a substitute count", async () => {
    overview = {
      ...overview,
      uniqueCustomers: {
        customers: [],
        unavailable: true,
        value: 0,
      },
    };
    const { CustomerActivity } = await import(
      "@/features/administration/overview-activity"
    );
    const view = render(
      await CustomerActivity({ overview: Promise.resolve(overview) })
    );

    expect(view.getByText("Unique customer count unavailable")).toBeDefined();
    expect(view.getByText("Live booking dates unavailable")).toBeDefined();
  });
});
