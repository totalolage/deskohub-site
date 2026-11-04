import { describe, expect, test } from "bun:test";
import { Result, Schema } from "effect";
import {
  type EmailDocumentProblem,
  emailDocumentForPublication,
  emailDraftProblems,
  englishEmailDocumentProblem,
  referencedEmailValueNames,
  requiredEmailValueNames,
} from "./email-publication";
import { EmailDocument, EmailDraft } from "./emails";

const locales = ["cs-CZ", "en-US"];
const publish = Schema.decodeUnknownResult(
  emailDocumentForPublication(locales)
);
const draft = Schema.decodeUnknownSync(EmailDraft);
const tags = (problems: readonly EmailDocumentProblem[]) =>
  problems.map((problem) => problem._tag);

const discountId = "01900000-0000-7000-8000-000000000001";
const texts = (word: string) => ({
  heading: [{ _tag: "Text", text: `${word} heading` }],
  intro: [
    { _tag: "Text", text: `${word} `, bold: true },
    { _tag: "Text", text: "book", italic: true, link: "book" },
    { _tag: "Text", text: ", " },
    { _tag: "Value", name: "first_name", bold: true },
  ],
  item_one: [{ _tag: "Text", text: `${word} one` }],
  item_nested: [{ _tag: "Value", name: "offer", field: ["code"] }],
  image_alt: [],
  offer_label: [{ _tag: "Text", text: `${word} redeem` }],
});

/** One shared structure with every component kind and both languages. */
const richDocument = {
  purpose: "marketing",
  templateKey: "workspace",
  structure: [
    { _tag: "Heading", id: "heading", textKey: "heading", level: 1 },
    {
      _tag: "Paragraph",
      id: "intro",
      textKey: "intro",
      links: { book: "https://workspace.deskohub.test/book" },
    },
    { _tag: "Spacer", id: "space" },
    {
      _tag: "TextList",
      id: "list",
      ordered: false,
      items: [
        {
          textKey: "item_one",
          list: {
            ordered: true,
            start: 3,
            items: [{ textKey: "item_nested" }],
          },
        },
      ],
    },
    { _tag: "Divider", id: "rule" },
    {
      _tag: "Image",
      id: "image",
      src: "https://res.cloudinary.com/cloud/image/upload/v1/email-campaigns/preview/a.png",
      altKey: "image_alt",
      align: "left",
      width: 320,
      href: "mailto:hello@deskohub.test",
    },
    {
      _tag: "Offer",
      id: "offer",
      value: "offer",
      labelKey: "offer_label",
      href: "https://workspace.deskohub.test/",
    },
  ],
  translations: {
    "cs-CZ": {
      subject: [
        { _tag: "Text", text: "Ahoj " },
        { _tag: "Value", name: "first_name" },
      ],
      preheader: [],
      texts: texts("cs"),
    },
    "en-US": {
      subject: [{ _tag: "Text", text: "Hello" }],
      preheader: [],
      texts: texts("en"),
    },
  },
  values: [
    {
      name: "offer",
      source: { kind: "discount", discountId, validDays: 30 },
    },
    {
      name: "first_name",
      source: {
        kind: "customer",
        path: ["profile", "customer", "displayName"],
      },
      fallback: { "cs-CZ": "zákazníku", "en-US": "there" },
    },
  ],
};

