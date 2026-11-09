import { Effect, Schema } from "effect";
import { describeEmailCustomerField } from "./email-customer-field-description";
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
      path: Schema.Array(Schema.NonEmptyString),
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
export const emailCustomerFieldCatalogue: EmailCustomerField =
  describeEmailCustomerField(AdministrationCustomerDetail.ast);

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
  const reason = selectionProblem(selection, selected);
  return reason
    ? new EmailCustomerSelectionInvalid({ path: selection.path, reason })
    : selected;
};

type SelectionProblem = EmailCustomerSelectionInvalid["reason"];

/** The first rule the selection breaks, checked in a fixed order. */
const selectionProblem = (
  selection: EmailCustomerSelection,
  selected: EmailCustomerField
): SelectionProblem | undefined => {
  const item = selected.kind === "list" ? selected.element : selected;
  return (
    selectedFieldsProblem(selection.fields, item) ??
    listOptionsProblem(selection, selected, item) ??
    (isUnsupportedSelection(selected, item) ? "unsupported" : undefined)
  );
};

/** A record needs selected fields; selected fields must be distinct scalars of a record. */
const selectedFieldsProblem = (
  fields: EmailCustomerSelection["fields"],
  item: EmailCustomerField
): SelectionProblem | undefined => {
  if (item.kind === "record" && !fields?.length) return "fields-required";
  if (fields && !areSelectableFields(fields, item)) return "invalid-fields";
  return undefined;
};

const areSelectableFields = (
  fields: NonNullable<EmailCustomerSelection["fields"]>,
  item: EmailCustomerField
) => {
  const keys = fields.map((path) => JSON.stringify(path));
  return (
    item.kind === "record" &&
    new Set(keys).size === keys.length &&
    fields.every((path) =>
      isEmailCustomerScalar(emailCustomerFieldAtPath(item, path))
    )
  );
};

/** Sort and limit apply only to lists, and a list sorts by one of its scalars. */
const listOptionsProblem = (
  selection: EmailCustomerSelection,
  selected: EmailCustomerField,
  item: EmailCustomerField
): SelectionProblem | undefined => {
  if (
    (selection.sort || selection.limit !== undefined) &&
    selected.kind !== "list"
  )
    return "list-only";
  if (
    selection.sort &&
    !isEmailCustomerScalar(emailCustomerFieldAtPath(item, selection.sort.path))
  )
    return "invalid-sort";
  return undefined;
};

const isUnsupportedSelection = (
  selected: EmailCustomerField,
  item: EmailCustomerField
) =>
  selected.kind === "unsupported" ||
  item.kind === "unsupported" ||
  (item.kind !== "record" && !isEmailCustomerScalar(item));

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
