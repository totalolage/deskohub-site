import { mapSupportedLocales } from "@deskohub/i18n/locale-registry";
import { testEmailAddress } from "@deskohub/test-email";
import {
  type EmailCustomerField,
  type EmailCustomerSelection,
  EmailDocument,
  type EmailInlinePart,
  type EmailValueSnapshot,
} from "@deskohub/workspace-admin-api";
import { Schema } from "effect";
import type { CampaignBodyNode } from "@/features/email-campaigns/body/campaign-body-document";
import type { Locale } from "@/features/i18n";

type InlinePart = typeof EmailInlinePart.Encoded;
type Marks = Pick<
  Extract<InlinePart, { readonly _tag: "Text" }>,
  "bold" | "italic" | "link"
>;

const text = (value: string, marks: Marks = {}): InlinePart => ({
  _tag: "Text",
  text: value,
  ...marks,
});
const value = (name: string, marks: Marks = {}): InlinePart => ({
  _tag: "Value",
  name,
  ...marks,
});

/** An image from the test Cloudinary account `cloud`. */
export const cloudinaryImage =
  "https://res.cloudinary.com/cloud/image/upload/v1/email-campaigns/preview/autumn.jpg";

type Words = {
  readonly subject: string;
  readonly preheader: string;
  readonly title: string;
  readonly hello: string;
  readonly events: string;
  readonly visits: string;
  readonly member: string;
  readonly steps: readonly [string, string, string];
  readonly alt: string;
  readonly contactName: string;
  readonly contactEmail: string;
  readonly groupName: string;
  readonly groupPoints: string;
  readonly offer: string;
  readonly button: string;
};

/** Each language's words for {@link emailDocumentFixture}. */
export const emailFixtureWords = {
  "en-US": {
    subject: "Autumn news for ",
    preheader: "New desks and longer hours",
    title: "Autumn news",
    hello: "Hello ",
    events: "our events",
    visits: "Visits: ",
    member: " Member: ",
    steps: ["Pick a date", "Pay online", "Bring a friend"],
    alt: "The new meeting room",
    contactName: "Name",
    contactEmail: "Email",
    groupName: "Group",
    groupPoints: "Discount points",
    offer: "Book with the code",
    button: "Book now",
  },
  "cs-CZ": {
    subject: "Podzimní novinky pro ",
    preheader: "Nové stoly a delší otevírací doba",
    title: "Podzimní novinky",
    hello: "Ahoj ",
    events: "naše akce",
    visits: "Návštěvy: ",
    member: " Člen: ",
    steps: ["Vyber termín", "Zaplať online", "Přiveď kamaráda"],
    alt: "Nová zasedačka",
    contactName: "Jméno",
    contactEmail: "E-mail",
    groupName: "Skupina",
    groupPoints: "Slevové body",
    offer: "Rezervovat s kódem",
    button: "Rezervovat",
  },
  "de-DE": {
    subject: "Herbstneuigkeiten für ",
    preheader: "Neue Schreibtische und längere Öffnungszeiten",
    title: "Herbstneuigkeiten",
    hello: "Hallo ",
    events: "unsere Veranstaltungen",
    visits: "Besuche: ",
    member: " Mitglied: ",
    steps: ["Wähle einen Termin", "Bezahle online", "Bring jemanden mit"],
    alt: "Der neue Besprechungsraum",
    contactName: "Name",
    contactEmail: "E-Mail",
    groupName: "Gruppe",
    groupPoints: "Rabattpunkte",
    offer: "Mit dem Code buchen",
    button: "Jetzt buchen",
  },
  "uk-UA": {
    subject: "Осінні новини для ",
    preheader: "Нові столи й довші години роботи",
    title: "Осінні новини",
    hello: "Вітаємо, ",
    events: "наші події",
    visits: "Відвідування: ",
    member: " Учасник: ",
    steps: ["Оберіть дату", "Оплатіть онлайн", "Приведіть друга"],
    alt: "Нова переговорна кімната",
    contactName: "Ім’я",
    contactEmail: "Електронна пошта",
    groupName: "Група",
    groupPoints: "Знижкові бали",
    offer: "Забронювати з кодом",
    button: "Забронювати",
  },
  "sk-SK": {
    subject: "Jesenné novinky pre ",
    preheader: "Nové stoly a predĺžené otváracie hodiny",
    title: "Jesenné novinky",
    hello: "Ahoj ",
    events: "naše podujatia",
    visits: "Návštevy: ",
    member: " Člen: ",
    steps: ["Vyber termín", "Zaplať online", "Priveď kamaráta"],
    alt: "Nová zasadačka",
    contactName: "Meno",
    contactEmail: "E-mail",
    groupName: "Skupina",
    groupPoints: "Zľavové body",
    offer: "Rezervovať s kódom",
    button: "Rezervovať",
  },
  "vi-VN": {
    subject: "Tin mùa thu cho ",
    preheader: "Bàn mới và giờ mở cửa dài hơn",
    title: "Tin mùa thu",
    hello: "Xin chào ",
    events: "các sự kiện của chúng tôi",
    visits: "Lượt ghé thăm: ",
    member: " Thành viên: ",
    steps: ["Chọn thời gian", "Thanh toán trực tuyến", "Dẫn theo bạn bè"],
    alt: "Phòng họp mới",
    contactName: "Họ tên",
    contactEmail: "Email",
    groupName: "Nhóm",
    groupPoints: "Điểm giảm giá",
    offer: "Đặt chỗ với mã",
    button: "Đặt ngay",
  },
  "hi-IN": {
    subject: "शरद ऋतु की खबरें, ",
    preheader: "नई डेस्क और खुलने का लंबा समय",
    title: "शरद ऋतु की खबरें",
    hello: "नमस्ते ",
    events: "हमारे कार्यक्रम",
    visits: "विज़िट: ",
    member: " सदस्य: ",
    steps: ["समय चुनें", "ऑनलाइन भुगतान करें", "किसी दोस्त को लाएँ"],
    alt: "नया मीटिंग रूम",
    contactName: "नाम",
    contactEmail: "ईमेल",
    groupName: "समूह",
    groupPoints: "छूट अंक",
    offer: "कोड के साथ बुक करें",
    button: "बुक करें",
  },
} as const satisfies Record<Locale, Words>;

