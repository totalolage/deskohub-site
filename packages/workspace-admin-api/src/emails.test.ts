import { describe, expect, test } from "bun:test";
import { Effect, JsonSchema, Schema } from "effect";
import {
  type EmailCustomerField,
  EmailCustomerSelection,
  EmailCustomerSelectionInvalid,
  emailCustomerFieldAtPath,
  emailCustomerFieldCatalogue,
  validateEmailCustomerSelection,
} from "./email-customer-selection";
import { EmailValueName } from "./email-identifiers";
import {
  EmailDocumentForPublication,
  requiredEmailValueNames,
} from "./email-publication";
import { emailValueSnapshotForDefinition } from "./email-value-snapshot";
import {
  EmailDocument,
  EmailDraft,
  type EmailTranslation,
  EmailValueDefinition,
} from "./emails";
import { AdministrationCustomerDetail } from "./workspace-admin-api";

interface CustomerContractNode {
  readonly $ref?: string;
  readonly type?: string | readonly string[];
  readonly properties?: Readonly<Record<string, CustomerContractNode>>;
  readonly items?: CustomerContractNode;
  readonly anyOf?: readonly CustomerContractNode[];
  readonly oneOf?: readonly CustomerContractNode[];
  readonly allOf?: readonly CustomerContractNode[];
}

const customerContractNode: Schema.Codec<CustomerContractNode> = Schema.suspend(
  () =>
    Schema.Struct({
      $ref: Schema.optionalKey(Schema.String),
      type: Schema.optionalKey(
        Schema.Union([Schema.String, Schema.Array(Schema.String)])
      ),
      properties: Schema.optionalKey(
        Schema.Record(Schema.String, customerContractNode)
      ),
      items: Schema.optionalKey(customerContractNode),
      anyOf: Schema.optionalKey(Schema.Array(customerContractNode)),
      oneOf: Schema.optionalKey(Schema.Array(customerContractNode)),
      allOf: Schema.optionalKey(Schema.Array(customerContractNode)),
    })
);

type CustomerFieldPath = readonly (string | 0)[];
const fieldPath = (path: CustomerFieldPath, kind: string) =>
  JSON.stringify([path, kind]);

// Use JSON Schema rather than the catalogue's AST walker as the coverage oracle.
function customerContractPaths(schema: Schema.Top): Set<string> {
  const document = Schema.toJsonSchemaDocument(Schema.toType(schema));
  const paths = new Set<string>();
  function visit(
    node: CustomerContractNode,
    path: CustomerFieldPath,
    constraintOnly = false
  ): void {
    if (node.$ref) {
      const referenced = JsonSchema.resolve$ref(
        node.$ref,
        document.definitions
      );
      if (!referenced)
        throw new Error(`Unresolved customer reference ${node.$ref}`);
      visit(Schema.decodeUnknownSync(customerContractNode)(referenced), path);
    }
    for (const branch of [...(node.anyOf ?? []), ...(node.oneOf ?? [])])
      visit(branch, path);
    for (const branch of node.allOf ?? []) visit(branch, path, true);
    for (const type of typeof node.type === "string"
      ? [node.type]
      : (node.type ?? [])) {
      switch (type) {
        case "null":
          break;
        case "string":
        case "number":
        case "integer":
        case "boolean":
          paths.add(fieldPath(path, "scalar"));
          break;
        case "object":
          if (!node.properties) throw new Error("Unbounded customer record");
          paths.add(fieldPath(path, "record"));
          break;
        case "array":
          if (!node.items) throw new Error("Customer list without an element");
          paths.add(fieldPath(path, "list"));
          break;
        default:
          throw new Error(`Unsupported customer JSON Schema type ${type}`);
      }
    }
    for (const [name, child] of Object.entries(node.properties ?? {}))
      visit(child, [...path, name]);
    if (node.items) visit(node.items, [...path, 0]);
    if (
      !node.type &&
      !node.$ref &&
      !node.anyOf &&
      !node.oneOf &&
      !node.allOf &&
      !constraintOnly
    )
      throw new Error(
        `Unrecognized customer schema at ${JSON.stringify(path)}`
      );
  }
  visit(Schema.decodeUnknownSync(customerContractNode)(document.schema), []);
  return paths;
}

