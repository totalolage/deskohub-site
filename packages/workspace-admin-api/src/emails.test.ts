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
import { emailValueSnapshotForDefinition } from "./email-value-snapshot";
import {
  EmailDocument,
  EmailDraft,
  type EmailTranslation,
  EmailValueDefinition,
  emailDocumentForPublication,
  emailPublicationProblems,
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

  test("saves partially configured controls but blocks publishing empty body text", () => {
    const incomplete = {
      structure: [{ _tag: "Button", id: "cta" }],
      values: [{ name: "offer", source: { kind: "discount" } }],
    };
    expect(
      Schema.decodeUnknownSync(EmailDraft)(incomplete).structure
    ).toHaveLength(1);
    expect(() => publish(incomplete)).toThrow();
    expect(() =>
      publish({
        ...document,
        translations: {
          ...document.translations,
          "cs-CZ": { ...translation, texts: { body: [] } },
        },
      })
    ).toThrow();
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
      ["first", "second"].map((name) => Schema.decodeSync(EmailValueName)(name))
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
        "marketingConsent",
        "documentHash",
      ])
    ).toMatchObject({ kind: "scalar", type: "string", nullable: true });
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

describe("recipient snapshot contract", () => {
  test("refuses extra customer fields and top-level missing data before sealing", () => {
    const definition = Schema.decodeUnknownSync(EmailValueDefinition)({
      name: "consent",
      source: {
        kind: "customer",
        path: ["activity", "marketingConsent"],
        fields: [["documentHash"]],
      },
      fallback: { "cs-CZ": "Unknown" },
    });
    const decode = Schema.decodeUnknownSync(
      emailValueSnapshotForDefinition(definition, "cs-CZ")
    );
    expect(
      decode({ _tag: "Resolved", value: { documentHash: "synthetic" } })._tag
    ).toBe("Resolved");
    expect(() =>
      decode({
        _tag: "Resolved",
        value: { documentHash: "synthetic", locale: "cs-CZ" },
      })
    ).toThrow();
    expect(() => decode({ _tag: "Resolved", value: null })).toThrow();
    expect(() =>
      decode({ _tag: "Resolved", value: { documentHash: null } })
    ).toThrow();
    expect(decode({ _tag: "Fallback", text: "Unknown" })._tag).toBe("Fallback");
    expect(() => decode({ _tag: "Fallback", text: "Other" })).toThrow();
  });
  test("bounds lists and defaults discount values to recipient single-use", () => {
    const list = Schema.decodeUnknownSync(EmailValueDefinition)({
      name: "bookings",
      source: {
        kind: "customer",
        path: ["activity", "reservations"],
        fields: [["id"]],
        limit: 1,
      },
    });
    expect(() =>
      Schema.decodeUnknownSync(emailValueSnapshotForDefinition(list, "cs-CZ"))({
        _tag: "Resolved",
        value: [{ id: "one" }, { id: "two" }],
      })
    ).toThrow();
    const discount = Schema.decodeUnknownSync(EmailValueDefinition)({
      name: "offer",
      source: {
        kind: "discount",
        discountId: "01900000-0000-7000-8000-000000000001",
        validDays: 30,
      },
    });
    expect(discount.source).toMatchObject({
      maxUses: 1,
      maxUsesPerCustomer: 1,
    });
    expect(() =>
      Schema.decodeUnknownSync(
        emailValueSnapshotForDefinition(discount, "cs-CZ")
      )({ _tag: "Resolved", value: { code: "SAMPLE-NOT-REDEEMABLE" } })
    ).toThrow();
  });
});

