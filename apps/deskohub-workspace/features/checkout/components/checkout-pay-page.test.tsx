import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  jest,
  mock,
  spyOn,
  test,
} from "bun:test";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import {
  buildCoworkCheckoutSummary,
  buildCoworkReservationQuote as buildCoworkPriceQuote,
  buildDiscountedCoworkCheckoutSummary,
} from "@/features/checkout/checkout-quote.test-utils";
import { formatWorkspaceMoney } from "@/features/checkout/workspace-money";
import { m } from "@/features/i18n";
import {
  workspaceRouterPush,
  workspaceUseAction,
} from "@/shared/testing/workspace-component-module-mocks";
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

const { submitWorkspaceReservation } = await import(
  "@/features/reservation/actions/submit-reservation"
);

mock.module("server-only", () => ({}));
const submitReservationActions = await import(
  "@/features/reservation/actions/submit-reservation"
);
mock.module("@/features/reservation/actions/submit-reservation", () => ({
  ...submitReservationActions,
  submitReservation: mock(),
  submitWorkspaceReservation,
}));

beforeEach(() => {
  workspaceUseAction.mockReturnValue({
    execute: mock(),
    isExecuting: false,
    result: {},
  });
});

afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

describe("CheckoutPayPage pricing change", () => {
  beforeAll(() => {
    registerWorkspaceComponentTestEnv();
  });

  afterEach(() => {
    cleanup();
  });

  afterAll(async () => {
    await unregisterWorkspaceComponentTestEnv();
  });

  test("requires review before exposing payment controls", async () => {
    const { CheckoutPayPage } = await import("./checkout-pay-page");
    const quote = buildCoworkReservationQuote({
      entryTier: "basic",
      coffee: false,
    });
    const freshPayUrl = "/en-US/checkout/pay?payState=fresh";
    const view = render(
      <CheckoutPayPage
        changedKeys={{
          sectionKeys: ["order", "total"],
          itemKeys: ["product:cowork:basic", "total:final"],
        }}
        freshPayUrl={freshPayUrl}
        locale="en-US"
        summary={quote.summary}
        variant="pricingChanged"
      />
    );

    expect(
      view.getByText(m.checkoutPayPricingChangedTitle({}, { locale: "en-US" }))
    ).toBeDefined();
    const reviewLink = view.getByRole("link", {
      name: m.checkoutPayReviewUpdatedPriceButton({}, { locale: "en-US" }),
    });
    expect(reviewLink.getAttribute("href")).toBe(freshPayUrl);
    expect(
      view.queryByRole("button", {
        name: m.checkoutPayOrderAndPayAmountButton(
          { amount: formatWorkspaceMoney(quote.summary.total, "en-US") },
          { locale: "en-US" }
        ),
      })
    ).toBeNull();
    expect(view.queryByRole("checkbox")).toBeNull();
  });
});

