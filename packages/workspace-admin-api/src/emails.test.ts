import { describe, expect, test } from "bun:test";
import { Effect, Schema } from "effect";
import {
  EmailCustomerSelection,
  EmailCustomerSelectionInvalid,
  emailCustomerFieldAtPath,
  emailCustomerFieldCatalogue,
  validateEmailCustomerSelection,
} from "./email-customer-selection";
import { EmailValueName } from "./email-identifiers";
import {
  EmailDocument,
  EmailDraft,
  type EmailTranslation,
  emailDocumentForPublication,
  requiredEmailValueNames,
} from "./emails";

const text = [{ _tag: "Text", text: "Hello" }] as const;
const translation: EmailTranslation = {
  subject: text,
  preheader: [],
  texts: { body: text },
};
const document: EmailDocument = {
  purpose: "marketing",
  templateKey: "workspace",
  structure: [{ _tag: "Paragraph", id: "body", textKey: "body" }],
  translations: { "cs-CZ": translation, "en-US": translation },
  values: [],
};
const publish = Schema.decodeUnknownSync(
  emailDocumentForPublication(["cs-CZ", "en-US"])
);

function selection(input: unknown) {
  return Schema.decodeUnknownSync(EmailCustomerSelection)(input);
}

describe("reusable email publication", () => {
  test("saves an incomplete draft without pretending it is publishable", () => {
    expect(
      Schema.decodeUnknownSync(EmailDraft)({
        translations: { "cs-CZ": { subject: [] } },
      })
    ).toEqual({ translations: { "cs-CZ": { subject: [] } } });
    expect(() => publish({})).toThrow();
    expect(publish(document)).toEqual(document);
  });

  test("current languages are required only at publication, not historical decoding", () => {
    expect(() =>
      publish({ ...document, translations: { "cs-CZ": translation } })
    ).toThrow();
    expect(() =>
      Schema.decodeUnknownSync(
        emailDocumentForPublication(["cs-CZ", "en-US", "de-DE"])
      )(document)
    ).toThrow();
    expect(Schema.decodeUnknownSync(EmailDocument)(document)).toEqual(document);
  });

  test("blocks removed values, missing texts, duplicate definitions and wrong shapes", () => {
    const reference = { _tag: "Value", name: "visits" };
    expect(() =>
      publish({
        ...document,
        translations: {
          ...document.translations,
          "en-US": { ...translation, subject: [reference] },
        },
      })
    ).toThrow();
    expect(() =>
      publish({
        ...document,
        structure: [{ _tag: "Paragraph", id: "body", textKey: "missing" }],
      })
    ).toThrow();
    const value = {
      name: "visits",
      source: {
        kind: "customer",
        path: ["activity", "reservations"],
        fields: [["id"]],
      },
    };
    expect(() => publish({ ...document, values: [value, value] })).toThrow();
    expect(() =>
      publish({
        ...document,
        values: [value],
        translations: {
          ...document.translations,
          "en-US": { ...translation, subject: [reference] },
        },
      })
    ).toThrow();
  });

  test("references across all languages generate in configured order and omit unused definitions", () => {
    const values = ["first", "unused", "second"].map((name) => ({
      name,
      source: {
        kind: "customer",
        path: ["activity", "reservationHistoryTruncated"],
      },
    }));
    const result = publish({
      ...document,
      values,
      translations: {
        ...document.translations,
        "cs-CZ": {
          ...translation,
          subject: [{ _tag: "Value", name: "second" }],
        },
        "en-US": {
          ...translation,
          preheader: [{ _tag: "Value", name: "first" }],
        },
      },
    });
    expect(requiredEmailValueNames(result)).toEqual(
      ["first", "second"].map(Schema.decodeSync(EmailValueName))
    );
  });

  test("discount exposes code and expiry scalars, while offer keeps shared destination", () => {
    const values = [
      {
        name: "offer",
        source: {
          kind: "discount",
          discountId: "01900000-0000-7000-8000-000000000001",
          validDays: 30,
          maxUses: 1,
          maxUsesPerCustomer: 1,
        },
      },
    ];
    const result = publish({
      ...document,
      values,
      structure: [
        {
          _tag: "Offer",
          id: "offer",
          value: "offer",
          labelKey: "body",
          href: "https://workspace.deskohub.test/",
        },
      ],
      translations: {
        ...document.translations,
        "cs-CZ": {
          ...translation,
          subject: [{ _tag: "Value", name: "offer", field: ["code"] }],
          preheader: [{ _tag: "Value", name: "offer", field: ["expiresAt"] }],
        },
      },
    });
    expect(requiredEmailValueNames(result)).toEqual([
      Schema.decodeSync(EmailValueName)("offer"),
    ]);
    expect(() =>
      publish({
        ...result,
        translations: {
          "cs-CZ": {
            ...translation,
            subject: [{ _tag: "Value", name: "offer" }],
          },
          "en-US": translation,
        },
      })
    ).toThrow();
  });
});

describe("administration-schema customer selections", () => {
  test("keeps scalar types, nullable and optional flags from the declared schema", () => {
    expect(
      emailCustomerFieldAtPath(emailCustomerFieldCatalogue, [
        "activity",
        "reservationHistoryTruncated",
      ])
    ).toMatchObject({
      kind: "scalar",
      type: "boolean",
      nullable: false,
      optional: false,
    });
    expect(
      emailCustomerFieldAtPath(emailCustomerFieldCatalogue, [
        "activity",
        "marketingConsent",
      ])
    ).toMatchObject({ kind: "record", nullable: true, optional: false });
    expect(
      emailCustomerFieldAtPath(emailCustomerFieldCatalogue, [
        "activity",
        "stats",
        "favoriteReservationProduct",
      ])
    ).toBeUndefined();
  });

  test("rejects implicit list flattening, indexes, missing container fields and shape-invalid options", async () => {
    for (const input of [
      { path: ["activity", "reservations", "id"] },
      { path: ["activity", "reservations", "0"] },
      { path: ["activity", "reservations"] },
      { path: ["activity", "reservationHistoryTruncated"], limit: 2 },
      { path: ["activity", "reservations"], fields: [["nonexistent"]] },
    ]) {
      const result = await Effect.runPromise(
        Effect.flip(
          validateEmailCustomerSelection(
            selection({ kind: "customer", ...input })
          )
        )
      );
      expect(result).toBeInstanceOf(EmailCustomerSelectionInvalid);
    }
  });

  test("permits explicitly selected scalar record fields and list bounds", async () => {
    const result = await Effect.runPromise(
      validateEmailCustomerSelection(
        selection({
          kind: "customer",
          path: ["activity", "marketingConsent"],
          fields: [["documentHash"]],
        })
      )
    );
    expect(result.kind).toBe("record");
    const list = await Effect.runPromise(
      validateEmailCustomerSelection(
        selection({
          kind: "customer",
          path: ["activity", "reservations"],
          fields: [["id"]],
          sort: { path: ["id"], direction: "asc" },
          limit: 2,
        })
      )
    );
    expect(list.kind).toBe("list");
  });
});