test("publication freezes selected field types and rejects incompatible historical preparation", () => {
  const published = publish({
    ...document,
    values: [
      {
        name: "consent",
        source: {
          kind: "customer",
          path: ["activity", "marketingConsent"],
          fields: [["documentHash"]],
        },
      },
    ],
  });
  const definition = published.values[0];
  if (!definition) throw new Error("missing test definition");
  expect(definition.customerShape).toMatchObject({
    kind: "record",
    fields: {
      documentHash: { kind: "scalar", type: "string", nullable: false },
    },
  });
  const decode = Schema.decodeUnknownSync(
    emailValueSnapshotForDefinition(definition, "cs-CZ")
  );
  expect(
    decode({ _tag: "Resolved", value: { documentHash: "synthetic" } })._tag
  ).toBe("Resolved");
  expect(() =>
    decode({ _tag: "Resolved", value: { documentHash: null } })
  ).toThrow();
  const historical = {
    ...definition,
    customerShape: {
      kind: "record",
      nullable: true,
      optional: false,
      fields: {
        documentHash: {
          kind: "scalar",
          type: "number",
          nullable: false,
          optional: false,
        },
      },
    },
  } as const;
  expect(() =>
    Schema.decodeUnknownSync(
      emailValueSnapshotForDefinition(historical, "cs-CZ")
    )({ _tag: "Resolved", value: { documentHash: 5 } })
  ).toThrow();
  expect(() =>
    Schema.decodeUnknownSync(
      emailValueSnapshotForDefinition(
        { ...historical, fallback: { "cs-CZ": "Unknown" } },
        "cs-CZ"
      )
    )({ _tag: "Fallback", text: "Unknown" })
  ).toThrow();
});

test("typed list components select sorting and limits within the frozen source", () => {
  const values = [
    {
      name: "recent",
      source: {
        kind: "customer",
        path: ["activity", "reservations"],
        fields: [["id"]],
        limit: 3,
      },
    },
  ];
  const component = {
    _tag: "List",
    id: "recent",
    value: "recent",
    fields: [{ field: ["id"], labelKey: "body" }],
    sort: { path: ["id"], direction: "desc" },
    limit: 2,
  };
  expect(
    publish({ ...document, values, structure: [component] }).structure[0]?._tag
  ).toBe("List");
  expect(() =>
    publish({
      ...document,
      values,
      structure: [
        { ...component, sort: { path: ["createdAt"], direction: "desc" } },
      ],
    })
  ).toThrow();
  expect(() =>
    publish({ ...document, values, structure: [{ ...component, limit: 4 }] })
  ).toThrow();
});

test("unfinished inline values round-trip in drafts and cannot publish", () => {
  for (const part of [{ _tag: "Value" }, { _tag: "Value", name: "" }]) {
    const draft = { translations: { "cs-CZ": { subject: [part] } } };
    const saved = Schema.decodeUnknownSync(EmailDraft)(draft);
    expect(JSON.stringify(saved)).toBe(JSON.stringify(draft));
    expect(() =>
      publish({
        ...document,
        translations: {
          ...document.translations,
          "cs-CZ": { ...translation, subject: [part] },
        },
      })
    ).toThrow();
  }
});

