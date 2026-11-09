import { describe, expect, test } from "bun:test";
import {
  renderOnLocaleRoute,
  routeLocale,
} from "@/features/gallery/components/gallery-render.test-utils";
import { formatPrice } from "@/shared/utils/currency";
import { drinksMenu, menuCategory } from "./menu-catalog.test-utils";
import { MenuSection } from "./menu-section";

const { category, products } = drinksMenu;

/** Text of each `tag` element in the HTML, in document order. */
const elementTexts = (html: string, tag: string) =>
  [...html.matchAll(new RegExp(`<${tag}[^>]*>(.*?)</${tag}>`, "g"))].map(
    ([, inner]) => inner!.replaceAll(/<[^>]+>/g, "")
  );

describe("MenuSection", () => {
  test("renders nothing for a category without products", () => {
    expect(
      renderOnLocaleRoute(
        <MenuSection
          products={products}
          category={menuCategory({ id: "games" })}
        />
      )
    ).toBe("");
  });

  test("lists only the category's products with their route-locale prices", () => {
    const html = renderOnLocaleRoute(
      <MenuSection products={products} category={category} />
    );

    expect(elementTexts(html, "h2")).toEqual(["Drinks"]);
    expect(elementTexts(html, "h3")).toEqual([
      "Lemonade(0.5 l)",
      "Nachos",
      "Espresso",
    ]);
    expect(html).toContain(formatPrice("85", routeLocale));
    expect(html).toContain(formatPrice("120", routeLocale));
    expect(html).toContain(formatPrice("55", routeLocale));
  });

  test("shows only measured units and present descriptions", () => {
    const html = renderOnLocaleRoute(
      <MenuSection products={products} category={category} />
    );

    expect(elementTexts(html, "span")).toEqual(["(0.5 l)"]);
    expect(elementTexts(html, "p")).toEqual(["Fresh mint"]);
  });

  test("puts the category emoji before its name", () => {
    const html = renderOnLocaleRoute(
      <MenuSection products={products} category={category} emoji="🍋" />
    );

    expect(elementTexts(html, "h2")).toEqual(["🍋Drinks"]);
    expect(elementTexts(html, "span")[0]).toBe("🍋");
  });
});
