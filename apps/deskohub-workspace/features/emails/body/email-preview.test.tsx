import "@/shared/testing/workspace-test-env";

import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { EmailDocument, type EmailDraft } from "@deskohub/workspace-admin-api";
import { Effect, Layer, Result, Schema } from "effect";
import { renderCampaignEmailPreview } from "@/features/email-campaigns/campaign-email";
import { CustomerValues } from "@/features/emails/values/customer";
import {
  EmailDiscountValues,
  emailDiscountSampleCode,
} from "@/features/emails/values/discount";
import { renderEmailContent } from "./email-content";
import {
  cloudinaryImage,
  emailDocumentFixture,
  legacyRichTextBody,
  richTextParityDocument,
} from "./email-document.test-utils";
import { renderEmailPreview } from "./email-preview";
import { previewEmailDocument } from "./email-preview-document";
import { sampleEmailValues } from "./email-sample-values";

const now = Temporal.Instant.from("2026-11-04T09:00:00Z");
type DraftComponent = NonNullable<
  (typeof EmailDraft.Encoded)["structure"]
>[number];

describe("renderEmailPreview", () => {
  test.each([
    ["marketing", undefined],
    ["operational", "You use the Workspace."],
  ] as const)(
    "renders a %s email exactly as the campaign preview does",
    async (purpose, operationalReason) => {
      const document = Schema.decodeUnknownSync(EmailDocument)({
        ...Schema.encodeSync(EmailDocument)(richTextParityDocument),
        purpose,
        translations: {
          "en-US": {
            ...Schema.encodeSync(EmailDocument)(richTextParityDocument)
              .translations["en-US"],
            ...(operationalReason && {
              operationalReason: [{ _tag: "Text", text: operationalReason }],
            }),
          },
        },
      });
      const preview = await Effect.runPromise(
        renderEmailPreview({
          document,
          locale: "en-US",
          values: { first_name: { _tag: "Resolved", value: "Jana" } },
        })
      );
      const legacy = await Effect.runPromise(
        renderCampaignEmailPreview({
          templateKey: "workspace",
          purpose,
          locale: "en-US",
          content: {
            subject: "Subject",
            preheader: "Preheader",
            body: { formatVersion: 1, doc: legacyRichTextBody },
            ...(operationalReason && { operationalReason }),
          },
        })
      );

      expect(preview).toEqual(legacy);
    }
  );

  test("fails with the render failure", async () => {
    const failure = await Effect.runPromise(
      Effect.flip(
        renderEmailPreview({
          document: emailDocumentFixture,
          locale: "en-US",
          values: {},
        })
      )
    );

    expect(failure).toMatchObject({ _tag: "EmailValueMissing" });
  });
});

describe("rendering with sample values", () => {
  const providerCalls = mock((provider: string) => provider);
  const fetchCalls = mock(() => Promise.reject(new Error("No network.")));
  const originalFetch = globalThis.fetch;
  const refused = (provider: string) => () => {
    providerCalls(provider);
    return Effect.die(`${provider} must not be called by a preview.`);
  };
  // Every provider a real delivery reads values from, refusing any call.
  const providers = Layer.mergeAll(
    Layer.succeed(CustomerValues, { resolve: refused("customer") }),
    Layer.succeed(EmailDiscountValues, {
      issue: refused("issue"),
      recover: refused("recover"),
      disableUnsent: refused("disable"),
    })
  );

  beforeEach(() => {
    providerCalls.mockClear();
    fetchCalls.mockClear();
    globalThis.fetch = Object.assign(fetchCalls, {
      preconnect: originalFetch.preconnect,
    });
  });
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  test("renders every language without reaching a customer or discount provider", async () => {
    for (const locale of ["en-US", "cs-CZ"] as const) {
      const preview = await Effect.runPromise(
        renderEmailPreview({
          document: emailDocumentFixture,
          locale,
          values: sampleEmailValues(emailDocumentFixture, locale, now),
        }).pipe(Effect.provide(providers))
      );

      expect(preview.html).toContain(emailDiscountSampleCode);
    }
    expect(providerCalls).not.toHaveBeenCalled();
    expect(fetchCalls).not.toHaveBeenCalled();
  });

  test("samples each shown value from its shape", () => {
    const samples = sampleEmailValues(emailDocumentFixture, "en-US", now);

    expect(Object.keys(samples).toSorted()).toEqual(
      emailDocumentFixture.values.map(({ name }) => name).toSorted()
    );
    expect(samples).toMatchObject({
      first_name: { _tag: "Resolved", value: "[displayName]" },
      contact: {
        _tag: "Resolved",
        value: { displayName: "[displayName]", email: "[email]" },
      },
      offer: {
        _tag: "Resolved",
        value: {
          code: emailDiscountSampleCode,
          expiresAt: now.add({ hours: 24 * 14 }).toString(),
        },
      },
    });
    expect(
      Result.isSuccess(
        renderEmailContent({
          document: emailDocumentFixture,
          locale: "en-US",
          values: samples,
        })
      )
    ).toBe(true);
  });
});

