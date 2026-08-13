import "@/shared/polyfills/temporal";

import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  jest,
  test,
} from "bun:test";
import { act, cleanup, render } from "@testing-library/react";
import {
  registerWorkspaceComponentTestEnv,
  unregisterWorkspaceComponentTestEnv,
} from "@/shared/testing/workspace-component-test-env";
import { countdownFill } from "./reservation-access-countdown";
import { ReservationAccessPage } from "./reservation-access-page";

test("maps remaining duration to countdown fill", () => {
  expect(countdownFill(-1)).toBe(0);
  expect(countdownFill(0)).toBe(0);
  expect(countdownFill(60 * 60 * 1000)).toBeCloseTo(0.5);
  expect(countdownFill(Number.MAX_VALUE)).toBe(1);
});

describe("ReservationAccessPage", () => {
  beforeAll(() => {
    registerWorkspaceComponentTestEnv();
  });

  afterEach(() => {
    cleanup();
    jest.useRealTimers();
  });

  afterAll(() => {
    unregisterWorkspaceComponentTestEnv();
  });

  test("shows the current PIN only in the available state", () => {
    const view = render(
      <ReservationAccessPage
        access={{
          state: "available",
          code: "2468",
          unavailableAt: Temporal.Instant.from("2026-06-20T11:30:00Z"),
        }}
        locale="en-US"
      />
    );

    const code = view.container.querySelector("[data-reservation-access-code]");
    if (!code) throw new Error("Access code output missing");
    expect(code.getAttribute("data-ph-mask")).toBe("");
    expect(code.getAttribute("data-ph-no-capture")).toBe("");
    expect(code.getAttribute("data-reservation-access-code")).toBe("");
    expect(code.getAttribute("aria-label")).toBe("2 4 6 8");
    expect(Array.from(code.children, (child) => child.textContent)).toEqual([
      "2",
      "4",
      "6",
      "8",
    ]);
    expect(view.getByText("Your access PIN")).toBeDefined();
    expect(view.getByText(/Available until/)).toBeDefined();
    expect(view.container.querySelector("[data-reservation-access]")).toBe(
      code.closest("[data-reservation-access]")
    );
  });

  test("shows the opening time without serializing a PIN before the window", () => {
    jest.useFakeTimers({
      now: new Date("2026-06-20T06:28:55Z"),
    });
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

    expect(view.getByText("Your access PIN")).toBeDefined();
    expect(view.getByRole("timer").textContent).toBe("available in 00:01:05");
    expect(view.getByRole("timer").getAttribute("aria-label")).toBe(
      "Access code available in 1 minute and 5 seconds"
    );
    expect(
      view.getByRole("timer").querySelector("svg[aria-hidden='true']")
    ).not.toBeNull();

    act(() => jest.advanceTimersByTime(1000));
    expect(view.getByRole("timer").textContent).toBe("available in 00:01:04");
    expect(view.getByRole("timer").getAttribute("aria-label")).toBe(
      "Access code available in 1 minute and 4 seconds"
    );

    act(() => jest.advanceTimersByTime(64_000));
    expect(view.getByRole("timer").textContent).toBe("Checking access…");
    expect(
      view.container.querySelector("[data-reservation-access-code]")
    ).toBeNull();
  });

  test("shows a farewell and contact link after the reservation", () => {
    const view = render(
      <ReservationAccessPage access={{ state: "ended" }} locale="en-US" />
    );

    expect(
      view.getByText("We're looking forward to seeing you again!")
    ).toBeDefined();
    expect(
      view.getByRole("link", { name: "contact us" }).getAttribute("href")
    ).toBe("/en-US/contact");
    expect(view.queryByText(/PIN display window/)).toBeNull();
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
