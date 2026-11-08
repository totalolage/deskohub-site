import { describe, expect, mock, test } from "bun:test";
import { testEmailAddress } from "@deskohub/test-email";
import type { ReactElement } from "react";
import type { CheckoutStatusViewModel } from "@/features/checkout/backend/checkout";
import type { SearchParamsRecord } from "@/shared/utils";

mock.module("server-only", () => ({}));
const nextServer = await import("next/server");
mock.module("next/server", () => ({
  ...nextServer,
  connection: () => Promise.resolve(),
}));
mock.module("next/root-params", () => ({
  locale: () => Promise.resolve("en-US"),
}));

/** The checkout status the preview page renders for `searchParams`. */
async function previewStatus(searchParams: SearchParamsRecord) {
  const { default: CheckoutStatusPreviewPage } = await import("./page");
  const page: ReactElement<{ readonly status: CheckoutStatusViewModel }> =
    await CheckoutStatusPreviewPage({
      searchParams: Promise.resolve(searchParams),
    });
  return page.props.status;
}

describe("CheckoutStatusPreviewPage", () => {
  test("previews a paid order awaiting delivery by default", async () => {
    const status = await previewStatus({});

    expect(status).toMatchObject({
      status: "paid_awaiting_delivery",
      paymentStatus: "paid",
      fulfillmentStatus: "awaiting_delivery",
      supportContactPrefill: { email: testEmailAddress("ada") },
    });
  });

  test.each([
    ["pending", "pending", "not_started"],
    ["payment_pending_delayed", "pending", "not_started"],
    ["paid_waiting_fulfillment", "paid", "processing"],
    ["paid_fulfillment_delayed", "paid", "processing"],
    ["paid_delivery_delayed", "paid", "awaiting_delivery"],
    ["fulfillment_failed", "paid", "failed"],
  ] as const)(
    "previews the %s status as %s payment and %s fulfillment",
    async (state, paymentStatus, fulfillmentStatus) => {
      expect(await previewStatus({ state })).toMatchObject({
        status: state,
        paymentStatus,
        fulfillmentStatus,
      });
    }
  );

  test("leaves the support email out when asked to hide it", async () => {
    const status = await previewStatus({
      state: "fulfillment_failed",
      email: "hidden",
    });

    expect(status.supportContactPrefill).not.toHaveProperty("email");
  });

  test("falls back to the default preview for an unknown state", async () => {
    const status = await previewStatus({ state: "refunded", email: "shown" });

    expect(status.status).toBe("paid_awaiting_delivery");
    expect(status.supportContactPrefill).toHaveProperty("email");
  });
});
