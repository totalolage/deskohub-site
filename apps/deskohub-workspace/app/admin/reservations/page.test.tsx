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
mock.module("next/server", () => ({ connection: () => Promise.resolve() }));

type LoadedReservationPage = {
  readonly input: AdministrationReservationListInput;
  readonly result: AdministrationReservationPage & {
    readonly dateFilterUnavailable: boolean;
    readonly dateSortUnavailable: boolean;
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
    dateSortUnavailable: false,
  },
};

let reservationPage: LoadedReservationPage = defaultReservationPage;

mock.module("@/features/administration/page-data.server", () => ({
  loadAdministrationReservations: () => Promise.resolve(reservationPage),
  loadAdministrationReservationsPage: () => ({
    input: Promise.resolve(reservationPage.input),
    result: Promise.resolve(reservationPage.result),
  }),
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
    const { ReservationsAdministrationContent } = await import("./page");
    const view = render(
      await ReservationsAdministrationContent({
        searchParams: Promise.resolve({}),
      })
    );

    expect(view.getByLabelText("115 reservations").textContent).toBe("115");
    expect(
      view.getByRole("combobox", { name: "Deskohub status" })
    ).toBeDefined();
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
        dateSortUnavailable: false,
      },
    };
    const { ReservationsAdministrationContent } = await import("./page");
    const view = render(
      await ReservationsAdministrationContent({
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

  test("preserves other filters when clearing the customer", async () => {
    reservationPage = {
      input: {
        customerId: "customer-one",
        direction: "asc",
        from: "2026-08-04",
        sort: "status",
        status: "complete",
        to: "2026-08-10",
        type: "cowork",
      },
      result: defaultReservationPage.result,
    };
    const { ReservationsAdministrationContent } = await import("./page");
    const view = render(
      await ReservationsAdministrationContent({
        searchParams: Promise.resolve({
          customerId: "customer-one",
          direction: "asc",
          from: "2026-08-04",
          sort: "status",
          status: "complete",
          to: "2026-08-10",
          type: "cowork",
        }),
      })
    );

    expect(
      view.getByRole("link", { name: "Clear customer" }).getAttribute("href")
    ).toBe(
      "/admin/reservations?direction=asc&from=2026-08-04&sort=status&status=complete&to=2026-08-10&type=cowork"
    );
  });

  test("shows the selected inclusive start-date range", async () => {
    reservationPage = {
      input: {
        direction: "asc",
        from: "2026-08-04",
        sort: "date",
        to: "2026-08-10",
      },
      result: {
        ...defaultReservationPage.result,
        page: 2,
        pageCount: 3,
      },
    };
    const { ReservationsAdministrationContent } = await import("./page");
    const view = render(
      await ReservationsAdministrationContent({
        searchParams: Promise.resolve({
          direction: "asc",
          from: "2026-08-04",
          sort: "date",
          to: "2026-08-10",
        }),
      })
    );

    expect(view.getByLabelText("Start date from").getAttribute("value")).toBe(
      "2026-08-04"
    );
    expect(view.getByLabelText("Start date to").getAttribute("value")).toBe(
      "2026-08-10"
    );
    expect(view.getByRole("link", { name: "Next" }).getAttribute("href")).toBe(
      "/admin/reservations?direction=asc&from=2026-08-04&sort=date&to=2026-08-10&page=3"
    );
  });

  test("places date shortcuts before right-aligned clear and apply actions", async () => {
    const originalNow = Temporal.Now.instant;
    Temporal.Now.instant = () => Temporal.Instant.from("2026-08-12T10:00:00Z");
    reservationPage = {
      input: {
        direction: "asc",
        from: "2026-08-04",
        sort: "date",
        status: "complete",
        to: "2026-08-10",
        type: "cowork",
      },
      result: defaultReservationPage.result,
    };

    try {
      const { ReservationsAdministrationContent } = await import("./page");
      const view = render(
        await ReservationsAdministrationContent({
          searchParams: Promise.resolve({}),
        })
      );
      const shortcuts = view.getByRole("navigation", {
        name: "Reservation date shortcuts",
      });
      const shortcutLinks = within(shortcuts).getAllByRole("link");

      expect(shortcutLinks.map((link) => link.textContent)).toEqual([
        "Today",
        "Upcoming",
        "Past",
      ]);
      expect(shortcutLinks.map((link) => link.getAttribute("href"))).toEqual([
        "/admin/reservations?direction=asc&from=2026-08-12&sort=date&status=complete&to=2026-08-12&type=cowork",
        "/admin/reservations?direction=asc&from=2026-08-13&sort=date&status=complete&type=cowork",
        "/admin/reservations?direction=asc&sort=date&status=complete&to=2026-08-11&type=cowork",
      ]);

      const actions = view.getByRole("group", { name: "Filter actions" });
      expect(actions.className).toContain("justify-end");
      expect(actions.textContent).toBe("ClearApply filters");
    } finally {
      Temporal.Now.instant = originalNow;
    }
  });

  test("explains the fallback when provider date sorting is unavailable", async () => {
    reservationPage = {
      input: { direction: "asc", sort: "date" },
      result: {
        ...defaultReservationPage.result,
        dateSortUnavailable: true,
      },
    };
    const { ReservationsAdministrationContent } = await import("./page");
    const view = render(
      await ReservationsAdministrationContent({
        searchParams: Promise.resolve({ direction: "asc", sort: "date" }),
      })
    );

    expect(
      view.getByText(
        "Reservation dates are temporarily unavailable for sorting. Showing newest records instead."
      )
    ).toBeDefined();
  });
});
