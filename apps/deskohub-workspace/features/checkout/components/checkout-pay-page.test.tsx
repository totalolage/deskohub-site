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
import { Schema } from "effect";
import {
  buildCoworkCheckoutSummary,
  buildCoworkReservationQuote as buildCoworkPriceQuote,
} from "@/features/checkout/checkout-quote.test-utils";
import { discountIdSchema } from "@/features/discounts/contracts";
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

describe("CheckoutPayPageSkeleton", () => {
  beforeAll(() => {
    registerWorkspaceComponentTestEnv();
  });

  afterEach(() => {
    cleanup();
  });

  afterAll(() => {
    unregisterWorkspaceComponentTestEnv();
  });

  test("renders skeleton order details with a disabled submit button", async () => {
    const { CheckoutPayPageSkeleton } = await import("./checkout-pay-page");
    const view = render(<CheckoutPayPageSkeleton locale="en-US" />);
    const submitButton = view.getByRole("button") as HTMLButtonElement;

    expect(submitButton.disabled).toBe(true);
    expect(
      view.getByText(m.checkoutSummarySectionOrder({}, { locale: "en-US" }))
    ).toBeDefined();
    expect(
      view.container.querySelectorAll(
        "[data-slot='skeleton'][aria-hidden='true']"
      ).length
    ).toBeGreaterThan(0);
  });
});

