import "@/shared/testing/workspace-test-env";

import { describe, expect, test } from "bun:test";
import {
  EmailDocument,
  type EmailValueSnapshot,
  WORKSPACE_SITE_TIME_ZONE,
} from "@deskohub/workspace-admin-api";
import { Result, Schema } from "effect";
import type { ReactElement } from "react";
import { render } from "react-email";
import { CampaignBodyContent } from "@/features/email-campaigns/body/campaign-body-content";
import { type Locale, m } from "@/features/i18n";
import { formatInstantDate } from "@/shared/utils/date-time-format";
import { renderEmailContent } from "./email-content";
import {
  cloudinaryImage,
  emailDocumentFixture,
  emailFixtureValues,
  emailFixtureWords,
  fixtureOfferExpiry,
  legacyRichTextBody,
  richTextParityDocument,
} from "./email-document.test-utils";

const renderHtml = (body: ReactElement) => render(body);

const rendered = (
  locale: string,
  values: Readonly<Record<string, EmailValueSnapshot>> = emailFixtureValues,
  document: EmailDocument = emailDocumentFixture
) => renderEmailContent({ document, locale, values });

const renderedContent = (...args: Parameters<typeof rendered>) =>
  Result.getOrThrow(rendered(...args));

/** The text of every element matching `tag`, in document order. */
const textsOf = (html: string, tag: string) =>
  [...html.matchAll(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, "g"))].map(
    (match) =>
      (match[1] ?? "")
        .replace(/<!--[\s\S]*?-->/g, "")
        .replace(/<[^>]+>/g, "")
        .replace("&#8203;", "")
  );

const failureOf = (result: ReturnType<typeof rendered>) =>
  Result.isFailure(result) ? result.failure : undefined;

