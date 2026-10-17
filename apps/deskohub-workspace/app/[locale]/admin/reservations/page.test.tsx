import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  mock,
  test,
} from "bun:test";
import { within } from "@testing-library/react";
import { prerender } from "react-dom/static";
import type {
  AdministrationReservationListInput,
  AdministrationReservationPage,
} from "@/features/administration/administration.service";
import { RouteLocaleProvider } from "@/features/i18n/route-locale";
import {
  registerWorkspaceComponentTestEnv,
  unregisterWorkspaceComponentTestEnv,
} from "@/shared/testing/workspace-component-test-env";

mock.module("server-only", () => ({}));
mock.module("next/server", () => ({ connection: () => Promise.resolve() }));
let routeLocale: "cs-CZ" | "en-US" = "en-US";

mock.module("next/root-params", () => ({
  locale: () => Promise.resolve(routeLocale),
}));

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
let reservationPageInput:
  | Promise<AdministrationReservationListInput>
  | undefined;

mock.module("@/features/administration/page-data.server", () => ({
  loadAdministrationRefundAttention: () => Promise.resolve(0),
  loadAdministrationReservationsPage: () => ({
    input: reservationPageInput ?? Promise.resolve(reservationPage.input),
    result: Promise.resolve(reservationPage.result),
  }),
}));

mock.module("@/features/administration/reservation-lookup", () => ({
  ReservationLookup: () => null,
}));

async function prerenderReservationsPage() {
  const { default: ReservationsAdministrationPage } = await import("./page");
  const { prelude } = await prerender(
    <RouteLocaleProvider locale={routeLocale}>
      <ReservationsAdministrationPage searchParams={Promise.resolve({})} />
    </RouteLocaleProvider>,
    // Inline every completed boundary instead of streaming hidden segments.
    { progressiveChunkSize: Number.POSITIVE_INFINITY }
  );
  const container = document.createElement("div");
  container.innerHTML = await new Response(prelude).text();
  return within(container);
}

describe("ReservationsAdministrationPage", () => {
  beforeAll(() => registerWorkspaceComponentTestEnv());
  afterEach(() => {
    reservationPage = defaultReservationPage;
    reservationPageInput = undefined;
    routeLocale = "en-US";
  });
  afterAll(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
    await unregisterWorkspaceComponentTestEnv();
  });

  test("waits for request input before reading the default date", async () => {
    const originalNow = Temporal.Now.instant;
    let nowReadCount = 0;
    Temporal.Now.instant = () => {
      nowReadCount += 1;
      return Temporal.Instant.from("2026-08-12T10:00:00Z");
    };
    let resolveInput!: (input: AdministrationReservationListInput) => void;
    reservationPageInput = new Promise((resolve) => {
      resolveInput = resolve;
    });

    try {
      const rendered = prerenderReservationsPage();
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(nowReadCount).toBe(0);

      resolveInput({});
      await rendered;
    } finally {
      Temporal.Now.instant = originalNow;
    }

    expect(nowReadCount).toBeGreaterThan(0);
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
            product: { kind: "cowork", tier: "basic" },
            typeLabel: "Cowork Basic",
            purpose: null,
            status: {
              group: "in_progress",
              code: "awaiting_payment",
              label: "Awaiting payment",
            },
            statusNote: null,
            statusNoteCode: null,
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
    const view = await prerenderReservationsPage();

    const table = view.getByRole("table", { name: "Reservations" });
    expect(
      within(table)
        .getByRole("link", { name: "Reservation" })
        .closest("th")
        ?.getAttribute("aria-sort")
    ).toBe("ascending");
    expect(
      view.getByRole("link", { name: "Previous" }).getAttribute("href")
    ).toBe("/en-US/admin/reservations?direction=asc&sort=reservation");
    expect(view.getByRole("link", { name: "Next" }).getAttribute("href")).toBe(
      "/en-US/admin/reservations?direction=asc&sort=reservation&page=3"
    );
  });

  test("keeps the selected start-date range across reservation pages", async () => {
    reservationPage = {
      input: {
        direction: "asc",
        from: "2026-08-04",
        sort: "date",
        to: "2026-08-10",
      },
      result: { ...defaultReservationPage.result, page: 2, pageCount: 3 },
    };
    const view = await prerenderReservationsPage();

    expect(view.getByRole("link", { name: "Next" }).getAttribute("href")).toBe(
      "/en-US/admin/reservations?direction=asc&from=2026-08-04&sort=date&to=2026-08-10&page=3"
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
    const view = await prerenderReservationsPage();

    expect(
      view.getByRole("link", { name: "Clear customer" }).getAttribute("href")
    ).toBe(
      "/en-US/admin/reservations?direction=asc&from=2026-08-04&sort=status&status=complete&to=2026-08-10&type=cowork"
    );
  });

  test("renders the reservation list in Czech on a Czech route", async () => {
    routeLocale = "cs-CZ";
    reservationPage = {
      input: { customerId: "customer-one" },
      result: {
        ...defaultReservationPage.result,
        total: 3,
        dateFilterUnavailable: true,
      },
    };
    const view = await prerenderReservationsPage();

    expect(view.getByRole("heading", { level: 1 }).textContent).toBe(
      "Rezervace"
    );
    expect(view.getByLabelText("3 rezervace")).toBeDefined();
    expect(
      view.getByText("Zobrazují se rezervace vybraného zákazníka.")
    ).toBeDefined();
    expect(
      view.getByRole("link", { name: "Zrušit výběr zákazníka" })
    ).toBeDefined();
    expect(
      view.getByText(
        "Data rezervací jsou dočasně nedostupná. Zkuste toto datum znovu za chvíli."
      )
    ).toBeDefined();
    expect(
      view.getByText("Tomuto zobrazení neodpovídají žádné rezervace.")
    ).toBeDefined();
  });

  test("counts Czech reservations with the right plural form", async () => {
    routeLocale = "cs-CZ";
    const view = await prerenderReservationsPage();

    expect(view.getByLabelText("115 rezervací")).toBeDefined();
  });
});
