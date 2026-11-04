import { Array as Arr, Schema } from "effect";
import {
  EmailCustomerField,
  selectedEmailCustomerShape,
} from "./email-customer-selection";
import { matchesEmailCustomerField } from "./email-customer-value-match";
import type { EmailValueDefinition } from "./emails";

const sameCustomerShape = Schema.toEquivalence(EmailCustomerField);

/** Fallback replaces the whole value/component, including scalar references into a missing record. */
export const EmailValueSnapshot = Schema.Union([
  Schema.TaggedStruct("Resolved", { value: Schema.Json }),
  Schema.TaggedStruct("Fallback", { text: Schema.String }),
]);
export type EmailValueSnapshot = typeof EmailValueSnapshot.Type;

/** Preparation validates generated values against their frozen definition before inserting/sealing. */
export const emailValueSnapshotForDefinition = (
  definition: EmailValueDefinition,
  locale: string
) =>
  EmailValueSnapshot.check(
    Schema.makeFilter(
      (snapshot) => {
        const current =
          definition.source.kind === "customer"
            ? selectedEmailCustomerShape(definition.source)
            : undefined;
        if (hasStaleCustomerShape(definition, current)) return false;
        if (snapshot._tag === "Fallback")
          return definition.fallback?.[locale] === snapshot.text;
        return (
          snapshot.value !== null &&
          matchesSourceValue(definition, current, snapshot.value)
        );
      },
      {
        description:
          "Generated value must match the frozen source shape, contain only selected fields, or equal the locale's configured fallback.",
      }
    )
  );

type CustomerSelection = Extract<
  EmailValueDefinition["source"],
  { readonly kind: "customer" }
>;
type JsonValue = NonNullable<Schema.Json>;

/** A customer source that no longer resolves, or resolves to a different shape than the frozen one. */
const hasStaleCustomerShape = (
  definition: EmailValueDefinition,
  current: EmailCustomerField | undefined
) =>
  definition.source.kind === "customer" &&
  (!current ||
    (definition.customerShape &&
      !sameCustomerShape(definition.customerShape, current)));

const matchesSourceValue = (
  definition: EmailValueDefinition,
  current: EmailCustomerField | undefined,
  value: JsonValue
): boolean => {
  if (definition.source.kind === "discount") return isDiscountValue(value);
  const selected = definition.customerShape ?? current;
  if (!selected) return false;
  if (exceedsSelectionLimit(selected, definition.source, value)) return false;
  return matchesEmailCustomerField(value, selected);
};

/** A discount is exactly a non-empty code and a parseable expiry. */
const isDiscountValue = (value: JsonValue) =>
  typeof value === "object" &&
  !Arr.isArray<Schema.Json>(value) &&
  Object.keys(value).length === 2 &&
  typeof value.code === "string" &&
  value.code.length > 0 &&
  typeof value.expiresAt === "string" &&
  Number.isFinite(Date.parse(value.expiresAt));

const exceedsSelectionLimit = (
  selected: EmailCustomerField,
  selection: CustomerSelection,
  value: JsonValue
) =>
  selected.kind === "list" &&
  selection.limit !== undefined &&
  Arr.isArray<Schema.Json>(value) &&
  value.length > selection.limit;
