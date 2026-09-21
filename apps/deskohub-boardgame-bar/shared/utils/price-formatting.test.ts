import { expect, test } from "bun:test";
import { formatPrice } from "./price-formatting";

const formatWithDigits = (
  amount: number,
  locale: string,
  digits?: { minimumFractionDigits?: number; maximumFractionDigits?: number }
) =>
  new Intl.NumberFormat(locale, {
    style: "currency",
    currency: "CZK",
    ...digits,
  }).format(amount);

test("formats whole amounts without minor units in every locale", () => {
  expect(formatPrice(150, "en-US")).toBe(
    formatWithDigits(150, "en-US", {
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    })
  );
  expect(formatPrice(150, "cs-CZ")).toBe(
    formatWithDigits(150, "cs-CZ", {
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    })
  );
});

test("leaves fractional amounts to the Intl currency defaults", () => {
  expect(formatPrice(149.99, "en-US")).toBe(formatWithDigits(149.99, "en-US"));
  expect(formatPrice(149.99, "cs-CZ")).toBe(formatWithDigits(149.99, "cs-CZ"));
});
