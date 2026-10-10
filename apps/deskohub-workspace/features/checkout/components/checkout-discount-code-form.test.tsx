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
import { renderToStaticMarkup } from "react-dom/server";
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

const applyDiscountCodeForm = mock(
  async (_locale: string, _payStateToken: string, _formData: FormData) => {}
);
const capture = mock();
let analyticsAccepted = true;

mock.module("@/features/checkout/actions/apply-discount-code", () => ({
  applyDiscountCodeForm,
}));
mock.module("@/features/reservation/actions/submit-reservation", () => ({
  submitReservation: mock(),
}));
mock.module("posthog-js", () => ({ default: { capture } }));
mock.module("@/features/cookie-consent", () => ({
  useCookieConsent: () => ({ isAccepted: () => analyticsAccepted }),
}));

describe("CheckoutDiscountCodeForm", () => {
  beforeAll(() => {
    registerWorkspaceComponentTestEnv();
  });

  beforeEach(() => {
    analyticsAccepted = true;
    capture.mockClear();
    applyDiscountCodeForm.mockClear();
    applyDiscountCodeForm.mockImplementation(async () => {});
    workspaceUseAction.mockReturnValue({
      execute: mock(),
      isExecuting: false,
      result: {},
    });
  });

  afterEach(() => {
    cleanup();
  });

  afterAll(async () => {
    await unregisterWorkspaceComponentTestEnv();
  });

  test("prefills the requested code without disabling Apply", async () => {
    const { CheckoutDiscountCodeForm } = await import(
      "./checkout-discount-code-form"
    );
    const view = render(
      <CheckoutDiscountCodeForm
        defaultCode="SUMMER10"
        enabled
        fieldError={false}
        locale="en-US"
        payStateToken="signed-state"
      />
    );

    const codeInput = view.getByRole("textbox");
    expect(codeInput).toHaveProperty("value", "SUMMER10");
    const applyButton = view.getByRole("button", {
      name: m.checkoutDiscountCodeApply({}, { locale: "en-US" }),
    });
    expect(applyButton).toHaveProperty("disabled", false);
  });

  test("renders the rejected code in server markup before hydration", async () => {
    const { CheckoutDiscountCodeForm } = await import(
      "./checkout-discount-code-form"
    );
    const rejectedCode = "SYNTHETIC-REJECTED-CODE";
    const markup = renderToStaticMarkup(
      <CheckoutDiscountCodeForm
        defaultCode={rejectedCode}
        enabled
        fieldError
        locale="en-US"
        payStateToken="signed-state"
      />
    );
    const serverDocument = new DOMParser().parseFromString(markup, "text/html");
    const codeInput = serverDocument.querySelector("#checkout-discount-code");

    expect(codeInput?.getAttribute("value")).toBe(rejectedCode);
    expect(applyDiscountCodeForm).not.toHaveBeenCalled();
  });

  test("refreshes the prefill when a new signed state requests another code", async () => {
    const { CheckoutDiscountCodeForm } = await import(
      "./checkout-discount-code-form"
    );
    const view = render(
      <CheckoutDiscountCodeForm
        defaultCode="SUMMER10"
        enabled
        fieldError={false}
        locale="en-US"
        payStateToken="signed-state"
      />
    );

    view.rerender(
      <CheckoutDiscountCodeForm
        defaultCode="WINTER20"
        enabled
        fieldError={false}
        locale="en-US"
        payStateToken="signed-state"
      />
    );

    await waitFor(() =>
      expect(view.getByRole("textbox")).toHaveProperty("value", "WINTER20")
    );
  });

  test("keeps local edits while the requested code stays unchanged", async () => {
    const { CheckoutDiscountCodeForm } = await import(
      "./checkout-discount-code-form"
    );
    const view = render(
      <CheckoutDiscountCodeForm
        defaultCode="SUMMER10"
        enabled
        fieldError={false}
        locale="en-US"
        payStateToken="signed-state"
      />
    );

    const codeInput = view.getByRole("textbox");
    fireEvent.input(codeInput, { target: { value: "MYCODE" } });
    view.rerender(
      <CheckoutDiscountCodeForm
        defaultCode="SUMMER10"
        enabled
        fieldError={false}
        locale="en-US"
        payStateToken="signed-state"
      />
    );

    expect(view.getByRole("textbox")).toHaveProperty("value", "MYCODE");
  });

  test("shows the applied adjustment instead of a prefilled code field", async () => {
    const { CheckoutDiscountCodeForm } = await import(
      "./checkout-discount-code-form"
    );
    const view = render(
      <CheckoutDiscountCodeForm
        appliedAdjustment={{ kind: "percentage", basisPoints: 2000 }}
        defaultCode="SUMMER10"
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
    expect(view.queryByRole("textbox")).toBeNull();
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

  test("posts the raw field through the bound server action", async () => {
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

    const codeInput = view.getByRole("textbox");
    expect(codeInput.getAttribute("name")).toBe("submittedCode");
    expect(codeInput).toHaveProperty("value", "");
    expect(codeInput.getAttribute("data-ph-mask")).not.toBeNull();
    const form = codeInput.closest("form");
    expect(form?.id).toBe("checkout-discount-code-form");
    expect(form?.getAttribute("action")).toBeTruthy();

    fireEvent.input(codeInput, { target: { value: " not valid! " } });
    expect(codeInput).toHaveProperty("value", " not valid! ");
    fireEvent.click(
      view.getByRole("button", {
        name: m.checkoutDiscountCodeApply({}, { locale: "en-US" }),
      })
    );

    await waitFor(() => expect(applyDiscountCodeForm).toHaveBeenCalledTimes(1));
    const [locale, payStateToken, formData] =
      applyDiscountCodeForm.mock.calls[0] ?? [];
    expect(locale).toBe("en-US");
    expect(payStateToken).toBe("signed-state");
    expect(formData?.get("submittedCode")).toBe(" not valid! ");
  });

  test("shows one field error while retaining the form", async () => {
    const { CheckoutDiscountCodeForm } = await import(
      "./checkout-discount-code-form"
    );
    const view = render(
      <CheckoutDiscountCodeForm
        defaultCode="SAVE20"
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
    expect(view.getByRole("textbox")).toHaveProperty("value", "SAVE20");
    await waitFor(() => {
      expect(capture).toHaveBeenCalledWith("pre-payment outcome", {
        outcome: "discount_rejected",
      });
    });
  });

  test("does not capture a rejection that occurred before analytics consent", async () => {
    analyticsAccepted = false;
    const { CheckoutDiscountCodeForm } = await import(
      "./checkout-discount-code-form"
    );
    const view = render(
      <CheckoutDiscountCodeForm
        defaultCode="SAVE20"
        enabled
        fieldError
        locale="en-US"
        payStateToken="signed-state"
      />
    );

    await waitFor(() => expect(capture).not.toHaveBeenCalled());

    analyticsAccepted = true;
    view.rerender(
      <CheckoutDiscountCodeForm
        defaultCode="SAVE20"
        enabled
        fieldError
        locale="en-US"
        payStateToken="signed-state"
      />
    );

    await waitFor(() => expect(capture).not.toHaveBeenCalled());
  });

  test("captures each rejected discount submission", async () => {
    const { CheckoutDiscountCodeForm } = await import(
      "./checkout-discount-code-form"
    );
    const view = render(
      <CheckoutDiscountCodeForm
        defaultCode="SAVE20"
        enabled
        fieldError
        locale="en-US"
        payStateToken="signed-state"
        rejectionId="synthetic-rejection-one"
      />
    );

    await waitFor(() => expect(capture).toHaveBeenCalledTimes(1));

    view.rerender(
      <CheckoutDiscountCodeForm
        defaultCode="WINTER20"
        enabled
        fieldError
        locale="en-US"
        payStateToken="signed-state"
        rejectionId="synthetic-rejection-two"
      />
    );

    await waitFor(() => expect(capture).toHaveBeenCalledTimes(2));
    await waitFor(() =>
      expect(view.getByRole("textbox")).toHaveProperty("value", "WINTER20")
    );
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

  test("keeps payment independent while the code action is pending", async () => {
    let resolveAction: (() => void) | undefined;
    applyDiscountCodeForm.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolveAction = resolve;
        })
    );
    const { CheckoutPayPage } = await import("./checkout-pay-page");
    const { CheckoutDiscountCodeForm } = await import(
      "./checkout-discount-code-form"
    );
    const quote = buildCoworkReservationQuote({
      entryTier: "basic",
      coffee: false,
    });
    const view = render(
      <CheckoutPayPage
        discountCodeForm={
          <CheckoutDiscountCodeForm
            enabled
            fieldError={false}
            locale="en-US"
            payStateToken="signed-state"
          />
        }
        locale="en-US"
        payStateToken="signed-state"
        summary={quote.summary}
        variant="pay"
      />
    );

    const codeInput = view.getByRole("textbox");
    fireEvent.input(codeInput, { target: { value: "SAVE20" } });
    fireEvent.click(
      view.getByRole("button", {
        name: m.checkoutDiscountCodeApply({}, { locale: "en-US" }),
      })
    );

    await waitFor(() =>
      expect(
        view.getByRole("button", {
          name: m.checkoutDiscountCodeApplying({}, { locale: "en-US" }),
        })
      ).toHaveProperty("disabled", true)
    );
    fireEvent.click(view.getByRole("checkbox"));
    expect(
      view.getByRole("button", {
        name: m.checkoutPayOrderAndPayButton({}, { locale: "en-US" }),
      })
    ).toHaveProperty("disabled", false);

    resolveAction?.();
    await waitFor(() =>
      expect(
        view.getByRole("button", {
          name: m.checkoutDiscountCodeApply({}, { locale: "en-US" }),
        })
      ).toHaveProperty("disabled", false)
    );
  });
});
