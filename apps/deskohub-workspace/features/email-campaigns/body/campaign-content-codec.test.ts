import { describe, expect, test } from "bun:test";
import { testEmailAddress } from "@deskohub/test-email";
import type { AdministrationCampaignContentInputType } from "@deskohub/workspace-admin-api";
import { Effect, Exit, Option, Schema } from "effect";
import { locales } from "@/features/i18n";
import { type CampaignId, campaignIdSchema } from "../campaign-identifiers";
import {
  type CampaignBodyDocument,
  campaignBodyDocument,
} from "./campaign-body-document";
import type {
  CampaignLocaleContent,
  CampaignLocalizedContent,
} from "./campaign-content";
import {
  type CampaignContentChanges,
  campaignContentLocales,
  changeCampaignContent,
  readCampaignContent,
  readCampaignDraftContent,
  writeCampaignContent,
} from "./campaign-content-codec";
import { markdownCampaignBody as readMarkdown } from "./campaign-content-codec.test-utils";

const cloudinaryImage =
  "https://res.cloudinary.com/cloud/image/upload/v1/campaigns/autumn.jpg";

const texts = { subject: "Podzim", preheader: "Novinky" };

/** A body document as the editor sends it. */
const document = (...content: ReadonlyArray<object>) => ({
  formatVersion: 1 as const,
  doc: { type: "doc", content },
});

const paragraph = (text: string) => ({
  type: "paragraph",
  content: [{ type: "text", text }],
});

const body = (text: string) =>
  Schema.decodeUnknownSync(campaignBodyDocument(Option.some("cloud")))(
    document(paragraph(text))
  );

const failure = <A, E>(effect: Effect.Effect<A, E>) =>
  Effect.runPromise(Effect.flip(effect));

const czech = (content: CampaignLocalizedContent): CampaignLocaleContent => {
  const locale = content["cs-CZ"];
  if (locale === undefined) throw new Error("No cs-CZ content");
  return locale;
};

/** The body `readCampaignDraftContent` reads from Czech Markdown. */
const readDraftMarkdown = (bodyMarkdown: string) =>
  Effect.runPromise(
    readCampaignDraftContent({ "cs-CZ": { ...texts, bodyMarkdown } }).pipe(
      Effect.map((content) => czech(content).body)
    )
  );

/** The Markdown `writeCampaignContent` writes for a Czech body. */
const writeMarkdown = (written: CampaignBodyDocument) =>
  writeCampaignContent({ "cs-CZ": { ...texts, body: written } }, "markdown")[
    "cs-CZ"
  ]?.bodyMarkdown ?? "";

describe("readCampaignContent", () => {
  test("reads Markdown and document bodies with their texts", async () => {
    const content = await Effect.runPromise(
      readCampaignContent({
        "cs-CZ": {
          ...texts,
          bodyMarkdown: "Dobrý den",
          operationalReason: "Měníme provozní dobu.",
        },
        "en-US": { ...texts, bodyDocument: document(paragraph("Hello")) },
      })
    );

    expect(content).toEqual({
      "cs-CZ": {
        ...texts,
        body: body("Dobrý den"),
        operationalReason: "Měníme provozní dobu.",
      },
      "en-US": { ...texts, body: body("Hello") },
    });
  });

  test("reads no locales from empty content", async () => {
    expect(await Effect.runPromise(readCampaignContent({}))).toEqual({});
  });

  test.each([
    ["javascript link", "[x](javascript:alert(1))"],
    ["external image", "![x](https://example.com/a.jpg)"],
    ["insecure button", "[[button: Go](http://deskohub.cz)]"],
  ])("refuses Markdown with a %s", async (_name, bodyMarkdown) => {
    const error = await failure(
      readCampaignContent({ "en-US": { ...texts, bodyMarkdown } })
    );

    expect(error).toMatchObject({
      _tag: "CampaignBodyMarkdownInvalid",
      locale: "en-US",
      cause: { _tag: "InvalidCampaignBody" },
    });
  });

  test("refuses a document that breaks the content rules", async () => {
    const error = await failure(
      readCampaignContent({
        "cs-CZ": {
          ...texts,
          bodyDocument: document({
            type: "ctaButton",
            attrs: { label: "", href: null },
          }),
        },
      })
    );

    expect(error).toMatchObject({
      _tag: "CampaignBodyDocumentInvalid",
      locale: "cs-CZ",
      cause: { _tag: "InvalidCampaignBody" },
    });
  });

  test("names the first failing locale in content order", async () => {
    const invalid = { ...texts, bodyMarkdown: "[x](javascript:alert(1))" };
    const input: AdministrationCampaignContentInputType = Object.fromEntries(
      [...locales].reverse().map((locale) => [locale, invalid])
    );

    expect(await failure(readCampaignContent(input))).toMatchObject({
      locale: locales[0],
    });
  });
});

