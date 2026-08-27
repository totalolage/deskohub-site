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
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import {
  buildCoworkCheckoutSummary,
  buildCoworkReservationQuote as buildCoworkPriceQuote,
} from "@/features/checkout/checkout-quote.test-utils";
import { m } from "@/features/i18n";
import { workspaceUseAction } from "@/shared/testing/workspace-component-module-mocks";
import {
  registerWorkspaceComponentTestEnv,
  unregisterWorkspaceComponentTestEnv,
} from "@/shared/testing/workspace-component-test-env";

const buildCoworkReservationQuote = (
  ...args: Parameters<typeof buildCoworkPriceQuote>
) => ({
  ...buildCoworkPriceQuote(...args),
  summary: buildCoworkCheckoutSummary(...args),
});

const applyDiscountCodeForm = mock();
const capture = mock();

mock.module("@/features/checkout/actions/apply-discount-code", () => ({
  applyDiscountCodeForm,
}));
mock.module("@/features/reservation/actions/submit-reservation", () => ({
  submitReservation: mock(),
}));
mock.module("posthog-js", () => ({ default: { capture } }));
mock.module("@/features/cookie-consent", () => ({
  useCookieConsent: () => ({ isAccepted: () => true }),
}));

describe("CheckoutDiscountCodeForm", () => {
  beforeAll(() => {
    registerWorkspaceComponentTestEnv();
  });

  beforeEach(() => {
    capture.mockClear();
    workspaceUseAction.mockReturnValue({
      execute: mock(),
      isExecuting: false,
      result: {},
    });
  });

  afterEach(() => {
    cleanup();
  });

  afterAll(() => {
    unregisterWorkspaceComponentTestEnv();
  });

  test("stays hidden while its server-evaluated release gate is disabled", async () => {
    const { CheckoutDiscountCodeForm } = await import(
      "./checkout-discount-code-form"
    );
    const view = render(
      <CheckoutDiscountCodeForm
        enabled={false}
        fieldError={false}
        locale="en-US"
        payStateToken="signed-state"
      />
    );

    expect(view.queryByRole("textbox")).toBeNull();
  });

  test("posts the raw field through a form action", async () => {
    const { CheckoutDiscountCodeForm } = await import(
      "./checkout-discount-code-form"
    );
    const view = render(
      <CheckoutDiscountCodeForm
        enabled
        fieldError={false}
        locale="en-US"
        payStateToken="signed-state"
      />
    );

    const codeInput = view.getByRole("textbox") as HTMLInputElement;
    expect(codeInput.name).toBe("submittedCode");
    expect(codeInput.value).toBe("");
    expect(codeInput.getAttribute("data-ph-mask")).not.toBeNull();
    expect(codeInput.closest("form")?.id).toBe("checkout-discount-code-form");
  });

  test("shows one field error while retaining the form", async () => {
    const { CheckoutDiscountCodeForm } = await import(
      "./checkout-discount-code-form"
    );
    const view = render(
      <CheckoutDiscountCodeForm
        enabled
        fieldError
        locale="en-US"
        payStateToken="signed-state"
      />
    );

    const error = view.getByRole("alert");
    expect(error.textContent).toBe(
      m.checkoutDiscountCodeUnavailable({}, { locale: "en-US" })
    );
    expect(error.className).toContain("bg-burned-orange/8");
    expect(error.className).toContain("text-burned-orange-ink");
    expect(view.getByRole("textbox").getAttribute("aria-invalid")).toBe("true");
    await waitFor(() => {
      expect(capture).toHaveBeenCalledWith("pre-payment outcome", {
        outcome: "discount_rejected",
      });
    });
  });

  test("celebrates the applied adjustment without showing the code", async () => {
    const { CheckoutDiscountCodeForm } = await import(
      "./checkout-discount-code-form"
    );
    const view = render(
      <CheckoutDiscountCodeForm
        appliedAdjustment={{ kind: "percentage", basisPoints: 2000 }}
        enabled={false}
        fieldError={false}
        locale="en-US"
        payStateToken="signed-state"
      />
    );

    expect(
      view.getByText(
        m.checkoutDiscountCodeApplied({ discount: "20%" }, { locale: "en-US" })
      )
    ).toBeDefined();
    const status = view.getByRole("status");
    expect(status.className).toContain("bg-aquamarine-green/12");
    expect(status.className).toContain("text-aquamarine-ink");
    expect(view.queryByRole("textbox")).toBeNull();
  });

  test("keeps payment independent from the code form pending state", async () => {
    const { CheckoutPayPage } = await import("./checkout-pay-page");
    const quote = buildCoworkReservationQuote({
      entryTier: "basic",
      coffee: false,
    });
    const view = render(
      <CheckoutPayPage
        discountCodeForm={
          <button disabled type="submit">
            {m.checkoutDiscountCodeApplying({}, { locale: "en-US" })}
          </button>
        }
        locale="en-US"
        payStateToken="signed-state"
        summary={quote.summary}
        variant="pay"
      />
    );

    expect(
      view.getByRole("button", {
        name: m.checkoutDiscountCodeApplying({}, { locale: "en-US" }),
      })
    ).toHaveProperty("disabled", true);
    for (const checkbox of view.getAllByRole("checkbox")) {
      fireEvent.click(checkbox);
    }
    expect(
      view.getByRole("button", {
        name: m.checkoutPayOrderAndPayButton({}, { locale: "en-US" }),
      })
    ).toHaveProperty("disabled", false);
  });
});
