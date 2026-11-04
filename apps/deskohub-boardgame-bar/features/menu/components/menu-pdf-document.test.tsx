import { beforeAll, describe, expect, mock, test } from "bun:test";
import { Image, Page, Text } from "@react-pdf/renderer";
import { isValidElement, type ReactNode } from "react";
import { setBoardgameTestEnv } from "@/shared/testing/boardgame-test-env";
import { findElementsOfType } from "@/shared/testing/react-element-tree";
import { formatPrice } from "@/shared/utils/currency";
import {
  drinksMenu,
  menuCategory,
  menuProduct,
} from "./menu-catalog.test-utils";

const logoPath = "/_next/static/media/for-light-bg.png";

let MenuPDFDocument: typeof import("./menu-pdf-document").MenuPDFDocument;
let publicDomain: string;

beforeAll(async () => {
  setBoardgameTestEnv();
  // Next's bundler imports a PNG as StaticImageData; Bun imports its path.
  mock.module("@/assets/images/logo/for-light-bg.png", () => ({
    default: { src: logoPath, width: 4096, height: 4096 },
  }));
  ({ MenuPDFDocument } = await import("./menu-pdf-document"));
  ({ NEXT_PUBLIC_DOMAIN: publicDomain } = (await import("@/env")).env);
});

const locale = "en-US";

/** Plain text a PDF element tree prints. */
const textOf = (node: unknown): string => {
  if (Array.isArray(node)) return node.map(textOf).join("");
  if (isValidElement<{ children?: unknown }>(node)) {
    return textOf(node.props.children);
  }
  return typeof node === "string" || typeof node === "number"
    ? String(node)
    : "";
};

const menuPages = (props: Parameters<typeof MenuPDFDocument>[0]) =>
  findElementsOfType(MenuPDFDocument(props) as ReactNode, Page);

const menuTexts = (props: Parameters<typeof MenuPDFDocument>[0]) =>
  findElementsOfType(menuPages(props)[1], Text).map(textOf);

describe("MenuPDFDocument", () => {
  test("opens with a cover page showing the optimized logo from the site's domain", () => {
    const [cover] = menuPages({ categories: [], products: [], locale });
    const [logo] = findElementsOfType(cover, Image);
    const logoUrl = new URL(
      String(logo && "src" in logo.props ? logo.props.src : undefined)
    );

    expect(logoUrl.origin).toBe(new URL(publicDomain).origin);
    expect(logoUrl.pathname).toBe("/_next/image");
    expect(logoUrl.searchParams.get("url")).toBe(logoPath);
  });

  test("prints each product of a category with its unit, description, and price", () => {
    expect(
      menuTexts({
        categories: [drinksMenu.category],
        products: drinksMenu.products,
        locale,
      })
    ).toEqual([
      "Drinks",
      "Lemonade",
      "(0.5 l)",
      "Fresh mint",
      formatPrice("85", locale),
      "Nachos",
      formatPrice("120", locale),
      "Espresso",
      formatPrice("55", locale),
    ]);
  });

  test("skips categories without an id or without products, keeping the rest in order", () => {
    expect(
      menuTexts({
        categories: [
          menuCategory({ id: undefined, name: "Unsaved" }),
          menuCategory({ id: "games", name: "Games" }),
          menuCategory({ id: "snacks", name: "Snacks" }),
          menuCategory({ id: "beer", name: "Beer" }),
        ],
        products: [
          menuProduct({
            id: "pilsner",
            _categoryId: "beer",
            name: "Pilsner",
            priceWithVat: "60",
          }),
          menuProduct({
            id: "chips",
            _categoryId: "snacks",
            name: "Chips",
            priceWithVat: "40",
          }),
        ],
        locale,
      })
    ).toEqual([
      "Snacks",
      "Chips",
      formatPrice("40", locale),
      "Beer",
      "Pilsner",
      formatPrice("60", locale),
    ]);
  });
});
