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

  afterAll(async () => {
    await unregisterWorkspaceComponentTestEnv();
  });

  test("shows the current PIN and leaves validity to the lock", () => {
    const view = render(
      <ReservationAccessPage
        access={{
          state: "available",
          code: "2468",
          accessStartsAt: Temporal.Instant.from("2026-08-13T08:00:00Z"),
          accessEndsAt: Temporal.Instant.from("2026-08-13T16:00:00Z"),
        }}
        locale="en-US"
        orderId="reservation-access-page"
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
    expect(
      view.getByText(
        /The lock accepts this PIN from Aug 13, 2026(?:,| at) 10:00 AM until Aug 13, 2026(?:,| at) 6:00 PM\./
      )
    ).toBeDefined();
    expect(view.container.querySelector("[data-reservation-access]")).toBe(
      code.closest("[data-reservation-access]")
    );
  });

  test("shows a code unavailable for any reason the same way", () => {
    const markupFor = (reason: "reservation-state" | "lookup-failed") => {
      const view = render(
        <ReservationAccessPage
          access={{ state: "unavailable", reason }}
          locale="en-US"
          orderId="reservation-access-page"
        />
      );
      const markup = view.container.innerHTML;
      cleanup();
      return markup;
    };

    expect(markupFor("lookup-failed")).toBe(markupFor("reservation-state"));
  });
});
