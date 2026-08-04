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
import { AdministrationBreadcrumbs } from "./admin-shell";
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
      within(table).getAllByRole("link", { name: "Meeting Room" })[0].className
    ).toContain("before:absolute");
    expect(
      within(table)
        .getAllByRole("link", { name: "Meeting Room" })[0]
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

  test("identifies customer and reservation entities in breadcrumbs", () => {
    const view = render(
      <AdministrationBreadcrumbs
        entityLabel="Ada Lovelace"
        segments={["admin", "customers", "customer-ada"]}
      />
    );
    expect(view.getByText("Ada Lovelace")).toBeDefined();

    view.rerender(
      <AdministrationBreadcrumbs
        entityLabel="Cowork Basic"
        segments={["admin", "reservations", "reservation-basic"]}
      />
    );
    expect(view.getByText("Cowork Basic")).toBeDefined();
  });
});
