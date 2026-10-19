import { describe, expect, test } from "bun:test";
import { classifyAgentEvalUrl } from "./observations";

const origins = {
  paymentProviderHost: "xpaysandbox.nexigroup.com",
  siteOrigin: "https://deskohub-workspace-site-abc123def-team.vercel.app",
};

describe("classifyAgentEvalUrl", () => {
  test.each([
    ["/en-US/reservation/cowork?date=2027-02-18", "reservation-cowork"],
    ["/cs-CZ/reservation/meeting-room", "reservation-meeting-room"],
    ["/en-US/reservation/office", "reservation-office"],
    ["/en-US/checkout/pay?payState=opaque", "pay"],
    ["/cs-CZ/reservation/status/order-1?outcome=success", "status"],
    ["/en-US/auth/sign-in?returnTo=%2Fen-US", "sign-in"],
    ["/cs-CZ/account", "account"],
    ["/en-US", "site"],
    ["/en-US/checkout/pay/return/order-1", "site"],
  ])("classifies %s on the preview as %s", (path, route) => {
    expect(classifyAgentEvalUrl(`${origins.siteOrigin}${path}`, origins)).toBe(
      route
    );
  });

  test("tells the payment provider and other sites apart", () => {
    expect(
      classifyAgentEvalUrl(
        "https://xpaysandbox.nexigroup.com/monetaweb/page/hosted",
        origins
      )
    ).toBe("payment-provider");
    expect(classifyAgentEvalUrl("https://www.google.com/search", origins)).toBe(
      "external"
    );
  });

  test("ignores blank and browser pages", () => {
    expect(classifyAgentEvalUrl("about:blank", origins)).toBeUndefined();
    expect(classifyAgentEvalUrl("chrome://newtab/", origins)).toBeUndefined();
  });
});
