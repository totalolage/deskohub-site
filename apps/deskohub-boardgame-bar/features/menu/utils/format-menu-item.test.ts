import { describe, expect, test } from "bun:test";
import type { DotyposProduct } from "@deskohub/dotypos";
import {
  menuCategory,
  menuProduct,
} from "../components/menu-catalog.test-utils";
import { formatCategory, formatMenuItem } from "./format-menu-item";

describe("formatMenuItem", () => {
  test("uses the locale's translated name and description", () => {
    const item = formatMenuItem(
      menuProduct({
        translatedName: { "en-US": "Lemonade", "cs-CZ": "Limonáda" },
        translatedDescription: { cs: "Čerstvá máta" },
        description: "Fresh mint",
        unit: "0.5 l",
      }),
      "cs-CZ"
    );

    expect(item).toEqual({
      id: "lemonade",
      name: "Limonáda",
      description: "Čerstvá máta",
      priceWithVat: "85",
      unit: "0.5 l",
    });
  });

  test("falls back to the plain name and description", () => {
    const item = formatMenuItem(
      menuProduct({
        translatedName: { "cs-CZ": "Limonáda" },
        description: "Fresh mint",
        subtitle: "Homemade",
      }),
      "en-US"
    );

    expect(item.name).toBe("Lemonade");
    expect(item.description).toBe("Fresh mint");
  });

  test("describes the product by its subtitle when it has no description", () => {
    expect(
      formatMenuItem(
        menuProduct({ description: "", subtitle: "Homemade" }),
        "en-US"
      ).description
    ).toBe("Homemade");
  });

  test("leaves missing details empty", () => {
    const {
      id: _id,
      name: _name,
      ...unnamedProduct
    } = menuProduct({ priceWithVat: null });

    // Dotypos data can still arrive without the documented name.
    expect(formatMenuItem(unnamedProduct as DotyposProduct, "en-US")).toEqual({
      id: "",
      name: "",
      description: undefined,
      priceWithVat: null,
      unit: undefined,
    });
  });
});

describe("formatCategory", () => {
  test("uses the locale's translated name", () => {
    expect(
      formatCategory(
        menuCategory({ translatedName: { "cs-CZ": "Nápoje" } }),
        "cs-CZ"
      )
    ).toEqual({ name: "Nápoje" });
  });

  test("falls back to the plain name, then to an empty name", () => {
    expect(formatCategory(menuCategory(), "en-US")).toEqual({
      name: "Drinks",
    });
    const { name: _name, ...unnamedCategory } = menuCategory();

    expect(formatCategory(unnamedCategory, "en-US")).toEqual({ name: "" });
  });
});