describe("campaign body Markdown", () => {
  test.each([
    ["heading 1", "# Podzim ve Workspace", "heading"],
    ["heading 2", "## Novinky", "heading"],
    ["heading 3", "### Detaily", "heading"],
    ["paragraph", "Čeština: žluťoučký kůň úpěl ďábelské ódy.", "paragraph"],
    ["bold", "Tohle je **důležité**.", "paragraph"],
    ["italic", "Tohle je *zdůrazněné*.", "paragraph"],
    ["link", "Více na [webu](https://workspace.deskohub.cz).", "paragraph"],
    [
      "mailto link",
      `Napište na [e-mail](mailto:${testEmailAddress("campaign")}).`,
      "paragraph",
    ],
    ["bullet list", "- jedna\n- dva **tučně**", "bulletList"],
    ["ordered list", "1. první\n2. druhá", "orderedList"],
    ["image", `![Nová zasedačka](${cloudinaryImage})`, "image"],
    ["divider", "Nad čarou\n\n---\n\nPod čarou", "horizontalRule"],
    [
      "button",
      "[[button: Rezervovat](https://workspace.deskohub.cz/cs-CZ/meeting-room)]",
      "ctaButton",
    ],
  ])("round-trips a %s", async (_name, markdown, nodeType) => {
    const read = await readMarkdown(markdown);

    expect(read.formatVersion).toBe(1);
    expect(read.doc.content?.map((node) => node.type)).toContain(nodeType);
    expect(writeMarkdown(read)).toBe(markdown);
  });

  test("reads a button's label and URL", async () => {
    const read = await readMarkdown(
      "[[button: Book now](https://deskohub.cz/book)]"
    );

    expect(read.doc.content).toEqual([
      {
        type: "ctaButton",
        attrs: { label: "Book now", href: "https://deskohub.cz/book" },
      },
    ]);
  });

  test.each([
    ["parentheses in the URL", "Book", "https://example.com/book(foo)"],
    ["unbalanced parentheses", "Book", "https://example.com/a)b(c"],
    ["a closing bracket after the URL", "Book", "https://example.com/x)]"],
    ["a space in the URL", "Book", "https://example.com/a b"],
    ["a backslash in the URL", "Book", "https://example.com/a\\b"],
    [
      "a mailto subject",
      "Write",
      `mailto:${testEmailAddress("team")}?subject=Hi%20(you)`,
    ],
    ["brackets in the label", "Book [now]", "https://deskohub.cz"],
    ["unbalanced brackets", "]] Book [[", "https://deskohub.cz"],
    [
      "link syntax in the label",
      "x](https://example.com)",
      "https://deskohub.cz",
    ],
    ["a multiline label", "Book\nnow\n\ntoday", "https://deskohub.cz"],
    ["whitespace around the label", "  Book\t ", "https://deskohub.cz"],
    ["backslashes in the label", "C:\\ \\[x\\]\\", "https://deskohub.cz"],
    [
      "Markdown in the label",
      "**no** _em_ `code` <b>x</b> # 1.",
      "https://deskohub.cz",
    ],
  ])(
    "keeps a button with %s through writing and reading",
    async (_name, label, href) => {
      const stored = Schema.decodeUnknownSync(
        campaignBodyDocument(Option.some("cloud"))
      )(
        document(
          paragraph("Hi"),
          { type: "ctaButton", attrs: { label, href } },
          paragraph("Bye")
        )
      );

      const read = await readMarkdown(writeMarkdown(stored));

      expect(read.doc.content?.[1]).toEqual({
        type: "ctaButton",
        attrs: { label, href },
      });
      expect(read).toEqual(stored);
    }
  );

  test.each([
    [
      "balanced parentheses in the URL",
      "[[button: Book](https://example.com/book(foo))]",
      { label: "Book", href: "https://example.com/book(foo)" },
    ],
    [
      "balanced brackets in the label",
      "[[button: Book [now]](https://deskohub.cz)]",
      { label: "Book [now]", href: "https://deskohub.cz" },
    ],
    [
      "spaces around the label",
      "[[button:   Book now  ](https://deskohub.cz)]  ",
      { label: "Book now", href: "https://deskohub.cz" },
    ],
  ])("reads a hand-written button with %s", async (_name, markdown, attrs) => {
    const read = await readMarkdown(markdown);

    expect(read.doc.content).toEqual([{ type: "ctaButton", attrs }]);
  });

  test.each([
    ["a bare URL", "See https://example.com/a?b=1&c=2 now"],
    ["a bare URL without a query", "See https://example.com/a now"],
    ["a bare domain", "Visit www.example.com today"],
  ])("keeps %s typed as text when it round-trips", async (_name, text) => {
    const typed = await readMarkdown(text.replaceAll("&", "\\&"));
    const read = await readMarkdown(writeMarkdown(typed));

    expect(read).toEqual(typed);
    expect(JSON.stringify(read.doc)).not.toContain('"link"');
    expect(JSON.stringify(read.doc)).toContain(
      JSON.stringify(text).slice(1, -1)
    );
  });

  test("round-trips an empty body", async () => {
    const empty = await readMarkdown("");

    expect(empty.doc).toEqual({
      type: "doc",
      content: [{ type: "paragraph" }],
    });
    expect(await readMarkdown(writeMarkdown(empty))).toEqual(empty);
  });
});

