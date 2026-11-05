import { describe, expect, test } from "bun:test";
import { getSchema, type JSONContent } from "@tiptap/core";
import { Node } from "@tiptap/pm/model";
import type {
  EmailDraftInlinePart,
  EmailDraftInlineParts,
} from "./email-draft-form";
import {
  emailInlinePartsEqual,
  emailInlinePartsToTipTap,
  normalizeEmailInlineParts,
  tipTapToEmailInlineParts,
  unformattedEmailInlineParts,
} from "./email-inline-parts";
import { emailInlineTextExtensions } from "./email-inline-text-extensions";

const richSchema = getSchema(
  emailInlineTextExtensions({ mode: "rich", missingValueLabel: "" })
);
const plainSchema = getSchema(
  emailInlineTextExtensions({ mode: "plain", missingValueLabel: "" })
);

/** The document as the editor holds it: parsed by the schema, back to JSON. */
const throughSchema = (doc: JSONContent, schema = richSchema): JSONContent =>
  Node.fromJSON(schema, doc).toJSON();

const cases: readonly {
  readonly name: string;
  readonly parts: EmailDraftInlineParts;
  readonly normalized: EmailDraftInlineParts;
}[] = [
  { name: "no parts", parts: [], normalized: [] },
  {
    name: "empty texts",
    parts: [{ _tag: "Text" }, { _tag: "Text", text: "", bold: true }],
    normalized: [],
  },
  {
    name: "unset and false marks",
    parts: [{ _tag: "Text", text: "Ahoj", bold: false, italic: undefined }],
    normalized: [{ _tag: "Text", text: "Ahoj" }],
  },
  {
    name: "neighbouring texts with the same marks",
    parts: [
      { _tag: "Text", text: "Dobrý ", bold: true },
      { _tag: "Text", text: "den", bold: true, italic: false },
      { _tag: "Text", text: "!" },
    ],
    normalized: [
      { _tag: "Text", text: "Dobrý den", bold: true },
      { _tag: "Text", text: "!" },
    ],
  },
  {
    name: "texts joined across an empty text",
    parts: [
      { _tag: "Text", text: "a", link: "web" },
      { _tag: "Text", text: "" },
      { _tag: "Text", text: "b", link: "web" },
    ],
    normalized: [{ _tag: "Text", text: "ab", link: "web" }],
  },
  {
    name: "texts with different links",
    parts: [
      { _tag: "Text", text: "a", link: "web" },
      { _tag: "Text", text: "b", link: "shop" },
      { _tag: "Text", text: "c", link: "" },
    ],
    normalized: [
      { _tag: "Text", text: "a", link: "web" },
      { _tag: "Text", text: "b", link: "shop" },
      { _tag: "Text", text: "c", link: "" },
    ],
  },
  {
    name: "a value with a field and every mark",
    parts: [
      {
        _tag: "Value",
        name: "booking",
        field: ["date"],
        bold: true,
        italic: true,
        link: "web",
      },
    ],
    normalized: [
      {
        _tag: "Value",
        name: "booking",
        field: ["date"],
        bold: true,
        italic: true,
        link: "web",
      },
    ],
  },
  {
    name: "unfinished values",
    parts: [
      { _tag: "Value" },
      { _tag: "Value", name: "" },
      { _tag: "Value", field: [] },
      { _tag: "Value", name: "x", field: ["", "y"], italic: false },
    ],
    normalized: [
      { _tag: "Value" },
      { _tag: "Value", name: "" },
      { _tag: "Value", field: [] },
      { _tag: "Value", name: "x", field: ["", "y"] },
    ],
  },
  {
    name: "texts around neighbouring values",
    parts: [
      { _tag: "Text", text: "Kód " },
      { _tag: "Value", name: "sleva", field: ["code"] },
      { _tag: "Value", name: "sleva", field: ["code"] },
      { _tag: "Text", text: " platí", italic: true },
    ],
    normalized: [
      { _tag: "Text", text: "Kód " },
      { _tag: "Value", name: "sleva", field: ["code"] },
      { _tag: "Value", name: "sleva", field: ["code"] },
      { _tag: "Text", text: " platí", italic: true },
    ],
  },
];

