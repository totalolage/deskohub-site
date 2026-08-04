import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  test,
} from "bun:test";
import { cleanup, render, within } from "@testing-library/react";
import {
  registerWorkspaceComponentTestEnv,
  unregisterWorkspaceComponentTestEnv,
} from "@/shared/testing/workspace-component-test-env";
import { ReservationTable, ReservationTimeline } from "./components";
import { loadFixtureReservation, loadFixtureReservations } from "./fixtures";

describe("administration reservation components", () => {
  beforeAll(() => registerWorkspaceComponentTestEnv());
  afterEach(() => cleanup());
  afterAll(() => unregisterWorkspaceComponentTestEnv());

  test("renders a semantic reservation table with friendly status labels", () => {
    const { items } = loadFixtureReservations({});
    const view = render(<ReservationTable reservations={items} />);
    const table = view.getByRole("table", { name: "Reservations" });
    expect(within(table).getAllByText("Confirmation issue")).not.toHaveLength(
      0
    );
    expect(
      within(table)
        .getAllByRole("link", { name: "Meeting room" })[0]
        .getAttribute("href")
    ).toBe("/admin/reservations/0198-admin-fixture-attention");
  });

  test("renders ordered operational history without forbidden fields", () => {
    const detail = loadFixtureReservation("0198-admin-fixture-attention");
    expect(detail).not.toBeNull();
    if (!detail) return;
    const serialized = JSON.stringify(detail);
    expect(serialized).not.toContain("customerAccessCode");
    expect(serialized).not.toContain("securityToken");
    expect(serialized).not.toContain("providerRedirectUrl");
    expect(serialized).not.toContain("rawPayload");

    const view = render(<ReservationTimeline items={detail.timeline} />);
    const timeline = view.getByRole("list", {
      name: "Reservation history",
    });
    expect(within(timeline).getAllByRole("listitem")).toHaveLength(5);
    expect(within(timeline).getByText("Payment started")).toBeDefined();
  });
});