describe("previewEmailDocument", () => {
  const draft = {
    purpose: "marketing",
    structure: [
      { _tag: "Heading", id: "title", textKey: "title", level: 1 },
      // Unfinished: no text yet.
      { _tag: "Paragraph", id: "empty" },
      {
        _tag: "Paragraph",
        id: "intro",
        textKey: "intro",
        links: { site: "https://deskohub.cz", draft: "deskohub" },
      },
      // Names a value the draft no longer defines.
      { _tag: "Record", id: "gone", value: "removed", fields: [] },
      {
        _tag: "Record",
        id: "contact",
        value: "contact",
        fields: [
          { field: ["displayName"], labelKey: "contact_name" },
          { field: ["unknown"], labelKey: "contact_unknown" },
          { labelKey: "contact_unfinished" },
        ],
      },
      {
        _tag: "TextList",
        id: "list",
        items: [{ textKey: "item" }, {}],
      },
      {
        _tag: "Image",
        id: "image",
        src: cloudinaryImage,
        altKey: "alt",
        href: "nowhere",
      },
      { _tag: "Button", id: "button", labelKey: "button" },
      {
        _tag: "Offer",
        id: "offer",
        value: "contact",
        labelKey: "offer",
        href: "https://deskohub.cz",
      },
    ],
    translations: {
      "en-US": {
        subject: [
          { _tag: "Text", text: "Hello " },
          { _tag: "Value", name: "first_name" },
          { _tag: "Value", name: "removed" },
          { _tag: "Value" },
        ],
        texts: {
          title: [{ _tag: "Text", text: "News" }],
          intro: [
            { _tag: "Text", text: "Visit us", link: "site" },
            { _tag: "Text" },
          ],
          item: [{ _tag: "Text", text: "One" }],
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
      },
      {
        name: "contact",
        source: {
          kind: "customer",
          path: ["profile", "customer"],
          fields: [["displayName"]],
        },
      },
      // Unfinished: no discount chosen yet.
      { name: "offer", source: { kind: "discount", validDays: 7 } },
    ],
  } satisfies typeof EmailDraft.Encoded;

  test("keeps what is finished and drops the rest", () => {
    const document = previewEmailDocument(draft, "en-US");

    expect(document.structure.map(({ id }) => id)).toEqual([
      "title",
      "intro",
      "contact",
      "list",
      "image",
    ]);
    expect(document.values.map(({ name }) => name)).toEqual([
      "first_name",
      "contact",
    ]);
    expect(document.structure).toContainEqual(
      expect.objectContaining({
        id: "intro",
        links: { site: "https://deskohub.cz" },
      })
    );
    expect(document.structure).toContainEqual(
      expect.objectContaining({
        id: "contact",
        fields: [{ field: ["displayName"], labelKey: "contact_name" }],
      })
    );
    expect(document.structure).toContainEqual(
      expect.not.objectContaining({ id: "image", href: expect.anything() })
    );
    expect(document.translations["en-US"]?.subject).toEqual([
      { _tag: "Text", text: "Hello " },
      { _tag: "Value", name: "first_name" },
    ]);
  });

  test("drops a record list without a field it can show and an unusable sort", () => {
    const groups = {
      name: "groups",
      source: {
        kind: "customer",
        path: ["profile", "discountGroups"],
        fields: [["name"]],
      },
    } as const;
    const list = (
      id: string,
      extra: Pick<DraftComponent, "fields" | "sort">
    ): DraftComponent => ({
      _tag: "List" as const,
      id,
      value: "groups",
      ...extra,
    });
    const document = previewEmailDocument(
      {
        structure: [
          list("unfinished", { fields: [{ labelKey: "label" }] }),
          list("absent", {
            fields: [{ field: ["unknown"], labelKey: "label" }],
          }),
          list("whole-record-sort", {
            fields: [{ field: ["name"], labelKey: "label" }],
            sort: { path: [], direction: "asc" },
          }),
          list("named-sort", {
            fields: [{ field: ["name"], labelKey: "label" }],
            sort: { path: ["name"], direction: "desc" },
          }),
        ],
        values: [groups],
      },
      "en-US"
    );

    expect(document.structure).toEqual([
      expect.objectContaining({ id: "whole-record-sort" }),
      expect.objectContaining({
        id: "named-sort",
        sort: { path: ["name"], direction: "desc" },
      }),
    ]);
    expect(document.structure[0]).not.toHaveProperty("sort");
    expect(
      Result.isSuccess(
        renderEmailContent({
          document,
          locale: "en-US",
          values: sampleEmailValues(document, "en-US", now),
        })
      )
    ).toBe(true);
  });

  test.each(["en-US", "cs-CZ"] as const)(
    "renders the draft in %s with sample values, missing texts empty",
    (locale) => {
      const document = previewEmailDocument(draft, locale);
      const content = renderEmailContent({
        document,
        locale,
        values: sampleEmailValues(document, locale, now),
      });

      expect(Result.isSuccess(content)).toBe(true);
    }
  );

  test("keeps a discount reference only to its code or expiry", () => {
    const offer = (field?: readonly string[]) => ({
      _tag: "Value" as const,
      name: "offer",
      ...(field && { field: [...field] }),
    });
    const document = previewEmailDocument(
      {
        translations: {
          "en-US": {
            subject: [
              offer(["code"]),
              offer(["expiresAt"]),
              offer(),
              offer(["percent"]),
              offer(["code", "expiresAt"]),
            ],
          },
        },
        values: [
          {
            name: "offer",
            source: {
              kind: "discount",
              discountId: "11111111-1111-4111-8111-111111111111",
              validDays: 14,
            },
          },
        ],
      },
      "en-US"
    );

    expect(document.translations["en-US"]?.subject).toEqual([
      offer(["code"]),
      offer(["expiresAt"]),
    ]);
  });

  test("keeps the first finished of repeated value names and component ids", () => {
    const displayName = {
      kind: "customer",
      path: ["profile", "customer", "displayName"],
    } as const;
    const document = previewEmailDocument(
      {
        structure: [
          // Unfinished: no text yet.
          { _tag: "Paragraph", id: "rule" },
          { _tag: "Divider", id: "rule" },
          { _tag: "Spacer", id: "gap" },
          { _tag: "Spacer", id: "rule" },
          { _tag: "Divider", id: "gap" },
        ],
        values: [
          // Unfinished: no discount chosen yet.
          { name: "first_name", source: { kind: "discount", validDays: 7 } },
          { name: "first_name", source: displayName },
          { name: "contact", source: displayName },
          {
            name: "first_name",
            source: { kind: "customer", path: ["profile", "customer"] },
          },
        ],
      },
      "en-US"
    );

    expect(document.structure).toEqual([
      expect.objectContaining({ _tag: "Divider", id: "rule" }),
      expect.objectContaining({ _tag: "Spacer", id: "gap" }),
    ]);
    expect(document.values).toEqual([
      { name: "first_name", source: displayName },
      { name: "contact", source: displayName },
    ]);
  });

  test("keeps an operational reason's finished parts", () => {
    const document = previewEmailDocument(
      {
        purpose: "operational",
        translations: {
          "cs-CZ": {
            operationalReason: [
              { _tag: "Text", text: "Máte rezervaci" },
              { _tag: "Value", name: "removed" },
            ],
          },
        },
      },
      "cs-CZ"
    );

    expect(document.translations["cs-CZ"]?.operationalReason).toEqual([
      { _tag: "Text", text: "Máte rezervaci" },
    ]);
    expect(
      previewEmailDocument({ translations: { "cs-CZ": {} } }, "cs-CZ")
        .translations["cs-CZ"]
    ).not.toHaveProperty("operationalReason");
  });

  test("renders an empty draft", () => {
    const document = previewEmailDocument({}, "en-US");

    expect(
      renderEmailContent({ document, locale: "en-US", values: {} })
    ).toMatchObject({ success: { subject: "", preheader: "" } });
  });
});
