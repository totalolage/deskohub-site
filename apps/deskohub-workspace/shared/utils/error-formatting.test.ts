import { describe, expect, test } from "bun:test";
import { Effect, Schema } from "effect";
import { serializeErrorForLog } from "./error-formatting";

describe("serializeErrorForLog", () => {
  test("projects nested schema errors without retaining rejected input", () => {
    const sentinel = "SCHEMA-ACTUAL-PII-SENTINEL";
    const schemaError = Effect.runSync(
      Schema.decodeUnknownEffect(
        Schema.Struct({ safe: Schema.Literal("expected") }),
        { onExcessProperty: "error" }
      )({ safe: "unexpected", nested: { value: sentinel } }).pipe(Effect.flip)
    );
    const wrapped = new Error("outer", { cause: schemaError });

    expect(JSON.stringify(serializeErrorForLog(wrapped))).not.toContain(
      sentinel
    );
  });
});
