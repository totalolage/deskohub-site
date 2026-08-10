import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  mock,
  test,
} from "bun:test";
import { cleanup, render, within } from "@testing-library/react";
import type {
  AdministrationReservationListInput,
  AdministrationReservationPage,
} from "@/features/administration/administration.service";
import {
  registerWorkspaceComponentTestEnv,
  unregisterWorkspaceComponentTestEnv,
} from "@/shared/testing/workspace-component-test-env";

mock.module("server-only", () => ({}));

type LoadedReservationPage = {
  readonly input: AdministrationReservationListInput;
  readonly result: AdministrationReservationPage & {
    readonly dateFilterUnavailable: boolean;
  };
};

const defaultReservationPage: LoadedReservationPage = {
  input: {},
  result: {
    items: [],
    page: 1,
    pageCount: 1,
    total: 115,
    dateFilterUnavailable: false,
  },
};

let reservationPage: LoadedReservationPage = defaultReservationPage;

mock.module("@/features/administration/page-data.server", () => ({
  loadAdministrationReservations: () => Promise.resolve(reservationPage),
}));

mock.module("@/features/administration/reservation-lookup", () => ({
  ReservationLookup: () => null,
}));

describe("ReservationsAdministrationPage", () => {
  beforeAll(() => registerWorkspaceComponentTestEnv());
  afterEach(() => {
    cleanup();
    reservationPage = defaultReservationPage;
  });
  afterAll(() => {
    unregisterWorkspaceComponentTestEnv();
  });

  test("shows the reservation count as a compact accessible badge", async () => {
    const { default: ReservationsAdministrationPage } = await import("./page");
    const view = render(
      await ReservationsAdministrationPage({
        searchParams: Promise.resolve({}),
      })
    );

    expect(view.getByLabelText("115 reservations").textContent).toBe("115");
    expect(view.queryByText("115 reservations")).toBeNull();
  });

  test("preserves server sorting while moving across reservation pages", async () => {
    reservationPage = {
      input: { direction: "asc", sort: "reservation" },
      result: {
        items: [
          {
            id: "reservation-on-page-two",
            customerId: "customer-one",
            customer: null,
            liveDetailsAvailable: false,
            startsAt: null,
            endsAt: null,
            date: null,
            type: "cowork",
            typeLabel: "Cowork Basic",
            status: { group: "in_progress", label: "Awaiting payment" },
            statusNote: null,
            createdAt: "2026-08-10T08:00:00Z",
            latestPayment: null,
            updatedAt: "2026-08-10T08:00:00Z",
          },
        ],
        page: 2,
        pageCount: 3,
        total: 49,
        dateFilterUnavailable: false,
      },
    };
    const { default: ReservationsAdministrationPage } = await import("./page");
    const view = render(
      await ReservationsAdministrationPage({
        searchParams: Promise.resolve({
          direction: "asc",
          page: "2",
          sort: "reservation",
        }),
      })
    );

    const table = view.getByRole("table", { name: "Reservations" });
    expect(
      within(table)
        .getByRole("link", { name: "Reservation" })
        .closest("th")
        ?.getAttribute("aria-sort")
    ).toBe("ascending");
    expect(
      view.getByRole("link", { name: "Previous" }).getAttribute("href")
    ).toBe("/admin/reservations?direction=asc&sort=reservation");
    expect(view.getByRole("link", { name: "Next" }).getAttribute("href")).toBe(
      "/admin/reservations?direction=asc&sort=reservation&page=3"
    );
  });
});
