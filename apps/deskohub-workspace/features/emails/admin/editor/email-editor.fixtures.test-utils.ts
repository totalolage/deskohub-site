import type { Locale } from "@/features/i18n";
import type {
  EmailDraftFormValues,
  EmailDraftTranslation,
} from "./email-draft-form";
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
 * unused definition. Every Workspace language has a translation, so every
 * editor tab has texts to show. Synthetic content only.
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
    "de-DE": {
      subject: [
        { _tag: "Text", text: "Hallo " },
        { _tag: "Value", name: "customer_name" },
      ],
      preheader: [{ _tag: "Text", text: "Eine synthetische Neuigkeit" }],
      texts: {
        "heading-1-text": [{ _tag: "Text", text: "Willkommen zurück" }],
        "paragraph-1-text": [
          { _tag: "Text", text: "Hallo " },
          { _tag: "Value", name: "customer_name" },
          { _tag: "Text", text: ", hier sind " },
          { _tag: "Text", text: "unsere Räume", bold: true, link: "link-1" },
        ],
        "offer-1-label": [{ _tag: "Text", text: "Sichere dir das Angebot" }],
        "paragraph-2-text": [{ _tag: "Text", text: "Bis bald" }],
      },
    },
    "uk-UA": {
      subject: [
        { _tag: "Text", text: "Вітаємо, " },
        { _tag: "Value", name: "customer_name" },
      ],
      preheader: [{ _tag: "Text", text: "Синтетичне оновлення" }],
      texts: {
        "heading-1-text": [{ _tag: "Text", text: "З поверненням" }],
        "paragraph-1-text": [
          { _tag: "Text", text: "Вітаємо, " },
          { _tag: "Value", name: "customer_name" },
          { _tag: "Text", text: ", перегляньте " },
          { _tag: "Text", text: "наші простори", bold: true, link: "link-1" },
        ],
        "offer-1-label": [{ _tag: "Text", text: "Отримайте пропозицію" }],
        "paragraph-2-text": [{ _tag: "Text", text: "До зустрічі" }],
      },
    },
    "sk-SK": {
      subject: [
        { _tag: "Text", text: "Ahoj " },
        { _tag: "Value", name: "customer_name" },
      ],
      preheader: [{ _tag: "Text", text: "Syntetická novinka" }],
      texts: {
        "heading-1-text": [{ _tag: "Text", text: "Vitaj späť" }],
        "paragraph-1-text": [
          { _tag: "Text", text: "Ahoj " },
          { _tag: "Value", name: "customer_name" },
          { _tag: "Text", text: ", pozri si " },
          { _tag: "Text", text: "naše priestory", bold: true, link: "link-1" },
        ],
        "offer-1-label": [{ _tag: "Text", text: "Získaj ponuku" }],
        "paragraph-2-text": [{ _tag: "Text", text: "Dovidenia" }],
      },
    },
    "vi-VN": {
      subject: [
        { _tag: "Text", text: "Xin chào " },
        { _tag: "Value", name: "customer_name" },
      ],
      preheader: [{ _tag: "Text", text: "Một tin tức tổng hợp" }],
      texts: {
        "heading-1-text": [{ _tag: "Text", text: "Chào mừng bạn trở lại" }],
        "paragraph-1-text": [
          { _tag: "Text", text: "Xin chào " },
          { _tag: "Value", name: "customer_name" },
          { _tag: "Text", text: ", hãy xem " },
          {
            _tag: "Text",
            text: "không gian của chúng tôi",
            bold: true,
            link: "link-1",
          },
        ],
        "offer-1-label": [{ _tag: "Text", text: "Nhận ưu đãi" }],
        "paragraph-2-text": [{ _tag: "Text", text: "Hẹn gặp lại" }],
      },
    },
    "hi-IN": {
      subject: [
        { _tag: "Text", text: "नमस्ते " },
        { _tag: "Value", name: "customer_name" },
      ],
      preheader: [{ _tag: "Text", text: "एक कृत्रिम खबर" }],
      texts: {
        "heading-1-text": [{ _tag: "Text", text: "वापसी पर स्वागत है" }],
        "paragraph-1-text": [
          { _tag: "Text", text: "नमस्ते " },
          { _tag: "Value", name: "customer_name" },
          { _tag: "Text", text: ", देखिए " },
          { _tag: "Text", text: "हमारी जगहें", bold: true, link: "link-1" },
        ],
        "offer-1-label": [{ _tag: "Text", text: "ऑफ़र पाएँ" }],
        "paragraph-2-text": [{ _tag: "Text", text: "फिर मिलेंगे" }],
      },
    },
  } satisfies Record<Locale, EmailDraftTranslation>,
};