describe("rich multilingual structure", () => {
  test("publishes shared formatting, lists, dividers, spacers, image layout and offers", () => {
    expect(emailDraftProblems(draft(richDocument), locales)).toEqual([]);
    const published = publish(richDocument);
    expect(Result.isSuccess(published)).toBe(true);
    const document = Result.getOrThrow(published);
    expect(document.structure.map((component) => component._tag)).toEqual([
      "Heading",
      "Paragraph",
      "Spacer",
      "TextList",
      "Divider",
      "Image",
      "Offer",
    ]);
    // Nested list texts reference values like any other text.
    expect(requiredEmailValueNames(document) as readonly string[]).toEqual([
      "offer",
      "first_name",
    ]);
  });

  test("historical documents without the new fields decode unchanged", () => {
    const historical = {
      purpose: "operational",
      templateKey: "workspace",
      structure: [
        { _tag: "Paragraph", id: "body", textKey: "body" },
        {
          _tag: "Image",
          id: "photo",
          src: "http://images.deskohub.test/a.png",
          altKey: "alt",
        },
        {
          _tag: "Button",
          id: "cta",
          labelKey: "cta",
          href: "http://workspace.deskohub.test/",
        },
      ],
      translations: {
        "cs-CZ": {
          subject: [{ _tag: "Text", text: "Ahoj" }],
          preheader: [],
          texts: { body: [{ _tag: "Text", text: "Text" }] },
        },
      },
      values: [],
    };
    // Today's publication rules, such as https-only destinations and every
    // current language, never apply to stored versions.
    expect(Schema.decodeUnknownSync(EmailDocument)(historical)).toEqual(
      historical as never
    );
    expect(Result.isFailure(publish(historical))).toBe(true);
  });

  test("plain texts refuse formatting, and links name the component's shared destinations", () => {
    const formatted = structuredClone(richDocument);
    formatted.translations["en-US"].subject = [
      { _tag: "Text", text: "Hello", bold: true } as never,
    ];
    formatted.translations["cs-CZ"].texts.offer_label = [
      { _tag: "Text", text: "Uplatnit", link: "book" } as never,
    ];
    formatted.translations["en-US"].texts.intro = [
      { _tag: "Text", text: "elsewhere", link: "missing" } as never,
    ];
    const problems = emailDraftProblems(draft(formatted), locales);
    expect(problems).toEqual([
      {
        _tag: "FormattingNotAllowed",
        at: {
          locale: "cs-CZ",
          field: "text",
          componentId: "offer",
          textKey: "offer_label",
        },
      },
      {
        _tag: "FormattingNotAllowed",
        at: { locale: "en-US", field: "subject" },
      },
      {
        _tag: "LinkUnknown",
        link: "missing",
        at: {
          locale: "en-US",
          field: "text",
          componentId: "intro",
          textKey: "intro",
        },
      },
    ] as never);
    expect(Result.isFailure(publish(formatted))).toBe(true);
  });

  test("destinations must use https or mailto at publication", () => {
    const insecure = structuredClone(richDocument);
    (insecure.structure[1] as { links: Record<string, string> }).links.book =
      "http://workspace.deskohub.test/book";
    (insecure.structure[6] as { href: string }).href = "ftp://deskohub.test/";
    expect(tags(emailDraftProblems(draft(insecure), locales))).toEqual([
      "DestinationInvalid",
      "DestinationInvalid",
    ]);
    expect(Result.isFailure(publish(insecure))).toBe(true);
  });
});