const translation = (words: Words) => ({
  subject: [text(words.subject), value("first_name")],
  preheader: [text(words.preheader)],
  texts: {
    title: [text(words.title)],
    intro: [
      text(words.hello),
      value("first_name", { bold: true }),
      text(", "),
      text(words.events, { italic: true, link: "events" }),
      text("."),
    ],
    stats: [
      text(words.visits),
      value("visits"),
      text(words.member),
      value("member"),
    ],
    step_1: [text(words.steps[0])],
    step_2: [text(words.steps[1])],
    step_2a: [text(words.steps[2])],
    image_alt: [text(words.alt)],
    contact_name: [text(words.contactName)],
    contact_email: [text(words.contactEmail)],
    group_name: [text(words.groupName)],
    group_points: [text(words.groupPoints)],
    offer_label: [text(words.offer)],
    button_label: [text(words.button)],
  },
});

const scalar = (type: "string" | "number" | "boolean"): EmailCustomerField => ({
  kind: "scalar",
  type,
  nullable: false,
  optional: false,
});
const record = (
  fields: Readonly<Record<string, EmailCustomerField>>
): EmailCustomerField => ({
  kind: "record",
  fields,
  nullable: false,
  optional: false,
});
const list = (element: EmailCustomerField): EmailCustomerField => ({
  kind: "list",
  element,
  nullable: false,
  optional: false,
});
const customer = (
  path: readonly string[],
  fields?: EmailCustomerSelection["fields"]
): typeof EmailCustomerSelection.Encoded =>
  fields ? { kind: "customer", path, fields } : { kind: "customer", path };

/**
 * A bilingual email using every component, inline values with marks, a
 * record, a sorted and limited record list, a scalar list and an offer.
 * Value shapes are frozen as publication froze them; `tags`, `visits` and
 * `member` name paths today's customer catalogue doesn't have, as after
 * catalogue drift.
 */