describe("CheckoutPayPage payment navigation", () => {
  beforeAll(() => {
    registerWorkspaceComponentTestEnv();
  });

  beforeEach(() => {
    workspaceRouterPush.mockClear();
  });

  afterEach(() => {
    cleanup();
    sessionStorage.removeItem(
      "deskohub:checkout-status-owner:/en-US/reservation/status/reservation-id"
    );
  });

  afterAll(async () => {
    await unregisterWorkspaceComponentTestEnv();
  });

  test("opens the payment gateway in a new tab and sends the original tab to status", async () => {
    const events: string[] = [];
    const execute = mock(() => {
      events.push("execute");
    });
    const paymentWindow = {
      opener: window,
    };
    const openPaymentWindow = spyOn(window, "open").mockImplementation(() => {
      events.push("open");
      return paymentWindow as Window;
    });
    workspaceUseAction.mockReturnValue({
      execute,
      isExecuting: false,
      result: {},
    });

    const { CheckoutPayPage } = await import("./checkout-pay-page");
    const quote = buildCoworkReservationQuote({
      entryTier: "basic",
      coffee: false,
    });
    const view = render(
      <CheckoutPayPage
        discountCodeForm={<button type="button">Apply discount</button>}
        locale="en-US"
        payStateToken="signed-summary"
        summary={quote.summary}
        variant="pay"
      />
    );

    expect(view.getByRole("button", { name: "Apply discount" })).toBeDefined();
    expect(view.getAllByRole("checkbox")).toHaveLength(1);
    expect(
      view.getByRole("checkbox", { name: /statutory withdrawal period/ })
    ).toBeDefined();
    fireEvent.click(view.getByRole("checkbox"));
    fireEvent.click(
      view.getByRole("button", {
        name: m.checkoutPayOrderAndPayAmountButton(
          { amount: formatWorkspaceMoney(quote.summary.total, "en-US") },
          { locale: "en-US" }
        ),
      })
    );

    expect(events).toEqual(["execute"]);
    expect(execute).toHaveBeenCalledWith({
      locale: "en-US",
      payStateToken: "signed-summary",
      legalConsent: true,
      earlyPerformanceConsent: true,
    });

    const actionOptions = workspaceUseAction.mock.calls.at(-1)?.[1] as
      | {
          readonly onSuccess: (result: {
            readonly data: {
              readonly status: "redirect";
              readonly redirectUrl: string;
              readonly statusUrl: string;
            };
          }) => void;
        }
      | undefined;
    if (!actionOptions) throw new Error("Checkout action options missing");

    act(() => {
      actionOptions.onSuccess({
        data: {
          status: "redirect",
          redirectUrl: "https://payments.example.test/checkout",
          statusUrl: "/en-US/reservation/status/reservation-id",
        },
      });
    });

    expect(events).toEqual(["execute", "open"]);
    expect(openPaymentWindow).toHaveBeenCalledTimes(1);
    expect(openPaymentWindow).toHaveBeenCalledWith(
      "https://payments.example.test/checkout",
      "_blank"
    );
    expect(paymentWindow.opener).toBeNull();
    expect(workspaceRouterPush).toHaveBeenCalledWith(
      "/en-US/reservation/status/reservation-id"
    );
    expect(
      sessionStorage.getItem(
        "deskohub:checkout-status-owner:/en-US/reservation/status/reservation-id"
      )
    ).toBe("true");
  });

  test("announces a payment start failure as an alert", async () => {
    const { CheckoutPayPage } = await import("./checkout-pay-page");
    const quote = buildCoworkReservationQuote({
      entryTier: "basic",
      coffee: false,
    });
    const view = render(
      <CheckoutPayPage
        locale="en-US"
        payStateToken="signed-summary"
        summary={quote.summary}
        variant="pay"
      />
    );
    expect(view.queryByRole("alert")).toBeNull();

    const actionOptions = workspaceUseAction.mock.calls.at(-1)?.[1] as
      | { readonly onTransportError: () => void }
      | undefined;
    if (!actionOptions) throw new Error("Checkout action options missing");

    act(() => {
      actionOptions.onTransportError();
    });

    expect(view.getByRole("alert").textContent).toBe(
      m.checkoutPaySubmitError({}, { locale: "en-US" })
    );
  });

  test("omits the early-performance request when the withdrawal period has elapsed", async () => {
    const { CheckoutPayPage } = await import("./checkout-pay-page");
    const quote = buildCoworkReservationQuote({
      entryTier: "basic",
      coffee: false,
    });
    const view = render(
      <CheckoutPayPage
        earlyPerformanceRequestRequired={false}
        locale="en-US"
        payStateToken="signed-summary"
        summary={quote.summary}
        variant="pay"
      />
    );

    expect(view.getAllByRole("checkbox")).toHaveLength(1);
    expect(
      view.queryByRole("checkbox", { name: /statutory withdrawal period/ })
    ).toBeNull();
    expect(
      view
        .getByRole("link", { name: "General Terms and Conditions" })
        .getAttribute("href")
    ).toBe("/en-US/terms-and-conditions");
    expect(
      view.getByRole("link", { name: "Operating Rules" }).getAttribute("href")
    ).toBe("/en-US/operating-rules");
  });

  test("does not open a payment tab for an internal zero-total checkout", async () => {
    const openPaymentWindow = spyOn(window, "open");
    workspaceUseAction.mockReturnValue({
      execute: mock(),
      isExecuting: false,
      result: {},
    });

    const { CheckoutPayPage } = await import("./checkout-pay-page");
    const view = render(
      <CheckoutPayPage
        locale="en-US"
        payStateToken="signed-summary"
        summary={buildDiscountedCoworkCheckoutSummary({ basisPoints: 10_000 })}
        variant="pay"
      />
    );

    fireEvent.click(view.getByRole("checkbox"));
    fireEvent.click(
      view.getByRole("button", {
        name: m.checkoutPayOrderAndPayButton({}, { locale: "en-US" }),
      })
    );

    const actionOptions = workspaceUseAction.mock.calls.at(-1)?.[1] as
      | {
          readonly onSuccess: (result: {
            readonly data: {
              readonly status: "redirect";
              readonly redirectUrl: string;
              readonly statusUrl?: string;
            };
          }) => void;
        }
      | undefined;
    if (!actionOptions) throw new Error("Checkout action options missing");

    act(() => {
      actionOptions.onSuccess({
        data: {
          status: "redirect",
          redirectUrl:
            "/en-US/reservation/status/reservation-id?outcome=success",
        },
      });
    });

    expect(openPaymentWindow).not.toHaveBeenCalled();
    expect(workspaceRouterPush).toHaveBeenCalledWith(
      "/en-US/reservation/status/reservation-id?outcome=success"
    );
    expect(
      view.queryByText(m.checkoutPayProviderHandoff({}, { locale: "en-US" }))
    ).toBeNull();
  });
});

