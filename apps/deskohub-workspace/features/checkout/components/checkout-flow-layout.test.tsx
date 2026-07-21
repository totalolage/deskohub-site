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

  test("links only configured steps and keeps the active step current", () => {
    const reservationHref =
      "/en-US/checkout/order?payState=encrypted-pay-state";
    const view = render(
      <CheckoutSteps
        activeStepKey="pay"
        locale="en-US"
        stepHrefs={{ order: reservationHref }}
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
  });
});
