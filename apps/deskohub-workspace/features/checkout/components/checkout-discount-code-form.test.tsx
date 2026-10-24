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
import { formatReferralInvitationDiscount } from "@/features/referrals/client";
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
mock.module("@/features/cookie-consent/analytics-events", () => ({
  captureAnalyticsEvent: capture,
}));
mock.module("@/features/cookie-consent", () => ({
  useCookieConsent: () => ({ isAccepted: () => analyticsAccepted }),
}));

describe("CheckoutDiscountCodeForm", () => {
  beforeAll(() => {
    registerWorkspaceComponentTestEnv();
  });

  beforeEach(() => {
    analyticsAccepted = true;
    applyDiscountCodeForm.mockClear();
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
    expect(view.queryByRole("alert")).toBeNull();
    expect(codeInput.getAttribute("aria-invalid")).toBeNull();
    expect(applyDiscountCodeForm).not.toHaveBeenCalled();
    expect(capture).not.toHaveBeenCalled();
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
        rejection="unavailable"
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
        locale="en-US"
        payStateToken="signed-state"
      />
    );

    view.rerender(
      <CheckoutDiscountCodeForm
        defaultCode="WINTER20"
        enabled
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
        locale="en-US"
        payStateToken="signed-state"
      />
    );

    expect(view.getByRole("textbox")).toHaveProperty("value", "MYCODE");
  });

  test("clears the ordinary code after referral acceptance refreshes pay state", async () => {
    const { CheckoutDiscountCodeForm } = await import(
      "./checkout-discount-code-form"
    );
    const view = render(
      <CheckoutDiscountCodeForm
        enabled
        locale="en-US"
        payStateToken="before-referral"
      />
    );

    const codeInput = view.getByRole("textbox");
    fireEvent.input(codeInput, { target: { value: "ORDINARY10" } });
    fireEvent.click(
      view.getByRole("button", {
        name: m.checkoutDiscountCodeApply({}, { locale: "en-US" }),
      })
    );

    await waitFor(() => expect(applyDiscountCodeForm).toHaveBeenCalledTimes(1));
    const [firstLocale, firstToken, firstFormData] =
      applyDiscountCodeForm.mock.calls[0] ?? [];
    expect(firstLocale).toBe("en-US");
    expect(firstToken).toBe("before-referral");
    expect(firstFormData?.get("submittedCode")).toBe("ORDINARY10");

    view.rerender(
      <CheckoutDiscountCodeForm
        enabled
        locale="en-US"
        payStateToken="after-referral"
        referralApplied
      />
    );

    await waitFor(() =>
      expect(view.getByRole("textbox")).toHaveProperty("value", "")
    );
    expect(
      view.getByText(
        m.checkoutReferralDiscountApplied(
          { discount: formatReferralInvitationDiscount("en-US") },
          { locale: "en-US" }
        )
      )
    ).toBeDefined();
    expect(
      view.getByRole("button", {
        name: m.checkoutDiscountCodeApply({}, { locale: "en-US" }),
      })
    ).toHaveProperty("disabled", false);
    expect(
      view.container.querySelector("form")?.getAttribute("action")
    ).toBeTruthy();
    expect(applyDiscountCodeForm).toHaveBeenCalledTimes(1);

    fireEvent.input(view.getByRole("textbox"), {
      target: { value: "NEXTCODE" },
    });
    fireEvent.click(
      view.getByRole("button", {
        name: m.checkoutDiscountCodeApply({}, { locale: "en-US" }),
      })
    );

    await waitFor(() => expect(applyDiscountCodeForm).toHaveBeenCalledTimes(2));
    const [nextLocale, nextToken, nextFormData] =
      applyDiscountCodeForm.mock.calls[1] ?? [];
    expect(nextLocale).toBe("en-US");
    expect(nextToken).toBe("after-referral");
    expect(nextFormData?.get("submittedCode")).toBe("NEXTCODE");
  });

  test.each(["en-US", "cs-CZ"] as const)(
    "shows the %s referral confirmation and leaves the ordinary code form available",
    async (locale) => {
      const { CheckoutDiscountCodeForm } = await import(
        "./checkout-discount-code-form"
      );
      const view = render(
        <CheckoutDiscountCodeForm
          enabled
          locale={locale}
          payStateToken="signed-state"
          referralApplied
        />
      );

      // Compare raw text: cs-CZ percentages contain a no-break space that
      // getByText's whitespace normalization would collapse.
      expect(
        view.container.querySelector("[data-checkout-referral-applied]")
          ?.textContent
      ).toBe(
        m.checkoutReferralDiscountApplied(
          { discount: formatReferralInvitationDiscount(locale) },
          { locale }
        )
      );
      const codeInput = view.getByRole("textbox") as HTMLInputElement;
      expect(codeInput.name).toBe("submittedCode");
      expect(codeInput.disabled).toBe(false);
      expect(
        view.getByRole("button", {
          name: m.checkoutDiscountCodeApply({}, { locale }),
        })
      ).toHaveProperty("disabled", false);
    }
  );

  test("posts the raw field through the bound server action", async () => {
    const { CheckoutDiscountCodeForm } = await import(
      "./checkout-discount-code-form"
    );
    const view = render(
      <CheckoutDiscountCodeForm
        enabled
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
        rejection="unavailable"
        locale="en-US"
        payStateToken="signed-state"
      />
    );

    const error = view.getByRole("alert");
    expect(error.textContent).toBe(
      m.checkoutDiscountCodeUnavailable({}, { locale: "en-US" })
    );
    expect(view.getByRole("textbox").getAttribute("aria-invalid")).toBe("true");
    expect(applyDiscountCodeForm).not.toHaveBeenCalled();
    expect(view.getByRole("textbox")).toHaveProperty("value", "SAVE20");
    await waitFor(() => {
      expect(capture).toHaveBeenCalledWith("pre-payment outcome", {
        outcome: "discount_rejected",
      });
    });
  });

  test.each(["en-US", "cs-CZ"] as const)(
    "renders the automated-request rejection in %s",
    async (locale) => {
      const { CheckoutDiscountCodeForm } = await import(
        "./checkout-discount-code-form"
      );
      const view = render(
        <CheckoutDiscountCodeForm
          defaultCode="SAVE20"
          enabled
          rejection="automated-request"
          locale={locale}
          payStateToken="signed-state"
        />
      );

      expect(view.getByRole("alert").textContent).toBe(
        m.automatedRequestRejected({}, { locale })
      );
    }
  );

  test.each([
    ["referral-already-attributed", m.checkoutReferralCodeAlreadyAttributed],
    ["referral-ineligible", m.checkoutReferralCodeIneligible],
  ] as const)(
    "explains the %s rejection in the field alert",
    async (rejection, message) => {
      const { CheckoutDiscountCodeForm } = await import(
        "./checkout-discount-code-form"
      );
      const view = render(
        <CheckoutDiscountCodeForm
          defaultCode="RFL12345"
          enabled
          rejection={rejection}
          locale="cs-CZ"
          payStateToken="signed-state"
        />
      );

      const error = view.getByRole("alert");
      expect(error.id).toBe("checkout-discount-code-error");
      expect(error.textContent).toBe(message({}, { locale: "cs-CZ" }));
      expect(view.getByRole("textbox").getAttribute("aria-invalid")).toBe(
        "true"
      );
      await waitFor(() => {
        expect(capture).toHaveBeenCalledWith("pre-payment outcome", {
          outcome: "discount_rejected",
        });
      });
    }
  );

  test("does not capture a rejection that occurred before analytics consent", async () => {
    analyticsAccepted = false;
    const { CheckoutDiscountCodeForm } = await import(
      "./checkout-discount-code-form"
    );
    const view = render(
      <CheckoutDiscountCodeForm
        defaultCode="SAVE20"
        enabled
        rejection="unavailable"
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
        rejection="unavailable"
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
        rejection="unavailable"
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
        rejection="unavailable"
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
        name: (name) =>
          name.startsWith(
            m.checkoutPayOrderAndPayButton({}, { locale: "en-US" })
          ),
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
