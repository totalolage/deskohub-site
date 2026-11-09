import {
  type DotyposCategory,
  DotyposCategorySchema,
  type DotyposProduct,
  DotyposProductSchema,
} from "@deskohub/dotypos";
import { Schema } from "effect";

/** The fixture fields with overrides applied; an `undefined` override leaves the field out, as Dotypos omits a missing id. */
const withOverrides = <A extends object>(
  defaults: A,
  overrides: Partial<A>
): A =>
  Object.fromEntries(
    Object.entries({ ...defaults, ...overrides }).filter(
      ([, value]) => value !== undefined
    )
  ) as A;

export const menuCategory = (
  overrides: Partial<typeof DotyposCategorySchema.Encoded> = {}
): DotyposCategory =>
  Schema.decodeSync(DotyposCategorySchema)(
    withOverrides({ id: "drinks", name: "Drinks" }, overrides)
  );

export const menuProduct = (
  overrides: Partial<typeof DotyposProductSchema.Encoded> = {}
): DotyposProduct =>
  Schema.decodeSync(DotyposProductSchema)(
    withOverrides(
      {
        id: "lemonade",
        _categoryId: "drinks",
        name: "Lemonade",
        priceWithoutVat: "70",
        priceWithVat: "85",
        vat: "21",
      },
      overrides
    )
  );

/**
 * One drinks category whose products cover each optional detail: a measured
 * unit with a description, a counted unit, and no unit or description.
 */
export const drinksMenu = {
  category: menuCategory(),
  products: [
    menuProduct({
      id: "lemonade",
      name: "Lemonade",
      unit: "0.5 l",
      description: "Fresh mint",
      priceWithVat: "85",
    }),
    menuProduct({
      id: "nachos",
      name: "Nachos",
      unit: "ks",
      priceWithVat: "120",
    }),
    menuProduct({ id: "espresso", name: "Espresso", priceWithVat: "55" }),
    menuProduct({ id: "chips", _categoryId: "snacks", name: "Chips" }),
  ],
};