describe("publication problems", () => {
  const locales = ["cs-CZ", "en-US"];
  const problems = (input: unknown, current: readonly string[] = locales) =>
    emailPublicationProblems(
      Schema.decodeUnknownSync(EmailDocument)(input),
      current
    );
  const bothLanguages = (overrides: object) => ({
    "cs-CZ": { ...translation, ...overrides },
    "en-US": { ...translation, ...overrides },
  });
  const email = {
    name: "email",
    source: { kind: "customer", path: ["profile", "customer", "email"] },
  };
  const customer = {
    name: "customer",
    source: {
      kind: "customer",
      path: ["profile", "customer"],
      fields: [["displayName"]],
    },
  };
  const reservations = {
    name: "reservations",
    source: {
      kind: "customer",
      path: ["activity", "reservations"],
      fields: [["id"], ["startsAt"]],
      limit: 3,
    },
  };
  const discount = {
    name: "discount",
    source: {
      kind: "discount",
      discountId: "01900000-0000-7000-8000-000000000001",
      validDays: 30,
    },
  };
  const value = (name: string, field?: readonly string[]) => ({
    _tag: "Value",
    name,
    ...(field && { field }),
  });
  const bodyField = (...field: string[]) => ({ field, labelKey: "body" });

  test("a complete document has none", () => {
    expect(problems(document)).toEqual([]);
  });

  test("reports duplicate names and ids, an empty body, and missing languages in that order", () => {
    expect(
      problems({ ...document, structure: [], values: [email, email] }, [
        "cs-CZ",
        "de-DE",
        "en-US",
        "sk-SK",
      ])
    ).toEqual([
      "Duplicate value names.",
      "Body is empty.",
      "Missing language: de-DE.",
      "Missing language: sk-SK.",
    ]);
    expect(
      problems({
        ...document,
        structure: [document.structure[0], document.structure[0]],
      })
    ).toEqual(["Duplicate component ids."]);
  });

  test("reports invalid customer selections, even unused ones", () => {
    expect(
      problems({
        ...document,
        values: [
          email,
          { name: "nowhere", source: { kind: "customer", path: ["nope"] } },
          { name: "bare", source: { kind: "customer", path: ["profile"] } },
        ],
      })
    ).toEqual([
      "Invalid customer selection: nowhere.",
      "Invalid customer selection: bare.",
    ]);
  });

  test("a subject needs a value or nonblank text", () => {
    expect(
      problems({
        ...document,
        values: [email],
        translations: {
          "cs-CZ": { ...translation, subject: [] },
          "en-US": {
            ...translation,
            subject: [
              { _tag: "Text", text: "  " },
              { _tag: "Text", text: "" },
            ],
          },
        },
      })
    ).toEqual(["Empty subject: cs-CZ.", "Empty subject: en-US."]);
    expect(
      problems({
        ...document,
        values: [email],
        translations: bothLanguages({ subject: [value("email")] }),
      })
    ).toEqual([]);
  });

  test("reports missing and empty texts per language and text key", () => {
    expect(
      problems({
        ...document,
        structure: [
          { _tag: "Paragraph", id: "body", textKey: "body" },
          { _tag: "Heading", id: "title", textKey: "title", level: 1 },
        ],
        values: [email],
        translations: {
          "cs-CZ": {
            ...translation,
            texts: { body: [{ _tag: "Text", text: " " }] },
          },
          "en-US": { ...translation, texts: { body: [value("email")] } },
        },
      })
    ).toEqual([
      "Empty text body: cs-CZ.",
      "Missing text title: cs-CZ.",
      "Empty text title: cs-CZ.",
      "Missing text title: en-US.",
      "Empty text title: en-US.",
    ]);
  });

  test("an image's alt text may be empty unless another component shares its key", () => {
    const image = {
      _tag: "Image",
      id: "image",
      src: "https://workspace.deskohub.test/image.png",
      altKey: "alt",
    };
    expect(
      problems({
        ...document,
        structure: [...document.structure, image],
        translations: {
          "cs-CZ": { ...translation, texts: { body: text, alt: [] } },
          "en-US": translation,
        },
      })
    ).toEqual(["Missing text alt: en-US."]);
    expect(
      problems({
        ...document,
        structure: [...document.structure, { ...image, altKey: "body" }],
        translations: bothLanguages({ texts: { body: [] } }),
      })
    ).toEqual([
      "Empty text body: cs-CZ.",
      "Empty text body: cs-CZ.",
      "Empty text body: en-US.",
      "Empty text body: en-US.",
    ]);
  });

  test("checks inline values in subject, preheader, reason, then texts", () => {
    expect(
      problems({
        ...document,
        translations: {
          "cs-CZ": {
            subject: [...text, value("subject")],
            preheader: [value("preheader")],
            operationalReason: [value("reason")],
            texts: { body: [value("body")] },
          },
          "en-US": translation,
        },
      })
    ).toEqual([
      "Invalid scalar value subject: cs-CZ.",
      "Invalid scalar value preheader: cs-CZ.",
      "Invalid scalar value reason: cs-CZ.",
      "Invalid scalar value body: cs-CZ.",
    ]);
  });

  test.each<[string, readonly string[] | undefined, boolean]>([
    ["discount", ["code"], true],
    ["discount", ["expiresAt"], true],
    ["discount", undefined, false],
    ["discount", ["validDays"], false],
    ["discount", ["code", "extra"], false],
    ["email", undefined, true],
    ["email", ["domain"], false],
    ["customer", undefined, false],
    ["customer", ["displayName"], true],
    ["customer", ["email"], false],
    ["customer", ["missing"], false],
    ["reservations", undefined, false],
    ["reservations", ["id"], false],
  ])("an inline %s value at %p is valid: %p", (name, field, valid) => {
    expect(
      problems({
        ...document,
        values: [email, customer, reservations, discount],
        translations: bothLanguages({ subject: [value(name, field)] }),
      })
    ).toEqual(
      valid
        ? []
        : [
            `Invalid scalar value ${name}: cs-CZ.`,
            `Invalid scalar value ${name}: en-US.`,
          ]
    );
  });

  test("matches each valued component to its value's source", () => {
    const offer = {
      _tag: "Offer",
      id: "offer",
      labelKey: "body",
      href: "https://workspace.deskohub.test/",
    };
    expect(
      problems({
        ...document,
        values: [email, customer, reservations, discount],
        structure: [
          { ...offer, id: "ghost", value: "ghost" },
          { ...offer, id: "offer-customer", value: "customer" },
          { ...offer, id: "offer-discount", value: "discount" },
          {
            _tag: "Record",
            id: "record-discount",
            value: "discount",
            fields: [bodyField("code")],
          },
          {
            _tag: "Record",
            id: "record-list",
            value: "reservations",
            fields: [bodyField("id")],
          },
          { _tag: "List", id: "list-record", value: "customer" },
          {
            _tag: "Record",
            id: "record-scalar",
            value: "email",
            fields: [bodyField("id")],
          },
          {
            _tag: "Record",
            id: "record",
            value: "customer",
            fields: [bodyField("displayName")],
          },
        ],
      })
    ).toEqual([
      "Unknown value: ghost.",
      "Offer requires a discount: customer.",
      "Structured component requires customer data: discount.",
      "Wrong component value shape: reservations.",
      "Wrong component value shape: customer.",
      "Wrong component value shape: email.",
    ]);
  });

  test("reports a valued component whose selection points nowhere as a wrong shape", () => {
    expect(
      problems({
        ...document,
        values: [
          { name: "nowhere", source: { kind: "customer", path: ["x"] } },
        ],
        structure: [
          ...document.structure,
          { _tag: "List", id: "list", value: "nowhere" },
        ],
      })
    ).toEqual([
      "Invalid customer selection: nowhere.",
      "Wrong component value shape: nowhere.",
    ]);
  });

  test("keeps list sorting, limits, and fields within the selected source", () => {
    const list = {
      _tag: "List",
      id: "list",
      value: "reservations",
      fields: [bodyField("id")],
    };
    const listProblems = (overrides: object) =>
      problems({
        ...document,
        values: [reservations],
        structure: [...document.structure, { ...list, ...overrides }],
      });

    expect(
      listProblems({ sort: { path: ["id"], direction: "asc" }, limit: 3 })
    ).toEqual([]);
    expect(
      listProblems({ sort: { path: ["status"], direction: "asc" } })
    ).toEqual(["Unselected list sort field: reservations."]);
    expect(
      listProblems({ sort: { path: ["createdAt"], direction: "asc" } })
    ).toEqual(["Unselected list sort field: reservations."]);
    expect(listProblems({ limit: 4 })).toEqual([
      "List component limit exceeds selected source: reservations.",
    ]);
    const { fields: _, ...fieldless } = list;
    expect(
      problems({
        ...document,
        values: [reservations],
        structure: [...document.structure, fieldless],
      })
    ).toEqual(["Record fields required: reservations."]);
    expect(
      listProblems({
        sort: { path: ["missing"], direction: "desc" },
        limit: 9,
        fields: [bodyField("id"), bodyField("createdAt")],
      })
    ).toEqual([
      "Unselected list sort field: reservations.",
      "List component limit exceeds selected source: reservations.",
      "Unselected component field: reservations.",
    ]);
    expect(listProblems({ fields: [bodyField("status")] })).toEqual([
      "Unselected component field: reservations.",
    ]);
  });

  test("an unbounded source accepts any list limit", () => {
    const { limit: _, ...unbounded } = reservations.source;
    expect(
      problems({
        ...document,
        values: [{ ...reservations, source: unbounded }],
        structure: [
          ...document.structure,
          {
            _tag: "List",
            id: "list",
            value: "reservations",
            fields: [bodyField("id")],
            limit: 50,
          },
        ],
      })
    ).toEqual([]);
  });

  test("record components need selected scalar fields", () => {
    const record = { _tag: "Record", id: "record", value: "customer" };
    const recordProblems = (fields: readonly object[]) =>
      problems({
        ...document,
        values: [customer],
        structure: [...document.structure, { ...record, fields }],
      });

    expect(recordProblems([bodyField("displayName")])).toEqual([]);
    expect(recordProblems([bodyField("email")])).toEqual([
      "Unselected component field: customer.",
    ]);
  });
});