describe("email inline parts", () => {
  for (const { name, parts, normalized } of cases)
    test(`round-trips ${name}`, () => {
      expect(normalizeEmailInlineParts(parts)).toEqual(normalized);
      const doc = emailInlinePartsToTipTap(parts);
      expect(tipTapToEmailInlineParts(doc)).toEqual(normalized);
      const held = throughSchema(doc);
      expect(held).toEqual(doc);
      expect(tipTapToEmailInlineParts(held)).toEqual(normalized);
      expect(emailInlinePartsToTipTap(tipTapToEmailInlineParts(held))).toEqual(
        held
      );
    });

  test("holds a value as a node with its name and field, and links by key", () => {
    expect(
      emailInlinePartsToTipTap([
        { _tag: "Text", text: "Ahoj ", link: "web" },
        { _tag: "Value", name: "customer", field: ["firstName"], bold: true },
        { _tag: "Value" },
      ])
    ).toEqual({
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            {
              type: "text",
              text: "Ahoj ",
              marks: [{ type: "emailLink", attrs: { key: "web" } }],
            },
            {
              type: "emailValue",
              attrs: { name: "customer", field: ["firstName"] },
              marks: [{ type: "bold" }],
            },
            { type: "emailValue", attrs: { name: null, field: null } },
          ],
        },
      ],
    });
  });

  test("an empty text is one empty paragraph", () => {
    expect(emailInlinePartsToTipTap([])).toEqual({
      type: "doc",
      content: [{ type: "paragraph" }],
    });
    expect(tipTapToEmailInlineParts({ type: "doc" })).toEqual([]);
  });

  test("joins paragraphs with a space and skips nodes it doesn't know", () => {
    expect(
      tipTapToEmailInlineParts({
        type: "doc",
        content: [
          { type: "paragraph", content: [{ type: "text", text: "a" }] },
          {
            type: "paragraph",
            content: [{ type: "hardBreak" }, { type: "text", text: "b" }],
          },
        ],
      })
    ).toEqual([{ _tag: "Text", text: "a b" }]);
  });

  test("drops formatting for plain texts", () => {
    const parts: EmailDraftInlineParts = [
      { _tag: "Text", text: "a", bold: true },
      { _tag: "Text", text: "b", link: "web" },
      { _tag: "Value", name: "x", italic: true },
    ];
    const plain = unformattedEmailInlineParts(parts);
    expect(plain).toEqual([
      { _tag: "Text", text: "ab" },
      { _tag: "Value", name: "x" },
    ]);
    const doc = emailInlinePartsToTipTap(plain);
    expect(throughSchema(doc, plainSchema)).toEqual(doc);
  });

  test("compares texts by their normalized parts", () => {
    expect(
      emailInlinePartsEqual(
        [
          { _tag: "Text", text: "a", bold: true, italic: false },
          { _tag: "Text", text: "b", bold: true },
        ],
        [{ _tag: "Text", text: "ab", bold: true }]
      )
    ).toBe(true);
    expect(
      emailInlinePartsEqual(
        [{ _tag: "Text", text: "ab" }],
        [{ _tag: "Text", text: "ab", italic: true }]
      )
    ).toBe(false);
    expect(
      emailInlinePartsEqual([{ _tag: "Value" }], [{ _tag: "Value", name: "" }])
    ).toBe(false);
  });
});

/** A seeded generator, so a failing case reproduces. */
const random = (seed: number) => () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
};

const randomPart = (next: () => number): EmailDraftInlinePart => {
  const pick = <T>(values: readonly T[]): T =>
    values[Math.floor(next() * values.length)] as T;
  const marks = {
    ...pick([{}, { bold: true }, { bold: false }]),
    ...pick([{}, { italic: true }, { italic: false }]),
    ...pick([{}, { link: "web" }, { link: "shop" }, { link: "" }]),
  };
  return next() < 0.7
    ? {
        _tag: "Text",
        ...pick([
          {},
          { text: "" },
          { text: "a" },
          { text: " bc" },
          { text: "ř\t" },
        ]),
        ...marks,
      }
    : {
        _tag: "Value",
        ...pick([{}, { name: "" }, { name: "booking" }, { name: "sleva" }]),
        ...pick([
          {},
          { field: [] },
          { field: ["date"] },
          { field: ["a", "b"] },
        ]),
        ...marks,
      };
};

test("round-trips random texts through the editor's schema", () => {
  const next = random(20_261_104);
  for (let run = 0; run < 500; run++) {
    const parts = Array.from({ length: Math.floor(next() * 8) }, () =>
      randomPart(next)
    );
    const normalized = normalizeEmailInlineParts(parts);
    expect(normalizeEmailInlineParts(normalized)).toEqual(normalized);
    const held = throughSchema(emailInlinePartsToTipTap(parts));
    expect(tipTapToEmailInlineParts(held)).toEqual(normalized);
    expect(emailInlinePartsToTipTap(tipTapToEmailInlineParts(held))).toEqual(
      held
    );
    const plain = unformattedEmailInlineParts(parts);
    expect(
      tipTapToEmailInlineParts(
        throughSchema(emailInlinePartsToTipTap(plain), plainSchema)
      )
    ).toEqual(plain);
  }
});
