import { describe, expect, test } from "bun:test";
import { routeTemplateMatcher } from "./route-template";

describe("routeTemplateMatcher", () => {
  const matchRoute = routeTemplateMatcher([
    "/[locale]",
    "/[locale]/account/[section]",
    "/[locale]/account/deleted",
    "/[locale]/reservation/status/[orderId]",
    "/[locale]/docs/[...slug]",
    "/[locale]/shop/[[...path]]",
    "/[locale]/shop",
  ]);

  test.each([
    ["/en-US", "/[locale]"],
    ["/en-US/", "/[locale]"],
    ["/en-US/account/deleted", "/[locale]/account/deleted"],
    ["/en-US/account/profile", "/[locale]/account/[section]"],
    [
      "/cs-CZ/reservation/status/synthetic",
      "/[locale]/reservation/status/[orderId]",
    ],
    ["/en-US/docs/a/b/c", "/[locale]/docs/[...slug]"],
    ["/en-US/shop", "/[locale]/shop"],
    ["/en-US/shop/a/b", "/[locale]/shop/[[...path]]"],
  ])("matches %s to %s", (pathname, template) => {
    expect(matchRoute(pathname)).toBe(template);
  });

  test.each([
    ["/"],
    ["/en-US/private-customer-reference-123"],
    ["/en-US/reservation/status"],
    ["/en-US/reservation/status/synthetic/extra"],
    ["/en-US/docs"],
    ["/en-US/account/profile/extra"],
  ])("matches nothing for %s", (pathname) => {
    expect(matchRoute(pathname)).toBeUndefined();
  });
});
