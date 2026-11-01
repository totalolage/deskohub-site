import { Effect, Schema, SchemaAST } from "effect";
import { AdministrationCustomerDetail } from "./workspace-admin-api";

const fieldPath = Schema.Array(Schema.NonEmptyString).check(
  Schema.isMinLength(1)
);

/** Historical selections decode independently of today's catalogue. */
export const EmailCustomerSelection = Schema.Struct({
  kind: Schema.Literal("customer"),
  path: fieldPath,
  fields: Schema.optionalKey(
    Schema.Array(fieldPath).check(Schema.isMinLength(1))
  ),
  sort: Schema.optionalKey(
    Schema.Struct({
      path: fieldPath,
      direction: Schema.Literals(["asc", "desc"]),
    })
  ),
  limit: Schema.optionalKey(Schema.Int.check(Schema.isGreaterThan(0))),
});
export type EmailCustomerSelection = typeof EmailCustomerSelection.Type;

type Presence = { readonly nullable: boolean; readonly optional: boolean };
export type EmailCustomerField = Presence &
  (
    | {
        readonly kind: "scalar";
        readonly type: "string" | "number" | "boolean";
        readonly choices?: readonly (string | number | boolean)[];
      }
    | {
        readonly kind: "record";
        readonly fields: Readonly<Record<string, EmailCustomerField>>;
      }
    | { readonly kind: "list"; readonly element: EmailCustomerField }
    | {
        readonly kind: "union";
        readonly alternatives: readonly EmailCustomerField[];
      }
    | { readonly kind: "unsupported" }
  );

export const EmailCustomerField: Schema.Codec<EmailCustomerField> =
  Schema.Union([
    Schema.Struct({
      kind: Schema.Literal("scalar"),
      type: Schema.Literals(["string", "number", "boolean"]),
      choices: Schema.optionalKey(
        Schema.Array(
          Schema.Union([Schema.String, Schema.Finite, Schema.Boolean])
        )
      ),
      nullable: Schema.Boolean,
      optional: Schema.Boolean,
    }),
    Schema.Struct({
      kind: Schema.Literal("record"),
      fields: Schema.Record(
        Schema.String,
        Schema.suspend(() => EmailCustomerField)
      ),
      nullable: Schema.Boolean,
      optional: Schema.Boolean,
    }),
    Schema.Struct({
      kind: Schema.Literal("list"),
      element: Schema.suspend(() => EmailCustomerField),
      nullable: Schema.Boolean,
      optional: Schema.Boolean,
    }),
    Schema.Struct({
      kind: Schema.Literal("union"),
      alternatives: Schema.Array(Schema.suspend(() => EmailCustomerField)),
      nullable: Schema.Boolean,
      optional: Schema.Boolean,
    }),
    Schema.Struct({
      kind: Schema.Literal("unsupported"),
      nullable: Schema.Boolean,
      optional: Schema.Boolean,
    }),
  ]);

/** Only schema-declared fields can be selected, including explicit internal fields. */
export const emailCustomerFieldCatalogue: EmailCustomerField = describeField(
  AdministrationCustomerDetail.ast
);

export class EmailCustomerSelectionInvalid extends Schema.TaggedErrorClass<EmailCustomerSelectionInvalid>()(
  "EmailCustomerSelectionInvalid",
  {
    path: Schema.Array(Schema.String),
    reason: Schema.Literals([
      "unknown-path",
      "fields-required",
      "invalid-fields",
      "list-only",
      "invalid-sort",
      "unsupported",
    ]),
  }
) {}

export const validateEmailCustomerSelection = (
  selection: EmailCustomerSelection
) => {
  const result = inspectEmailCustomerSelection(selection);
  return result instanceof EmailCustomerSelectionInvalid
    ? Effect.fail(result)
    : Effect.succeed(result);
};

