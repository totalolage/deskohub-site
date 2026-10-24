import { Schema } from "effect";
import type { Locale } from "@/features/i18n";
import {
  type CampaignBodyDocument,
  CampaignBodyNode,
  campaignBodyFormatVersion,
} from "./campaign-body-document";
import { campaignBodySchema } from "./campaign-body-extensions";

const text = (value: string, marks?: CampaignBodyNode["marks"]) =>
  marks ? { type: "text", text: value, marks } : { type: "text", text: value };

const paragraph = (...content: CampaignBodyNode[]): CampaignBodyNode => ({
  type: "paragraph",
  content,
});

const heading = (level: 1 | 2 | 3, value: string): CampaignBodyNode => ({
  type: "heading",
  attrs: { level },
  content: [text(value)],
});

const list = (
  type: "bulletList" | "orderedList",
  ...items: string[]
): CampaignBodyNode => ({
  type,
  content: items.map((item) => ({
    type: "listItem",
    content: [paragraph(text(item))],
  })),
});

const link = (href: string) => [{ type: "link", attrs: { href } }];

/**
 * A body using every block and mark the editor offers, in the form the
 * editor holds it (its schema fills in default attributes). It includes text
 * Markdown would re-read as formatting, a leading `# ` and an empty paragraph,
 * so a lossy round trip changes it.
 */
const richDocument = (words: {
  readonly heading: string;
  readonly section: string;
  readonly detail: string;
  readonly bullets: readonly [string, string];
  readonly steps: readonly [string, string];
  readonly link: string;
  readonly button: string;
  readonly typedHash: string;
}): CampaignBodyDocument => ({
  formatVersion: campaignBodyFormatVersion,
  doc: Schema.decodeUnknownSync(CampaignBodyNode)(
    campaignBodySchema
      .nodeFromJSON({
        type: "doc",
        content: [
          heading(1, words.heading),
          heading(2, words.section),
          heading(3, words.detail),
          paragraph(
            text(`${words.typedHash} `),
            text("**", [{ type: "bold" }]),
            text(" "),
            text(words.link, [
              ...link("https://deskohub.cz/akce"),
              { type: "italic" },
            ])
          ),
          paragraph(),
          list("bulletList", ...words.bullets),
          { ...list("orderedList", ...words.steps), attrs: { start: 3 } },
          {
            type: "ctaButton",
            attrs: {
              label: words.button,
              href: "https://deskohub.cz/rezervace",
            },
          },
          { type: "horizontalRule" },
          {
            type: "image",
            attrs: {
              src: "https://res.cloudinary.com/cloud/image/upload/v1/campaigns/autumn.jpg",
              alt: words.heading,
            },
          },
        ],
      })
      .toJSON()
  ),
});

/** A rich body per locale, each in its own language. */
export const richCampaignBodies = {
  "cs-CZ": richDocument({
    heading: "Podzimní novinky",
    section: "Co chystáme",
    detail: "Podrobnosti",
    bullets: ["Nové stoly", "Delší otevírací doba"],
    steps: ["Vyberte termín", "Zaplaťte online"],
    link: "více na webu",
    button: "Rezervovat",
    typedHash: "# není nadpis",
  }),
  "en-US": richDocument({
    heading: "Autumn news",
    section: "What's coming",
    detail: "Details",
    bullets: ["New desks", "Longer opening hours"],
    steps: ["Pick a date", "Pay online"],
    link: "more on the website",
    button: "Book now",
    typedHash: "# not a heading",
  }),
} satisfies Record<Locale, CampaignBodyDocument>;
