import { Predicate } from "effect";
import type {
  BlockContent,
  Blockquote,
  Heading,
  InlineCode,
  Link,
  List,
  ListItem,
  Paragraph,
  PhrasingContent,
  RootContent,
  Strong,
  Text,
} from "mdast";
import { toMarkdown } from "mdast-util-to-markdown";

/** A Markdown document as blocks, ready to serialize or to compose. */
export type MarkdownBlocks = ReadonlyArray<RootContent>;

/** The `Content-Type` of a Markdown response (RFC 7763). */
export const markdownContentType = "text/markdown; charset=utf-8";

type Phrasing = PhrasingContent | string;

const toPhrasing = (content: ReadonlyArray<Phrasing>): PhrasingContent[] =>
  content.map((node) => (Predicate.isString(node) ? markdownText(node) : node));

export const markdownText = (value: string): Text => ({ type: "text", value });

export const markdownHeading = (
  depth: Heading["depth"],
  ...content: ReadonlyArray<Phrasing>
): Heading => ({ type: "heading", depth, children: toPhrasing(content) });

export const markdownParagraph = (
  ...content: ReadonlyArray<Phrasing>
): Paragraph => ({ type: "paragraph", children: toPhrasing(content) });

export const markdownStrong = (
  ...content: ReadonlyArray<Phrasing>
): Strong => ({
  type: "strong",
  children: toPhrasing(content),
});

export const markdownInlineCode = (value: string): InlineCode => ({
  type: "inlineCode",
  value,
});

export const markdownLink = (
  url: string,
  ...content: ReadonlyArray<Phrasing>
): Link => ({ type: "link", url, children: toPhrasing(content) });

export const markdownBlockquote = (
  ...children: ReadonlyArray<BlockContent>
): Blockquote => ({ type: "blockquote", children: [...children] });

/** A bulleted list. */
export const markdownList = (items: ReadonlyArray<ListItem>): List => ({
  type: "list",
  ordered: false,
  spread: false,
  children: [...items],
});

/** A numbered list, such as steps to follow in order. */
export const markdownOrderedList = (items: ReadonlyArray<ListItem>): List => ({
  ...markdownList(items),
  ordered: true,
  start: 1,
});

/** A list item of one line. */
export const markdownListItem = (
  ...content: ReadonlyArray<Phrasing>
): ListItem => ({
  type: "listItem",
  spread: false,
  children: [markdownParagraph(...content)],
});

/** A list item of several blocks, such as a line and a nested list. */
export const markdownBlockListItem = (
  ...children: ReadonlyArray<BlockContent>
): ListItem => ({ type: "listItem", spread: false, children: [...children] });

/**
 * Fills a translated template as `@doist/react-interpolate` fills it on the
 * HTML page: `{name}` takes its value as literal text, and `<name>…</name>`
 * wraps its filled content. A name without a value stays as written.
 */
export const markdownInterpolate = (
  template: string,
  mapping: Readonly<
    Record<string, string | ((content: PhrasingContent[]) => PhrasingContent)>
  >
): PhrasingContent[] =>
  [...template.matchAll(/<(\w+)>(.*?)<\/\1>|\{(\w+)\}|[^<{]+|[<{]/gs)].map(
    ([match, tag, tagContent = "", placeholder]) => {
      const value = mapping[tag ?? placeholder ?? ""];
      if (Predicate.isString(value)) return markdownText(value);
      if (Predicate.isFunction(value)) {
        return value(markdownInterpolate(tagContent, mapping));
      }
      return markdownText(match);
    }
  );

/**
 * Serializes Markdown blocks to text. Text values are escaped, so copy and
 * data never turn into Markdown syntax.
 */
export const serializeMarkdown = (blocks: MarkdownBlocks) =>
  toMarkdown(
    { type: "root", children: [...blocks] },
    { bullet: "-", emphasis: "_", rule: "-" }
  );
