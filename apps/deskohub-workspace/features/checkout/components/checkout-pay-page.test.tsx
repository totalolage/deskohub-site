import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  jest,
  mock,
  test,
} from "bun:test";
import { act, cleanup, render } from "@testing-library/react";
import { Schema } from "effect";
import { buildCoworkReservationQuote } from "@/features/checkout/checkout-quote.test-utils";
import { discountIdSchema } from "@/features/discounts/contracts";
import { m } from "@/features/i18n";
import { workspaceUseAction } from "@/shared/testing/workspace-component-module-mocks";
import {
  registerWorkspaceComponentTestEnv,
  unregisterWorkspaceComponentTestEnv,
} from "@/shared/testing/workspace-component-test-env";

const { submitWorkspaceReservation } = await import(
  "@/features/reservation/actions/submit-reservation"
);

mock.module("server-only", () => ({}));
const refresh = mock();
mock.module("next/navigation", () => ({
  useRouter: () => ({ push: mock(), refresh }),
}));
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

describe("CheckoutPayStabilizingPage", () => {
  beforeAll(() => {
    registerWorkspaceComponentTestEnv();
  });

  afterEach(() => {
    cleanup();
    refresh.mockClear();
  });

  afterAll(() => {
    unregisterWorkspaceComponentTestEnv();
  });

  test("keeps payment controls fenced while production refreshes the handoff", async () => {
    const { CheckoutPayStabilizingPage } = await import("./checkout-pay-page");
    const quote = buildCoworkReservationQuote({
      entryTier: "basic",
      coffee: false,
    });
    const view = render(
      <CheckoutPayStabilizingPage
        locale="en-US"
        refreshIntervalMs={5}
        summary={quote.summary}
      />
    );

    expect(
      view.getByText(m.checkoutPayStabilizingTitle({}, { locale: "en-US" }))
    ).toBeDefined();
    expect(view.queryByRole("checkbox")).toBeNull();
    expect(
      view.queryByRole("button", {
        name: m.checkoutPayOrderAndPayButton({}, { locale: "en-US" }),
      })
    ).toBeNull();

    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(refresh).toHaveBeenCalled();
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
