import type { JSONContent, MarkdownToken } from "@tiptap/core";
import Image from "@tiptap/extension-image";
import { Predicate } from "effect";
import type {
  CampaignBodyAttributeValue,
  CampaignBodyNode,
} from "./campaign-body-document";

/** The width of the template's body column, in CSS pixels. */
export const campaignBodyColumnWidth = 534;

/**
 * The widest picture a body image is stored at: twice the body column, sharp
 * on high-density screens and no heavier than needed, since every recipient
 * downloads it.
 */
export const campaignImageMaxWidth = 2 * campaignBodyColumnWidth;

/** Where an image sits across the body column. */
const campaignImageAlignments = ["left", "center", "right"] as const;
export type CampaignImageAlignment = (typeof campaignImageAlignments)[number];

/**
 * A new image is centered. So is one saved before images had an alignment;
 * without a width it still fills the column, so nothing about it changes.
 */
export const defaultCampaignImageAlignment: CampaignImageAlignment = "center";

export const isCampaignImageAlignment = (
  value: CampaignBodyAttributeValue | undefined
): value is CampaignImageAlignment =>
  campaignImageAlignments.some((alignment) => alignment === value);

/**
 * No picture is wider: it's the most JPEG and GIF can store. The bound also
 * keeps every width a plain run of digits in Markdown, never `1e+21`.
 */
const widestPicture = 65_535;

/** An image's width is its natural width in whole CSS pixels. */
export const isCampaignImageWidth = (
  value: CampaignBodyAttributeValue | undefined
): value is number =>
  Number.isInteger(value) &&
  Number(value) > 0 &&
  Number(value) <= widestPicture;

/** The source of every image in the body, in document order. */
export const campaignBodyImageSources = (
  node: CampaignBodyNode
): ReadonlyArray<string> => [
  ...(node.type === "image" && Predicate.isString(node.attrs?.src)
    ? [node.attrs.src]
    : []),
  ...(node.content ?? []).flatMap(campaignBodyImageSources),
];

// Markdown spells a laid-out image with a Pandoc-style attribute list on its
// own line: `![Alt](https://…){align=left width=240}`. A plain image line
// stays a centered image without a width. Alt text and titles may break
// lines but not paragraphs; the inline lexer then checks the image itself.
const attributedImagePattern =
  /^(!\[(?:[^\n]|\n(?!\n))*?\]\((?:[^\n]|\n(?!\n))*?\))\{([^{}\n]*)\}[^\S\n]*(?:\n|$)/;
const imageAttributePattern = /^(align|width)=(\S+)$/;

type ImageLayout = {
  readonly align?: string;
  readonly width?: number | string;
};

/**
 * Reads `align=… width=…`. Values stay as written, so the content rules can
 * name a bad one; an unknown or repeated key means it isn't an attribute list.
 */
const parseImageLayout = (list: string): ImageLayout | undefined => {
  const layout: Record<string, string | number> = {};
  for (const entry of list.trim().split(/\s+/)) {
    const [, key, value] = imageAttributePattern.exec(entry) ?? [];
    if (key === undefined || value === undefined || key in layout) {
      return undefined;
    }
    layout[key] =
      key === "width" && /^\d+$/.test(value) ? Number(value) : value;
  }
  return layout;
};

const imageLayoutMarkdown = (attrs: JSONContent["attrs"]) => {
  const align = attrs?.align ?? defaultCampaignImageAlignment;
  const width = attrs?.width ?? null;
  const entries = [
    ...(align === defaultCampaignImageAlignment ? [] : [`align=${align}`]),
    ...(width === null ? [] : [`width=${width}`]),
  ];
  return entries.length > 0 ? `{${entries.join(" ")}}` : "";
};

/**
 * A block image from the Deskohub Cloudinary account, with its alignment and
 * natural width. The renderer shows it at that width, capped to the body
 * column, so alignment has room to show; an image without a width fills the
 * column.
 */
export const CampaignImage = Image.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      align: {
        default: defaultCampaignImageAlignment,
        parseHTML: (element) => element.getAttribute("data-align"),
        // An image saved with a null alignment is centered, as in the email.
        renderHTML: (attributes) => ({
          "data-align": isCampaignImageAlignment(attributes.align)
            ? attributes.align
            : defaultCampaignImageAlignment,
        }),
      },
    };
  },

  markdownTokenizer: {
    // Named after the node, so the image's own parser reads the token.
    name: "image",
    level: "block",
    start: (source) => source.search(/^!\[(?:[^\n]|\n(?!\n))*?\)\{/m),
    tokenize: (source, _tokens, lexer) => {
      const [raw, image, list] = attributedImagePattern.exec(source) ?? [];
      if (raw === undefined || image === undefined || list === undefined) {
        return undefined;
      }
      const layout = parseImageLayout(list);
      const [token, ...rest] = lexer.inlineTokens(image);
      if (!layout || token?.type !== "image" || rest.length > 0) {
        return undefined;
      }
      return { ...token, type: "image", raw, ...layout } as MarkdownToken;
    },
  },

  parseMarkdown: (token, helpers) =>
    helpers.createNode("image", {
      src: token.href,
      title: token.title,
      alt: token.text,
      ...(token.align !== undefined && { align: token.align }),
      ...(token.width !== undefined && { width: token.width }),
    }),

  renderMarkdown(node, helpers, context) {
    return `${this.parent?.(node, helpers, context) ?? ""}${imageLayoutMarkdown(node.attrs)}`;
  },
});
