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

  test("projects primitive, custom, aggregate, and nested causes to closed metadata", () => {
    const sentinel = "SENSITIVE-CATEGORY-SENTINEL";
    const projected = serializeErrorForLog(
      new AggregateError(
        [
          sentinel,
          42,
          false,
          {
            _tag: "SyntheticTaggedCause",
            customerId: sentinel,
            cause: new Error(sentinel, {
              cause: { providerOrderId: sentinel },
            }),
          },
        ],
        sentinel
      )
    );
    const serialized = JSON.stringify(projected);

    expect(projected).toEqual({
      kind: "aggregate_error",
      errors: [
        { kind: "string" },
        { kind: "number" },
        { kind: "boolean" },
        {
          kind: "tagged_object",
          cause: {
            kind: "error",
            category: "native",
            cause: { kind: "object" },
          },
        },
      ],
    });
    expect(serialized).not.toContain(sentinel);
    expect(serialized).not.toContain("customerId");
    expect(serialized).not.toContain("providerOrderId");
  });
});
