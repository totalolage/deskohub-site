import { describe, expect, test } from "bun:test";
import {
  markdownBlockListItem,
  markdownHeading,
  markdownLink,
  markdownList,
  markdownListItem,
  markdownParagraph,
  markdownStrong,
  serializeMarkdown,
} from "./markdown";
import { markdownLinkUrls, markdownPlainText } from "./markdown.test-utils";

describe("serializeMarkdown", () => {
  test("escapes text so copy never becomes Markdown syntax", () => {
    const copy = [
      "1. Úvodní ustanovení",
      "# not a heading",
      "- not a list",
      "*not emphasis* and _not either_",
      "[not a link](https://example.com) <b>not html</b>",
      "a \\ backslash and `no code`",
    ];
    const markdown = serializeMarkdown(
      copy.map((line) => markdownParagraph(line))
    );

    expect(markdownPlainText(markdown)).toBe(copy.join("\n"));
    expect(markdownLinkUrls(markdown)).toEqual([]);
  });

  test("renders headings, links, strong text and nested lists", () => {
    const markdown = serializeMarkdown([
      markdownHeading(1, "Title"),
      markdownParagraph(markdownStrong("Label"), ": value"),
      markdownList([
        markdownListItem(markdownLink("https://example.com/a", "First")),
        markdownBlockListItem(
          markdownParagraph("Second"),
          markdownList([markdownListItem("Nested")])
        ),
      ]),
    ]);

    expect(markdown).toBe(
      [
        "# Title",
        "",
        "**Label**: value",
        "",
        "- [First](https://example.com/a)",
        "- Second",
        "  - Nested",
        "",
      ].join("\n")
    );
  });
});
