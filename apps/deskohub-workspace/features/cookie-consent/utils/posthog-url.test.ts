import { describe, expect, test } from "bun:test";
import { createPostHogPageUrl, sanitizePostHogProperties } from "./posthog-url";

describe("createPostHogPageUrl", () => {
  test("strips sensitive checkout and auth query params", () => {
    expect(
      createPostHogPageUrl(
        "https://deskohub.test/checkout?payState=secret&payStateRef=ref&checkoutToken=checkout&step=pay&token=abc"
      )
    ).toBe("https://deskohub.test/checkout?step=pay");
  });

  test("strips sensitive params from current and referrer urls", () => {
    expect(
      sanitizePostHogProperties(
        {
          $current_url:
            "https://deskohub.test/checkout/pay?payState=secret&step=pay",
          $referrer:
            "https://deskohub.test/checkout/payment/order-id?checkoutToken=secret&outcome=success",
        },
        "preview"
      )
    ).toEqual({
      $current_url: "https://deskohub.test/checkout/pay?step=pay",
      $referrer:
        "https://deskohub.test/checkout/payment/order-id?outcome=success",
      "deployment.environment.name": "preview",
    });
  });
});
