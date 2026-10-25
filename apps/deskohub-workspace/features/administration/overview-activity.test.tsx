import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  test,
} from "bun:test";
import { cleanup, render } from "@testing-library/react";
import { RouteLocaleProvider } from "@/features/i18n/route-locale";
import {
  registerWorkspaceComponentTestEnv,
  unregisterWorkspaceComponentTestEnv,
} from "@/shared/testing/workspace-component-test-env";
import { m } from "./i18n";
import {
  CustomerActivity,
  OverviewReservationActivityCalendar,
  ReservationCounts,
} from "./overview-activity";

const makeCustomer = (id: string, displayName: string, hasName = true) => ({
  customer: { id, displayName, hasName, email: null, phone: null },
  customerId: id,
});

const overview = {
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
      makeCustomer("customer-unnamed", "Unnamed customer", false),
      makeCustomer("customer-drew", "Drew Jones"),
    ],
    unavailable: false,
    value: 3,
  },
};

beforeAll(() => registerWorkspaceComponentTestEnv());
afterEach(() => cleanup());
afterAll(() => unregisterWorkspaceComponentTestEnv());

describe("CustomerActivity", () => {
  test("shows unavailable customer metrics without a substitute count", async () => {
    const view = render(
      await CustomerActivity({
        locale: "en-US",
        overview: Promise.resolve({
          ...overview,
          uniqueCustomers: { customers: [], unavailable: true, value: 0 },
        }),
      })
    );

    expect(view.getByText("Unique customer count unavailable")).toBeDefined();
    expect(view.getByText("Live booking dates unavailable")).toBeDefined();
  });

  test("names customers and the remainder in Czech", async () => {
    const view = render(
      await CustomerActivity({
        locale: "cs-CZ",
        overview: Promise.resolve({
          ...overview,
          uniqueCustomers: { ...overview.uniqueCustomers, value: 7 },
        }),
      })
    );

    expect(view.getByText("Unikátní zákazníci")).toBeDefined();
    expect(view.getByText("Noví zákazníci")).toBeDefined();
    expect(view.getByText("… a 5 dalších")).toBeDefined();
    expect(view.getByText("Drew Jones")).toBeDefined();
    expect(view.getByText("Zákazník bez jména")).toBeDefined();
    expect(view.queryByText("Unnamed customer")).toBeNull();
  });

  test("selects the Czech remainder form for two to four customers", () => {
    expect(
      m.administrationOverviewMoreCustomers({ count: 3 }, { locale: "cs-CZ" })
    ).toBe("… a 3 další");
  });
});

describe("ReservationCounts", () => {
  test("describes reservation completion in Czech", async () => {
    const view = render(
      <RouteLocaleProvider locale="cs-CZ">
        {
          await ReservationCounts({
            locale: "cs-CZ",
            overview: Promise.resolve(overview),
          })
        }
      </RouteLocaleProvider>
    );

    expect(view.getByRole("link", { name: "Dnes" })).toBeDefined();
    expect(view.getByText("Dokončeno: 1 z 2 rezervací")).toBeDefined();
    expect(
      view.getByRole("link", { name: "Posledních 7 dní" }).getAttribute("href")
    ).toBe("/cs-CZ/admin/reservations?from=2026-08-05&to=2026-08-11");
  });

  test("groups the digits of large reservation counts for the locale", async () => {
    const largeOverview = {
      ...overview,
      today: { completed: 1001, unavailable: false, value: 1234 },
    };
    for (const [locale, completion, completed, total] of [
      [
        "cs-CZ",
        "Dokončeno: 1\u00a0001 z 1\u00a0234 rezervací",
        "1\u00a0001",
        "/ 1\u00a0234",
      ],
      [
        "en-US",
        "1,001 completed out of 1,234 total reservations",
        "1,001",
        "/ 1,234",
      ],
    ] as const) {
      const view = render(
        <RouteLocaleProvider locale={locale}>
          {
            await ReservationCounts({
              locale,
              overview: Promise.resolve(largeOverview),
            })
          }
        </RouteLocaleProvider>
      );

      for (const text of [completion, completed, total]) {
        expect(
          view.getAllByText((_, element) => element?.textContent === text)
        ).toHaveLength(1);
      }
      view.unmount();
    }
  });

  test("keeps the singular total in English", () => {
    expect(
      m.administrationOverviewReservationCompletion(
        { completed: 0, count: 1 },
        { locale: "en-US" }
      )
    ).toBe("0 completed out of 1 total reservation");
  });
});

describe("OverviewReservationActivityCalendar", () => {
  test("shades each day by its reservation count", async () => {
    const view = render(
      await OverviewReservationActivityCalendar({
        activity: Promise.resolve({
          from: "2026-01-01",
          to: "2026-03-31",
          dates: [
            { count: 6, date: "2026-02-10" },
            { count: 600, date: "2026-02-11" },
          ],
        }),
        locale: "en-US",
      })
    );
    const intensity = (date: string) =>
      view.container
        .querySelector<HTMLElement>(`time[datetime="${date}"]`)
        ?.style.getPropertyValue("--reservation-activity-intensity");

    expect(intensity("2026-02-09")).toBe("");
    expect(intensity("2026-02-10")).toBe("50%");
    expect(intensity("2026-02-11")).toBe("100%");
    expect(
      view.container.querySelectorAll("span.size-3[style]").length
    ).toBeGreaterThan(1);
  });
});