export const emailDocumentFixture: EmailDocument = Schema.decodeUnknownSync(
  EmailDocument
)({
  purpose: "marketing",
  templateKey: "workspace",
  structure: [
    { _tag: "Heading", id: "title", textKey: "title", level: 1 },
    {
      _tag: "Paragraph",
      id: "intro",
      textKey: "intro",
      links: { events: "https://deskohub.cz/akce" },
    },
    { _tag: "Paragraph", id: "stats", textKey: "stats" },
    {
      _tag: "TextList",
      id: "steps",
      ordered: true,
      start: 2,
      items: [
        { textKey: "step_1" },
        {
          textKey: "step_2",
          list: { ordered: false, items: [{ textKey: "step_2a" }] },
        },
      ],
    },
    {
      _tag: "Image",
      id: "image",
      src: cloudinaryImage,
      altKey: "image_alt",
      href: "https://deskohub.cz/zasedacka",
      align: "left",
      width: 240,
    },
    {
      _tag: "Record",
      id: "contact",
      value: "contact",
      fields: [
        { field: ["displayName"], labelKey: "contact_name" },
        { field: ["email"], labelKey: "contact_email" },
      ],
    },
    {
      _tag: "List",
      id: "groups",
      value: "groups",
      fields: [
        { field: ["name"], labelKey: "group_name" },
        { field: ["basisPoints"], labelKey: "group_points" },
      ],
      sort: { path: ["basisPoints"], direction: "desc" },
      limit: 2,
    },
    { _tag: "List", id: "tags", value: "tags" },
    {
      _tag: "Offer",
      id: "offer",
      value: "offer",
      labelKey: "offer_label",
      href: "https://deskohub.cz/rezervace",
    },
    { _tag: "Divider", id: "divider" },
    { _tag: "Spacer", id: "spacer" },
    {
      _tag: "Button",
      id: "button",
      labelKey: "button_label",
      href: "https://deskohub.cz/rezervace",
    },
  ],
  translations: mapSupportedLocales((locale) =>
    translation(emailFixtureWords[locale])
  ),
  values: [
    {
      name: "first_name",
      source: customer(["profile", "customer", "displayName"]),
      customerShape: scalar("string"),
    },
    {
      name: "visits",
      source: customer(["profile", "visits"]),
      customerShape: scalar("number"),
    },
    {
      name: "member",
      source: customer(["profile", "member"]),
      customerShape: scalar("boolean"),
    },
    {
      name: "contact",
      source: customer(["profile", "customer"], [["displayName"], ["email"]]),
      customerShape: record({
        displayName: scalar("string"),
        email: { ...scalar("string"), nullable: true, optional: true },
      }),
    },
    {
      name: "groups",
      source: customer(
        ["profile", "discountGroups"],
        [["name"], ["basisPoints"]]
      ),
      customerShape: list(
        record({ name: scalar("string"), basisPoints: scalar("number") })
      ),
    },
    {
      name: "tags",
      source: customer(["profile", "tags"]),
      customerShape: list(scalar("string")),
    },
    {
      name: "offer",
      source: {
        kind: "discount",
        discountId: "11111111-1111-4111-8111-111111111111",
        validDays: 14,
      },
    },
  ],
});

/** The expiry of the fixture's discount code. */
export const fixtureOfferExpiry = "2026-11-18T10:00:00.000Z";

/** Snapshots of every value {@link emailDocumentFixture} shows. */
export const emailFixtureValues = {
  first_name: { _tag: "Resolved", value: "Jana" },
  visits: { _tag: "Resolved", value: 1234.5 },
  member: { _tag: "Resolved", value: true },
  contact: {
    _tag: "Resolved",
    value: { displayName: "Jana Testová", email: testEmailAddress("jana") },
  },
  groups: {
    _tag: "Resolved",
    value: [
      { name: "Students", basisPoints: 1500 },
      { name: "Members", basisPoints: 2500 },
      { name: "Friends", basisPoints: 500 },
    ],
  },
  tags: { _tag: "Resolved", value: ["quiet corner", "coffee"] },
  offer: {
    _tag: "Resolved",
    value: { code: "SAMPLE CODE", expiresAt: fixtureOfferExpiry },
  },
} satisfies Record<string, EmailValueSnapshot>;

const legacyText = (value: string, marks?: CampaignBodyNode["marks"]) =>
  marks ? { type: "text", text: value, marks } : { type: "text", text: value };
const legacyParagraph = (...content: CampaignBodyNode[]) => ({
  type: "paragraph",
  content,
});
const legacyItem = (...content: CampaignBodyNode[]) => ({
  type: "listItem",
  content,
});
const widthlessImage =
  "https://res.cloudinary.com/cloud/image/upload/v1/email-campaigns/preview/wide.jpg";

