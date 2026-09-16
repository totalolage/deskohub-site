import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { createElement, Fragment } from "react";
import { getCanonicalLegalDocument } from "./canonical-document";
import { getLegalDocument } from "./content";

const hash = (canonicalDocument: string) =>
  createHash("sha256").update(canonicalDocument).digest("hex");

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

  test("drops boolean and holes but keeps key order title, lead, updatedAt, sections", () => {
    const canonicalDocument = getCanonicalLegalDocument({
      title: "t",
      lead: "l",
      updatedAt: "u",
      sections: [],
    });
    expect(canonicalDocument).toBe(
      '{"title":"t","lead":"l","updatedAt":"u","sections":[]}'
    );
  });

  test("marketing-communications en-US matches the production snapshot hash", () => {
    const canonicalDocument = getCanonicalLegalDocument(
      getLegalDocument("en-US", "marketing-communications")
    );
    expect(canonicalDocument.length).toBe(2412);
    expect(hash(canonicalDocument)).toBe(
      "75655dda4406b51fd74d1151a8d28443b75e580728c203cef54c2483ec3ed02d"
    );
  });

  test("marketing-communications cs-CZ matches the production snapshot hash", () => {
    const canonicalDocument = getCanonicalLegalDocument(
      getLegalDocument("cs-CZ", "marketing-communications")
    );
    expect(canonicalDocument.length).toBe(2492);
    expect(hash(canonicalDocument)).toBe(
      "3bbaa65156c221b8bf97b74a93c11830fb4f73cbbcd5d144932c51d6b71b4cb7"
    );
  });
});
