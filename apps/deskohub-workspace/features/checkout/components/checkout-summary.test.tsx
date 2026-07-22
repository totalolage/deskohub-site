import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  test,
} from "bun:test";
import { act, cleanup, render } from "@testing-library/react";
import { Schema } from "effect";
import { buildWorkspaceCheckoutQuote } from "@/features/checkout/checkout-quote.test-utils";
import { discountIdSchema } from "@/features/discounts/contracts";
import {
  registerWorkspaceComponentTestEnv,
  unregisterWorkspaceComponentTestEnv,
} from "@/shared/testing/workspace-component-test-env";
import { CheckoutSummary } from "./checkout-summary";
import { CheckoutSummaryDiscountDetailsContent } from "./checkout-summary-discount-details";

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
    expect(view.queryByRole("button", { name: /discount/i })).toBeNull();
    expect(view.container.querySelector("del")).toBeNull();
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

  test("highlights the canonical changed product key", () => {
    const quote = buildWorkspaceCheckoutQuote({
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
    const quote = buildWorkspaceCheckoutQuote(
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
    const quote = buildWorkspaceCheckoutQuote(
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
    const quote = buildWorkspaceCheckoutQuote(
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
});
