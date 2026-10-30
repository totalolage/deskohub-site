import { describe, expect, test } from "bun:test";
import { createElement, Fragment } from "react";
import { getCanonicalLegalDocument } from "./canonical-document";

describe("getCanonicalLegalDocument", () => {
  test("flattens primitive and nested real JSX nodes to concatenated text", () => {
    const canonicalDocument = getCanonicalLegalDocument({
      title: "t",
      lead: "l",
      updatedAt: "u",
      sections: [
        {
          heading: "h",
          body: [
            "plain",
            42,
            false,
            null,
            undefined,
            createElement(
              Fragment,
              null,
              "nested ",
              createElement(
                "span",
                null,
                "deep ",
                createElement("b", null, "deeper")
              )
            ),
            ["array ", createElement("i", { key: "i" }, "item")],
          ],
        },
      ],
    });
    const parsed = JSON.parse(canonicalDocument) as {
      sections: { body: string[] }[];
    };
    expect(parsed.sections[0]?.body).toEqual([
      "plain",
      "42",
      "",
      "",
      "",
      "nested deep deeper",
      "array item",
    ]);
  });
});
