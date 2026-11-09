import type { Nodes } from "mdast";
import { fromMarkdown } from "mdast-util-from-markdown";
import { toString as nodeText } from "mdast-util-to-string";

const blockContainers = new Set(["root", "list", "listItem", "blockquote"]);

const blockLines = (node: Nodes): string[] =>
  "children" in node && blockContainers.has(node.type)
    ? node.children.flatMap(blockLines)
    : [nodeText(node)];

/**
 * The text a reader sees in Markdown, one line per block, with Markdown
 * syntax and escapes removed and whitespace collapsed.
 */
export const markdownPlainText = (markdown: string): string =>
  blockLines(fromMarkdown(markdown))
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .join("\n");

/** Each link target in Markdown, in document order. */
export const markdownLinkUrls = (markdown: string): string[] => {
  const urls: string[] = [];
  const collect = (node: Nodes) => {
    if (node.type === "link") urls.push(node.url);
    if ("children" in node) node.children.forEach(collect);
  };
  collect(fromMarkdown(markdown));
  return urls;
};

/**
 * A message's text with its interpolation tags removed, such as the
 * `<pricing>` around a link, as `markdownPlainText` reads the rendered link.
 */
export const messagePlainText = (message: string): string =>
  message.replace(/<\/?\w+>/g, "");
