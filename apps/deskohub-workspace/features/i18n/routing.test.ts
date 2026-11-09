import { describe, expect, test } from "bun:test";
import { getLocalizedPagePath, getUnprefixedPagePath } from "./routing";

describe("page paths", () => {
  test("drops the locale segment for a locale-agnostic path", () => {
    expect(getUnprefixedPagePath("/[locale]/account")).toBe("/account");
  });

  test("fills a dynamic route's parameters", () => {
    expect(
      getUnprefixedPagePath(
        "/[locale]/admin/email-campaigns/[campaignId]/runs/[runId]",
        { campaignId: 12, runId: "run-3" }
      )
    ).toBe("/admin/email-campaigns/12/runs/run-3");
  });

  test("encodes each parameter as one path segment", () => {
    expect(
      getUnprefixedPagePath("/[locale]/reservation/status/[orderId]", {
        orderId: "order 1/2?x",
      })
    ).toBe("/reservation/status/order%201%2F2%3Fx");
  });

  test("builds a path to a route handler", () => {
    expect(
      getUnprefixedPagePath("/[locale]/admin/invoices/[invoiceId]/pdf", {
        invoiceId: "invoice-id",
      })
    ).toBe("/admin/invoices/invoice-id/pdf");
  });

  test("prefixes a static route with the locale", () => {
    expect(getLocalizedPagePath("cs-CZ", "/[locale]/account")).toBe(
      "/cs-CZ/account"
    );
  });

  test("prefixes a dynamic route with the locale", () => {
    expect(
      getLocalizedPagePath("en-US", "/[locale]/account/[section]", {
        section: "security",
      })
    ).toBe("/en-US/account/security");
  });
});