/** The publication schema uses the same semantic validation as source lookup. */
export const inspectEmailCustomerSelection = (
  selection: EmailCustomerSelection
): EmailCustomerField | EmailCustomerSelectionInvalid => {
  const selected = emailCustomerFieldAtPath(
    emailCustomerFieldCatalogue,
    selection.path
  );
  if (!selected)
    return new EmailCustomerSelectionInvalid({
      path: selection.path,
      reason: "unknown-path",
    });
  const item = selected.kind === "list" ? selected.element : selected;
  if (item.kind === "record" && !selection.fields?.length)
    return new EmailCustomerSelectionInvalid({
      path: selection.path,
      reason: "fields-required",
    });
  if (selection.fields) {
    const keys = selection.fields.map((path) => JSON.stringify(path));
    if (
      item.kind !== "record" ||
      new Set(keys).size !== keys.length ||
      selection.fields.some(
        (path) => !isEmailCustomerScalar(emailCustomerFieldAtPath(item, path))
      )
    )
      return new EmailCustomerSelectionInvalid({
        path: selection.path,
        reason: "invalid-fields",
      });
  }
  if (
    (selection.sort || selection.limit !== undefined) &&
    selected.kind !== "list"
  )
    return new EmailCustomerSelectionInvalid({
      path: selection.path,
      reason: "list-only",
    });
  if (
    selection.sort &&
    !isEmailCustomerScalar(emailCustomerFieldAtPath(item, selection.sort.path))
  )
    return new EmailCustomerSelectionInvalid({
      path: selection.path,
      reason: "invalid-sort",
    });
  if (
    selected.kind === "unsupported" ||
    item.kind === "unsupported" ||
    (item.kind !== "record" && !isEmailCustomerScalar(item))
  )
    return new EmailCustomerSelectionInvalid({
      path: selection.path,
      reason: "unsupported",
    });
  return selected;
};

/** Paths cannot cross list boundaries implicitly or use numeric indexes. */
export const emailCustomerFieldAtPath = (
  root: EmailCustomerField,
  path: readonly string[],
  options: { readonly inheritPresence?: boolean } = {}
): EmailCustomerField | undefined => {
  let field: EmailCustomerField | undefined = root;
  for (const segment of path) {
    if (field?.kind !== "record" || !Object.hasOwn(field.fields, segment))
      return undefined;
    const child: EmailCustomerField | undefined = field.fields[segment];
    field =
      child && options.inheritPresence !== false
        ? {
            ...child,
            nullable: field.nullable || child.nullable,
            optional: field.optional || child.optional,
          }
        : child;
  }
  return field;
};

export const isEmailCustomerScalar = (
  field: EmailCustomerField | undefined
): boolean =>
  field?.kind === "scalar" ||
  (field?.kind === "union" &&
    field.alternatives.length > 0 &&
    field.alternatives.every(isEmailCustomerScalar));

/** Freeze only the selected structure so unrelated new fields do not invalidate old emails. */
export const selectedEmailCustomerShape = (
  selection: EmailCustomerSelection
): EmailCustomerField | undefined => {
  const selected = emailCustomerFieldAtPath(
    emailCustomerFieldCatalogue,
    selection.path,
    { inheritPresence: false }
  );
  if (!selected) return undefined;
  if (selected.kind === "record")
    return projectShape(selected, selection.fields ?? []);
  if (selected.kind === "list" && selected.element.kind === "record")
    return {
      ...selected,
      element: projectShape(selected.element, selection.fields ?? []),
    };
  return selected;
};

function projectShape(
  field: EmailCustomerField,
  paths: readonly (readonly string[])[]
): EmailCustomerField {
  if (field.kind !== "record") return field;
  const names = [
    ...new Set(paths.flatMap((path) => (path[0] ? [path[0]] : []))),
  ];
  return {
    ...field,
    fields: Object.fromEntries(
      names.flatMap((name) => {
        const child = field.fields[name];
        if (!child) return [];
        const relative = paths
          .filter((path) => path[0] === name)
          .map((path) => path.slice(1));
        return [
          [
            name,
            relative.some((path) => path.length === 0)
              ? child
              : projectShape(child, relative),
          ],
        ];
      })
    ),
  };
}

