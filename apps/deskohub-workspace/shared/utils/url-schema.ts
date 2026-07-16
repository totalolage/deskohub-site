import { Schema } from "effect";

export const urlStringSchema = Schema.String.check(
  Schema.makeFilter((value) => URL.canParse(value), {
    expected: "a URL",
  })
);
