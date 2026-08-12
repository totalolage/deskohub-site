import "@/shared/polyfills/temporal";

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
import { ReservationAccessPage } from "./reservation-access-page";

describe("ReservationAccessPage", () => {
  beforeAll(() => {
    registerWorkspaceComponentTestEnv();
  });

  afterEach(() => {
    cleanup();
  });

  afterAll(() => {
    unregisterWorkspaceComponentTestEnv();
  });

  test("shows the current PIN only in the available state", () => {
    const view = render(
      <ReservationAccessPage
        access={{
          state: "available",
          code: "SYNTHETIC",
          unavailableAt: Temporal.Instant.from("2026-06-20T11:30:00Z"),
        }}
        locale="en-US"
      />
    );

    const code = view.getByText("SYNTHETIC");
    expect(code.getAttribute("data-ph-mask")).toBe("");
    expect(code.getAttribute("data-ph-no-capture")).toBe("");
    expect(code.getAttribute("data-reservation-access-code")).toBe("");
    expect(view.getByText("Your current access PIN")).toBeDefined();
    expect(view.container.querySelector("[data-reservation-access]")).toBe(
      code.closest("[data-reservation-access]")
    );
  });

  test("shows the opening time without serializing a PIN before the window", () => {
    const view = render(
      <ReservationAccessPage
        access={{
          state: "upcoming",
          availableAt: Temporal.Instant.from("2026-06-20T06:30:00Z"),
          unavailableAt: Temporal.Instant.from("2026-06-20T11:30:00Z"),
        }}
        locale="en-US"
      />
    );

    expect(view.getByText("Your access PIN will appear here")).toBeDefined();
    expect(
      view.container.querySelector("[data-reservation-access-code]")
    ).toBeNull();
  });

  test("explains when the PIN display window has ended", () => {
    const view = render(
      <ReservationAccessPage access={{ state: "ended" }} locale="en-US" />
    );

    expect(view.getByText("The PIN display window has ended")).toBeDefined();
    expect(
      view.container.querySelector("[data-reservation-access-code]")
    ).toBeNull();
  });

  test("fails closed when reservation access is unavailable", () => {
    const view = render(
      <ReservationAccessPage access={{ state: "unavailable" }} locale="en-US" />
    );

    expect(view.getByText("The access PIN is unavailable")).toBeDefined();
    expect(
      view.container.querySelector("[data-reservation-access-code]")
    ).toBeNull();
  });
});
