import { describe, expect, test } from "bun:test";
import type { StandardSchemaV1 } from "@standard-schema/spec";
import { decodeStandardSchema } from "./index";

describe("standard-schema helpers", () => {
  test("rejects asynchronous schemas", () => {
    const asyncSchema: StandardSchemaV1<unknown, string> = {
      "~standard": {
        version: 1,
        vendor: "test",
        validate: async () => ({ value: "later" }),
      },
    };

    expect(() => decodeStandardSchema(asyncSchema, "value")).toThrow(
      "Async Standard Schema validation is not supported here"
    );
  });
});
