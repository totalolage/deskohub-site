import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { CheckoutStatusViewModel } from "@/features/checkout/backend/checkout-status.service";
import { CheckoutStatusPage } from "./checkout-status-page";

const baseStatus = {
  orderId: "reservation-status-page",
  returnOutcome: "success",
  status: "fulfilled",
  paymentStatus: "paid",
  fulfillmentStatus: "fulfilled",
} satisfies CheckoutStatusViewModel;

describe("CheckoutStatusPage", () => {
  test("renders reconstructed reservation summary rows", () => {
    const markup = renderToStaticMarkup(
      <CheckoutStatusPage
        locale="en-US"
        status={{
          ...baseStatus,
          summary: {
            tier: "profi",
            date: "2026-06-20",
            coffee: false,
            monitorOption: "2x27-qhd",
            price: { value: 55_000, exponent: 2, currency: "CZK" },
          },
        }}
      />
    );

    expect(markup).toContain("Profi Workstation");
    expect(markup).toContain("Saturday, June 20, 2026");
    expect(markup).toContain("2x 27 QHD");
    expect(markup).toContain("CZK");
    expect(markup).not.toContain(
      "We will send the reservation details by email."
    );
  });

  test("renders fallback copy without a reconstructed summary", () => {
    const markup = renderToStaticMarkup(
      <CheckoutStatusPage locale="en-US" status={baseStatus} />
    );

    expect(markup).toContain("We will send the reservation details by email.");
  });
});
