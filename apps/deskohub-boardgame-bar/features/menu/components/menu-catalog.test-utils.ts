import type { Category, Product } from "@deskohub/dotypos/generated";

export const menuCategory = (overrides: Partial<Category> = {}): Category => ({
  id: "drinks",
  name: "Drinks",
  ...overrides,
});

export const menuProduct = (overrides: Partial<Product> = {}): Product => ({
  id: "lemonade",
  _categoryId: "drinks",
  name: "Lemonade",
  priceWithoutVat: "70",
  priceWithVat: "85",
  vat: "21",
  ...overrides,
});

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
