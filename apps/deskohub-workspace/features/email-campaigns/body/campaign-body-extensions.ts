import { type Extensions, getSchema } from "@tiptap/core";
import Bold from "@tiptap/extension-bold";
import Document from "@tiptap/extension-document";
import Heading from "@tiptap/extension-heading";
import HorizontalRule from "@tiptap/extension-horizontal-rule";
import Italic from "@tiptap/extension-italic";
import Link from "@tiptap/extension-link";
import { BulletList, ListItem, OrderedList } from "@tiptap/extension-list";
import Paragraph from "@tiptap/extension-paragraph";
import Text from "@tiptap/extension-text";
import { CampaignCtaButton } from "./campaign-cta-button";
import { CampaignImage } from "./campaign-image";

const campaignHeadingLevels = [1, 2, 3] as const;

/**
 * The campaign body content set. The editor, renderer, validator, and Markdown
 * parser all build on this list, so they agree on one document schema. It
 * must stay free of DOM and React dependencies; the editor adds its own
 * editing-only extensions (history, placeholder) on top.
 */
export const campaignBodyExtensions: Extensions = [
  Document,
  Paragraph,
  Text,
  Heading.configure({ levels: [...campaignHeadingLevels] }),
  Bold,
  Italic,
  Link.configure({
    autolink: false,
    defaultProtocol: "https",
    HTMLAttributes: { rel: null, target: null, class: null },
    openOnClick: false,
  }),
  BulletList,
  OrderedList,
  ListItem,
  CampaignImage.configure({ allowBase64: false, inline: false }),
  HorizontalRule,
  CampaignCtaButton,
];

export const campaignBodySchema = getSchema(campaignBodyExtensions);