describe("CheckoutPayPage pricing change", () => {
  beforeAll(() => {
    registerWorkspaceComponentTestEnv();
  });

  afterEach(() => {
    cleanup();
  });

  afterAll(() => {
    unregisterWorkspaceComponentTestEnv();
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
        name: m.checkoutPayOrderAndPayButton({}, { locale: "en-US" }),
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
  });

  afterAll(() => {
    unregisterWorkspaceComponentTestEnv();
  });

  test("opens the payment gateway in a new tab and sends the original tab to status", async () => {
    const events: string[] = [];
    const execute = mock(() => {
      events.push("execute");
    });
    const replace = mock((_href: string) => undefined);
    const postMessage = mock(() => undefined);
    const paymentWindow = {
      close: mock(() => undefined),
      closed: false,
      location: { replace },
      opener: window,
      postMessage,
    };
    spyOn(window, "open").mockImplementation(() => {
      events.push("open");
      return paymentWindow as unknown as Window;
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
        locale="en-US"
        payStateToken="signed-summary"
        summary={quote.summary}
        variant="pay"
      />
    );

    fireEvent.click(view.getByRole("checkbox"));
    fireEvent.click(
      view.getByRole("button", {
        name: m.checkoutPayOrderAndPayButton({}, { locale: "en-US" }),
      })
    );

    expect(events).toEqual(["open", "execute"]);
    expect(window.open).toHaveBeenCalledWith("about:blank", "_blank");
    expect(paymentWindow.opener).toBeNull();
    expect(execute).toHaveBeenCalledWith({
      locale: "en-US",
      payStateToken: "signed-summary",
      legalConsent: true,
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

    expect(replace).toHaveBeenCalledWith(
      "https://payments.example.test/checkout"
    );
    expect(workspaceRouterPush).toHaveBeenCalledWith(
      "/en-US/reservation/status/reservation-id"
    );
    expect(paymentWindow.close).not.toHaveBeenCalled();

    const { CheckoutPaymentWindowCoordinator } = await import(
      "./checkout-payment-window"
    );
    render(<CheckoutPaymentWindowCoordinator />);

    expect(postMessage).toHaveBeenCalledWith(
      "deskohub:checkout-status-tab-alive",
      "*"
    );
    expect(paymentWindow.close).not.toHaveBeenCalled();
  });
});

describe("CheckoutPayPage discount urgency", () => {
  beforeAll(() => {
    registerWorkspaceComponentTestEnv();
  });

  afterEach(() => {
    cleanup();
  });

  afterAll(() => {
    unregisterWorkspaceComponentTestEnv();
  });

  test("shows and updates an applied discount inside its final hour", async () => {
    jest.useFakeTimers({
      now: new Date("2026-08-02T09:18:00.000Z"),
    });
    const { CheckoutPayPage } = await import("./checkout-pay-page");
    const quote = buildDiscountedQuote({
      countdownStartsAt: "2026-08-02T09:00:00.000Z",
      expiresAt: "2026-08-02T10:00:00.000Z",
    });
    const view = render(
      <CheckoutPayPage
        locale="en-US"
        payStateToken="signed-summary"
        summary={quote.summary}
        variant="pay"
      />
    );

    const banner = view.getByText(
      "Hurry — Summer sale ends in 42 minutes"
    ).parentElement;
    expect(banner?.className).toContain("text-aquamarine-ink");

    act(() => jest.advanceTimersByTime(1000));

    expect(
      view.getByText("Hurry — Summer sale ends in 41 minutes and 59 seconds")
    ).toBeDefined();
  });

  test("keeps the urgency banner hidden until less than one hour remains", async () => {
    jest.useFakeTimers({
      now: new Date("2026-08-02T09:00:00.000Z"),
    });
    const { CheckoutPayPage } = await import("./checkout-pay-page");
    const quote = buildDiscountedQuote({
      countdownStartsAt: "2026-08-02T09:00:00.000Z",
      expiresAt: "2026-08-02T10:00:00.000Z",
    });
    const view = render(
      <CheckoutPayPage
        locale="en-US"
        payStateToken="signed-summary"
        summary={quote.summary}
        variant="pay"
      />
    );

    expect(view.queryByText(/Hurry/)).toBeNull();

    act(() => jest.advanceTimersByTime(1));

    expect(
      view.getByText("Hurry — Summer sale ends in 60 minutes")
    ).toBeDefined();
  });

  test("shows a discount only once when it applies to multiple product rows", async () => {
    jest.useFakeTimers({
      now: new Date("2026-08-02T09:18:00.000Z"),
    });
    const { CheckoutPayPage } = await import("./checkout-pay-page");
    const quote = buildDiscountedQuote({
      countdownStartsAt: "2026-08-02T09:00:00.000Z",
      expiresAt: "2026-08-02T10:00:00.000Z",
    });
    const discountedItem = quote.summary.sections
      .find(({ key }) => key === "order")
      ?.items.find((item) => "discounts" in item && item.discounts);
    if (!discountedItem) {
      throw new Error("Expected a discounted product summary item");
    }
    const secondDiscountedItem = {
      ...discountedItem,
      key: "product:cowork:plus" as const,
      product: { kind: "cowork", tier: "plus" } as const,
    };
    const summary = {
      ...quote.summary,
      sections: quote.summary.sections.map((section) =>
        section.key === "order"
          ? { ...section, items: [...section.items, secondDiscountedItem] }
          : section
      ),
    };
    const view = render(
      <CheckoutPayPage
        locale="en-US"
        payStateToken="signed-summary"
        summary={summary}
        variant="pay"
      />
    );

    expect(
      view.getAllByText("Hurry — Summer sale ends in 42 minutes")
    ).toHaveLength(1);
  });

  test("explains when a displayed discount expires", async () => {
    jest.useFakeTimers({
      now: new Date("2026-08-02T09:59:59.000Z"),
    });
    const { CheckoutPayPage } = await import("./checkout-pay-page");
    const quote = buildDiscountedQuote({
      countdownStartsAt: "2026-08-02T09:00:00.000Z",
      expiresAt: "2026-08-02T10:00:00.000Z",
    });
    const view = render(
      <CheckoutPayPage
        locale="en-US"
        payStateToken="signed-summary"
        summary={quote.summary}
        variant="pay"
      />
    );

    expect(
      view.getByText("Hurry — Summer sale ends in 1 second")
    ).toBeDefined();

    act(() => jest.advanceTimersByTime(1000));

    const expiredBanner = view.getByText(
      "Summer sale has ended. We’ll recheck your total before starting payment."
    );
    expect(expiredBanner).toBeDefined();
    expect(expiredBanner.closest("output")?.className).toContain(
      "text-burned-orange-ink"
    );
  });
});

function buildDiscountedQuote({
  countdownStartsAt,
  expiresAt,
}: {
  readonly countdownStartsAt: string;
  readonly expiresAt: string;
}) {
  const money = (value: number) => ({
    value,
    exponent: 2,
    currency: "CZK",
  });

  return buildCoworkReservationQuote(
    { entryTier: "basic", coffee: false },
    {
      discountQuote: {
        product: { kind: "cowork", tier: "basic" },
        discountableSubtotal: money(35_000),
        discounts: [
          {
            discount: {
              id: Schema.decodeUnknownSync(discountIdSchema)("summer-sale"),
              label: "Summer sale",
              adjustment: { kind: "percentage", basisPoints: 5000 },
              countdownStartsAt,
              expiresAt,
            },
            subtotalBefore: money(35_000),
            amount: money(17_500),
            subtotalAfter: money(17_500),
          },
        ],
        totalDiscount: money(17_500),
        discountedSubtotal: money(17_500),
      },
    }
  );
}
