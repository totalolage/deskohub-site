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
        "https://deskohub.test/reservation/status/order-id?x-vercel-protection-bypass=secret&step=done"
      )
    ).toBe("https://deskohub.test/reservation/status/order-id?step=done");
  });

  test("strips reservation access capability tokens", () => {
    expect(
      createPostHogPageUrl(
        "https://deskohub.test/reservation/access/order-id?accessToken=signed-capability&step=access"
      )
    ).toBe("https://deskohub.test/reservation/access/order-id?step=access");
    expect(
      createPostHogPageUrl(
        "https://deskohub.test/reservation/invoice/order-id?accessToken=signed-capability&step=invoice"
      )
    ).toBe("https://deskohub.test/reservation/invoice/order-id?step=invoice");
  });

  test("continues to strip the retired reservation status token name", () => {
    expect(
      createPostHogPageUrl(
        "https://deskohub.test/reservation/status/order-id?statusToken=retired-capability&outcome=success"
      )
    ).toBe("https://deskohub.test/reservation/status/order-id?outcome=success");
  });

  test("preserves sale-banner attribution on PostHog pageviews", () => {
    expect(
      createPostHogPageUrl(
        "https://deskohub.test/en-US/reservation/cowork?utm_source=deskohub&utm_medium=sale_banner&utm_content=home_hero"
      )
    ).toBe(
      "https://deskohub.test/en-US/reservation/cowork?utm_source=deskohub&utm_medium=sale_banner&utm_content=home_hero"
    );
  });

  test("strips sensitive params from current, referrer, and initial urls", () => {
    expect(
      sanitizePostHogProperties(
        {
          $current_url:
            "https://deskohub.test/checkout/pay?payState=secret&step=pay",
          $referrer:
            "https://deskohub.test/checkout/pay/return/order-id?checkoutToken=secret&outcome=success",
          $initial_current_url:
            "https://deskohub.test/checkout/pay/return/order-id?payStateRef=secret",
          $initial_referrer:
            "https://deskohub.test/reservation/cowork?token=secret&step=details",
        },
        "preview"
      )
    ).toEqual({
      $current_url: "https://deskohub.test/checkout/pay?step=pay",
      $referrer:
        "https://deskohub.test/checkout/pay/return/order-id?outcome=success",
      $initial_current_url:
        "https://deskohub.test/checkout/pay/return/order-id",
      $initial_referrer:
        "https://deskohub.test/reservation/cowork?step=details",
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
