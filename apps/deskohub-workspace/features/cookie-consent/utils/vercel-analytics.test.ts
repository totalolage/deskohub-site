import { describe, expect, test } from "bun:test";
import { sanitizeVercelAnalyticsEvent } from "./vercel-analytics";

describe("sanitizeVercelAnalyticsEvent", () => {
  test.each([
    [
      "pageview",
      "https://deskohub.test/en-US/reservation/status/synthetic-reservation-id?orderId=synthetic-order-id&outcome=success",
      "https://deskohub.test/en-US/reservation/status/[id]?outcome=success",
    ],
    [
      "event",
      "https://deskohub.test/cs-CZ/reservation/access/synthetic-reservation-id?accessToken=synthetic-capability",
      "https://deskohub.test/cs-CZ/reservation/access/[id]",
    ],
    [
      "pageview",
      "https://deskohub.test/en-US/reservation/invoice/synthetic-order-id",
      "https://deskohub.test/en-US/reservation/invoice/[id]",
    ],
    [
      "pageview",
      "https://deskohub.test/admin/orders/synthetic-order-id",
      "https://deskohub.test/admin/orders/[id]",
    ],
  ] as const)(
    "normalizes %s operational URLs",
    (type, url, expectedUrl) => {
      expect(
        sanitizeVercelAnalyticsEvent({
          type,
          url,
        })
      ).toEqual({
        type,
        url: expectedUrl,
      });
    }
  );

  test("leaves ordinary marketing URLs unchanged", () => {
    const event = {
      type: "pageview" as const,
      url: "https://deskohub.test/en-US/meeting-room?utm_source=deskohub",
    };

    expect(sanitizeVercelAnalyticsEvent(event)).toEqual(event);
  });
});
