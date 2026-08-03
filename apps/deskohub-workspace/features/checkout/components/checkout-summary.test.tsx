import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  jest,
  setSystemTime,
  test,
} from "bun:test";
import { act, cleanup, render } from "@testing-library/react";
import { Effect, Schema } from "effect";
import {
  buildCoworkCheckoutSummary,
  buildCoworkReservationQuote as buildCoworkPriceQuote,
} from "@/features/checkout/checkout-quote.test-utils";
import { getMeetingRoomCheckoutSummary } from "@/features/checkout/checkout-summary-meeting-room";
import { getMeetingRoomReservationQuote } from "@/features/checkout/reservation-quote-meeting-room";
import { discountIdSchema } from "@/features/discounts/contracts";
import {
  registerWorkspaceComponentTestEnv,
  unregisterWorkspaceComponentTestEnv,
} from "@/shared/testing/workspace-component-test-env";
import { CheckoutSummary } from "./checkout-summary";
import { CheckoutSummaryDiscountCountdown } from "./checkout-summary-discount-countdown";
import { CheckoutSummaryDiscountDetailsContent } from "./checkout-summary-discount-details";

const buildCoworkReservationQuote = (
  ...args: Parameters<typeof buildCoworkPriceQuote>
) => ({
  ...buildCoworkPriceQuote(...args),
  summary: buildCoworkCheckoutSummary(...args),
});

