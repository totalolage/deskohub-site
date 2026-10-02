import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  test,
} from "bun:test";
import { cleanup, render } from "@testing-library/react";
import { m } from "@/features/i18n";
import {
  registerWorkspaceComponentTestEnv,
  unregisterWorkspaceComponentTestEnv,
} from "@/shared/testing/workspace-component-test-env";
import { CheckoutSteps } from "./checkout-flow-layout";

describe("CheckoutSteps", () => {
  beforeAll(() => {
    registerWorkspaceComponentTestEnv();
  });

  afterEach(() => {
    cleanup();
  });

  afterAll(() => {
    unregisterWorkspaceComponentTestEnv();
  });

  test("renders four ordered steps starting with the display-only choose-space step", () => {
    const view = render(<CheckoutSteps activeStepKey="pay" locale="en-US" />);
    const items = view.getAllByRole("listitem");

    expect(items).toHaveLength(4);
    expect(items[0]?.textContent).toContain(
      m.checkoutOrderStepChooseSpace({}, { locale: "en-US" })
    );
    expect(items[1]?.textContent).toContain(
      m.checkoutOrderStepReservation({}, { locale: "en-US" })
    );
    expect(items[2]?.textContent).toContain(
      m.checkoutOrderStepPayment({}, { locale: "en-US" })
    );
    expect(items[3]?.textContent).toContain(
      m.checkoutOrderStepAccess({}, { locale: "en-US" })
    );
  });

  test("keeps the choose-space step completed and never current for every active step", () => {
    for (const activeStepKey of ["order", "pay", "access"] as const) {
      const view = render(
        <CheckoutSteps activeStepKey={activeStepKey} locale="en-US" />
      );
      const completedLabel = m.checkoutOrderStepCompleted(
        {},
        { locale: "en-US" }
      );
      const chooseSpaceItem = view
        .getByText(m.checkoutOrderStepChooseSpace({}, { locale: "en-US" }))
        .closest("li");

      expect(chooseSpaceItem).not.toBeNull();
      expect(chooseSpaceItem?.getAttribute("aria-current")).toBeNull();
      expect(chooseSpaceItem?.querySelector("svg.lucide-check")).not.toBeNull();
      expect(chooseSpaceItem?.querySelector(".sr-only")?.textContent).toBe(
        completedLabel
      );
      expect(chooseSpaceItem?.textContent).toContain(completedLabel);
      cleanup();
    }
  });

  test("renders catalog step labels in both locales", () => {
    for (const locale of ["en-US", "cs-CZ"] as const) {
      const view = render(
        <CheckoutSteps activeStepKey="order" locale={locale} />
      );

      expect(
        view.getByText(m.checkoutOrderStepChooseSpace({}, { locale }))
      ).toBeTruthy();
      expect(
        view.getByText(m.checkoutOrderStepCompleted({}, { locale }))
      ).toBeTruthy();
      expect(
        view.getByText(m.checkoutOrderStepReservation({}, { locale }))
      ).toBeTruthy();
      expect(
        view.getByText(m.checkoutOrderStepPayment({}, { locale }))
      ).toBeTruthy();
      expect(
        view.getByText(m.checkoutOrderStepAccess({}, { locale }))
      ).toBeTruthy();
      cleanup();
    }
  });

  test("keeps one current step and numbers real steps two through four", () => {
    const view = render(<CheckoutSteps activeStepKey="pay" locale="en-US" />);
    const currentItems = view
      .getAllByRole("listitem")
      .filter((item) => item.getAttribute("aria-current") === "step");

    expect(currentItems).toHaveLength(1);
    expect(currentItems[0]?.textContent).toContain(
      m.checkoutOrderStepPayment({}, { locale: "en-US" })
    );
    expect(view.getByText("2").closest("li")?.textContent).toContain(
      m.checkoutOrderStepReservation({}, { locale: "en-US" })
    );
    expect(view.getByText("3").closest("li")?.textContent).toContain(
      m.checkoutOrderStepPayment({}, { locale: "en-US" })
    );
    expect(view.getByText("4").closest("li")?.textContent).toContain(
      m.checkoutOrderStepAccess({}, { locale: "en-US" })
    );
    expect(view.queryByText("1")).toBeNull();
  });

  test("links only configured real steps and never links the choose-space step", () => {
    const reservationHref =
      "/en-US/reservation/cowork?payState=encrypted-pay-state";
    const view = render(
      <CheckoutSteps
        activeStepKey="pay"
        locale="en-US"
        stepLinks={{ order: { href: reservationHref, prefetch: false } }}
      />
    );
    const reservationLabel = m.checkoutOrderStepReservation(
      {},
      { locale: "en-US" }
    );
    const paymentLabel = m.checkoutOrderStepPayment({}, { locale: "en-US" });

    expect(
      view
        .getByRole("link", { name: new RegExp(reservationLabel, "i") })
        .getAttribute("href")
    ).toBe(reservationHref);
    expect(
      view.getByText(paymentLabel).closest("li")?.getAttribute("aria-current")
    ).toBe("step");
    expect(
      view.queryByRole("link", { name: new RegExp(paymentLabel, "i") })
    ).toBeNull();
    expect(
      view.queryByRole("link", {
        name: new RegExp(
          m.checkoutOrderStepChooseSpace({}, { locale: "en-US" }),
          "i"
        ),
      })
    ).toBeNull();
  });
});
