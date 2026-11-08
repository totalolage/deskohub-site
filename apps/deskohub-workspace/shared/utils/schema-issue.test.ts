import { describe, expect, test } from "bun:test";
import { Result, Schema } from "effect";
import { getFirstInvalidFieldPath } from "./schema-issue";

const Order = Schema.Struct({
  seats: Schema.Int,
  billing: Schema.Struct({
    address: Schema.Struct({ postalCode: Schema.NonEmptyString }),
  }),
});

const firstInvalidFieldPath = (input: typeof Order.Encoded | string) => {
  const decoded = Schema.decodeUnknownResult(Order)(input);
  if (Result.isSuccess(decoded)) throw new Error("Expected a decode failure");
  return getFirstInvalidFieldPath(decoded.failure.issue);
};

describe("getFirstInvalidFieldPath", () => {
  test("names a top-level field", () => {
    expect(
      firstInvalidFieldPath({
        seats: 1.5,
        billing: { address: { postalCode: "11000" } },
      })
    ).toBe("seats");
  });

  test("joins a nested field's path with dots", () => {
    expect(
      firstInvalidFieldPath({
        seats: 2,
        billing: { address: { postalCode: "" } },
      })
    ).toBe("billing.address.postalCode");
  });

  test("names no field when the value itself is invalid", () => {
    expect(firstInvalidFieldPath("not an order")).toBeUndefined();
  });
});
