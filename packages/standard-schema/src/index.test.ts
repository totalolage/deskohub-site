import { describe, expect, test } from "bun:test";
import type { StandardSchemaV1 } from "@standard-schema/spec";
import { decodeStandardSchema, parseStandardSchema } from "./index";

const lengthSchema: StandardSchemaV1<unknown, number> = {
  "~standard": {
    version: 1,
    vendor: "test",
    validate: (value) =>
      typeof value === "string"
        ? { value: value.length }
        : { issues: [{ message: "Expected string" }] },
  },
};

describe("standard-schema helpers", () => {
  test("returns transformed sync output", () => {
    expect(decodeStandardSchema(lengthSchema, "deskohub")).toBe(8);
    expect(parseStandardSchema(lengthSchema, "deskohub", "invalid")).toBe(8);
  });

  test("uses supplied parse error message", () => {
    expect(decodeStandardSchema(lengthSchema, 123)).toBeUndefined();
    expect(() =>
      parseStandardSchema(lengthSchema, 123, "Use this message")
    ).toThrow("Use this message");
  });
});
