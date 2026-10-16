import { expect, test } from "bun:test";
import { localizeAdministrationHref } from "./administration-href";

test("places administration hrefs under the locale segment", () => {
  expect(localizeAdministrationHref("/admin", "cs-CZ")).toBe("/cs-CZ/admin");
  expect(localizeAdministrationHref("/admin/reservations/r-1", "en-US")).toBe(
    "/en-US/admin/reservations/r-1"
  );
  expect(
    localizeAdministrationHref("/admin/reservations?status=paid", "cs-CZ")
  ).toBe("/cs-CZ/admin/reservations?status=paid");
  expect(localizeAdministrationHref("/admin?page=2", "en-US")).toBe(
    "/en-US/admin?page=2"
  );
});

test("leaves every other href unchanged", () => {
  for (const href of [
    "/administrator",
    "/admin-help",
    "/cs-CZ/admin/codes",
    "/en-US/reservation/status/r-1",
    "https://xpay.nexigroup.com/orders/1",
    "#main-content",
  ]) {
    expect(localizeAdministrationHref(href, "cs-CZ")).toBe(href);
  }
});