describe("CheckoutSummary", () => {
  beforeAll(() => {
    registerWorkspaceComponentTestEnv();
  });

  afterEach(() => {
    cleanup();
    jest.useRealTimers();
    setSystemTime();
  });

  afterAll(() => {
    unregisterWorkspaceComponentTestEnv();
  });

  test("renders server-provided summary rows and amounts without a duplicate title", () => {
    const quote = buildCoworkReservationQuote({
      entryTier: "basic",
      coffee: true,
    });

    const view = render(
      <CheckoutSummary locale="en-US" summary={quote.summary} />
    );

    expect(view.queryByText("Order summary")).toBeNull();
    expect(view.getByText("Basic Day Pass")).toBeDefined();
    expect(view.getByText("Coffee")).toBeDefined();
    expect(view.getAllByText(/CZK/).length).toBeGreaterThan(0);
    expect(view.queryByRole("button", { name: /discount/i })).toBeNull();
    expect(view.container.querySelector("del")).toBeNull();
  });

  test("localizes product summary item keys", () => {
    const quote = buildCoworkReservationQuote({
      entryTier: "basic",
      coffee: false,
    });

    const view = render(
      <CheckoutSummary locale="cs-CZ" summary={quote.summary} />
    );

    expect(view.getByText("Basic Day Pass")).toBeDefined();
    expect(view.queryByText("product:basic")).toBeNull();
  });

  test("renders the day product as whole day", () => {
    const reservation = {
      kind: "meeting-room" as const,
      duration: { unit: "day" as const, amount: 1 as const },
      reservationDate: "2099-06-10" as const,
    };
    const quote = Effect.runSync(getMeetingRoomReservationQuote(reservation));
    const view = render(
      <CheckoutSummary
        locale="en-US"
        summary={getMeetingRoomCheckoutSummary(quote)}
      />
    );

    expect(view.getByText("Meeting room - whole day")).toBeDefined();
    expect(view.queryByText("Meeting room - 24 hours")).toBeNull();
  });

  test("highlights the canonical changed product key", () => {
    const quote = buildCoworkReservationQuote({
      entryTier: "basic",
      coffee: false,
    });
    const view = render(
      <CheckoutSummary
        changedKeys={{
          sectionKeys: ["order"],
          itemKeys: ["product:cowork:basic"],
        }}
        locale="en-US"
        summary={quote.summary}
      />
    );

    expect(view.getByText("Basic Day Pass").parentElement?.className).toContain(
      "text-burned-orange"
    );
  });

  test("renders a discounted product with its original and final prices", async () => {
    const money = (value: number) => ({
      value,
      exponent: 2,
      currency: "CZK",
    });
    const application = {
      discount: {
        id: Schema.decodeUnknownSync(discountIdSchema)("opaque-sale"),
        label: "Summer sale",
        adjustment: { kind: "percentage" as const, basisPoints: 5000 },
      },
      subtotalBefore: money(55_000),
      amount: money(27_500),
      subtotalAfter: money(27_500),
    };
    const quote = buildCoworkReservationQuote(
      {
        entryTier: "profi",
        coffee: true,
        monitorOption: "2x27-qhd",
      },
      {
        discountQuote: {
          product: { kind: "cowork", tier: "profi" },
          discountableSubtotal: money(55_000),
          discounts: [application],
          totalDiscount: money(27_500),
          discountedSubtotal: money(27_500),
        },
      }
    );

    const view = render(
      <CheckoutSummary locale="en-US" summary={quote.summary} />
    );

    expect(view.getByText(/original price.*550/i)).toBeDefined();
    expect(view.getByText(/discounted price.*275/i)).toBeDefined();
    expect(view.queryByText("Discount")).toBeNull();
    const detailsButton = view.getByRole("button", {
      name: /discount.*profi workstation/i,
    });

    await act(async () => detailsButton.focus());
    expect(document.activeElement).toBe(detailsButton);
    expect(detailsButton.getAttribute("data-state")).toBe("instant-open");
    expect(detailsButton.getAttribute("aria-describedby")).toMatch(/^radix-/);
  });

  test("keeps paid Basic coffee full price while discounting only the product", () => {
    const money = (value: number) => ({
      value,
      exponent: 2,
      currency: "CZK",
    });
    const quote = buildCoworkReservationQuote(
      { entryTier: "basic", coffee: true },
      {
        discountQuote: {
          product: { kind: "cowork", tier: "basic" },
          discountableSubtotal: money(35_000),
          discounts: [
            {
              discount: {
                id: Schema.decodeUnknownSync(discountIdSchema)("half-price"),
                label: "Half price",
                adjustment: { kind: "percentage", basisPoints: 5000 },
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

    const view = render(
      <CheckoutSummary locale="en-US" summary={quote.summary} />
    );

    expect(view.container.querySelectorAll("del")).toHaveLength(1);
    const coffeeRow = view.getByText("Coffee").parentElement;
    expect(coffeeRow?.textContent?.replaceAll("\u00a0", " ")).toContain(
      "CZK 50"
    );
    expect(coffeeRow?.querySelector("del")).toBeNull();
  });

  test("shows stacked discounts in application order", () => {
    const money = (value: number) => ({
      value,
      exponent: 2,
      currency: "CZK",
    });
    const discountId = Schema.decodeUnknownSync(discountIdSchema);
    const quote = buildCoworkReservationQuote(
      { entryTier: "basic", coffee: false },
      {
        discountQuote: {
          product: { kind: "cowork", tier: "basic" },
          discountableSubtotal: money(35_000),
          discounts: [
            {
              discount: {
                id: discountId("summer-sale"),
                label: "Summer sale",
                adjustment: { kind: "percentage", basisPoints: 5000 },
              },
              subtotalBefore: money(35_000),
              amount: money(17_500),
              subtotalAfter: money(17_500),
            },
            {
              discount: {
                id: discountId("member-bonus"),
                label: "Member bonus",
                adjustment: { kind: "fixed", amount: money(20_000) },
              },
              subtotalBefore: money(17_500),
              amount: money(17_500),
              subtotalAfter: money(0),
            },
          ],
          totalDiscount: money(35_000),
          discountedSubtotal: money(0),
        },
      }
    );
    const productItem = quote.summary.sections
      .find(({ key }) => key === "order")
      ?.items.find(({ key }) => key === "product:cowork:basic");
    if (!(productItem && "discounts" in productItem)) {
      throw new Error("Expected a discounted product summary item");
    }
    const view = render(
      <CheckoutSummaryDiscountDetailsContent
        discounts={productItem.discounts}
        locale="en-US"
      />
    );

    expect(view.queryByRole("heading")).toBeNull();
    const rows = view.getAllByRole("listitem");
    expect(rows).toHaveLength(2);
    expect(rows[0]?.textContent).toContain("Summer sale");
    expect(rows[0]?.textContent).toContain("50%");
    expect(rows[0]?.textContent?.replaceAll("\u00a0", " ")).toContain(
      "-CZK 175"
    );
    expect(rows[1]?.textContent).toContain("Member bonus");
    expect(rows[1]?.textContent?.replaceAll("\u00a0", " ")).toContain(
      "CZK 200"
    );
    expect(rows[1]?.textContent?.replaceAll("\u00a0", " ")).toContain(
      "-CZK 175"
    );
  });

  test("localizes an active discount countdown", async () => {
    setSystemTime(new Date("2026-08-01T12:30:00.000Z"));
    const discount = {
      id: Schema.decodeUnknownSync(discountIdSchema)("timed-sale"),
      label: "Summer sale",
      adjustment: { kind: "percentage" as const, basisPoints: 5000 },
      countdownStartsAt: "2026-08-01T10:00:00.000Z",
      expiresAt: "2026-08-02T10:00:00.000Z",
    };
    const english = render(
      <CheckoutSummaryDiscountCountdown discount={discount} locale="en-US" />
    );

    expect(await english.findByText("Ends in 22 hours")).toBeDefined();

    cleanup();
    const czech = render(
      <CheckoutSummaryDiscountCountdown discount={discount} locale="cs-CZ" />
    );

    expect(await czech.findByText("Končí za 22 hodin")).toBeDefined();
  });

  test("replaces the discount countdown with its expiry state", () => {
    jest.useFakeTimers({
      now: new Date("2026-08-02T09:59:45.000Z"),
    });
    const view = render(
      <CheckoutSummaryDiscountCountdown
        discount={{
          id: Schema.decodeUnknownSync(discountIdSchema)("expiring-sale"),
          label: "Summer sale",
          adjustment: { kind: "percentage", basisPoints: 5000 },
          countdownStartsAt: "2026-08-02T09:00:00.000Z",
          expiresAt: "2026-08-02T10:00:00.000Z",
        }}
        locale="en-US"
      />
    );

    expect(view.getByText("Ends in 15 seconds")).toBeDefined();

    act(() => jest.advanceTimersByTime(15_000));

    expect(view.queryByText("Ends in 15 seconds")).toBeNull();
    expect(view.getByText("Ended — price will be rechecked")).toBeDefined();
  });

  test("updates the countdown at its start and unit boundaries", () => {
    jest.useFakeTimers({
      now: new Date("2026-08-01T09:59:59.999Z"),
    });
    const view = render(
      <CheckoutSummaryDiscountCountdown
        discount={{
          id: Schema.decodeUnknownSync(discountIdSchema)("scheduled-sale"),
          label: "Summer sale",
          adjustment: { kind: "percentage", basisPoints: 5000 },
          countdownStartsAt: "2026-08-01T10:00:00.000Z",
          expiresAt: "2026-08-02T10:00:00.000Z",
        }}
        locale="en-US"
      />
    );

    expect(view.queryByText(/Ends in/)).toBeNull();

    act(() => jest.advanceTimersByTime(1));
    expect(view.getByText("Ends in 24 hours")).toBeDefined();

    act(() => jest.advanceTimersByTime(3_600_000));
    expect(view.getByText("Ends in 23 hours")).toBeDefined();
  });

  test("switches to a one-second interval below one hour", () => {
    jest.useFakeTimers({
      now: new Date("2026-08-02T09:00:00.000Z"),
    });
    const view = render(
      <CheckoutSummaryDiscountCountdown
        discount={{
          id: Schema.decodeUnknownSync(discountIdSchema)("urgent-sale"),
          label: "Summer sale",
          adjustment: { kind: "percentage", basisPoints: 5000 },
          countdownStartsAt: "2026-08-02T09:00:00.000Z",
          expiresAt: "2026-08-02T10:00:00.000Z",
        }}
        locale="en-US"
      />
    );

    expect(view.getByText("Ends in 1 hour")).toBeDefined();

    act(() => jest.advanceTimersByTime(1));
    expect(view.getByText("Ends in 60 minutes")).toBeDefined();

    act(() => jest.advanceTimersByTime(1000));
    expect(view.getByText("Ends in 59 minutes and 59 seconds")).toBeDefined();

    act(() => jest.advanceTimersByTime(1000));
    expect(view.getByText("Ends in 59 minutes and 58 seconds")).toBeDefined();
  });
});
