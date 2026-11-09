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
import { type Locale, m } from "@/features/i18n";
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

const renderHistory = (locale: Locale, history: CustomerReservationHistory) =>
  render(<ReservationHistory history={history} locale={locale} />);

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

  afterAll(async () => {
    await unregisterWorkspaceComponentTestEnv();
  });

  test("renders current, past, cancelled, and undated groups with counts", () => {
    const view = renderHistory("en-US", availableHistory);

    expect(
      view.getByRole("heading", {
        name: m.accountReservationsCurrentTitle({}, { locale: "en-US" }),
      })
    ).toBeTruthy();
    expect(
      view.getByRole("heading", {
        name: m.accountReservationsPastTitle({}, { locale: "en-US" }),
      })
    ).toBeTruthy();
    expect(
      view.getByRole("heading", {
        name: m.accountReservationsOtherTitle({}, { locale: "en-US" }),
      })
    ).toBeTruthy();

    const group = (id: string) =>
      view.container.querySelector(`[data-account-reservation-group="${id}"]`)!;

    expect(group("current").textContent).toContain("1");
    expect(group("past").textContent).toContain("2");
    expect(group("unavailable").textContent).toContain("1");

    expect(
      group("past").querySelector(
        '[data-account-reservation-status="cancelled"]'
      )
    ).toBeTruthy();
    expect(
      group("current").querySelector(
        '[data-account-reservation-status="confirmed"]'
      )
    ).toBeTruthy();

    expect(view.container.querySelector("nav")).toBeNull();
    for (const id of [
      "account-reservations-current",
      "account-reservations-past",
      "account-reservations-unavailable",
    ]) {
      expect(view.container.querySelector(`a[href="#${id}"]`)).toBeNull();
    }

    for (const [name, id] of [
      [
        m.accountReservationsCurrentTitle({}, { locale: "en-US" }),
        "account-reservations-current",
      ],
      [
        m.accountReservationsPastTitle({}, { locale: "en-US" }),
        "account-reservations-past",
      ],
      [
        m.accountReservationsOtherTitle({}, { locale: "en-US" }),
        "account-reservations-unavailable",
      ],
    ] as const) {
      expect(view.getByRole("region", { name }).getAttribute("id")).toBe(id);
    }
    expect(group("current").querySelector("li > div")).toBeTruthy();
    expect(group("past").querySelector("tbody tr")).toBeTruthy();
    expect(group("unavailable").querySelector("article")).toBeTruthy();
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

    expect(
      view
        .getByRole("button", {
          name: m.accountReservationCheckIn({}, { locale: "en-US" }),
        })
        .hasAttribute("disabled")
    ).toBe(true);
    expect(view.queryByRole("button", { name: /nfc/i })).toBeNull();
    expect(
      view.getByRole("link", {
        name: m.accountReservationShowPinCode({}, { locale: "en-US" }),
      })
    ).toBeTruthy();
    expect(
      view.queryByRole("button", {
        name: m.accountReservationShowPinCode({}, { locale: "en-US" }),
      })
    ).toBeNull();

    expect(view.container.textContent).not.toContain("SSID");
    expect(view.container.textContent).not.toContain("password");
  });

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
    expect(
      row?.querySelector(
        '[data-account-reservation-status="requires-attention"]'
      )
    ).toBeTruthy();
    expect(row?.textContent).toContain("Aug 21, 2026");

    const link = view.getByRole("link", {
      name: m.accountReservationView({}, { locale: "en-US" }),
    });
    expect(link.tagName).toBe("A");
    expect(link.getAttribute("href")).toBe(
      "/en-US/reservation/status/workspace%20reservation%2F1"
    );
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
    const dateTile = view.getByText("Nov").parentElement;
    expect(
      view.getByRole("heading", {
        name: m.accountReservationMoreCurrent({}, { locale: "en-US" }),
      })
    ).toBeTruthy();
    expect(dateTile).toBeTruthy();
    expect(dateTile?.textContent).toContain("12");
    expect(dateTile?.querySelector(".sr-only")?.textContent).toContain(
      "Nov 12"
    );
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

  test.each(["en-US", "cs-CZ"] as const)(
    "renders a localized guarded PIN access link without URL extras in %s",
    (locale) => {
      const view = renderHistory(locale, linkedHistory);
      const pinLink = view.getByRole("link", {
        name: m.accountReservationShowPinCode({}, { locale }),
      });
      const pinHref = pinLink.getAttribute("href");
      const detailLink = view.getByRole("link", {
        name: m.accountReservationView({}, { locale }),
      });

      expect(pinLink.tagName).toBe("A");
      expect(pinLink.getAttribute("role")).toBeNull();
      expect(pinHref).toBe(
        `/${locale}/reservation/access/workspace%20reservation%2F1`
      );
      expect(pinHref).not.toContain("?");
      expect(pinHref).not.toContain("#");
      expect(detailLink.getAttribute("href")).toBe(
        `/${locale}/reservation/status/workspace%20reservation%2F1`
      );
    }
  );

  test("explains why PIN access is disabled for provider-only reservations", () => {
    const locale = "en-US";
    const view = renderHistory(locale, {
      kind: "available",
      groups: {
        current: [reservation({ id: "provider-only" })],
        past: [],
        unavailable: [],
      },
    });
    const pinButton = view.getByRole("button", {
      name: m.accountReservationShowPinCode({}, { locale }),
    });

    expect(pinButton.hasAttribute("disabled")).toBe(true);
    expect(
      view.queryByRole("link", {
        name: m.accountReservationShowPinCode({}, { locale }),
      })
    ).toBeNull();
    expect(pinButton.nextElementSibling?.tagName).toBe("P");
    expect(
      view.container.querySelector('a[href*="/reservation/access/"]')
    ).toBeNull();
  });

  test("links a review account's sandbox reservation to its status but never to a PIN", () => {
    const view = renderHistory("en-US", {
      kind: "available",
      groups: {
        current: [
          reservation({
            id: "review-sample",
            workspaceReservationId: linkedReservationId,
            reviewSandbox: true,
          }),
        ],
        past: [],
        unavailable: [],
      },
    });

    expect(
      view
        .getByRole("button", {
          name: m.accountReservationShowPinCode({}, { locale: "en-US" }),
        })
        .hasAttribute("disabled")
    ).toBe(true);
    expect(
      view.container.querySelector('a[href*="/reservation/access/"]')
    ).toBeNull();
    expect(
      view.container.querySelector('a[href*="/reservation/status/"]')
    ).not.toBeNull();
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
        name: m.accountReservationView({}, { locale: "en-US" }),
      })
    ).toBeNull();
    expect(view.container.querySelector("li a")).toBeNull();
  });

  test("uses the guarded link for dirty profile navigation", () => {
    const originalConfirm = window.confirm;
    const confirm = mock(() => false);
    window.confirm = confirm;

    try {
      const view = render(
        <UnsavedChangesProvider>
          <DirtyProfileGuard />
          <ReservationHistory locale="en-US" history={linkedHistory} />
        </UnsavedChangesProvider>
      );
      const link = view.getByRole("link", {
        name: m.accountReservationView({}, { locale: "en-US" }),
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

  test("cancels dirty PIN access navigation after confirmation is declined", () => {
    const originalConfirm = window.confirm;
    const confirm = mock(() => false);
    window.confirm = confirm;

    try {
      const view = render(
        <UnsavedChangesProvider>
          <DirtyProfileGuard />
          <ReservationHistory locale="en-US" history={linkedHistory} />
        </UnsavedChangesProvider>
      );
      const pinLink = view.getByRole("link", {
        name: m.accountReservationShowPinCode({}, { locale: "en-US" }),
      });
      const event = new MouseEvent("click", {
        bubbles: true,
        cancelable: true,
        button: 0,
      });

      pinLink.dispatchEvent(event);

      expect(event.defaultPrevented).toBe(true);
      expect(confirm).toHaveBeenCalledTimes(1);
    } finally {
      window.confirm = originalConfirm;
    }
  });

  test("shows the setup start beside each early-setup meeting room only", () => {
    const setupStartsAt = "2026-09-18T11:45:00Z";
    const setupText = m.accountReservationSetupFrom(
      {
        time: new Intl.DateTimeFormat("en-US", {
          timeStyle: "short",
          timeZone: "Europe/Prague",
        }).format(new Date(setupStartsAt)),
      },
      { locale: "en-US" }
    );
    const view = renderHistory("en-US", {
      kind: "available",
      groups: {
        current: [
          reservation({ id: "featured", setupStartsAt }),
          reservation({ id: "compact", setupStartsAt }),
          reservation({ id: "compact-without-setup" }),
        ],
        past: [
          reservation({ id: "past", setupStartsAt }),
          reservation({ id: "past-without-setup" }),
        ],
        unavailable: [],
      },
    });

    expect(view.getAllByText(setupText)).toHaveLength(3);
  });

  test("omits the current panel entirely when the history has no current reservations", () => {
    const view = renderHistory("en-US", {
      kind: "available",
      groups: { current: [], past: [], unavailable: [] },
    });

    expect(
      view.container.querySelector('[data-account-reservation-group="current"]')
    ).toBeNull();
    expect(
      view.container.querySelector("#account-reservations-current-title")
    ).toBeNull();
    // The e2e readiness check anchors on the past panel's title, which renders
    // unconditionally, so reservations navigation settles even with no
    // current reservations.
    expect(
      view.container.querySelector('[data-account-reservation-group="past"]')
    ).toBeTruthy();
    expect(
      view.container.querySelector("#account-reservations-past-title")
    ).toBeTruthy();
    expect(
      view.container.querySelector(
        '[data-account-reservation-group="past"] table'
      )
    ).toBeNull();
    expect(
      view.container.querySelector('[data-account-reservation-group="past"] p')
    ).toBeTruthy();
  });

  for (const locale of ["en-US", "cs-CZ"] as const) {
    test(`labels the other party of each reservation in ${locale}`, () => {
      const view = renderHistory(locale, {
        kind: "available",
        groups: {
          current: [
            reservation({
              id: "featured-for",
              party: { kind: "booked-for", customerName: "Jana Testová" },
            }),
            reservation({
              id: "compact-by",
              party: { kind: "booked-by", authorName: "Petr Ukázka" },
            }),
          ],
          past: [
            reservation({
              id: "past-deleted",
              endsAt: "2026-08-21T10:00:00Z",
              party: { kind: "booked-by-deleted-account" },
            }),
            reservation({
              id: "past-for-unnamed",
              endsAt: "2026-08-20T10:00:00Z",
              party: { kind: "booked-for", customerName: null },
            }),
            reservation({
              id: "past-by-unnamed",
              endsAt: "2026-08-19T10:00:00Z",
              party: { kind: "booked-by", authorName: null },
            }),
            reservation({ id: "past-own", endsAt: "2026-08-18T10:00:00Z" }),
          ],
          unavailable: [],
        },
      });
      const current = view.container.querySelector(
        '[data-account-reservation-group="current"]'
      )!;
      const pastRows = view.container.querySelectorAll(
        '[data-account-reservation-group="past"] tbody tr'
      );
      const parties = (element: Element | undefined) => [
        ...(element?.querySelectorAll("[data-account-reservation-party]") ??
          []),
      ];
      const partyKinds = (element: Element | undefined) =>
        parties(element).map((party) =>
          party.getAttribute("data-account-reservation-party")
        );

      expect(partyKinds(current.querySelector("ul > li") ?? undefined)).toEqual(
        ["booked-for"]
      );
      expect(partyKinds(current)).toEqual(["booked-for", "booked-by"]);
      expect(parties(current).map((party) => party.textContent)).toEqual([
        expect.stringContaining("Jana Testová"),
        expect.stringContaining("Petr Ukázka"),
      ]);
      expect([...pastRows].map((row) => partyKinds(row))).toEqual([
        ["booked-by-deleted-account"],
        ["booked-for"],
        ["booked-by"],
        [],
      ]);
      // Unnamed parties fall back to a generic label, not a missing name.
      for (const row of [...pastRows].slice(1, 3)) {
        expect(parties(row)[0]?.textContent).not.toContain("null");
      }
    });
  }

  test("keeps the profile page usable when the reservation provider is unavailable", () => {
    const locale = "en-US";
    const view = renderHistory(locale, {
      kind: "unavailable",
      reason: "provider-unavailable",
    });

    expect(
      view.getByRole("heading", { level: 2 }).nextElementSibling?.tagName
    ).toBe("P");
    expect(
      view.container.querySelector("[data-account-reservation-group]")
    ).toBeNull();
    expect(view.queryByRole("link")).toBeNull();
    expect(view.queryByRole("button")).toBeNull();
  });
});
