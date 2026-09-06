import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  test,
} from "bun:test";
import { cleanup, render } from "@testing-library/react";
import {
  registerWorkspaceComponentTestEnv,
  unregisterWorkspaceComponentTestEnv,
} from "@/shared/testing/workspace-component-test-env";
import type { CustomerReservationSummary } from "../contracts";
import { ReservationHistory } from "./reservation-history";

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

describe("ReservationHistory", () => {
  beforeAll(() => {
    registerWorkspaceComponentTestEnv();
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
