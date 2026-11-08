import {
  type EmailCustomerField,
  emailCustomerFieldAtPath,
  emailCustomerFieldCatalogue,
  isEmailCustomerScalar,
} from "@deskohub/workspace-admin-api";
import type { EmailDraftValueDefinition } from "./email-draft-form";

/** What a value definition yields per recipient. */
export type EmailValueKind = "scalar" | "record" | "list" | "discount";

/** A customer field path, as selections and references name it. */
export type EmailCustomerFieldPath = readonly string[];

/** The catalogue field a customer definition selects, if its path exists. */
export const selectedEmailCustomerField = (
  definition: EmailDraftValueDefinition
): EmailCustomerField | undefined =>
  definition.source?.kind === "customer" && definition.source.path?.length
    ? emailCustomerFieldAtPath(
        emailCustomerFieldCatalogue,
        definition.source.path
      )
    : undefined;

/**
 * What `definition` yields, or `undefined` while its source is unfinished or
 * names a field that can't be used.
 */
export const emailValueKind = (
  definition: EmailDraftValueDefinition
): EmailValueKind | undefined => {
  if (definition.source?.kind === "discount") return "discount";
  const field = selectedEmailCustomerField(definition);
  if (!field) return undefined;
  if (field.kind === "list") return "list";
  if (field.kind === "record") return "record";
  return isEmailCustomerScalar(field) ? "scalar" : undefined;
};

/**
 * Paths of every scalar field inside `field`, through nested records but
 * never into lists. A scalar `field` itself has the one empty path.
 */
export const emailCustomerScalarPaths = (
  field: EmailCustomerField | undefined,
  prefix: EmailCustomerFieldPath = []
): readonly EmailCustomerFieldPath[] => {
  if (!field) return [];
  if (isEmailCustomerScalar(field)) return [prefix];
  if (field.kind !== "record") return [];
  return Object.entries(field.fields).flatMap(([name, child]) =>
    emailCustomerScalarPaths(child, [...prefix, name])
  );
};

/** One customer field a value definition can select. */
export type EmailCustomerFieldOption = {
  readonly path: EmailCustomerFieldPath;
  readonly kind: "scalar" | "record" | "list";
};

const selectableItem = (field: EmailCustomerField): boolean =>
  isEmailCustomerScalar(field) || field.kind === "record";

const fieldOptions = (
  field: EmailCustomerField,
  prefix: EmailCustomerFieldPath
): EmailCustomerFieldOption[] => {
  if (field.kind !== "record") return [];
  return Object.entries(field.fields).flatMap(([name, child]) => {
    const path = [...prefix, name];
    if (isEmailCustomerScalar(child)) return [{ path, kind: "scalar" }];
    if (child.kind === "list")
      return selectableItem(child.element) ? [{ path, kind: "list" }] : [];
    if (child.kind === "record")
      return [{ path, kind: "record" }, ...fieldOptions(child, path)];
    return [];
  });
};

/** Every customer field a definition can select, in catalogue order. */
export const emailCustomerFieldOptions: readonly EmailCustomerFieldOption[] =
  fieldOptions(emailCustomerFieldCatalogue, []);

/**
 * The record fields `definition` selects, for record and list definitions:
 * the paths components and scalar references may use.
 */
export const selectedEmailCustomerFieldPaths = (
  definition: EmailDraftValueDefinition
): readonly EmailCustomerFieldPath[] =>
  definition.source?.kind === "customer"
    ? (definition.source.fields ?? []).filter((path) => path.length > 0)
    : [];

/**
 * The paths a list definition's items can sort by: the items themselves, the
 * empty path, for a list of scalars, else the record fields it selects.
 */
export const emailListSortPaths = (
  definition: EmailDraftValueDefinition
): readonly EmailCustomerFieldPath[] => {
  const selected = selectedEmailCustomerField(definition);
  return selected?.kind === "list" && isEmailCustomerScalar(selected.element)
    ? [[]]
    : selectedEmailCustomerFieldPaths(definition);
};

/** A value a text can show: a scalar definition, or one field of one. */
export type EmailScalarValueOption = {
  readonly name: string;
  /** Unset for a scalar definition itself. */
  readonly field?: EmailCustomerFieldPath;
};

/** The discount fields a text can show. */
const emailDiscountScalarFields = ["code", "expiresAt"] as const;

/**
 * Everything a text can show from `definitions`, in definition order: each
 * named scalar customer value, each selected field of a record value, and
 * each discount's code and expiry. Lists show only through list blocks.
 */
export const emailScalarValueOptions = (
  definitions: readonly EmailDraftValueDefinition[]
): readonly EmailScalarValueOption[] =>
  definitions.flatMap((definition): EmailScalarValueOption[] => {
    const name = definition.name;
    if (!name) return [];
    switch (emailValueKind(definition)) {
      case "scalar":
        return [{ name }];
      case "record":
        return selectedEmailCustomerFieldPaths(definition).map((field) => ({
          name,
          field,
        }));
      case "discount":
        return emailDiscountScalarFields.map((field) => ({
          name,
          field: [field],
        }));
      default:
        return [];
    }
  });

/** A value reference as one readable token, such as `booking.date`. */
export const emailValueReferenceLabel = ({
  name,
  field,
}: EmailScalarValueOption): string =>
  [name, ...(field ?? [])].filter(Boolean).join(".");

/** A customer field path as one readable token, such as `stats.reservationCount`. */
export const emailCustomerFieldPathLabel = (
  path: EmailCustomerFieldPath
): string => path.join(".");