/** A legacy campaign body using every block, mark and image layout. */
export const legacyRichTextBody: CampaignBodyNode = {
  type: "doc",
  content: [
    { type: "heading", attrs: { level: 1 }, content: [legacyText("Autumn")] },
    { type: "heading", attrs: { level: 2 }, content: [legacyText("Coming")] },
    { type: "heading", attrs: { level: 3 }, content: [legacyText("Details")] },
    legacyParagraph(
      legacyText("Hello "),
      legacyText("Jana", [{ type: "bold" }]),
      legacyText(", read "),
      legacyText("the programme", [
        { type: "link", attrs: { href: "https://deskohub.cz/program" } },
        { type: "italic" },
      ]),
      legacyText(" and "),
      legacyText("mail us", [
        {
          type: "link",
          attrs: { href: `mailto:${testEmailAddress("hello")}` },
        },
      ]),
      legacyText(".")
    ),
    { type: "paragraph" },
    {
      type: "bulletList",
      content: [
        legacyItem(legacyParagraph(legacyText("Desks")), {
          type: "orderedList",
          attrs: { start: 3 },
          content: [legacyItem(legacyParagraph(legacyText("Third")))],
        }),
        legacyItem(legacyParagraph(legacyText("Hours", [{ type: "italic" }]))),
      ],
    },
    {
      type: "orderedList",
      content: [legacyItem(legacyParagraph(legacyText("First")))],
    },
    {
      type: "ctaButton",
      attrs: { label: "Book now", href: "https://deskohub.cz/rezervace" },
    },
    { type: "horizontalRule" },
    {
      type: "image",
      attrs: { src: cloudinaryImage, alt: "Room", align: "right", width: 240 },
    },
    { type: "image", attrs: { src: widthlessImage, alt: "Wide" } },
    {
      type: "image",
      attrs: { src: cloudinaryImage, alt: "Huge", align: "left", width: 4000 },
    },
  ],
};

/** The same body as {@link legacyRichTextBody}, as a reusable email. */
export const richTextParityDocument = Schema.decodeUnknownSync(EmailDocument)({
  purpose: "marketing",
  templateKey: "workspace",
  structure: [
    { _tag: "Heading", id: "h1", textKey: "h1", level: 1 },
    { _tag: "Heading", id: "h2", textKey: "h2", level: 2 },
    { _tag: "Heading", id: "h3", textKey: "h3", level: 3 },
    {
      _tag: "Paragraph",
      id: "intro",
      textKey: "intro",
      links: {
        programme: "https://deskohub.cz/program",
        mail: `mailto:${testEmailAddress("hello")}`,
      },
    },
    { _tag: "Spacer", id: "spacer" },
    {
      _tag: "TextList",
      id: "bullets",
      ordered: false,
      items: [
        {
          textKey: "desks",
          list: { ordered: true, start: 3, items: [{ textKey: "third" }] },
        },
        { textKey: "hours" },
      ],
    },
    {
      _tag: "TextList",
      id: "steps",
      ordered: true,
      items: [{ textKey: "first" }],
    },
    {
      _tag: "Button",
      id: "button",
      labelKey: "button",
      href: "https://deskohub.cz/rezervace",
    },
    { _tag: "Divider", id: "divider" },
    {
      _tag: "Image",
      id: "room",
      src: cloudinaryImage,
      altKey: "room",
      align: "right",
      width: 240,
    },
    { _tag: "Image", id: "wide", src: widthlessImage, altKey: "wide" },
    {
      _tag: "Image",
      id: "huge",
      src: cloudinaryImage,
      altKey: "huge",
      align: "left",
      width: 4000,
    },
  ],
  translations: {
    "en-US": {
      subject: [text("Subject")],
      preheader: [text("Preheader")],
      texts: {
        h1: [text("Autumn")],
        h2: [text("Coming")],
        h3: [text("Details")],
        intro: [
          text("Hello "),
          { _tag: "Value", name: "first_name", bold: true },
          text(", read "),
          text("the programme", { italic: true, link: "programme" }),
          text(" and "),
          text("mail us", { link: "mail" }),
          text("."),
        ],
        desks: [text("Desks")],
        third: [text("Third")],
        hours: [text("Hours", { italic: true })],
        first: [text("First")],
        button: [text("Book now")],
        room: [text("Room")],
        wide: [text("Wide")],
        huge: [text("Huge")],
      },
    },
  },
  values: [
    {
      name: "first_name",
      source: {
        kind: "customer",
        path: ["profile", "customer", "displayName"],
      },
      customerShape: {
        kind: "scalar",
        type: "string",
        nullable: false,
        optional: false,
      },
    },
  ],
});
