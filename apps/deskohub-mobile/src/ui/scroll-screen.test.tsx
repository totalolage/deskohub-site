import { describe, expect, test } from "bun:test";
import { isValidElement, type RefObject } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ScrollScreen, useScrollScreenToTop } from "./scroll-screen";
import { elementTree, find } from "./testing/element-tree";

describe("ScrollScreen", () => {
  test("scrolls its content back to the top on request", () => {
    let scrollToTop: (() => void) | undefined;
    const Reader = () => {
      scrollToTop = useScrollScreenToTop();
      return null;
    };
    const tree = elementTree(ScrollScreen, { children: <Reader /> });
    const scrollView = find(tree, "ScrollView");
    const scrolls: Array<unknown> = [];
    (scrollView?.props.ref as RefObject<unknown>).current = {
      scrollTo: (options: unknown) => scrolls.push(options),
    };

    // The ScrollView's content provides the request to the screen's children.
    const provider = scrollView?.props.children;
    if (!isValidElement(provider)) {
      throw new Error("ScrollScreen renders nothing inside its ScrollView");
    }
    renderToStaticMarkup(provider);
    scrollToTop?.();

    // Instantly, so the top is already in view as the screen returns.
    expect(scrolls).toEqual([{ y: 0, animated: false }]);
  });

  test("a scroll request outside a ScrollScreen does nothing", () => {
    let scrollToTop: (() => void) | undefined;
    elementTree(() => {
      scrollToTop = useScrollScreenToTop();
      return null;
    }, {});
    expect(() => scrollToTop?.()).not.toThrow();
  });
});
