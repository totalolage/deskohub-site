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
import type { CustomerReservationSummary } from "../contracts";

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
    const view = render(
      <ReservationHistory locale="en-US" history={availableHistory} />
    );

    expect(view.getByText("Current and upcoming")).toBeTruthy();
    expect(view.getByText("Past reservations")).toBeTruthy();
    expect(view.getByText("Reservations missing date details")).toBeTruthy();

    const group = (id: string) =>
      view.container.querySelector(`[data-account-reservation-group="${id}"]`)!;

    expect(group("current").textContent).toContain("1");
    expect(group("past").textContent).toContain("2");
    expect(group("unavailable").textContent).toContain("1");

    expect(group("past").textContent).toContain("Cancelled");
    expect(group("current").textContent).toContain("Confirmed");
  });

  test("renders localized group titles and statuses in Czech", () => {
    const view = render(
      <ReservationHistory locale="cs-CZ" history={availableHistory} />
    );

    expect(view.getByText("Aktuální a nadcházející")).toBeTruthy();
    expect(view.getByText("Minulé rezervace")).toBeTruthy();
    expect(view.getByText("Rezervace bez údaje o datu")).toBeTruthy();
    expect(view.getByText("Zrušeno")).toBeTruthy();
  });

  test("links a persisted reservation to its encoded English status URL", () => {
    const view = render(
      <ReservationHistory locale="en-US" history={linkedHistory} />
    );

    const link = view.getByRole("link");
    expect(link.getAttribute("href")).toBe(
      "/en-US/reservation/status/workspace%20reservation%2F1"
    );
  });

  test("links a persisted reservation to its encoded Czech status URL", () => {
    const view = render(
      <ReservationHistory locale="cs-CZ" history={linkedHistory} />
    );

    const link = view.getByRole("link");
    expect(link.getAttribute("href")).toBe(
      "/cs-CZ/reservation/status/workspace%20reservation%2F1"
    );
  });

  test("does not create a fake link from a provider-only reservation id", () => {
    const view = render(
      <ReservationHistory
        locale="en-US"
        history={{
          kind: "available",
          groups: {
            current: [reservation({ id: "provider-only-id" })],
            past: [],
            unavailable: [],
          },
        }}
      />
    );

    expect(view.queryByRole("link")).toBeNull();
    expect(view.container.querySelector("li a")).toBeNull();
  });

  test("keeps linked reservations as focusable native list-item anchors", () => {
    const view = render(
      <ReservationHistory locale="en-US" history={linkedHistory} />
    );

    const link = view.getByRole("link");
    expect(link.tagName).toBe("A");
    expect(link.getAttribute("role")).toBeNull();
    expect(link.getAttribute("tabindex")).toBeNull();
    expect(link.tabIndex).toBe(0);
    link.focus();
    expect(document.activeElement).toBe(link);
    const item = link.closest("li");
    expect(item).toBeTruthy();
    expect(item?.className).not.toContain("p-4");
    expect(link.className).toContain("p-4");
    expect(link.className).toContain("pr-10");
    expect(link.querySelector("svg")?.getAttribute("aria-hidden")).toBe("true");
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
          <ReservationHistory locale="en-US" history={linkedHistory} />
        </UnsavedChangesProvider>
      );
      const link = view.getByRole("link");
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
    const view = render(
      <ReservationHistory
        locale="en-US"
        history={{
          kind: "available",
          groups: { current: [], past: [], unavailable: [] },
        }}
      />
    );

    expect(
      view.getByText("You have no current or upcoming reservations.")
    ).toBeTruthy();
    expect(view.getByText("You have no past reservations yet.")).toBeTruthy();
  });

  test("keeps the profile page usable when the reservation provider is unavailable", () => {
    const view = render(
      <ReservationHistory
        locale="en-US"
        history={{ kind: "unavailable", reason: "provider-unavailable" }}
      />
    );

    expect(
      view.getByText("Reservation history is temporarily unavailable")
    ).toBeTruthy();
    expect(
      view.getByText(
        "Our booking system could not be reached. Your profile is still available, please try again later."
      )
    ).toBeTruthy();
  });
});
