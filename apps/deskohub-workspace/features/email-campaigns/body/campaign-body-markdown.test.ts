import { describe, expect, test } from "bun:test";
import { testEmailAddress } from "@deskohub/test-email";
import { Effect, Exit, Result, Schema } from "effect";
import {
  CampaignBodyDocument,
  UnfinishedCampaignBodyDocument,
} from "./campaign-body-document";
import {
  campaignBodyToMarkdown,
  parseCampaignBodyMarkdown,
  parseUnfinishedCampaignBodyMarkdown,
} from "./campaign-body-markdown";

const cloudinaryImage =
  "https://res.cloudinary.com/cloud/image/upload/v1/campaigns/autumn.jpg";

const parse = (markdown: string) =>
  Effect.runPromise(parseCampaignBodyMarkdown(markdown));

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
    const body = await parse(markdown);

    expect(body.formatVersion).toBe(1);
    expect(body.doc.content?.map((node) => node.type)).toContain(nodeType);
    expect(campaignBodyToMarkdown(body)).toBe(markdown);
  });

  test("parses a button's label and URL", async () => {
    const body = await parse("[[button: Book now](https://deskohub.cz/book)]");

    expect(body.doc.content).toEqual([
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
    "keeps a button with %s through export and import",
    async (_name, label, href) => {
      const body = Schema.decodeUnknownSync(CampaignBodyDocument)({
        formatVersion: 1,
        doc: {
          type: "doc",
          content: [
            { type: "paragraph", content: [{ type: "text", text: "Hi" }] },
            { type: "ctaButton", attrs: { label, href } },
            { type: "paragraph", content: [{ type: "text", text: "Bye" }] },
          ],
        },
      });

      const imported = await parse(campaignBodyToMarkdown(body));

      expect(imported.doc.content?.[1]).toEqual({
        type: "ctaButton",
        attrs: { label, href },
      });
      expect(imported).toEqual(body);
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
  ])("parses a hand-written button with %s", async (_name, markdown, attrs) => {
    const body = await parse(markdown);

    expect(body.doc.content).toEqual([{ type: "ctaButton", attrs }]);
  });

  test.each([
    ["javascript link", "[x](javascript:alert(1))"],
    ["external image", "![x](https://example.com/a.jpg)"],
    ["insecure button", "[[button: Go](http://deskohub.cz)]"],
  ])("rejects a %s", async (_name, markdown) => {
    const exit = await Effect.runPromiseExit(
      parseCampaignBodyMarkdown(markdown)
    );

    expect(Exit.isFailure(exit)).toBe(true);
    expect(JSON.stringify(exit)).toContain("InvalidCampaignBody");
  });

  test.each([
    ["a bare URL", "See https://example.com/a?b=1&c=2 now"],
    ["a bare URL without a query", "See https://example.com/a now"],
    ["a bare domain", "Visit www.example.com today"],
  ])("keeps %s typed as text when it round-trips", async (_name, text) => {
    const typed = await parse(text.replaceAll("&", "\\&"));
    const imported = await parse(campaignBodyToMarkdown(typed));

    expect(imported).toEqual(typed);
    expect(JSON.stringify(imported.doc)).not.toContain('"link"');
    expect(JSON.stringify(imported.doc)).toContain(
      JSON.stringify(text).slice(1, -1)
    );
  });

  test("round-trips an empty body", async () => {
    const empty = await parse("");

    expect(empty.doc).toEqual({
      type: "doc",
      content: [{ type: "paragraph" }],
    });
    expect(await parse(campaignBodyToMarkdown(empty))).toEqual(empty);
  });
});

describe("unfinished campaign body Markdown", () => {
  const parseUnfinished = (markdown: string) =>
    Effect.runPromise(parseUnfinishedCampaignBodyMarkdown(markdown));

  /** An editor document as the composer holds it mid-edit. */
  const editorBody = (...content: ReadonlyArray<object>) => ({
    formatVersion: 1 as const,
    doc: { type: "doc", content },
  });

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
    const markdown = campaignBodyToMarkdown(editorBody(node) as never);

    const unfinished = await parseUnfinished(markdown);
    const finished = await Effect.runPromiseExit(
      parseCampaignBodyMarkdown(markdown)
    );

    expect(unfinished.doc.content?.[0]?.type).toBe(node.type);
    expect(Exit.isFailure(finished)).toBe(true);
  });

  test("keeps a button's unfinished label and URL", async () => {
    const body = await parseUnfinished(
      campaignBodyToMarkdown(
        editorBody({
          type: "ctaButton",
          attrs: { label: "", href: null },
        }) as never
      )
    );

    expect(body.doc.content).toEqual([
      { type: "ctaButton", attrs: { label: "", href: "" } },
    ]);
  });

  test("parses finished Markdown as the strict parser does", async () => {
    const markdown =
      "Více na [webu](https://workspace.deskohub.cz).\n\n[[button: Rezervovat](https://workspace.deskohub.cz)]";

    expect(await parseUnfinished(markdown)).toEqual(await parse(markdown));
  });

  test("still refuses a body outside the content set's structure", () => {
    expect(
      Result.isFailure(
        Schema.decodeUnknownResult(UnfinishedCampaignBodyDocument)({
          formatVersion: 1,
          doc: { type: "doc", content: [{ type: "video" }] },
        })
      )
    ).toBe(true);
  });
});
