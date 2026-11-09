import { Predicate } from "effect";
import type { FieldErrors, FieldValues } from "react-hook-form";

/** A field React Hook Form validation rejected, by its dotted path. */
export type InvalidFormField = {
  readonly name: string;
  readonly message?: string;
};

/**
 * Every rejected field in a React Hook Form error tree, with its message, in
 * the order the form reports them. Nested objects and arrays give dotted
 * paths such as `billing.companyId`.
 */
export const getInvalidFormFields = <Values extends FieldValues>(
  errors: FieldErrors<Values>
): readonly InvalidFormField[] => collectInvalidFields(errors, "");

// A nested entry is a field error, or the error tree of an object or array.
type FieldErrorTree = FieldErrors | NonNullable<FieldErrors[string]>;

const collectInvalidFields = (
  errors: FieldErrorTree,
  prefix: string
): readonly InvalidFormField[] =>
  Object.entries(errors).flatMap(
    ([key, error]: [string, FieldErrorTree | undefined]) => {
      if (error === undefined) return [];
      const name = `${prefix}${key}`;
      // A leaf error has a validation `type`; anything else nests field errors.
      if (!("type" in error && Predicate.isString(error.type))) {
        return collectInvalidFields(error, `${name}.`);
      }
      return Predicate.isString(error.message) && error.message !== ""
        ? [{ name, message: error.message }]
        : [{ name }];
    }
  );
