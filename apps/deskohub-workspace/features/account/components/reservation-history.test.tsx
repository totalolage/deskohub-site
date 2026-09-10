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
import type { ComponentPropsWithoutRef } from "react";
import { workspaceReservationIdSchema } from "@/features/reservation/persistence-contracts";
import {
  UnsavedChangesProvider,
  useUnsavedChanges,
} from "@/shared/components/unsaved-changes-guard";
import {
  registerWorkspaceComponentTestEnv,
  unregisterWorkspaceComponentTestEnv,
} from "@/shared/testing/workspace-component-test-env";
import type {
  CustomerReservationHistory,
  CustomerReservationSummary,
} from "../contracts";
import type { ReservationHistoryCopy } from "./reservation-history";

type NavigateEvent = {
  readonly preventDefault: () => void;
};

type MockNextLinkProps = ComponentPropsWithoutRef<"a"> & {
  readonly href: string;
  readonly onNavigate?: (event: NavigateEvent) => void;
};

function MockNextLink({
  children,
  href,
  onNavigate,
  ...props
}: MockNextLinkProps) {
  return (
    <a href={href} {...props} onClick={onNavigate}>
      {children}
    </a>
  );
}

mock.module("next/link", () => ({ default: MockNextLink }));

const { ReservationHistory } = await import("./reservation-history");

const historyCopy = {
  "en-US": {
    assignedDesk: "Assigned desk",
    checkIn: "Check in",
    date: "Date",
    moreCurrent: "More current and upcoming reservations",
    nfcAccess: "NFC access",
    product: "Product",
    seats: "Seats",
    showPinCode: "Show PIN code",
    status: "Status",
    unavailable: "Unavailable",
    unsupportedDescription: "Not available in your account yet.",
    validity: "Validity",
    viewReservation: "View reservation",
    wifi: "Wi-Fi",
  },
  "cs-CZ": {
    assignedDesk: "Přiřazené místo",
    checkIn: "Odbavit se",
    date: "Datum",
    moreCurrent: "Další aktuální a nadcházející rezervace",
    nfcAccess: "NFC přístup",
    product: "Produkt",
    seats: "Místa",
    showPinCode: "Zobrazit PIN kód",
    status: "Stav",
    unavailable: "Nedostupné",
    unsupportedDescription: "Ve vašem účtu zatím není k dispozici.",
    validity: "Platnost",
    viewReservation: "Zobrazit rezervaci",
    wifi: "Wi-Fi",
  },
} satisfies Record<"en-US" | "cs-CZ", ReservationHistoryCopy>;

const copyFor = (locale: keyof typeof historyCopy) => historyCopy[locale];

const renderHistory = (
  locale: keyof typeof historyCopy,
  history: CustomerReservationHistory
) =>
  render(
    <ReservationHistory
      copy={copyFor(locale)}
      history={history}
      locale={locale}
    />
  );

const reservation = (
  overrides: Partial<CustomerReservationSummary>
): CustomerReservationSummary => ({
  id: "reservation-1",
  product: { kind: "meeting-room" },
  startsAt: "2026-09-18T12:00:00Z",
  endsAt: "2026-09-18T14:00:00Z",
  seats: 2,
  status: "confirmed",
  ...overrides,
});

const availableHistory = {
  kind: "available" as const,
  groups: {
    current: [reservation({ id: "current-1" })],
    past: [
      reservation({
        id: "past-1",
        startsAt: "2026-08-21T08:00:00Z",
        endsAt: "2026-08-21T10:00:00Z",
        status: "confirmed",
      }),
      reservation({ id: "past-cancelled", status: "cancelled" as const }),
    ],
    unavailable: [reservation({ id: "undated-1", endsAt: null })],
  },
};

const linkedReservationId = workspaceReservationIdSchema.make(
  "workspace reservation/1"
);
const linkedHistory = {
  kind: "available" as const,
  groups: {
    current: [
      reservation({
        id: "provider-reservation-1",
        workspaceReservationId: linkedReservationId,
      }),
    ],
    past: [],
    unavailable: [],
  },
};

const expectedPragueAllDayRange = (
  locale: "en-US" | "cs-CZ",
  startsAt: string,
  endsAt: string
) =>
  new Intl.DateTimeFormat(locale, {
    dateStyle: "full",
    timeZone: "Europe/Prague",
  }).formatRange(new Date(startsAt), new Date(new Date(endsAt).getTime() - 1));

