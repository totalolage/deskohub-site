import { describe, expect, test } from "bun:test";
import { preferredMediaType } from "./media-type-negotiation";

const offered = ["text/html", "text/markdown"] as const;

const preferredFor = (accept?: string) =>
  preferredMediaType(
    new Headers(accept === undefined ? {} : { accept }),
    offered
  );

describe("preferredMediaType", () => {
  test.each([
    ["text/markdown", "text/markdown"],
    ["text/markdown, */*", "text/markdown"],
    ["text/markdown, text/html, */*", "text/markdown"],
    ["text/markdown, text/html;q=0.9", "text/markdown"],
    ["text/markdown;q=1.0, text/html;q=0.5, */*;q=0.1", "text/markdown"],
    ["text/html;q=0.5, text/markdown", "text/markdown"],
    ["text/plain, text/markdown;q=0.9, */*;q=0.1", "text/markdown"],
  ])("prefers Markdown for %p", (accept, expected) => {
    expect(preferredFor(accept)).toBe(expected);
  });

  test.each([
    [
      "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
      "text/html",
    ],
    ["*/*", "text/html"],
    ["text/*", "text/html"],
    ["text/html, text/markdown", "text/html"],
    ["text/html;q=0.9, text/markdown;q=0.9", "text/html"],
    ["text/markdown;q=0.5, text/html", "text/html"],
    ["text/markdown;q=0.8, */*", "text/html"],
  ])("keeps HTML for %p", (accept, expected) => {
    expect(preferredFor(accept)).toBe(expected);
  });

  test("serves the first offer without an Accept header", () => {
    expect(preferredFor()).toBe("text/html");
  });

  test("accepts none of the offers", () => {
    expect(preferredFor("application/json")).toBeUndefined();
    expect(preferredFor("text/markdown;q=0")).toBeUndefined();
  });
});