describe("renderEmailContent", () => {
  test.each(["en-US", "cs-CZ"] as const)(
    "renders %s from the shared structure with its own texts and values",
    async (locale: Locale) => {
      const words = emailFixtureWords[locale];
      const content = renderedContent(locale);
      const html = await renderHtml(content.body);
      const expiry = formatInstantDate({
        instant: Temporal.Instant.from(fixtureOfferExpiry),
        locale,
        timeZone: WORKSPACE_SITE_TIME_ZONE,
      });

      expect(content.subject).toBe(`${words.subject}Jana`);
      expect(content.preheader).toBe(words.preheader);
      expect(content.operationalReason).toBeUndefined();
      expect(textsOf(html, "h1")).toEqual([words.title]);
      // The inline value keeps its bold mark; the link and italic text keep theirs.
      expect(html).toContain("<strong>Jana</strong>");
      expect(html).toMatch(
        new RegExp(
          `<em><a[^>]*href="https://deskohub.cz/akce"[^>]*>${words.events}</a></em>`
        )
      );
      expect(html).toContain(`${new Intl.NumberFormat(locale).format(1234.5)}`);
      expect(html).toContain(m.emailContentYes({}, { locale }));
      // The ordered list starts at 2 and nests a bulleted list.
      expect(html).toMatch(/<ol[^>]*start="2"/);
      expect(textsOf(html, "p")).toEqual(
        expect.arrayContaining([...words.steps])
      );
      expect(html).toMatch(/<ol[\s\S]*<ul[\s\S]*<\/ul>[\s\S]*<\/ol>/);
      // The linked image keeps its alt text, width and alignment.
      expect(html).toMatch(
        new RegExp(
          `<a[^>]*href="https://deskohub.cz/zasedacka"[^>]*><img[^>]*alt="${words.alt}"[^>]*src="${cloudinaryImage}"[^>]*width="240"`
        )
      );
      expect(html).toMatch(/<td[^>]*align="left"/);
      // Record rows label each field.
      const cells = textsOf(html, "td");
      expect(cells).toEqual(
        expect.arrayContaining([words.contactName, "Jana Testová"])
      );
      // The record list keeps the component's sort and limit.
      const groupCells = cells.filter((cell) =>
        ["Students", "Members", "Friends"].includes(cell)
      );
      expect(groupCells).toEqual(["Members", "Students"]);
      // A scalar list is a bulleted list.
      expect(textsOf(html, "li")).toEqual(
        expect.arrayContaining(["quiet corner", "coffee"])
      );
      // The offer shows its code, its localized expiry and its button.
      expect(html).toContain("SAMPLE CODE");
      expect(html).toContain(
        m.emailContentOfferValidUntil({ date: expiry }, { locale })
      );
      expect(html).toContain(m.emailContentOfferCodeLabel({}, { locale }));
      expect(textsOf(html, "a")).toEqual(
        expect.arrayContaining([words.offer, words.button])
      );
      expect(html).toContain("<hr");
    }
  );

  test("words the operational reason with its values", () => {
    const document = Schema.decodeUnknownSync(EmailDocument)({
      ...Schema.encodeSync(EmailDocument)(emailDocumentFixture),
      purpose: "operational",
      translations: {
        "en-US": {
          ...emailDocumentFixture.translations["en-US"],
          operationalReason: [
            { _tag: "Text", text: "You booked as " },
            { _tag: "Value", name: "first_name", bold: true },
            { _tag: "Text", text: ". " },
          ],
        },
      },
    });

    expect(
      renderedContent("en-US", emailFixtureValues, document)
    ).toMatchObject({ operationalReason: "You booked as Jana." });
  });

  test("shows a fallback in place of the value or the whole component", async () => {
    const content = renderedContent("en-US", {
      ...emailFixtureValues,
      first_name: { _tag: "Fallback", text: "friend" },
      offer: { _tag: "Fallback", text: "Ask us about this month offer." },
    });
    const html = await renderHtml(content.body);

    expect(content.subject).toBe(`${emailFixtureWords["en-US"].subject}friend`);
    expect(html).toContain("<strong>friend</strong>");
    expect(textsOf(html, "p")).toContain("Ask us about this month offer.");
    expect(html).not.toContain("SAMPLE CODE");
    expect(html).not.toContain(
      m.emailContentOfferCodeLabel({}, { locale: "en-US" })
    );
  });

  describe("an old publication", () => {
    test("renders though today's catalogue has none of its retired fields", () => {
      // `tags`, `visits` and `member` are only in the frozen shapes.
      expect(Result.isSuccess(rendered("cs-CZ"))).toBe(true);
    });

    test("fails for a Workspace language it was never written in", () => {
      const document = Schema.decodeUnknownSync(EmailDocument)({
        ...Schema.encodeSync(EmailDocument)(emailDocumentFixture),
        translations: {
          "en-US":
            Schema.encodeSync(EmailDocument)(emailDocumentFixture).translations[
              "en-US"
            ],
        },
      });

      expect(
        Result.isSuccess(rendered("en-US", emailFixtureValues, document))
      ).toBe(true);
      expect(
        failureOf(rendered("cs-CZ", emailFixtureValues, document))
      ).toMatchObject({ _tag: "EmailLanguageMissing", locale: "cs-CZ" });
      expect(failureOf(rendered("de-DE"))).toMatchObject({
        _tag: "EmailLanguageMissing",
        locale: "de-DE",
      });
    });
  });

  test("renders a nullable or absent optional record field empty", async () => {
    for (const contact of [
      { displayName: "Jana Testová", email: null },
      { displayName: "Jana Testová" },
    ]) {
      const content = renderedContent("en-US", {
        ...emailFixtureValues,
        contact: { _tag: "Resolved", value: contact },
      });
      const cells = textsOf(await renderHtml(content.body), "td");

      expect(cells).toEqual(
        expect.arrayContaining([emailFixtureWords["en-US"].contactEmail, ""])
      );
    }
  });

  test("fails for a translation in a language the Workspace doesn't offer", () => {
    const encoded = Schema.encodeSync(EmailDocument)(emailDocumentFixture);
    const document = Schema.decodeUnknownSync(EmailDocument)({
      ...encoded,
      translations: {
        ...encoded.translations,
        "de-DE": encoded.translations["en-US"],
      },
    });

    expect(
      failureOf(rendered("de-DE", emailFixtureValues, document))
    ).toMatchObject({
      _tag: "EmailLanguageMissing",
      locale: "de-DE",
    });
  });

  test("fails for a shown value without a snapshot", () => {
    const { contact: _contact, ...values } = emailFixtureValues;

    expect(failureOf(rendered("en-US", values))).toMatchObject({
      _tag: "EmailValueMissing",
      name: "contact",
    });
  });

  test.each([
    ["a record that isn't one", "contact", "Jana"],
    ["a record field that isn't a scalar", "contact", { displayName: [1] }],
    ["a list that isn't one", "groups", { name: "Students" }],
    ["a list item that isn't a record", "groups", ["Students"]],
    ["a scalar list item that isn't a scalar", "tags", [["coffee"]]],
    ["a sort key that isn't a scalar", "groups", [{ basisPoints: [1] }]],
    ["a scalar that is a record", "first_name", { name: "Jana" }],
    ["a scalar of another type than publication froze", "first_name", 42],
    ["a record without a required field", "contact", { email: null }],
    [
      "a record with a field publication didn't select",
      "contact",
      { displayName: "Jana", phone: "1" },
    ],
    ["a discount without a code", "offer", { expiresAt: fixtureOfferExpiry }],
    [
      "a discount with an invalid expiry",
      "offer",
      { code: "A", expiresAt: "soon" },
    ],
  ])("fails for %s", (_, name, value) => {
    expect(
      failureOf(
        rendered("en-US", {
          ...emailFixtureValues,
          [name]: { _tag: "Resolved", value },
        })
      )
    ).toMatchObject({ _tag: "EmailValueMismatch", name });
  });
});

describe("rich text parity with campaign bodies", () => {
  test("renders the same body HTML as the campaign renderer, byte for byte", async () => {
    const content = renderedContent(
      "en-US",
      {
        first_name: { _tag: "Resolved", value: "Jana" },
      },
      richTextParityDocument
    );

    expect(await renderHtml(content.body)).toBe(
      await renderHtml(
        <CampaignBodyContent
          body={{ formatVersion: 1, doc: legacyRichTextBody }}
        />
      )
    );
  });
});