describe("drafts and publication", () => {
  const broken = {
    purpose: "marketing",
    templateKey: "workspace",
    structure: [
      { _tag: "Paragraph", id: "intro", textKey: "intro" },
      { _tag: "Button", id: "cta", labelKey: "cta" },
      { _tag: "Record", id: "contact", value: "removed" },
    ],
    translations: {
      "cs-CZ": {
        subject: [
          { _tag: "Text", text: "Ahoj " },
          { _tag: "Value", name: "removed" },
        ],
        texts: {
          intro: [{ _tag: "Value", name: "first_name" }],
          cta: [{ _tag: "Text", text: "Rezervovat" }],
        },
      },
      "en-US": { subject: [{ _tag: "Text", text: "Hello" }], texts: {} },
    },
    values: [
      {
        name: "first_name",
        source: {
          kind: "customer",
          path: ["profile", "customer", "displayName"],
        },
      },
      // Unused and unfinished: never blocks, publication drops it.
      { name: "later", source: { kind: "discount" } },
      // Unused and complete: kept in configured order.
      {
        name: "spare",
        source: {
          kind: "customer",
          path: ["activity", "stats", "favoriteProduct"],
        },
      },
    ],
  };

  test("an incomplete draft saves with broken references, missing translations and an unused definition", () => {
    expect(draft(broken)).toEqual(broken as never);
    const problems = emailDraftProblems(draft(broken), locales);
    expect(problems).toEqual([
      {
        _tag: "ComponentIncomplete",
        index: 1,
        componentId: "cta",
        field: "href",
      },
      {
        _tag: "ComponentIncomplete",
        index: 2,
        componentId: "contact",
        field: "fields",
      },
      {
        _tag: "ValueUnknown",
        name: "removed",
        at: { field: "component", componentId: "contact" },
      },
      {
        _tag: "ValueUnknown",
        name: "removed",
        at: { locale: "cs-CZ", field: "subject" },
      },
      {
        _tag: "TextMissing",
        locale: "en-US",
        componentId: "intro",
        textKey: "intro",
      },
      {
        _tag: "TextMissing",
        locale: "en-US",
        componentId: "cta",
        textKey: "cta",
      },
    ] as never);
    expect(problems.map(englishEmailDocumentProblem)).toContain(
      "Missing text intro: en-US."
    );
    expect(Result.isFailure(publish(broken))).toBe(true);
  });

  test("a removed used definition marks every use; unused definitions are listed separately", () => {
    const removed = {
      ...broken,
      values: broken.values.filter((value) => value.name !== "first_name"),
    };
    const problems = emailDraftProblems(draft(removed), locales);
    expect(
      problems.filter(
        (problem) =>
          problem._tag === "ValueUnknown" && problem.name === "first_name"
      )
    ).toEqual([
      {
        _tag: "ValueUnknown",
        name: "first_name",
        at: {
          locale: "cs-CZ",
          field: "text",
          componentId: "intro",
          textKey: "intro",
        },
      },
    ] as never);
    expect([...referencedEmailValueNames(draft(removed))].sort()).toEqual([
      "first_name",
      "removed",
    ]);
  });

  test("repairing published content publishes and prunes only unused unfinished definitions", () => {
    const repaired = {
      ...broken,
      structure: [
        broken.structure[0],
        { ...broken.structure[1], href: "https://workspace.deskohub.test/" },
      ],
      translations: {
        "cs-CZ": {
          ...broken.translations["cs-CZ"],
          subject: [{ _tag: "Text", text: "Ahoj" }],
        },
        "en-US": {
          subject: [{ _tag: "Text", text: "Hello" }],
          texts: {
            intro: [{ _tag: "Text", text: "Hi" }],
            cta: [{ _tag: "Text", text: "Book" }],
          },
        },
      },
    };
    expect(emailDraftProblems(draft(repaired), locales)).toEqual([]);
    const document = Result.getOrThrow(publish(repaired));
    expect(document.values.map((value) => value.name as string)).toEqual([
      "first_name",
      "spare",
    ]);
    expect(requiredEmailValueNames(document) as readonly string[]).toEqual([
      "first_name",
    ]);
  });

  test("a referenced unfinished definition blocks with its own problem", () => {
    const referenced = {
      ...richDocument,
      values: [
        { name: "offer", source: { kind: "discount" } },
        richDocument.values[1],
      ],
    };
    expect(emailDraftProblems(draft(referenced), locales)).toEqual([
      { _tag: "ValueIncomplete", index: 0, name: "offer", field: "discountId" },
      { _tag: "ValueIncomplete", index: 0, name: "offer", field: "validDays" },
    ] as never);
    expect(Result.isFailure(publish(referenced))).toBe(true);
  });

  test("publication succeeds exactly when the draft reports no problems", () => {
    const cases: unknown[] = [
      {},
      richDocument,
      broken,
      (({ purpose: _, ...rest }) => rest)(richDocument),
      {
        ...richDocument,
        structure: [...richDocument.structure, { _tag: "Divider", id: "rule" }],
      },
      {
        ...richDocument,
        structure: [{ _tag: "TextList", id: "list", ordered: true, items: [] }],
      },
      {
        ...richDocument,
        structure: [
          {
            _tag: "Image",
            id: "image",
            src: "https://a.test/b.png",
            altKey: "image_alt",
            width: 0,
          },
        ],
      },
    ];
    for (const input of cases) {
      const problems = emailDraftProblems(draft(input), locales);
      expect([input, Result.isSuccess(publish(input))]).toEqual([
        input,
        problems.length === 0,
      ]);
    }
  });
});
