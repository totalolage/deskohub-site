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

  test("strips Vercel preview bypass params", () => {
    expect(
      createPostHogPageUrl(
        "https://deskohub.test/checkout/status/order-id?x-vercel-protection-bypass=secret&step=done"
      )
    ).toBe("https://deskohub.test/checkout/status/order-id?step=done");
  });

  test("strips sensitive params from current, referrer, and initial urls", () => {
    expect(
      sanitizePostHogProperties(
        {
          $current_url:
            "https://deskohub.test/checkout/pay?payState=secret&step=pay",
          $referrer:
            "https://deskohub.test/checkout/payment/order-id?checkoutToken=secret&outcome=success",
          $initial_current_url:
            "https://deskohub.test/checkout/result/order-id?payStateRef=secret",
          $initial_referrer:
            "https://deskohub.test/checkout/order?token=secret&step=details",
        },
        "preview"
      )
    ).toEqual({
      $current_url: "https://deskohub.test/checkout/pay?step=pay",
      $referrer:
        "https://deskohub.test/checkout/payment/order-id?outcome=success",
      $initial_current_url: "https://deskohub.test/checkout/result/order-id",
      $initial_referrer: "https://deskohub.test/checkout/order?step=details",
      "deployment.environment.name": "preview",
    });
  });

  test("leaves non-url referrers unchanged", () => {
    expect(
      sanitizePostHogProperties(
        {
          $referrer: "$direct",
          $initial_referrer: "$direct",
        },
        "preview"
      )
    ).toEqual({
      $referrer: "$direct",
      $initial_referrer: "$direct",
      "deployment.environment.name": "preview",
    });
  });
});
