import { describe, expect, test } from "bun:test";
import { testEmailAddress } from "@deskohub/test-email";
import { createPostHogPageUrl, sanitizePostHogProperties } from "./posthog-url";

const syntheticAddress = testEmailAddress("synthetic");
const syntheticEmailAddress = testEmailAddress("synthetic-email");

describe("createPostHogPageUrl", () => {
  test("strips private query and fragment values", () => {
    const privateValues = [
      syntheticEmailAddress,
      "Synthetic Name",
      "synthetic-token",
      "synthetic-billing",
      "123456",
    ];
    const sanitizedUrl = createPostHogPageUrl(
      `https://deskohub.test/reservation/status/order-id?payState=synthetic-pay-state&x-vercel-protection-bypass=synthetic-bypass&accessToken=synthetic-capability&statusToken=synthetic-status&utm_source=deskohub&email=${encodeURIComponent(syntheticEmailAddress)}&name=Synthetic%20Name&token=synthetic-token&billing=synthetic-billing&pin=123456#synthetic-fragment`
    );

    expect(sanitizedUrl).toBe("https://deskohub.test/reservation/status/[id]");
    for (const privateValue of privateValues) {
      expect(sanitizedUrl).not.toContain(privateValue);
    }
    expect(sanitizedUrl).not.toContain("synthetic-fragment");
  });

  test("strips userinfo credentials from page URLs", () => {
    expect(
      createPostHogPageUrl(
        "https://synthetic-user:synthetic-password@deskohub.test/account?token=synthetic-token#synthetic-fragment"
      )
    ).toBe("https://deskohub.test/account");
  });

  test("strips sensitive params from current, referrer, initial, and session-entry urls", () => {
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
          $session_entry_url:
            "https://deskohub.test/checkout/pay?payState=secret#synthetic-fragment",
          $session_entry_referrer:
            "https://deskohub.test/checkout/pay/return/order-id?checkoutToken=secret",
          $session_entry_pathname:
            "/reservation/status/session-entry-order-id?statusToken=secret#synthetic-fragment",
          $initial_utm_source: "legacy-synthetic-campaign",
          $session_entry_utm_source: "synthetic-session-campaign",
          $session_entry_gclid: "synthetic-session-click-id",
        },
        "preview"
      )
    ).toEqual({
      $current_url: "https://deskohub.test/checkout/pay",
      $referrer: "https://deskohub.test/checkout/pay/return/[id]",
      $initial_current_url: "https://deskohub.test/checkout/pay/return/[id]",
      $initial_referrer: "https://deskohub.test/reservation/cowork",
      $session_entry_url: "https://deskohub.test/checkout/pay",
      $session_entry_referrer: "https://deskohub.test/checkout/pay/return/[id]",
      $session_entry_pathname: "/reservation/status/[id]",
      "deployment.environment.name": "preview",
    });
  });

  test("drops malformed URL properties instead of returning them raw", () => {
    const properties = sanitizePostHogProperties(
      {
        $current_url: `${syntheticEmailAddress}?token=synthetic-token`,
        $initial_current_url: "not a URL",
        $referrer: "$direct",
      },
      "preview"
    );

    expect(properties).toEqual({
      $referrer: "$direct",
      "deployment.environment.name": "preview",
    });
    expect(JSON.stringify(properties)).not.toContain("synthetic-token");
    expect(JSON.stringify(properties)).not.toContain(syntheticEmailAddress);
  });

  test("sanitizes URL properties nested in explicit person-property bags", () => {
    expect(
      sanitizePostHogProperties(
        {
          $set_once: {
            $initial_current_url: `https://deskohub.test/account?email=${encodeURIComponent(syntheticAddress)}#name`,
          },
        },
        "preview"
      )
    ).toEqual({
      $set_once: {
        $initial_current_url: "https://deskohub.test/account",
      },
      "deployment.environment.name": "preview",
    });
  });

  test("redacts operational IDs from path properties while preserving ordinary paths", () => {
    expect(
      sanitizePostHogProperties(
        {
          $pathname:
            "/reservation/status/synthetic-reservation-id?token=synthetic-token#synthetic-fragment",
          $initial_pathname: "/en-US/reservation/cowork",
        },
        "preview"
      )
    ).toEqual({
      $pathname: "/reservation/status/[id]",
      $initial_pathname: "/en-US/reservation/cowork",
      "deployment.environment.name": "preview",
    });
  });

  test("drops malformed path properties instead of returning them raw", () => {
    const properties = sanitizePostHogProperties(
      {
        $pathname: "reservation/status/synthetic-reservation-id",
        $initial_pathname: { path: "synthetic-private-value" },
      },
      "preview"
    );

    expect(properties).toEqual({
      "deployment.environment.name": "preview",
    });
  });

  test("drops non-string URL and path properties, including nested person properties", () => {
    const properties = sanitizePostHogProperties(
      {
        $current_url: { email: syntheticEmailAddress },
        $pathname: ["synthetic-name", "synthetic-token"],
        $set_once: {
          $initial_current_url: { billing: "synthetic-billing" },
          $initial_pathname: ["123456"],
        },
      },
      "preview"
    );

    expect(properties).toEqual({
      $set_once: {},
      "deployment.environment.name": "preview",
    });
    for (const privateValue of [
      syntheticEmailAddress,
      "synthetic-name",
      "synthetic-token",
      "synthetic-billing",
      "123456",
    ]) {
      expect(JSON.stringify(properties)).not.toContain(privateValue);
    }
  });

  test("drops query-derived campaign properties at the top level and in person properties", () => {
    const campaignProperties = [
      "utm_source",
      "$initial_utm_medium",
      "$session_entry_utm_source",
      "msclkid",
      "$initial_fbclid",
      "$session_entry_ttclid",
    ];
    const properties = sanitizePostHogProperties(
      {
        ...Object.fromEntries(
          campaignProperties.map((property, index) => [
            property,
            `synthetic-top-campaign-${index}`,
          ])
        ),
        utm_content: syntheticEmailAddress,
        gclid: "synthetic-click-id",
        keep: "ordinary-value",
        $set_once: {
          ...Object.fromEntries(
            campaignProperties.map((property, index) => [
              property,
              `synthetic-nested-campaign-${index}`,
            ])
          ),
          $initial_utm_content: "Synthetic Name",
          $initial_gclid: "synthetic-nested-click-id",
          $session_entry_utm_content: "Synthetic Nested Name",
          $session_entry_gclid: "synthetic-nested-session-click-id",
          keepNested: "ordinary-nested-value",
        },
      },
      "preview"
    );

    expect(properties).toMatchObject({
      keep: "ordinary-value",
      $set_once: {
        keepNested: "ordinary-nested-value",
      },
      "deployment.environment.name": "preview",
    });
    for (const property of [
      ...campaignProperties,
      "utm_content",
      "$initial_utm_content",
      "$session_entry_utm_content",
    ]) {
      expect(properties).not.toHaveProperty(property);
      expect(properties.$set_once).not.toHaveProperty(property);
    }
    expect(JSON.stringify(properties)).not.toContain(syntheticEmailAddress);
    expect(JSON.stringify(properties)).not.toContain("Synthetic Name");
    expect(JSON.stringify(properties)).not.toContain("synthetic-click-id");
    expect(JSON.stringify(properties)).not.toContain(
      "synthetic-nested-click-id"
    );
    expect(JSON.stringify(properties)).not.toContain(
      "synthetic-nested-session-click-id"
    );
  });
});
