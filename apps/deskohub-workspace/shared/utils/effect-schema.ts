import { Schema } from "effect";

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
