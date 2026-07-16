import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  test,
} from "bun:test";
import { cleanup, render } from "@testing-library/react";
import { Schema } from "effect";
import { buildWorkspaceCheckoutQuote } from "@/features/checkout/checkout-quote.test-utils";
import { discountIdSchema } from "@/features/discounts/contracts";
import {
  registerWorkspaceComponentTestEnv,
  unregisterWorkspaceComponentTestEnv,
} from "@/shared/testing/workspace-component-test-env";
import { CheckoutSummary } from "./checkout-summary";

describe("CheckoutSummary", () => {
  beforeAll(() => {
    registerWorkspaceComponentTestEnv();
  });

  afterEach(() => {
    cleanup();
  });

  afterAll(() => {
    unregisterWorkspaceComponentTestEnv();
  });

  test("renders server-provided summary rows and amounts without a duplicate title", () => {
    const quote = buildWorkspaceCheckoutQuote({
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
  });

  test("localizes product summary item keys", () => {
    const quote = buildWorkspaceCheckoutQuote({
      entryTier: "basic",
      coffee: false,
    });

    const view = render(
      <CheckoutSummary locale="cs-CZ" summary={quote.summary} />
    );

    expect(view.getByText("Basic Day Pass")).toBeDefined();
    expect(view.queryByText("product:basic")).toBeNull();
  });

  test("renders the public label for generic discount rows", () => {
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
      subtotalBefore: money(35_000),
      amount: money(17_500),
      subtotalAfter: money(17_500),
    };
    const quote = buildWorkspaceCheckoutQuote(
      { entryTier: "basic", coffee: false },
      {
        discountQuote: {
          product: { kind: "cowork", tier: "basic" },
          discountableSubtotal: money(35_000),
          discounts: [application],
          totalDiscount: money(17_500),
          discountedSubtotal: money(17_500),
        },
      }
    );

    const view = render(
      <CheckoutSummary locale="en-US" summary={quote.summary} />
    );

    expect(view.getByText("Summer sale")).toBeDefined();
    expect(view.queryByText("discount:opaque-sale")).toBeNull();
  });
});
