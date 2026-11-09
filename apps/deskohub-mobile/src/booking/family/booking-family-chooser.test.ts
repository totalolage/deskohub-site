import { describe, expect, test } from "bun:test";
import type { CustomerOffering } from "@deskohub/workspace-customer-api";
import { makeFakeCustomerData } from "../../customer-api/testing/customer-data-test-registry";
import { bookingOfferingsAtom } from "../data/booking-queries";
import { bookingFamilyChoices } from "./booking-family-chooser";
import { settledValue } from "./testing/settled-value";

const czk = (value: number, exponent = 2) => ({
  value,
  exponent,
  currency: "CZK",
});

const lowestPrice = (
  offerings: ReadonlyArray<CustomerOffering>,
  family: CustomerOffering["family"]
) =>
  Math.min(
    ...offerings
      .filter((offering) => offering.family === family)
      .map(({ advertisedPrice }) => advertisedPrice.price.value)
  );

describe("bookingFamilyChoices", () => {
  test("offers each catalog family once, in catalog order, from its cheapest advertised price", async () => {
    const { registry } = makeFakeCustomerData("linked");
    const catalog = await settledValue(registry, bookingOfferingsAtom("cs-CZ"));

    const choices = bookingFamilyChoices(catalog.offerings);

    expect(choices.map(({ family }) => family)).toEqual([
      ...new Set(catalog.offerings.map(({ family }) => family)),
    ]);
    for (const { family, fromPrice } of choices) {
      expect(fromPrice.value).toBe(lowestPrice(catalog.offerings, family));
    }
  });

  test("compares prices across minor-unit exponents", () => {
    const offerings = [
      { family: "office", advertisedPrice: { price: czk(500, 0) } },
      { family: "office", advertisedPrice: { price: czk(45_000) } },
      { family: "office", advertisedPrice: { price: czk(46_000) } },
    ] as unknown as ReadonlyArray<CustomerOffering>;

    expect(bookingFamilyChoices(offerings)).toEqual([
      { family: "office", fromPrice: czk(45_000) },
    ]);
  });

  test("offers nothing without offerings", () => {
    expect(bookingFamilyChoices([])).toEqual([]);
  });
});
