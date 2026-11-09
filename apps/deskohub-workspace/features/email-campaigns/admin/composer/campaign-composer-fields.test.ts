import { describe, expect, test } from "bun:test";
import type { AdministrationCampaignEditorContentType } from "@deskohub/workspace-admin-api";
import { Option } from "effect";
import type { CampaignBodyNode } from "../../body/campaign-body-document";
import { richCampaignBodies } from "../../body/campaign-body-document.test-utils";
import { campaignBodySchema } from "../../body/campaign-body-extensions";
import {
  type CampaignComposerFields,
  type CampaignComposerLocaleFields,
  campaignComposerFieldsFromCampaign,
  composerLocales,
  localeContentIssueMessage,
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
  test("sends the body as the editor's document", () => {
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
        bodyDocument: {
          formatVersion: 1,
          doc: fields.locales["cs-CZ"].body,
        },
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
        composerLocales(undefined).editable
      )["cs-CZ"]
    ).toMatchObject({ subject: "Ahoj", operationalReason: null });
  });

  test("clears every locale without content, whatever the last save left", () => {
    expect(
      toAdministrationCampaignContentChange(
        czechOnly,
        composerLocales(undefined).editable
      )
    ).toMatchObject({ "en-US": null });
  });

  test("clears a locale a single-locale audience hides", () => {
    const bothLocales = withSubject(czechOnly, "en-US", "Hello");
    expect(
      toAdministrationCampaignContentChange(
        bothLocales,
        composerLocales("en-US").editable
      )
    ).toMatchObject({ "cs-CZ": null, "en-US": { subject: "Hello" } });
  });
});

describe("editor round trip", () => {
  const saved: AdministrationCampaignEditorContentType = {
    id: "01990000-0000-7000-8000-000000000001",
    title: "Autumn news",
    purpose: "operational",
    templateKey: "workspace",
    delivery: "once",
    status: "draft",
    audienceId: null,
    locales: ["cs-CZ", "en-US"],
    createdAt: "2026-10-19T08:00:00Z",
    updatedAt: "2026-10-19T08:00:00Z",
    content: {
      "cs-CZ": {
        subject: "Podzimní novinky",
        preheader: "Co je nového",
        bodyDocument: richCampaignBodies["cs-CZ"],
        operationalReason: "Měníme otevírací dobu.",
      },
      "en-US": {
        subject: "Autumn news",
        preheader: "What's new",
        bodyDocument: richCampaignBodies["en-US"],
      },
    },
  };

  test.each(["cs-CZ", "en-US"] as const)(
    "the editor holds the saved %s body unchanged",
    (locale) => {
      const { body } =
        campaignComposerFieldsFromCampaign(saved).locales[locale];
      expect(campaignBodySchema.nodeFromJSON(body).toJSON()).toEqual(body);
      expect(body).toEqual(richCampaignBodies[locale].doc);
    }
  );

  test("saving unchanged fields writes back exactly what the port read", () => {
    const fields = campaignComposerFieldsFromCampaign(saved);
    expect(
      toAdministrationCampaignContentChange(
        fields,
        composerLocales(undefined).editable
      )
    ).toEqual({
      "cs-CZ": { ...saved.content["cs-CZ"] },
      "en-US": { operationalReason: null, ...saved.content["en-US"] },
    });
  });
});

describe("localeContentIssues", () => {
  const imageCloudName = Option.some("synthetic-cloud");
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
  const issueTags = (fields: CampaignComposerLocaleFields) =>
    localeContentIssues(fields, imageCloudName).map(({ _tag }) => _tag);

  test("asks for a subject and a body", () => {
    expect(issueTags(newCampaignComposerFields.locales["cs-CZ"])).toEqual([
      "SubjectMissing",
      "BodyMissing",
    ]);
  });

  test("checks a written body against the body rules", () => {
    expect(
      issueTags(
        withBody(
          paragraph({
            type: "text",
            text: "link",
            marks: [{ type: "link", attrs: { href: "http://example.test" } }],
          }),
          { type: "image", attrs: { src: "https://example.test/a.png" } },
          {
            type: "image",
            attrs: {
              src: "https://res.cloudinary.com/synthetic-cloud/image/upload/synthetic.png",
            },
          },
          { type: "ctaButton", attrs: { label: " ", href: "ftp://x" } },
          {
            type: "ctaButton",
            attrs: { label: "Line\r\nbreak", href: "https://example.test" },
          }
        )
      )
    ).toEqual([
      "LinkHrefInvalid",
      "ImageSourceInvalid",
      "ButtonLabelMissing",
      "ButtonHrefInvalid",
      "ButtonLabelLineBreaks",
    ]);
  });

  test("reports a body outside the content set as invalid structure", () => {
    expect(
      issueTags(
        withBody({
          type: "unknownNode",
          content: [{ type: "text", text: "Synthetic" }],
        })
      )
    ).toEqual(["StructureInvalid"]);
  });

  test("describes every issue in each admin language", () => {
    const issues = [
      ...localeContentIssues(
        newCampaignComposerFields.locales["en-US"],
        imageCloudName
      ),
      ...localeContentIssues(
        withBody(
          paragraph({
            type: "text",
            text: "link",
            marks: [{ type: "link", attrs: { href: "http://example.test" } }],
          }),
          { type: "ctaButton", attrs: { label: null, href: null } }
        ),
        imageCloudName
      ),
    ];

    for (const locale of ["cs-CZ", "en-US"] as const) {
      const messages = issues.map((issue) =>
        localeContentIssueMessage(issue, locale)
      );
      expect(messages.every((message) => message.length > 0)).toBe(true);
      expect(new Set(messages).size).toBe(messages.length);
    }
  });
});
