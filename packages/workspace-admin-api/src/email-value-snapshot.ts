import { Array as Arr, Schema } from "effect";
import {
  EmailCustomerField,
  selectedEmailCustomerShape,
} from "./email-customer-selection";
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
        if (snapshot._tag === "Fallback")
          return definition.fallback?.[locale] === snapshot.text;
        const value = snapshot.value;
        if (value === null) return false;
        if (definition.source.kind === "discount")
          return (
            typeof value === "object" &&
            !Arr.isArray<Schema.Json>(value) &&
            Object.keys(value).length === 2 &&
            typeof value.code === "string" &&
            value.code.length > 0 &&
            typeof value.expiresAt === "string" &&
            Number.isFinite(Date.parse(value.expiresAt))
          );
        const selection = definition.source;
        const current = selectedEmailCustomerShape(selection);
        if (!current) return false;
        if (
          definition.customerShape &&
          !sameCustomerShape(definition.customerShape, current)
        )
          return false;
        const selected = definition.customerShape ?? current;
        if (
          selected.kind === "list" &&
          selection.limit !== undefined &&
          Arr.isArray<Schema.Json>(value) &&
          value.length > selection.limit
        )
          return false;
        return matchesField(value, selected);
      },
      {
        description:
          "Generated value must match the frozen source shape, contain only selected fields, or equal the locale's configured fallback.",
      }
    )
  );

function matchesField(
  value: Schema.Json | undefined,
  field: EmailCustomerField
): boolean {
  if (value === undefined) return field.optional;
  if (value === null) return field.nullable;
  switch (field.kind) {
    case "scalar":
      return (
        typeof value === field.type &&
        (field.choices === undefined ||
          field.choices.some((choice) => choice === value))
      );
    case "union":
      return field.alternatives.some((alternative) =>
        matchesField(value, alternative)
      );
    case "list":
      return (
        Arr.isArray<Schema.Json>(value) &&
        value.every((item) => matchesField(item, field.element))
      );
    case "record":
      return (
        typeof value === "object" &&
        !Arr.isArray<Schema.Json>(value) &&
        Object.keys(value).every((key) => Object.hasOwn(field.fields, key)) &&
        Object.entries(field.fields).every(([key, descriptor]) =>
          matchesField(
            Object.hasOwn(value, key) ? value[key] : undefined,
            descriptor
          )
        )
      );
    case "unsupported":
      return false;
  }
}
