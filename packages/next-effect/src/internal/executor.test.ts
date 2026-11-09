import { describe, expect, test } from "bun:test";
import { Effect } from "effect";
import { execute } from "./executor";

describe("execute", () => {
  test("rejects typed failures directly without mapError", async () => {
    const failure: { readonly _tag: "DomainError" } = { _tag: "DomainError" };

    await expect(execute(Effect.fail(failure))).rejects.toBe(failure);
  });
});
