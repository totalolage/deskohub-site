import { Schema } from "effect";
import {
  type EmailCustomerField,
  emailCustomerFieldAtPath,
  emailCustomerFieldCatalogue,
} from "./email-customer-selection";
import type { EmailValueDefinition } from "./emails";

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
            !Array.isArray(value) &&
            Object.keys(value).length === 2 &&
            typeof value.code === "string" &&
            value.code.length > 0 &&
            typeof value.expiresAt === "string" &&
            Number.isFinite(Date.parse(value.expiresAt))
          );
        const selection = definition.source;
        const selected = emailCustomerFieldAtPath(
          emailCustomerFieldCatalogue,
          selection.path
        );
        if (!selected) return false;
        if (selected.kind === "list")
          return (
            Array.isArray(value) &&
            (selection.limit === undefined ||
              value.length <= selection.limit) &&
            value.every((item) =>
              selected.element.kind === "record"
                ? matchesSelectedRecord(
                    item,
                    selected.element,
                    selection.fields ?? []
                  )
                : matchesField(item, selected.element)
            )
          );
        if (selected.kind === "record")
          return matchesSelectedRecord(value, selected, selection.fields ?? []);
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
        Array.isArray(value) &&
        value.every((item) => matchesField(item, field.element))
      );
    case "record":
      return false;
    case "unsupported":
      return false;
  }
}

function matchesSelectedRecord(
  value: Schema.Json,
  field: EmailCustomerField,
  paths: readonly (readonly string[])[]
): boolean {
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value) ||
    paths.length === 0
  )
    return false;
  if (!hasOnlySelectedFields(value, paths, [])) return false;
  return paths.every((path) => {
    const descriptor = emailCustomerFieldAtPath(field, path);
    return (
      descriptor !== undefined &&
      matchesField(valueAtPath(value, path), descriptor)
    );
  });
}

function valueAtPath(
  value: Schema.Json,
  path: readonly string[]
): Schema.Json | undefined {
  let result: Schema.Json | undefined = value;
  for (const part of path) {
    if (result === null || result === undefined) return result;
    if (
      typeof result !== "object" ||
      Array.isArray(result) ||
      !Object.hasOwn(result, part)
    )
      return undefined;
    result = result[part];
  }
  return result;
}

function hasOnlySelectedFields(
  value: Schema.Json,
  paths: readonly (readonly string[])[],
  prefix: readonly string[]
): boolean {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    return paths.some(
      (path) =>
        path.length >= prefix.length &&
        prefix.every((part, index) => part === path[index])
    );
  return Object.entries(value).every(([key, child]) => {
    const path = [...prefix, key];
    return (
      paths.some(
        (selected) =>
          selected.length >= path.length &&
          path.every((part, index) => part === selected[index])
      ) && hasOnlySelectedFields(child, paths, path)
    );
  });
}
