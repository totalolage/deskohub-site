import { expect, test } from "bun:test";
import { agentPageRoute } from "./agent-page-request";

test.each([
  ["/en-US", "en-US", "/"],
  ["/cs-CZ/", "cs-CZ", "/"],
  ["/en-US/reservation/cowork", "en-US", "/reservation/cowork"],
  [
    "/en-US/reservation/status/019edbcf-5026-7ecc-821b-eda46998eaaa",
    "en-US",
    "/reservation/status/[id]",
  ],
  [
    "/cs-CZ/checkout/pay/return/synthetic-order",
    "cs-CZ",
    "/checkout/pay/return/[id]",
  ],
])("reports %s as the route %s", (pathname, locale, route) => {
  expect(agentPageRoute(pathname, locale)).toBe(route);
});