function describeField(ast: SchemaAST.AST): EmailCustomerField {
  const presence: Presence = {
    nullable: ast._tag === "Null",
    optional: SchemaAST.isOptional(ast) || ast._tag === "Undefined",
  };
  switch (ast._tag) {
    case "String":
      return { ...presence, kind: "scalar", type: "string" };
    case "Number":
      return { ...presence, kind: "scalar", type: "number" };
    case "Boolean":
      return { ...presence, kind: "scalar", type: "boolean" };
    case "Literal": {
      const literal = ast.literal;
      if (typeof literal === "string")
        return {
          ...presence,
          kind: "scalar",
          type: "string",
          choices: [literal],
        };
      if (typeof literal === "number")
        return {
          ...presence,
          kind: "scalar",
          type: "number",
          choices: [literal],
        };
      if (typeof literal === "boolean")
        return {
          ...presence,
          kind: "scalar",
          type: "boolean",
          choices: [literal],
        };
      return { ...presence, kind: "unsupported" };
    }
    case "Objects":
      return {
        ...presence,
        kind: "record",
        fields: Object.fromEntries(
          ast.propertySignatures
            .filter((property) => typeof property.name === "string")
            .map((property) => [property.name, describeField(property.type)])
        ),
      };
    case "Arrays": {
      const element = ast.rest[0];
      return element && ast.elements.length === 0 && ast.rest.length === 1
        ? { ...presence, kind: "list", element: describeField(element) }
        : { ...presence, kind: "unsupported" };
    }
    case "Suspend":
      return { ...describeField(ast.thunk()), optional: presence.optional };
    case "Union":
      return mergeFields(
        ast.types
          .filter((type) => type._tag !== "Null" && type._tag !== "Undefined")
          .map(describeField),
        {
          nullable: ast.types.some((type) => type._tag === "Null"),
          optional:
            presence.optional ||
            ast.types.some((type) => type._tag === "Undefined"),
        }
      );
    default:
      return { ...presence, kind: "unsupported" };
  }
}

function mergeFields(
  fields: readonly EmailCustomerField[],
  presence: Presence
): EmailCustomerField {
  const combined: Presence = {
    nullable: presence.nullable || fields.some((field) => field.nullable),
    optional: presence.optional || fields.some((field) => field.optional),
  };
  const first = fields[0];
  if (!first) return { ...combined, kind: "unsupported" };
  if (fields.length === 1) return { ...first, ...combined };
  if (fields.every((field) => field.kind === "record")) {
    const names = new Set(fields.flatMap((field) => Object.keys(field.fields)));
    return {
      ...combined,
      kind: "record",
      fields: Object.fromEntries(
        [...names].map((name) => {
          const variants = fields.flatMap((field) =>
            field.fields[name] ? [field.fields[name]] : []
          );
          return [
            name,
            mergeFields(variants, {
              nullable: false,
              optional: variants.length < fields.length,
            }),
          ];
        })
      ),
    };
  }
  if (
    first.kind === "scalar" &&
    fields.every(
      (field) => field.kind === "scalar" && field.type === first.type
    )
  ) {
    const choices = fields.flatMap((field) =>
      field.kind === "scalar" ? (field.choices ?? []) : []
    );
    return {
      ...combined,
      kind: "scalar",
      type: first.type,
      ...(fields.every((field) => field.kind === "scalar" && field.choices)
        ? { choices: [...new Set(choices)] }
        : {}),
    };
  }
  if (fields.every((field) => field.kind === "list"))
    return {
      ...combined,
      kind: "list",
      element: mergeFields(
        fields.map((field) => field.element),
        { nullable: false, optional: false }
      ),
    };
  return { ...combined, kind: "union", alternatives: fields };
}
