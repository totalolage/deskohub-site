import { Schema } from "effect";

const isoDateTimeWithOffsetPattern =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;

export const isoDateTimeWithOffsetStringEffectSchema = Schema.String.check(
  Schema.makeFilter((value) =>
    isoDateTimeWithOffsetPattern.test(value) &&
    Number.isFinite(Date.parse(value))
      ? undefined
      : "Expected ISO datetime string with offset."
  )
);

export const urlStringEffectSchema = Schema.String.check(
  Schema.makeFilter((value) => {
    try {
      new URL(value);
      return undefined;
    } catch {
      return "Expected URL string.";
    }
  })
);
