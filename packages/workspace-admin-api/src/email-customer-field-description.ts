import { SchemaAST } from "effect";
import type { EmailCustomerField } from "./email-customer-selection";

type Presence = Pick<EmailCustomerField, "nullable" | "optional">;
type RecordField = Extract<EmailCustomerField, { readonly kind: "record" }>;
type ListField = Extract<EmailCustomerField, { readonly kind: "list" }>;
type ScalarType = Extract<
  EmailCustomerField,
  { readonly kind: "scalar" }
>["type"];

const scalarTypeByTag: Partial<Record<SchemaAST.AST["_tag"], ScalarType>> = {
  String: "string",
  Number: "number",
  Boolean: "boolean",
};

/** Describes the values a schema accepts as a selectable customer field. */
export function describeEmailCustomerField(
  ast: SchemaAST.AST
): EmailCustomerField {
  const presence: Presence = {
    nullable: ast._tag === "Null",
    optional: SchemaAST.isOptional(ast) || ast._tag === "Undefined",
  };
  const scalarType = scalarTypeByTag[ast._tag];
  if (scalarType) return { ...presence, kind: "scalar", type: scalarType };
  switch (ast._tag) {
    case "Literal":
      return describeLiteral(ast.literal, presence);
    case "Objects":
      return describeObjects(ast, presence);
    case "Arrays":
      return describeArrays(ast, presence);
    case "Suspend":
      return {
        ...describeEmailCustomerField(ast.thunk()),
        optional: presence.optional,
      };
    case "Union":
      return describeUnion(ast, presence);
    default:
      return { ...presence, kind: "unsupported" };
  }
}

function describeLiteral(
  literal: SchemaAST.Literal["literal"],
  presence: Presence
): EmailCustomerField {
  if (typeof literal === "string")
    return { ...presence, kind: "scalar", type: "string", choices: [literal] };
  if (typeof literal === "number")
    return { ...presence, kind: "scalar", type: "number", choices: [literal] };
  if (typeof literal === "boolean")
    return { ...presence, kind: "scalar", type: "boolean", choices: [literal] };
  return { ...presence, kind: "unsupported" };
}

/** Symbol-keyed properties and index signatures are not selectable. */
function describeObjects(
  ast: SchemaAST.Objects,
  presence: Presence
): EmailCustomerField {
  return {
    ...presence,
    kind: "record",
    fields: Object.fromEntries(
      ast.propertySignatures
        .filter((property) => typeof property.name === "string")
        .map((property) => [
          property.name,
          describeEmailCustomerField(property.type),
        ])
    ),
  };
}

/** Only homogeneous arrays are lists; tuples are not selectable. */
function describeArrays(
  ast: SchemaAST.Arrays,
  presence: Presence
): EmailCustomerField {
  const element = ast.rest[0];
  return element && ast.elements.length === 0 && ast.rest.length === 1
    ? {
        ...presence,
        kind: "list",
        element: describeEmailCustomerField(element),
      }
    : { ...presence, kind: "unsupported" };
}

/** `null` and `undefined` members become presence instead of alternatives. */
function describeUnion(
  ast: SchemaAST.Union,
  presence: Presence
): EmailCustomerField {
  return mergeFields(
    ast.types
      .filter((type) => type._tag !== "Null" && type._tag !== "Undefined")
      .map(describeEmailCustomerField),
    {
      nullable: ast.types.some((type) => type._tag === "Null"),
      optional:
        presence.optional ||
        ast.types.some((type) => type._tag === "Undefined"),
    }
  );
}

/** Merges the alternatives one value can take into a single field. */
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
  return mergeAlternatives(first, fields, combined);
}

/**
 * Records merge by field and lists by element; scalars of one type merge
 * their choices. Anything else stays a union of the alternatives.
 */
function mergeAlternatives(
  first: EmailCustomerField,
  fields: readonly EmailCustomerField[],
  combined: Presence
): EmailCustomerField {
  if (fields.every((field) => field.kind === "record"))
    return mergeRecords(fields, combined);
  if (
    first.kind === "scalar" &&
    fields.every(
      (field) => field.kind === "scalar" && field.type === first.type
    )
  )
    return mergeScalars(first.type, fields, combined);
  if (fields.every((field) => field.kind === "list"))
    return mergeLists(fields, combined);
  return { ...combined, kind: "union", alternatives: fields };
}

/** A field missing from some alternatives becomes optional. */
function mergeRecords(
  fields: readonly RecordField[],
  combined: Presence
): EmailCustomerField {
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

/** Choices survive only when every alternative restricts them. */
function mergeScalars(
  type: ScalarType,
  fields: readonly EmailCustomerField[],
  combined: Presence
): EmailCustomerField {
  const choices = fields.flatMap((field) =>
    field.kind === "scalar" ? (field.choices ?? []) : []
  );
  return {
    ...combined,
    kind: "scalar",
    type,
    ...(fields.every((field) => field.kind === "scalar" && field.choices)
      ? { choices: [...new Set(choices)] }
      : {}),
  };
}

function mergeLists(
  fields: readonly ListField[],
  combined: Presence
): EmailCustomerField {
  return {
    ...combined,
    kind: "list",
    element: mergeFields(
      fields.map((field) => field.element),
      { nullable: false, optional: false }
    ),
  };
}