describe("CheckoutPayPage provider handoff", () => {
  beforeAll(() => {
    registerWorkspaceComponentTestEnv();
  });

  afterEach(() => {
    cleanup();
  });

  afterAll(async () => {
    await unregisterWorkspaceComponentTestEnv();
  });

  test.each(["en-US", "cs-CZ"] as const)(
    "explains the Nexi handoff and names the total on the pay button in %s",
    async (locale) => {
      const { CheckoutPayPage } = await import("./checkout-pay-page");
      const quote = buildCoworkReservationQuote({
        entryTier: "basic",
        coffee: false,
      });
      const view = render(
        <CheckoutPayPage
          locale={locale}
          payStateToken="signed-summary"
          summary={quote.summary}
          variant="pay"
        />
      );

      expect(
        view.getByText(m.checkoutPayProviderHandoff({}, { locale }))
      ).toBeDefined();
      const amount = formatWorkspaceMoney(quote.summary.total, locale);
      expect(amount).toMatch(locale === "cs-CZ" ? /Kč/ : /CZK/);
      const payButton = view.getByRole("button", {
        name: m.checkoutPayOrderAndPayAmountButton({ amount }, { locale }),
      });
      expect(payButton).toHaveProperty("disabled", true);
    }
  );

  test("renders the terms and early-performance consents unticked, for the customer to give", async () => {
    const { CheckoutPayPage } = await import("./checkout-pay-page");
    const quote = buildCoworkReservationQuote({
      entryTier: "basic",
      coffee: false,
    });
    const amount = formatWorkspaceMoney(quote.summary.total, "en-US");
    const payButtonName = m.checkoutPayOrderAndPayAmountButton(
      { amount },
      { locale: "en-US" }
    );
    const earlyPerformanceView = render(
      <CheckoutPayPage
        earlyPerformanceRequestRequired
        locale="en-US"
        payStateToken="signed-summary"
        summary={quote.summary}
        variant="pay"
      />
    );
    const earlyPerformanceCheckbox = earlyPerformanceView.getByRole(
      "checkbox",
      { name: /general terms and conditions/i }
    );

    expect(
      earlyPerformanceView.getByRole("checkbox", {
        name: /statutory withdrawal period/i,
      })
    ).toBe(earlyPerformanceCheckbox);
    expect(earlyPerformanceCheckbox.getAttribute("aria-checked")).toBe("false");
    expect(
      earlyPerformanceView.getByRole("button", { name: payButtonName })
    ).toHaveProperty("disabled", true);
    earlyPerformanceView.unmount();

    const legalOnlyView = render(
      <CheckoutPayPage
        earlyPerformanceRequestRequired={false}
        locale="en-US"
        payStateToken="signed-summary"
        summary={quote.summary}
        variant="pay"
      />
    );
    const legalConsentCheckbox = legalOnlyView.getByRole("checkbox", {
      name: /general terms and conditions/i,
    });

    expect(legalConsentCheckbox.getAttribute("aria-checked")).toBe("false");
    expect(
      legalOnlyView.queryByRole("checkbox", {
        name: /statutory withdrawal period/i,
      })
    ).toBeNull();
    expect(
      legalOnlyView.getByRole("button", { name: payButtonName })
    ).toHaveProperty("disabled", true);
  });

  test("updates the pay button total when a discount changes it", async () => {
    const { CheckoutPayPage } = await import("./checkout-pay-page");
    const fullPrice = buildCoworkCheckoutSummary({
      entryTier: "basic",
      coffee: false,
    });
    const discounted = buildDiscountedCoworkCheckoutSummary({
      basisPoints: 5000,
    });
    const payButtonName = (summary: typeof fullPrice) =>
      m.checkoutPayOrderAndPayAmountButton(
        { amount: formatWorkspaceMoney(summary.total, "en-US") },
        { locale: "en-US" }
      );
    expect(payButtonName(discounted)).not.toBe(payButtonName(fullPrice));

    const view = render(
      <CheckoutPayPage
        locale="en-US"
        payStateToken="signed-summary"
        summary={fullPrice}
        variant="pay"
      />
    );
    expect(
      view.getByRole("button", { name: payButtonName(fullPrice) })
    ).toBeDefined();

    view.rerender(
      <CheckoutPayPage
        locale="en-US"
        payStateToken="signed-summary"
        summary={discounted}
        variant="pay"
      />
    );
    expect(
      view.getByRole("button", { name: payButtonName(discounted) })
    ).toBeDefined();
    expect(
      view.queryByRole("button", { name: payButtonName(fullPrice) })
    ).toBeNull();
  });
});
