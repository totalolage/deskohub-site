import { expect, test } from "bun:test";
import { agentPageRoute } from "./agent-page-request";

test.each([
  ["/en-US", "/"],
  ["/cs-CZ/", "/"],
  ["/en-US/reservation/cowork", "/reservation/cowork"],
  ["/en-US/account/profile", "/account/[section]"],
  ["/en-US/account/deleted", "/account/deleted"],
  [
    "/en-US/reservation/status/019edbcf-5026-7ecc-821b-eda46998eaaa",
    "/reservation/status/[orderId]",
  ],
])("reports %s as the route %s", (pathname, route) => {
  expect(agentPageRoute(pathname)).toBe(route);
});

test.each([
  ["an unknown page", "/en-US/private-customer-reference-123"],
  ["an unknown nested page", "/cs-CZ/private/customer-reference-123"],
  [
    "extra segments after an identifier",
    "/en-US/reservation/status/synthetic-order/private-customer-reference-123",
  ],
  ["extra segments after a static page", "/en-US/reservation/cowork/private"],
  ["a route handler path", "/cs-CZ/checkout/pay/return/synthetic-order"],
  ["a path without a locale segment", "/reservation/cowork"],
])("reports %s as unknown", (_, pathname) => {
  expect(agentPageRoute(pathname)).toBe("unknown");
});
