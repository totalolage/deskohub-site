import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { buildWorkspaceCheckoutQuote } from "@/features/checkout/checkout-quote";
import { CheckoutSummary } from "./checkout-summary";

describe("CheckoutSummary", () => {
  test("renders server-provided summary rows and amounts without a duplicate title", () => {
    const quote = buildWorkspaceCheckoutQuote({
      entryTier: "basic-day-pass",
      coffee: true,
    });

    const markup = renderToStaticMarkup(
      <CheckoutSummary locale="en-US" summary={quote.summary} />
    );

    expect(markup).not.toContain("Order summary");
    expect(markup).toContain("Basic Day Pass");
    expect(markup).toContain("Coffee");
    expect(markup).toContain("CZK");
  });
});
