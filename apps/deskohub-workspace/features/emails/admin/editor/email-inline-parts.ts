import type { JSONContent } from "@tiptap/core";
import { Schema } from "effect";
import type {
  EmailDraftInlinePart,
  EmailDraftInlineParts,
} from "./email-draft-form";

/** A translated text holds one line: line breaks become spaces. */
export const singleLineEmailInlineText = (text: string): string =>
  text.replace(/[^\S\r\n]*[\r\n]+[^\S\r\n]*/g, " ");

/** The inline node that holds a value reference in a text editor. */
export const emailInlineValueNode = "emailValue";
/** The mark that ties text to one of its block's links, by link key. */
export const emailInlineLinkMark = "emailLink";

const isAttributeText = Schema.is(Schema.String);
const isAttributePath = Schema.is(Schema.Array(Schema.String));

/**
 * The reference a value node's attributes hold. An unset or malformed name
 * or field stays unset.
 */
export const emailInlineValueReference = (
  attrs: JSONContent["attrs"]
): { readonly name?: string; readonly field?: readonly string[] } => {
  const name = attrs?.name;
  const field = attrs?.field;
  return {
    ...(isAttributeText(name) && { name }),
    ...(isAttributePath(field) && { field: [...field] }),
  };
};

/** The link key a link mark's attributes hold. */
export const emailInlineLinkKey = (
  attrs: JSONContent["attrs"]
): string | undefined => {
  const key = attrs?.key;
  return isAttributeText(key) ? key : undefined;
};

type EmailInlineMarks = {
  readonly bold?: boolean;
  readonly italic?: boolean;
  readonly link?: string;
};

/** The set marks of a part, in the order normalized parts list them. */
const setMarks = (marks: EmailInlineMarks): EmailInlineMarks => ({
  ...(marks.bold && { bold: true }),
  ...(marks.italic && { italic: true }),
  ...(marks.link !== undefined && { link: marks.link }),
});

const sameMarks = (a: EmailInlineMarks, b: EmailInlineMarks): boolean =>
  Boolean(a.bold) === Boolean(b.bold) &&
  Boolean(a.italic) === Boolean(b.italic) &&
  a.link === b.link;

/** A value part with every key it sets, even an empty name or field path. */
const normalizedValuePart = (
  part: Extract<EmailDraftInlinePart, { readonly _tag: "Value" }>
): EmailDraftInlinePart => ({
  _tag: "Value",
  ...(part.name !== undefined && { name: part.name }),
  ...(part.field !== undefined && { field: [...part.field] }),
  ...setMarks(part),
});

/**
 * Adds a text part to `normalized`: nothing when it is empty, joined to the
 * previous text when their marks match.
 */
const appendTextPart = (
  normalized: EmailDraftInlinePart[],
  part: Extract<EmailDraftInlinePart, { readonly _tag: "Text" }>
) => {
  const text = part.text ?? "";
  if (!text) return;
  const previous = normalized.at(-1);
  if (previous?._tag === "Text" && sameMarks(previous, part))
    normalized[normalized.length - 1] = {
      ...previous,
      text: `${previous.text ?? ""}${text}`,
    };
  else normalized.push({ _tag: "Text", text, ...setMarks(part) });
};

/**
 * The one spelling of a text's parts that a text editor reads back: empty
 * texts dropped, neighbouring texts with the same marks joined, and unset or
 * `false` marks left out. Value parts keep every key they set, even an empty
 * name or field path, so an unfinished reference survives editing.
 */
export const normalizeEmailInlineParts = (
  parts: EmailDraftInlineParts
): EmailDraftInlineParts => {
  const normalized: EmailDraftInlinePart[] = [];
  for (const part of parts) {
    if (part._tag === "Value") normalized.push(normalizedValuePart(part));
    else appendTextPart(normalized, part);
  }
  return normalized;
};

/** The parts without bold, italic or links, as a plain text holds them. */
export const unformattedEmailInlineParts = (
  parts: EmailDraftInlineParts
): EmailDraftInlineParts =>
  normalizeEmailInlineParts(
    parts.map((part) =>
      part._tag === "Text"
        ? { _tag: "Text", text: part.text }
        : {
            _tag: "Value",
            ...(part.name !== undefined && { name: part.name }),
            ...(part.field !== undefined && { field: part.field }),
          }
    )
  );

/** Whether two texts read the same once normalized. */
export const emailInlinePartsEqual = (
  a: EmailDraftInlineParts,
  b: EmailDraftInlineParts
): boolean =>
  // Normalized parts list their keys in one order, so their JSON compares.
  JSON.stringify(normalizeEmailInlineParts(a)) ===
  JSON.stringify(normalizeEmailInlineParts(b));

const tipTapMarks = (
  marks: EmailInlineMarks
): NonNullable<JSONContent["marks"]> => [
  ...(marks.bold ? [{ type: "bold" }] : []),
  ...(marks.italic ? [{ type: "italic" }] : []),
  ...(marks.link !== undefined
    ? [{ type: emailInlineLinkMark, attrs: { key: marks.link } }]
    : []),
];

const tipTapInline = (part: EmailDraftInlinePart): JSONContent => {
  const marks = tipTapMarks(part);
  const node: JSONContent =
    part._tag === "Text"
      ? { type: "text", text: part.text }
      : {
          type: emailInlineValueNode,
          attrs: {
            name: part.name ?? null,
            field: part.field ? [...part.field] : null,
          },
        };
  return marks.length > 0 ? { ...node, marks } : node;
};

/**
 * A text editor document of one paragraph holding `parts`, normalized. Value
 * parts become value nodes whose unset name or field is `null`; links carry
 * the link key, never a destination.
 */
export const emailInlinePartsToTipTap = (
  parts: EmailDraftInlineParts
): JSONContent => {
  const content = normalizeEmailInlineParts(parts).map(tipTapInline);
  return {
    type: "doc",
    content: [
      content.length > 0
        ? { type: "paragraph", content }
        : { type: "paragraph" },
    ],
  };
};

const partMarks = (marks: JSONContent["marks"]): EmailInlineMarks => {
  const link = emailInlineLinkKey(
    marks?.find((mark) => mark.type === emailInlineLinkMark)?.attrs
  );
  return {
    ...(marks?.some((mark) => mark.type === "bold") && { bold: true }),
    ...(marks?.some((mark) => mark.type === "italic") && { italic: true }),
    ...(link !== undefined && { link }),
  };
};

const inlinePart = (node: JSONContent): EmailDraftInlinePart[] => {
  if (node.type === "text")
    return [{ _tag: "Text", text: node.text ?? "", ...partMarks(node.marks) }];
  if (node.type !== emailInlineValueNode) return [];
  return [
    {
      _tag: "Value",
      ...emailInlineValueReference(node.attrs),
      ...partMarks(node.marks),
    },
  ];
};

/**
 * The normalized parts of a text editor document. The editor holds one
 * paragraph; should a document hold more, a space joins them.
 */
export const tipTapToEmailInlineParts = (
  doc: JSONContent
): EmailDraftInlineParts =>
  normalizeEmailInlineParts(
    (doc.content ?? []).flatMap((block, index) => [
      ...(index > 0 ? [{ _tag: "Text" as const, text: " " }] : []),
      ...(block.content ?? []).flatMap(inlinePart),
    ])
  );