const expectedPragueTimedRange = (
  locale: "en-US" | "cs-CZ",
  startsAt: string,
  endsAt: string
) =>
  new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Europe/Prague",
  }).formatRange(new Date(startsAt), new Date(endsAt));

const calendarPeriod = (view: ReturnType<typeof render>) =>
  view.container.querySelector("svg.lucide-calendar-days")?.parentElement
    ?.textContent;

function DirtyProfileGuard() {
  useUnsavedChanges({
    enabled: true,
    isDirty: () => true,
    message: "Leave this form?",
  });
  return null;
}

describe("ReservationHistory", () => {
  beforeAll(() => {
    registerWorkspaceComponentTestEnv();
  });

  beforeEach(() => {
    window.location.href = "http://localhost/en-US/account";
  });

  afterEach(() => {
    cleanup();
  });

  afterAll(() => {
    unregisterWorkspaceComponentTestEnv();
  });

  test("renders current, past, cancelled, and undated groups with counts", () => {
    const view = renderHistory("en-US", availableHistory);

    expect(
      view.getByRole("heading", { name: "Current and upcoming" })
    ).toBeTruthy();
    expect(
      view.getByRole("heading", { name: "Past reservations" })
    ).toBeTruthy();
    expect(
      view.getByRole("heading", {
        name: "Reservations missing date details",
      })
    ).toBeTruthy();

    const group = (id: string) =>
      view.container.querySelector(`[data-account-reservation-group="${id}"]`)!;

    expect(group("current").textContent).toContain("1");
    expect(group("past").textContent).toContain("2");
    expect(group("unavailable").textContent).toContain("1");

    expect(group("past").textContent).toContain("Cancelled");
    expect(group("current").textContent).toContain("Confirmed");

    expect(view.container.querySelector("nav")).toBeNull();
    for (const id of [
      "account-reservations-current",
      "account-reservations-past",
      "account-reservations-unavailable",
    ]) {
      expect(view.container.querySelector(`a[href="#${id}"]`)).toBeNull();
    }

    for (const [name, id] of [
      ["Current and upcoming", "account-reservations-current"],
      ["Past reservations", "account-reservations-past"],
      ["Reservations missing date details", "account-reservations-unavailable"],
    ] as const) {
      expect(view.getByRole("region", { name }).getAttribute("id")).toBe(id);
    }
    expect(group("current").querySelector("li > div")).toBeTruthy();
    expect(group("past").querySelector("tbody tr")).toBeTruthy();
    expect(group("unavailable").querySelector("article")).toBeTruthy();
  });

  test("renders localized group titles and statuses in Czech", () => {
    const view = renderHistory("cs-CZ", availableHistory);

    expect(
      view.getByRole("heading", { name: "Aktuální a nadcházející" })
    ).toBeTruthy();
    expect(
      view.getByRole("heading", { name: "Minulé rezervace" })
    ).toBeTruthy();
    expect(
      view.getByRole("heading", { name: "Rezervace bez údaje o datu" })
    ).toBeTruthy();
    expect(view.getByText("Zrušeno")).toBeTruthy();
  });

  test("keeps every provider status and exposes unsupported actions as disabled", () => {
    const statuses = [
      "confirmed",
      "cancelled",
      "pending",
      "requires-attention",
    ] as const;
    const view = renderHistory("en-US", {
      kind: "available",
      groups: {
        current: statuses.map((status, index) =>
          reservation({
            id: `status-${index}`,
            status,
            workspaceReservationId:
              index === 0 ? linkedReservationId : undefined,
          })
        ),
        past: [],
        unavailable: [],
      },
    });

    for (const status of statuses) {
      expect(
        view.container.querySelector(
          `[data-account-reservation-status="${status}"]`
        )
      ).toBeTruthy();
    }
    expect(view.queryByText("Checked in")).toBeNull();

    for (const label of [
      copyFor("en-US").checkIn,
      copyFor("en-US").nfcAccess,
      copyFor("en-US").showPinCode,
    ]) {
      expect(
        view.getByRole("button", { name: label }).hasAttribute("disabled")
      ).toBe(true);
    }

    expect(view.getByText(copyFor("en-US").assignedDesk)).toBeTruthy();
    expect(view.getByText(copyFor("en-US").wifi)).toBeTruthy();
    expect(
      view.getByText(copyFor("en-US").unsupportedDescription)
    ).toBeTruthy();
    expect(
      view.getAllByText(copyFor("en-US").unavailable).length
    ).toBeGreaterThan(1);
    expect(view.container.textContent).not.toContain("SSID");
    expect(view.container.textContent).not.toContain("password");
  });

  test.each(["en-US", "cs-CZ"] as const)(
    "renders account-owned availability copy in %s",
    (locale) => {
      const view = renderHistory(locale, {
        kind: "available",
        groups: {
          current: [reservation({ id: `available-${locale}` })],
          past: [],
          unavailable: [],
        },
      });

      expect(view.getByText(copyFor(locale).assignedDesk)).toBeTruthy();
      expect(view.getByText(copyFor(locale).wifi)).toBeTruthy();
      expect(
        view.getAllByText(copyFor(locale).unavailable).length
      ).toBeGreaterThan(0);
      expect(
        view.getByRole("button", { name: copyFor(locale).checkIn })
      ).toBeTruthy();
    }
  );

  test("renders compact past rows as accessible guarded actions", () => {
    const view = renderHistory("en-US", {
      kind: "available",
      groups: {
        current: [],
        past: [
          reservation({
            endsAt: "2026-08-21T10:00:00Z",
            id: "past-linked",
            startsAt: "2026-08-21T08:00:00Z",
            status: "requires-attention",
            workspaceReservationId: linkedReservationId,
          }),
        ],
        unavailable: [],
      },
    });

    const table = view.getByRole("table");
    const row = table.querySelector("tbody tr");
    expect(row).toBeTruthy();
    expect(row?.textContent).toContain("Meeting Room");
    expect(row?.textContent).toContain("Needs attention");
    expect(row?.textContent).toContain("Aug 21, 2026");
    expect(table.className).toContain("xl:table");
    expect(table.className).toContain("xl:table-fixed");
    expect(table.querySelector("thead")?.className).toContain(
      "xl:table-header-group"
    );
    expect(table.querySelector("tbody")?.className).toContain(
      "xl:table-row-group"
    );
    expect(row?.className).toContain("max-xl:p-4");
    expect(row?.className).toContain("xl:table-row");
    expect(row?.querySelector("td")?.className).toContain("min-w-0");
    expect(row?.querySelector("td")?.className).toContain("xl:table-cell");
    expect(row?.querySelector("td > div")?.className).toContain("xl:block");

    const link = view.getByRole("link", {
      name: copyFor("en-US").viewReservation,
    });
    expect(link.tagName).toBe("A");
    expect(link.getAttribute("href")).toBe(
      "/en-US/reservation/status/workspace%20reservation%2F1"
    );
  });

  test.each(["en-US", "cs-CZ"] as const)(
    "preserves timed past periods in %s",
    (locale) => {
      const startsAt = "2026-09-18T12:00:00Z";
      const endsAt = "2026-09-18T14:00:00Z";
      const view = renderHistory(locale, {
        kind: "available",
        groups: {
          current: [],
          past: [reservation({ endsAt, startsAt })],
          unavailable: [],
        },
      });
      const row = view.container.querySelector(
        '[data-account-reservation-group="past"] tbody tr'
      );

      expect(row?.querySelector("td")?.textContent).toContain(
        expectedPragueTimedRange(locale, startsAt, endsAt)
      );
    }
  );

  test.each(["en-US", "cs-CZ"] as const)(
    "preserves inclusive all-day past periods in %s",
    (locale) => {
      const startsAt = "2026-09-05T22:00:00Z";
      const endsAt = "2026-09-07T22:00:00Z";
      const view = renderHistory(locale, {
        kind: "available",
        groups: {
          current: [],
          past: [reservation({ endsAt, startsAt })],
          unavailable: [],
        },
      });
      const row = view.container.querySelector(
        '[data-account-reservation-group="past"] tbody tr'
      );

      expect(row?.querySelector("td")?.textContent).toContain(
        expectedPragueAllDayRange(locale, startsAt, endsAt)
      );
    }
  );

  test("wraps the longest Czech status and table detail action", () => {
    const view = renderHistory("cs-CZ", {
      kind: "available",
      groups: {
        current: [],
        past: [
          reservation({
            endsAt: "2026-08-21T10:00:00Z",
            id: "past-czech-linked",
            startsAt: "2026-08-21T08:00:00Z",
            status: "requires-attention",
            workspaceReservationId: linkedReservationId,
          }),
        ],
        unavailable: [],
      },
    });
    const row = view.container.querySelector(
      '[data-account-reservation-group="past"] tbody tr'
    );
    const status = row?.querySelector(
      '[data-account-reservation-status="requires-attention"]'
    );
    const link = view.getByRole("link", {
      name: copyFor("cs-CZ").viewReservation,
    });

    expect(status?.textContent).toContain("Vyžaduje pozornost");
    expect(status?.className).toContain("min-w-0");
    expect(status?.className).toContain("whitespace-normal");
    expect(link.className).toContain("min-w-0");
    expect(link.className).toContain("max-w-full");
    expect(link.className).toContain("whitespace-normal");
    expect(link.className).toContain("hover:underline");
    expect(link.className).not.toContain("px-4");
  });

  test("wraps opaque ids and constrains responsive reservation content", () => {
    const longId =
      "reservation-id-with-a-deliberately-long-opaque-value-that-must-wrap";
    const view = renderHistory("en-US", {
      kind: "available",
      groups: {
        current: [
          reservation({ id: longId }),
          reservation({
            endsAt: "2026-11-13T14:00:00Z",
            id: "current-compact",
            startsAt: "2026-11-12T12:00:00Z",
          }),
        ],
        past: [reservation({ id: "past-row" })],
        unavailable: [reservation({ id: "undated-row", endsAt: null })],
      },
    });

    const id = view.getByText(longId);
    expect(id.tagName).toBe("CODE");
    expect(id.className).toContain("min-w-0");
    expect(id.className).toContain("break-all");
    expect(
      view.container.querySelector('[data-account-reservation-group="current"]')
        ?.className
    ).toContain("min-w-0");
    const table = view.getByRole("table");
    expect(table.className).toContain("xl:table");
    expect(table.className).toContain("xl:table-fixed");
    expect(table.parentElement?.className).toContain("overflow-hidden");
    expect(
      [...table.querySelectorAll("thead th")].map((header) => header.className)
    ).toEqual([
      expect.stringContaining("xl:w-[30%]"),
      expect.stringContaining("xl:w-[25%]"),
      expect.stringContaining("xl:w-[12%]"),
      expect.stringContaining("xl:w-[17%]"),
      expect.stringContaining("xl:w-[16%]"),
    ]);
    const dateTile = view.getByText("Nov").parentElement;
    expect(
      view.getByRole("heading", {
        name: copyFor("en-US").moreCurrent,
      })
    ).toBeTruthy();
    expect(dateTile).toBeTruthy();
    expect(dateTile?.textContent).toContain("12");
    expect(dateTile?.textContent).toContain("Date: Nov 12");
  });

  test("keeps past row labels mobile-only at the table breakpoint", () => {
    const view = renderHistory("en-US", {
      kind: "available",
      groups: {
        current: [],
        past: [reservation({ id: "past-row-labels" })],
        unavailable: [],
      },
    });
    const table = view.getByRole("table");
    const rowLabels = [
      ...table.querySelectorAll("tbody tr td > div > span:first-child"),
    ];

    expect(rowLabels).toHaveLength(4);
    for (const label of rowLabels) {
      expect(label.className).toContain("block");
      expect(label.className).toContain("xl:hidden");
      expect(label.className).not.toContain("max-xl:block");
    }
    expect(table.querySelector("thead")?.className).toContain("hidden");
    expect(table.querySelector("thead")?.className).toContain(
      "xl:table-header-group"
    );
  });

  test("keeps featured desktop spacing compact without changing mobile stacking", () => {
    const view = renderHistory("en-US", linkedHistory);
    const card = view.container.querySelector(
      '[data-account-reservation-group="current"] li > div'
    );
    expect(card).toBeTruthy();
    const header = card?.children[0];
    const main = card?.children[2];
    const footer = card?.children[3];
    const buttons = footer?.children[0];
    const right = footer?.children[1];
    const explanation = right?.querySelector("p");
    const action = view.getByRole("link", {
      name: copyFor("en-US").viewReservation,
    });

    expect(header?.className).toContain("p-6");
    expect(header?.className).toContain("xl:py-4");
    expect(main?.className).toContain("px-6");
    expect(main?.className).toContain("xl:py-5");
    expect(footer?.className).toContain("xl:grid");
    expect(footer?.className).toContain("xl:grid-cols-[minmax(0,1fr)_auto]");
    expect(footer?.className).toContain("xl:gap-y-2");
    expect(footer?.className).toContain("xl:py-4");
    expect(buttons?.className).toContain("xl:row-start-2");
    expect(right?.className).toContain("xl:contents");
    expect(explanation?.className).toContain("xl:text-xs");
    expect(explanation?.className).toContain("xl:leading-5");
    expect(action.parentElement?.className).toContain("xl:col-start-2");
    expect(action.parentElement?.className).toContain("xl:row-span-2");
    expect(action.parentElement?.className).toContain("xl:items-center");

    expect(footer?.className).toContain("flex-col");
    expect(footer?.className).toContain("sm:flex-row");
    expect(buttons?.className).toContain("flex-col");
    expect(right?.className).toContain("flex-col");
  });

  test.each(["en-US", "cs-CZ"] as const)(
    "renders a single Prague calendar day as a localized full date in %s",
    (locale) => {
      const startsAt = "2026-09-05T22:00:00Z";
      const endsAt = "2026-09-06T22:00:00Z";
      const view = renderHistory(locale, {
        kind: "available",
        groups: {
          current: [
            reservation({
              endsAt,
              product: { kind: "other" },
              startsAt,
            }),
          ],
          past: [],
          unavailable: [],
        },
      });

      expect(calendarPeriod(view)).toBe(
        expectedPragueAllDayRange(locale, startsAt, endsAt)
      );
    }
  );

  test.each(["en-US", "cs-CZ"] as const)(
    "renders a multi-day Prague calendar interval through the inclusive end date in %s",
    (locale) => {
      const startsAt = "2026-09-05T22:00:00Z";
      const endsAt = "2026-09-07T22:00:00Z";
      const view = renderHistory(locale, {
        kind: "available",
        groups: {
          current: [reservation({ endsAt, startsAt })],
          past: [],
          unavailable: [],
        },
      });

      expect(calendarPeriod(view)).toBe(
        expectedPragueAllDayRange(locale, startsAt, endsAt)
      );
    }
  );

  test.each(["en-US", "cs-CZ"] as const)(
    "renders a DST all-day interval as one Prague calendar day in %s",
    (locale) => {
      const startsAt = "2026-03-28T23:00:00Z";
      const endsAt = "2026-03-29T22:00:00Z";
      const view = renderHistory(locale, {
        kind: "available",
        groups: {
          current: [reservation({ endsAt, startsAt })],
          past: [],
          unavailable: [],
        },
      });

      expect(calendarPeriod(view)).toBe(
        expectedPragueAllDayRange(locale, startsAt, endsAt)
      );
    }
  );

  test.each(["en-US", "cs-CZ"] as const)(
    "keeps timed reservation formatting unchanged in %s",
    (locale) => {
      const startsAt = "2026-09-18T12:00:00Z";
      const endsAt = "2026-09-18T14:00:00Z";
      const view = renderHistory(locale, {
        kind: "available",
        groups: {
          current: [reservation({ endsAt, startsAt })],
          past: [],
          unavailable: [],
        },
      });

      expect(calendarPeriod(view)).toBe(
        expectedPragueTimedRange(locale, startsAt, endsAt)
      );
    }
  );

  test.each(["en-US", "cs-CZ"] as const)(
    "keeps a midnight-to-noon reservation timed in %s",
    (locale) => {
      const startsAt = "2026-09-18T22:00:00Z";
      const endsAt = "2026-09-19T10:00:00Z";
      const view = renderHistory(locale, {
        kind: "available",
        groups: {
          current: [reservation({ endsAt, startsAt })],
          past: [],
          unavailable: [],
        },
      });

      expect(calendarPeriod(view)).toBe(
        expectedPragueTimedRange(locale, startsAt, endsAt)
      );
    }
  );

  test.each([
    ["en-US", "missing start", { startsAt: null }],
    ["en-US", "missing end", { endsAt: null }],
    ["en-US", "invalid start", { startsAt: "not-a-date" }],
    ["en-US", "invalid end", { endsAt: "not-a-date" }],
    ["cs-CZ", "missing start", { startsAt: null }],
    ["cs-CZ", "missing end", { endsAt: null }],
    ["cs-CZ", "invalid start", { startsAt: "not-a-date" }],
    ["cs-CZ", "invalid end", { endsAt: "not-a-date" }],
  ] as const)(
    "omits the calendar row for a %s %s reservation",
    (locale, _caseName, overrides) => {
      const view = renderHistory(locale, {
        kind: "available",
        groups: {
          current: [reservation({ ...overrides, seats: null })],
          past: [],
          unavailable: [],
        },
      });

      const item = view.container.querySelector("li");
      expect(item).toBeTruthy();
      expect(item?.querySelector("svg.lucide-calendar-days")).toBeNull();
    }
  );

  test("links a persisted reservation to its encoded English status URL", () => {
    const view = renderHistory("en-US", linkedHistory);

    const link = view.getByRole("link", {
      name: copyFor("en-US").viewReservation,
    });
    expect(link.getAttribute("href")).toBe(
      "/en-US/reservation/status/workspace%20reservation%2F1"
    );
  });

  test("links a persisted reservation to its encoded Czech status URL", () => {
    const view = renderHistory("cs-CZ", linkedHistory);

    const link = view.getByRole("link", {
      name: copyFor("cs-CZ").viewReservation,
    });
    expect(link.getAttribute("href")).toBe(
      "/cs-CZ/reservation/status/workspace%20reservation%2F1"
    );
  });

  test("does not create a fake link from a provider-only reservation id", () => {
    const view = renderHistory("en-US", {
      kind: "available",
      groups: {
        current: [reservation({ id: "provider-only-id" })],
        past: [],
        unavailable: [],
      },
    });

    expect(
      view.queryByRole("link", {
        name: copyFor("en-US").viewReservation,
      })
    ).toBeNull();
    expect(view.container.querySelector("li a")).toBeNull();
  });

  test("keeps linked reservation actions as focusable native anchors", () => {
    const view = renderHistory("en-US", linkedHistory);

    const link = view.getByRole("link", {
      name: copyFor("en-US").viewReservation,
    });
    expect(link.tagName).toBe("A");
    expect(link.getAttribute("role")).toBeNull();
    expect(link.getAttribute("tabindex")).toBeNull();
    expect(link.tabIndex).toBe(0);
    link.focus();
    expect(document.activeElement).toBe(link);
    const item = link.closest("li");
    expect(item).toBeTruthy();
    expect(item?.querySelectorAll("a")).toHaveLength(1);
    expect(link.className).toContain("h-9");
    expect(link.className).toContain("hover:");
    expect(link.className).toContain("focus-visible:");
  });

  test("uses the guarded link for dirty profile navigation", () => {
    const originalConfirm = window.confirm;
    const confirm = mock(() => false);
    window.confirm = confirm;

    try {
      const view = render(
        <UnsavedChangesProvider>
          <DirtyProfileGuard />
          <ReservationHistory
            copy={copyFor("en-US")}
            locale="en-US"
            history={linkedHistory}
          />
        </UnsavedChangesProvider>
      );
      const link = view.getByRole("link", {
        name: copyFor("en-US").viewReservation,
      });
      const event = new MouseEvent("click", {
        bubbles: true,
        cancelable: true,
        button: 0,
      });

      link.dispatchEvent(event);

      expect(event.defaultPrevented).toBe(true);
      expect(confirm).toHaveBeenCalledTimes(1);
    } finally {
      window.confirm = originalConfirm;
    }
  });

  test("shows the empty-state notices for a fresh account", () => {
    const view = renderHistory("en-US", {
      kind: "available",
      groups: { current: [], past: [], unavailable: [] },
    });

    expect(
      view.getByText("You have no current or upcoming reservations.")
    ).toBeTruthy();
    expect(view.getByText("You have no past reservations yet.")).toBeTruthy();
  });

  test.each([
    [
      "en-US",
      "Reservation history is temporarily unavailable",
      "Our booking system could not be reached. Your profile is still available, please try again later.",
    ],
    [
      "cs-CZ",
      "Historie rezervací je dočasně nedostupná",
      "Náš rezervační systém není dostupný. Váš profil zůstává k dispozici, zkuste to prosím později.",
    ],
  ] as const)(
    "keeps the profile page usable when the reservation provider is unavailable in %s",
    (locale, title, description) => {
      const view = renderHistory(locale, {
        kind: "unavailable",
        reason: "provider-unavailable",
      });

      expect(view.getByText(title)).toBeTruthy();
      expect(view.getByText(description)).toBeTruthy();
    }
  );
});
