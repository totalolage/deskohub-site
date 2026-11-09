import type { EmailDraftFormValues } from "./email-draft-form";
import type { EmailEditorDiscount } from "./email-values-section";

/** A synthetic discount the fixtures' discount value issues codes from. */
export const fixtureDiscount: EmailEditorDiscount = {
  id: "8f14e45f-ceea-4e7a-9b2f-1a2b3c4d5e6f",
  label: "Synthetic welcome discount",
};

/** The Cloudinary account the fixtures' uploads go to. */
export const fixtureImageCloudName = "cloud";

/**
 * A draft with every kind of problem the editor must show: a reference to a
 * value that no longer exists, an incomplete Czech translation, a used and an
 * unused definition. Synthetic content only.
 */
export const fixtureDraft: EmailDraftFormValues = {
  purpose: "marketing",
  templateKey: "workspace",
  values: [
    {
      name: "customer_name",
      source: {
        kind: "customer",
        path: ["profile", "customer", "displayName"],
      },
      fallback: { "en-US": "there", "cs-CZ": "zákazníku" },
    },
    {
      name: "welcome_offer",
      source: {
        kind: "discount",
        discountId: fixtureDiscount.id,
        validDays: 14,
        maxUses: 1,
        maxUsesPerCustomer: 1,
      },
    },
    {
      name: "unused_count",
      source: {
        kind: "customer",
        path: ["activity", "stats", "reservationCount"],
      },
    },
  ],
  structure: [
    { _tag: "Heading", id: "heading-1", textKey: "heading-1-text", level: 1 },
    {
      _tag: "Paragraph",
      id: "paragraph-1",
      textKey: "paragraph-1-text",
      links: { "link-1": "https://workspace.deskohub.test/coworking" },
    },
    {
      _tag: "Offer",
      id: "offer-1",
      value: "welcome_offer",
      labelKey: "offer-1-label",
      href: "https://workspace.deskohub.test/offer",
    },
    { _tag: "Paragraph", id: "paragraph-2", textKey: "paragraph-2-text" },
  ],
  translations: {
    "en-US": {
      subject: [
        { _tag: "Text", text: "Hello " },
        { _tag: "Value", name: "customer_name" },
      ],
      preheader: [{ _tag: "Text", text: "A synthetic update" }],
      texts: {
        "heading-1-text": [{ _tag: "Text", text: "Welcome back" }],
        "paragraph-1-text": [
          { _tag: "Text", text: "Hi " },
          { _tag: "Value", name: "customer_name" },
          { _tag: "Text", text: ", see " },
          { _tag: "Text", text: "our spaces", bold: true, link: "link-1" },
        ],
        "offer-1-label": [{ _tag: "Text", text: "Claim the offer" }],
        "paragraph-2-text": [
          { _tag: "Text", text: "Your last visit: " },
          { _tag: "Value", name: "last_visit" },
        ],
      },
    },
    "cs-CZ": {
      subject: [
        { _tag: "Text", text: "Dobrý den, " },
        { _tag: "Value", name: "customer_name" },
      ],
      texts: {
        "heading-1-text": [{ _tag: "Text", text: "Vítejte zpět" }],
      },
    },
  },
};
