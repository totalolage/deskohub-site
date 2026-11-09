import { describe, expect, test } from "bun:test";
import { testEmailAddress } from "@deskohub/test-email";
import { preparePostHogEvent } from "./posthog-event";

const createEvent = (
  event: string,
  properties: Parameters<typeof preparePostHogEvent>[0]["properties"]
) => ({
  uuid: "019ee060-bc9f-7070-aea9-9440835fe38f",
  event,
  properties,
});

describe("preparePostHogEvent", () => {
  test("sanitizes documented initial URLs in top-level person-property bags", () => {
    const event = {
      ...createEvent("workspace page viewed", {
        $current_url: `https://workspace.deskohub.cz/account?email=${encodeURIComponent(testEmailAddress("synthetic"))}#name`,
        $referrer: "$direct",
      }),
      $set_once: {
        $initial_current_url:
          "https://workspace.deskohub.cz/checkout/pay/return/order-id?token=synthetic-token#billing",
        $initial_referrer:
          "https://workspace.deskohub.cz/account?pin=123456#synthetic-fragment",
        $initial_pathname:
          "/reservation/invoice/synthetic-reservation-id?billing=synthetic-billing#synthetic-fragment",
      },
    };

    const preparedEvent = preparePostHogEvent(event, "production");

    expect(preparedEvent).toBe(event);
    expect(preparedEvent?.properties).toEqual({
      $current_url: "https://workspace.deskohub.cz/account",
      $referrer: "$direct",
      "deployment.environment.name": "production",
    });
    expect(preparedEvent?.$set_once).toEqual({
      $initial_current_url:
        "https://workspace.deskohub.cz/checkout/pay/return/[id]",
      $initial_referrer: "https://workspace.deskohub.cz/account",
      $initial_pathname: "/reservation/invoice/[id]",
    });
    for (const privateValue of [
      testEmailAddress("synthetic"),
      "synthetic-token",
      "billing",
      "123456",
      "synthetic-fragment",
    ]) {
      expect(JSON.stringify(preparedEvent)).not.toContain(privateValue);
    }
  });
});
