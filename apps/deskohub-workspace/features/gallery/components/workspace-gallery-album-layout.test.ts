import { describe, expect, test } from "bun:test";
import {
  galleryAlbumColumns,
  galleryAlbumSpacing,
} from "./workspace-gallery-album-layout";

describe("galleryAlbumColumns", () => {
  test.each([
    [320, 1],
    [519, 1],
    [520, 2],
    [899, 2],
    [900, 3],
    [1088, 3],
  ])("lays a %d px album out in %d columns", (width, columns) => {
    expect(galleryAlbumColumns(width)).toBe(columns);
  });
});

describe("galleryAlbumSpacing", () => {
  test.each([
    [639, 14],
    [640, 18],
  ])("spaces a %d px album's photos %d px apart", (width, spacing) => {
    expect(galleryAlbumSpacing(width)).toBe(spacing);
  });
});
