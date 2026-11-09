import { Node } from "@tiptap/core";

// Markdown spells a button `[[button: Label](URL)]` on its own line. A
// backslash escapes the next character, line breaks included. Like CommonMark
// links, the label may hold balanced brackets and the URL balanced parentheses
// without escapes.
const escapedCharacter = String.raw`\\[\s\S]`;
const labelCharacter = String.raw`${escapedCharacter}|[^\\[\]\n]`;
const hrefCharacter = String.raw`${escapedCharacter}|[^\\()\s]`;
const ctaButtonMarkdownPattern = new RegExp(
  String.raw`^\[\[button:((?:${labelCharacter}|\[(?:${labelCharacter})*\])*)\]` +
    String.raw`\(((?:${hrefCharacter}|\((?:${hrefCharacter})*\))*)\)\]` +
    String.raw`[^\S\n]*(?:\n|$)`
);

const unescapeCtaButtonMarkdown = (text: string) =>
  text.replace(/\\([\s\S])/g, "$1");

/** Drops the unescaped whitespace around a label, as `[[button: Label]` has. */
const trimCtaButtonLabel = (label: string) =>
  label
    .replace(/^[^\S\n]+/, "")
    .replace(/(?<=(?:^|[^\\])(?:\\\\)*)[^\S\n]+$/, "");

/**
 * Escapes what would end the label or be trimmed from it: brackets, line
 * breaks, backslashes, and whitespace at either end.
 */
const escapeCtaButtonLabel = (label: string) =>
  label.replace(/[\\[\]\n]/g, "\\$&").replace(/^[^\S\n]|[^\S\n]$/g, "\\$&");

/** Escapes what would end the URL: parentheses, whitespace, backslashes. */
const escapeCtaButtonHref = (href: string) => href.replace(/[\\()\s]/g, "\\$&");

/**
 * A call-to-action button: a label and a URL rendered as a prominent link.
 * Markdown spells it `[[button: Label](https://example.com)]` on its own line.
 */
export const CampaignCtaButton = Node.create({
  name: "ctaButton",
  group: "block",
  atom: true,
  selectable: true,
  draggable: true,

  addAttributes() {
    return {
      href: { default: null },
      label: { default: "" },
    };
  },

  parseHTML() {
    return [
      {
        tag: "a[data-cta-button]",
        getAttrs: (element) => ({
          href: element.getAttribute("href"),
          label: element.textContent ?? "",
        }),
      },
    ];
  },

  renderHTML({ node }) {
    return [
      "a",
      { "data-cta-button": "", href: node.attrs.href },
      node.attrs.label,
    ];
  },

  markdownTokenizer: {
    name: "ctaButton",
    level: "block",
    start: (source) => source.indexOf("[[button:"),
    tokenize: (source) => {
      const match = ctaButtonMarkdownPattern.exec(source);

      return match
        ? {
            type: "ctaButton",
            raw: match[0],
            label: unescapeCtaButtonMarkdown(
              trimCtaButtonLabel(match[1] ?? "")
            ),
            href: unescapeCtaButtonMarkdown(match[2] ?? ""),
          }
        : undefined;
    },
  },

  parseMarkdown: (token) => ({
    type: "ctaButton",
    attrs: { href: token.href, label: token.label },
  }),

  renderMarkdown: (node) =>
    `[[button: ${escapeCtaButtonLabel(String(node.attrs?.label ?? ""))}](${escapeCtaButtonHref(String(node.attrs?.href ?? ""))})]`,
});
