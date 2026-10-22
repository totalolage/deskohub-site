import { describe, expect, test } from "bun:test";
import { getClientEnv } from "@/client-env";
import type { CampaignBodyNode } from "../../body/campaign-body-document";
import {
  type CampaignComposerFields,
  type CampaignComposerLocaleFields,
  composerLocales,
  localeContentIssues,
  newCampaignComposerFields,
  toAdministrationCampaignContent,
  toAdministrationCampaignContentChange,
} from "./campaign-composer-fields";

const withSubject = (
  fields: CampaignComposerFields,
  locale: keyof CampaignComposerFields["locales"],
  subject: string
): CampaignComposerFields => ({
  ...fields,
  locales: {
    ...fields.locales,
    [locale]: { ...fields.locales[locale], subject },
  },
});

describe("composerLocales", () => {
  test("without a single-locale audience, every locale shows and Czech is required", () => {
    expect(composerLocales(undefined)).toEqual({
      editable: ["cs-CZ", "en-US"],
      required: "cs-CZ",
    });
  });

  test("a single-locale audience shows and requires only its locale", () => {
    expect(composerLocales("en-US")).toEqual({
      editable: ["en-US"],
      required: "en-US",
    });
    expect(composerLocales("cs-CZ")).toEqual({
      editable: ["cs-CZ"],
      required: "cs-CZ",
    });
  });
});

describe("toAdministrationCampaignContent", () => {
  const bothLocales = withSubject(
    withSubject(newCampaignComposerFields, "cs-CZ", "Ahoj"),
    "en-US",
    "Hello"
  );

  test("saves only the editable locales", () => {
    expect(
      Object.keys(
        toAdministrationCampaignContent(
          bothLocales,
          composerLocales("en-US").editable
        )
      )
    ).toEqual(["en-US"]);
  });

  test("skips locales with no text", () => {
    const czechOnly = withSubject(newCampaignComposerFields, "cs-CZ", "Ahoj");
    expect(
      Object.keys(
        toAdministrationCampaignContent(
          czechOnly,
          composerLocales(undefined).editable
        )
      )
    ).toEqual(["cs-CZ"]);
  });
});

describe("toAdministrationCampaignContent body", () => {
  test("sends the body as Markdown", () => {
    const fields: CampaignComposerFields = {
      ...newCampaignComposerFields,
      locales: {
        ...newCampaignComposerFields.locales,
        "cs-CZ": {
          ...newCampaignComposerFields.locales["cs-CZ"],
          subject: " Ahoj ",
          body: {
            type: "doc",
            content: [
              {
                type: "paragraph",
                content: [
                  { type: "text", text: "Dobrý " },
                  { type: "text", text: "den", marks: [{ type: "bold" }] },
                ],
              },
            ],
          },
        },
      },
    };

    expect(
      toAdministrationCampaignContent(fields, composerLocales("cs-CZ").editable)
    ).toEqual({
      "cs-CZ": {
        subject: "Ahoj",
        preheader: "",
        bodyMarkdown: "Dobrý **den**",
      },
    });
  });
});

describe("toAdministrationCampaignContentChange", () => {
  const czechOnly = withSubject(newCampaignComposerFields, "cs-CZ", "Ahoj");

  test("restores the default reason line unless one is set", () => {
    expect(
      toAdministrationCampaignContentChange(
        czechOnly,
        composerLocales(undefined).editable,
        ["cs-CZ"]
      )["cs-CZ"]
    ).toMatchObject({ subject: "Ahoj", operationalReason: null });
  });

  test("removes a saved locale that no longer has content", () => {
    expect(
      toAdministrationCampaignContentChange(
        czechOnly,
        composerLocales(undefined).editable,
        ["cs-CZ", "en-US"]
      )
    ).toMatchObject({ "en-US": null });
  });

  test("leaves locales the draft never had alone", () => {
    expect(
      Object.keys(
        toAdministrationCampaignContentChange(
          czechOnly,
          composerLocales(undefined).editable,
          ["cs-CZ"]
        )
      )
    ).toEqual(["cs-CZ"]);
  });
});

describe("localeContentIssues", () => {
  const paragraph = (...content: CampaignBodyNode[]): CampaignBodyNode => ({
    type: "paragraph",
    content,
  });
  const withBody = (
    ...content: CampaignBodyNode[]
  ): CampaignComposerLocaleFields => ({
    ...newCampaignComposerFields.locales["en-US"],
    subject: "Synthetic subject",
    body: { type: "doc", content },
  });
  const issueMessages = (
    fields: CampaignComposerLocaleFields,
    locale: "cs-CZ" | "en-US" = "en-US"
  ) => localeContentIssues(fields, locale).map(({ issue }) => issue);

  test("asks for a subject and a body in the admin's language", () => {
    const empty = newCampaignComposerFields.locales["cs-CZ"];
    expect(issueMessages(empty)).toEqual([
      "Add a subject.",
      "Write the email body.",
    ]);
    expect(issueMessages(empty, "cs-CZ")).toEqual([
      "Doplňte předmět.",
      "Napište text e-mailu.",
    ]);
  });

  test("names each body rule problem by where it points", () => {
    const cloudinaryImage = `https://res.cloudinary.com/${getClientEnv().NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME}/image/upload/synthetic.png`;
    expect(
      issueMessages(
        withBody(
          paragraph({
            type: "text",
            text: "link",
            marks: [{ type: "link", attrs: { href: "http://example.test" } }],
          }),
          { type: "image", attrs: { src: "https://example.test/a.png" } },
          { type: "image", attrs: { src: cloudinaryImage } },
          { type: "ctaButton", attrs: { label: " ", href: "ftp://x" } },
          {
            type: "ctaButton",
            attrs: { label: "Line\r\nbreak", href: "https://example.test" },
          }
        )
      )
    ).toEqual([
      "A link must use an https: or mailto: URL.",
      "An image must come from the Deskohub Cloudinary account.",
      "A button needs a label.",
      "A button needs an https: or mailto: URL.",
      "A button label must break lines with line feeds only.",
    ]);
  });

  test("reports a body outside the content set without its internal message", () => {
    expect(
      issueMessages(
        withBody({
          type: "unknownNode",
          content: [{ type: "text", text: "Synthetic" }],
        }),
        "cs-CZ"
      )
    ).toEqual([
      "Text e-mailu obsahuje prvky, které e-maily kampaní nepodporují.",
    ]);
  });
});
