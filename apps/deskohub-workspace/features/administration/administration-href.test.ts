import { expect, test } from "bun:test";
import {
  administrationHref,
  localizeAdministrationHref,
} from "./administration-href";

test("builds unprefixed administration paths", () => {
  expect(administrationHref("/[locale]/admin")).toBe("/admin");
  expect(
    administrationHref("/[locale]/admin/customers/[customerId]/create-code", {
      customerId: 42,
    })
  ).toBe("/admin/customers/42/create-code");
  expect(
    administrationHref("/[locale]/admin/orders/[orderId]", {
      orderId: "order 1/2",
    })
  ).toBe("/admin/orders/order%201%2F2");
});

test("places administration hrefs under the locale segment", () => {
  expect(localizeAdministrationHref("/admin", "cs-CZ")).toBe("/cs-CZ/admin");
  expect(
    localizeAdministrationHref(
      administrationHref("/[locale]/admin/reservations/[reservationId]", {
        reservationId: "r-1",
      }),
      "en-US"
    )
  ).toBe("/en-US/admin/reservations/r-1");
  expect(
    localizeAdministrationHref("/admin/reservations?status=paid", "cs-CZ")
  ).toBe("/cs-CZ/admin/reservations?status=paid");
  expect(localizeAdministrationHref("/admin?page=2", "en-US")).toBe(
    "/en-US/admin?page=2"
  );
});
