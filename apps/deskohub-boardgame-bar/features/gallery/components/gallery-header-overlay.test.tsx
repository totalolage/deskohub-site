import { describe, expect, mock, test } from "bun:test";
import type { CloudinaryAsset } from "@deskohub/cloudinary";
import type { ReactElement } from "react";
import { findElementsOfType } from "@/shared/testing/react-element-tree";
import {
  GalleryHeaderControls,
  GalleryHeaderText,
} from "./gallery-header-overlay";

describe("GalleryHeaderText", () => {
  const textOf = (props: Parameters<typeof GalleryHeaderText>[0]) => {
    const tree = GalleryHeaderText(props);
    return {
      headings: findElementsOfType(tree, "h1").map(
        ({ props }) => props.children
      ),
      paragraphs: findElementsOfType(tree, "p").map(
        ({ props }) => props.children
      ),
    };
  };

  test("shows the title as the heading and the description below it", () => {
    expect(textOf({ title: "Gallery", description: "Our tables" })).toEqual({
      headings: ["Gallery"],
      paragraphs: ["Our tables"],
    });
  });

  test("shows only the parts it is given", () => {
    expect(textOf({ title: "Gallery" })).toEqual({
      headings: ["Gallery"],
      paragraphs: [],
    });
    expect(textOf({ description: "Our tables" })).toEqual({
      headings: [],
      paragraphs: ["Our tables"],
    });
  });
});

describe("GalleryHeaderControls", () => {
  const images = ["a", "b", "c"].map(
    (publicId) => ({ public_id: publicId }) as CloudinaryAsset
  );

  const controls = (haveText = false) => {
    const handlers = { onPrevious: mock(), onNext: mock(), onSelect: mock() };
    const tree = GalleryHeaderControls({
      images,
      currentIndex: 1,
      haveText,
      ...handlers,
    });
    const [previous, ...rest] = findElementsOfType(tree, "button");
    const next = rest.pop()!;
    const arrowColumns = (
      tree as ReactElement<{ children: ReactElement<{ className: string }>[] }>
    ).props.children
      .filter((child) => child.props.className.includes("justify-"))
      .map((child) => child.props.className);
    return { handlers, previous: previous!, next, dots: rest, arrowColumns };
  };

  test("moves to the previous and next slides", () => {
    const { handlers, previous, next } = controls();

    previous.props.onClick!({} as never);
    expect(handlers.onPrevious).toHaveBeenCalledTimes(1);
    next.props.onClick!({} as never);
    expect(handlers.onNext).toHaveBeenCalledTimes(1);
  });

  test("selects a slide from its dot and highlights the current one", () => {
    const { handlers, dots } = controls();

    expect(dots).toHaveLength(images.length);
    dots[2]!.props.onClick!({} as never);
    expect(handlers.onSelect).toHaveBeenCalledWith(2);
    expect(dots.map(({ props }) => props.className?.includes("w-8"))).toEqual([
      false,
      true,
      false,
    ]);
  });

  test("raises the arrows beside the text band and centers them without it", () => {
    expect(
      controls(true).arrowColumns.every((name) => name.includes("self-start"))
    ).toBeTrue();
    expect(
      controls(false).arrowColumns.every((name) => name.includes("self-center"))
    ).toBeTrue();
    expect(controls().arrowColumns).toHaveLength(2);
  });
});