describe("readCampaignDraftContent", () => {
  const paragraphLink = (href: string) => ({
    type: "paragraph",
    content: [
      { type: "text", text: "web", marks: [{ type: "link", attrs: { href } }] },
    ],
  });

  test.each([
    [
      "a button without a label or URL",
      { type: "ctaButton", attrs: { label: "", href: null } },
    ],
    [
      "a button with an unfinished URL",
      { type: "ctaButton", attrs: { label: "Klik", href: "htt" } },
    ],
    ["a link without a URL", paragraphLink("")],
    ["a link with an unsafe URL", paragraphLink("javascript:alert(1)")],
    [
      "an image from elsewhere",
      { type: "image", attrs: { src: "https://example.com/a.jpg" } },
    ],
  ])("accepts %s that saving refuses", async (_name, node) => {
    const bodyDocument = document(node);
    const markdown = writeMarkdown(bodyDocument as never);

    const draft = await Effect.runPromise(
      readCampaignDraftContent({
        "cs-CZ": { ...texts, bodyMarkdown: markdown },
        "en-US": { ...texts, bodyDocument },
      })
    );
    const finished = await Effect.runPromiseExit(
      readCampaignContent({ "cs-CZ": { ...texts, bodyMarkdown: markdown } })
    );

    expect(draft["cs-CZ"]?.body.doc.content?.[0]?.type).toBe(node.type);
    expect(draft["en-US"]?.body.doc.content?.[0]?.type).toBe(node.type);
    expect(Exit.isFailure(finished)).toBe(true);
  });

  test("keeps a button's unfinished label and URL", async () => {
    const read = await readDraftMarkdown(
      writeMarkdown(
        document({
          type: "ctaButton",
          attrs: { label: "", href: null },
        }) as never
      )
    );

    expect(read.doc.content).toEqual([
      { type: "ctaButton", attrs: { label: "", href: "" } },
    ]);
  });

  test("reads finished Markdown as the finished read does", async () => {
    const markdown =
      "Více na [webu](https://workspace.deskohub.cz).\n\n[[button: Rezervovat](https://workspace.deskohub.cz)]";

    expect(await readDraftMarkdown(markdown)).toEqual(
      await readMarkdown(markdown)
    );
  });

  test("still refuses a body outside the content set's structure", async () => {
    const error = await failure(
      readCampaignDraftContent({
        "cs-CZ": { ...texts, bodyDocument: document({ type: "video" }) },
      })
    );

    expect(error).toMatchObject({
      _tag: "CampaignBodyDocumentInvalid",
      locale: "cs-CZ",
    });
  });
});