function customerCataloguePaths(
  field: EmailCustomerField,
  path: CustomerFieldPath = []
): string[] {
  switch (field.kind) {
    case "scalar":
      return [fieldPath(path, "scalar")];
    case "record":
      return [
        fieldPath(path, "record"),
        ...Object.entries(field.fields).flatMap(([name, child]) =>
          customerCataloguePaths(child, [...path, name])
        ),
      ];
    case "list":
      return [
        fieldPath(path, "list"),
        ...customerCataloguePaths(field.element, [...path, 0]),
      ];
    case "union":
      return field.alternatives.flatMap((child) =>
        customerCataloguePaths(child, path)
      );
    case "unsupported":
      return [];
  }
}

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
const publish = Schema.decodeUnknownSync(EmailDocumentForPublication);

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

  test("Czech is required only at publication, not historical decoding", () => {
    const englishOnly = { ...document, translations: { "en-US": translation } };
    expect(() => publish(englishOnly)).toThrow();
    expect(
      publish({ ...document, translations: { "cs-CZ": translation } })
    ).toEqual({ ...document, translations: { "cs-CZ": translation } });
    expect(Schema.decodeUnknownSync(EmailDocument)(englishOnly)).toEqual(
      englishOnly
    );
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
    // A repeated name a text uses is ambiguous; repeated unused ones drop.
    expect(() =>
      publish({
        ...document,
        values: [value, value],
        structure: [
          ...document.structure,
          {
            _tag: "List",
            id: "visits",
            value: "visits",
            fields: [{ field: ["id"], labelKey: "body" }],
          },
        ],
      })
    ).toThrow();
    expect(
      publish({ ...document, values: [value, value] }).values
    ).toHaveLength(1);
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
  test("covers every declared customer field and list element", () => {
    expect(
      new Set(customerCataloguePaths(emailCustomerFieldCatalogue))
    ).toEqual(customerContractPaths(AdministrationCustomerDetail));
  });

  test("coverage detects removed fields and newly declared list fields", () => {
    if (emailCustomerFieldCatalogue.kind !== "record")
      throw new Error("Customer detail must be a record");
    const { profile: omitted, ...fields } = emailCustomerFieldCatalogue.fields;
    expect(omitted).toBeDefined();
    expect(
      new Set(
        customerCataloguePaths({ ...emailCustomerFieldCatalogue, fields })
      )
    ).not.toEqual(customerContractPaths(AdministrationCustomerDetail));
    const extended = Schema.Struct({
      ...AdministrationCustomerDetail.fields,
      futureHistory: Schema.Array(
        Schema.Struct({ futureField: Schema.String })
      ),
    });
    expect(
      new Set(customerCataloguePaths(emailCustomerFieldCatalogue))
    ).not.toEqual(customerContractPaths(extended));
    expect(customerContractPaths(extended)).toContain(
      fieldPath(["futureHistory", 0, "futureField"], "scalar")
    );
  });

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

test("publication freezes source sorting separately from projected customer fields", () => {
  const published = publish({
    ...document,
    values: [
      {
        name: "codes",
        source: {
          kind: "customer",
          path: ["profile", "codes"],
          fields: [["code"]],
          sort: { path: ["createdAt"], direction: "desc" },
          limit: 2,
        },
      },
    ],
  });
  expect(published.values[0]?.customerSortShape).toEqual({
    kind: "scalar",
    type: "string",
    nullable: false,
    optional: false,
  });
  expect(published.values[0]?.customerShape).toMatchObject({
    kind: "list",
    element: { kind: "record", fields: { code: { type: "string" } } },
  });
  expect(
    Object.keys(
      published.values[0]?.customerShape?.kind === "list" &&
        published.values[0].customerShape.element.kind === "record"
        ? published.values[0].customerShape.element.fields
        : {}
    )
  ).toEqual(["code"]);
  const historical = Schema.decodeUnknownSync(EmailValueDefinition)({
    name: "legacy_sort",
    source: {
      kind: "customer",
      path: ["profile", "codes"],
      fields: [["code"]],
      sort: { path: ["createdAt"], direction: "desc" },
    },
  });
  expect(historical.customerSortShape).toBeUndefined();
});
