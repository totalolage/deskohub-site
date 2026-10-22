import { describe, expect, test } from "bun:test";
import {
  getLocalizedDynamicPagePath,
  getLocalizedPagePath,
  getPagePath,
} from "./routing";

describe("localized page paths", () => {
  test("prefixes a static page route with the locale", () => {
    expect(getLocalizedPagePath("cs-CZ", "/[locale]/account")).toBe(
      "/cs-CZ/account"
    );
  });

  test("drops the locale segment for a locale-agnostic path", () => {
    expect(getPagePath("/[locale]/account")).toBe("/account");
  });

  test("fills a dynamic page route's parameters", () => {
    expect(
      getLocalizedDynamicPagePath("en-US", "/[locale]/account/[section]", {
        section: "security",
      })
    ).toBe("/en-US/account/security");
  });

  test("encodes each parameter as one path segment", () => {
    expect(
      getLocalizedDynamicPagePath(
        "cs-CZ",
        "/[locale]/reservation/status/[orderId]",
        { orderId: "order 1/2?x" }
      )
    ).toBe("/cs-CZ/reservation/status/order%201%2F2%3Fx");
  });
});