describe("changeCampaignContent", () => {
  const campaignId: CampaignId = campaignIdSchema.make("campaign-1");
  const current: CampaignLocalizedContent = {
    "cs-CZ": {
      subject: "Předmět",
      preheader: "Úvod",
      body: body("Dobrý den"),
      operationalReason: "Měníme provozní dobu.",
    },
    "en-US": { subject: "Subject", preheader: "Intro", body: body("Hello") },
  };

  const change = (changes: CampaignContentChanges) =>
    changeCampaignContent({ campaignId, current, changes });

  test("keeps omitted locales and fields", async () => {
    expect(
      await Effect.runPromise(change({ "cs-CZ": { subject: "Nový" } }))
    ).toEqual({
      ...current,
      "cs-CZ": { ...czech(current), subject: "Nový" },
    });
  });

  test("removes a locale mapped to null", async () => {
    expect(await Effect.runPromise(change({ "en-US": null }))).toEqual({
      "cs-CZ": current["cs-CZ"],
    });
  });

  test("restores the default reason line for a null reason", async () => {
    const changed = await Effect.runPromise(
      change({ "cs-CZ": { operationalReason: null } })
    );

    expect(changed["cs-CZ"]).not.toHaveProperty("operationalReason");
  });

  test("sets a new reason", async () => {
    const changed = await Effect.runPromise(
      change({ "en-US": { operationalReason: "We change hours." } })
    );

    expect(changed["en-US"]?.operationalReason).toBe("We change hours.");
  });

  test.each([
    ["Markdown", { bodyMarkdown: "Ahoj" }],
    ["a document", { bodyDocument: document(paragraph("Ahoj")) }],
  ])("replaces a body given as %s", async (_name, bodyChange) => {
    const changed = await Effect.runPromise(change({ "cs-CZ": bodyChange }));

    expect(changed["cs-CZ"]).toEqual({ ...czech(current), body: body("Ahoj") });
  });

  test("adds a locale with a subject and a body, and an empty preheader", async () => {
    const changed = await Effect.runPromise(
      changeCampaignContent({
        campaignId,
        current: {},
        changes: { "en-US": { subject: "New", bodyMarkdown: "Hello" } },
      })
    );

    expect(changed).toEqual({
      "en-US": { subject: "New", preheader: "", body: body("Hello") },
    });
  });

  test.each<[string, CampaignContentChanges]>([
    ["a body", { "en-US": { subject: "New" } }],
    ["a subject", { "en-US": { bodyMarkdown: "Hello" } }],
  ])(
    "refuses a new locale without %s, naming the campaign",
    async (_name, changes) => {
      const error = await failure(
        changeCampaignContent({ campaignId, current: {}, changes })
      );

      expect(error).toMatchObject({
        _tag: "CampaignLocaleContentMissing",
        campaignId,
        locale: "en-US",
      });
    }
  );

  test("holds a changed body to the rules saving applies", async () => {
    const error = await failure(
      change({ "en-US": { bodyMarkdown: "[x](javascript:alert(1))" } })
    );

    expect(error).toMatchObject({
      _tag: "CampaignBodyMarkdownInvalid",
      locale: "en-US",
    });
  });
});

describe("writeCampaignContent", () => {
  const content: CampaignLocalizedContent = {
    "en-US": {
      subject: "Subject",
      preheader: "Intro",
      body: body("Hello"),
      operationalReason: "We change hours.",
    },
    "cs-CZ": { subject: "Předmět", preheader: "Úvod", body: body("Ahoj") },
  };

  test("writes Markdown bodies with their texts", () => {
    expect(writeCampaignContent(content, "markdown")).toEqual({
      "cs-CZ": { subject: "Předmět", preheader: "Úvod", bodyMarkdown: "Ahoj" },
      "en-US": {
        subject: "Subject",
        preheader: "Intro",
        bodyMarkdown: "Hello",
        operationalReason: "We change hours.",
      },
    });
  });

  test("writes document bodies as stored", () => {
    expect(writeCampaignContent(content, "document")).toEqual({
      "cs-CZ": {
        subject: "Předmět",
        preheader: "Úvod",
        bodyDocument: body("Ahoj"),
      },
      "en-US": {
        subject: "Subject",
        preheader: "Intro",
        bodyDocument: body("Hello"),
        operationalReason: "We change hours.",
      },
    });
  });

  test.each(["markdown", "document"] as const)(
    "writes %s locales in content order",
    (form) => {
      const reordered: CampaignLocalizedContent = Object.fromEntries(
        [...locales].reverse().map((locale) => [locale, czech(content)])
      );

      expect(Object.keys(writeCampaignContent(reordered, form))).toEqual([
        ...locales,
      ]);
      expect(campaignContentLocales(reordered)).toEqual(locales);
    }
  );

  test("reads back what it writes", async () => {
    for (const form of ["markdown", "document"] as const) {
      expect(
        await Effect.runPromise(
          readCampaignContent(writeCampaignContent(content, form))
        )
      ).toEqual(content);
    }
  });
});
