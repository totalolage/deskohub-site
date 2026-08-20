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
import { cleanup, render } from "@testing-library/react";
import {
  registerWorkspaceComponentTestEnv,
  unregisterWorkspaceComponentTestEnv,
} from "@/shared/testing/workspace-component-test-env";

mock.module("server-only", () => ({}));
mock.module("next/server", () => ({ connection: () => Promise.resolve() }));

let overview = {
  ranges: {
    today: { from: "2026-08-11", to: "2026-08-11" },
    upcoming: { from: "2026-08-12", to: "2026-09-10" },
    lastSevenDays: { from: "2026-08-05", to: "2026-08-11" },
  },
  today: { unavailable: false, value: 1 },
  upcoming: { unavailable: false, value: 2 },
  lastSevenDays: { unavailable: false, value: 3 },
};

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
    overview = {
      ranges: {
        today: { from: "2026-08-11", to: "2026-08-11" },
        upcoming: { from: "2026-08-12", to: "2026-09-10" },
        lastSevenDays: { from: "2026-08-05", to: "2026-08-11" },
      },
      today: { unavailable: false, value: 1 },
      upcoming: { unavailable: false, value: 2 },
      lastSevenDays: { unavailable: false, value: 3 },
    };
  });
  afterAll(() => unregisterWorkspaceComponentTestEnv());

  test("links reservation activity to its inclusive start-date range", async () => {
    const { ReservationActivity } = await import("./page");
    const view = render(await ReservationActivity());

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

  test("keeps an unavailable reservation activity range linked", async () => {
    overview = {
      ...overview,
      upcoming: { unavailable: true, value: 0 },
    };
    const { ReservationActivity } = await import("./page");
    const view = render(await ReservationActivity());

    expect(
      view.getByRole("link", { name: /Upcoming/ }).getAttribute("href")
    ).toBe("/admin/reservations?from=2026-08-12&to=2026-09-10");
    expect(view.getByText("Live booking dates unavailable")).toBeDefined();
  });
});
