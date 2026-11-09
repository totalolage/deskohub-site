import { describe, expect, test } from "bun:test";
import { EffectDrizzleQueryError } from "drizzle-orm/effect-core";
import { Cause, Data } from "effect";
import { SqlError } from "effect/unstable/sql";
import { isDatabaseUnavailable } from "./database-unavailable";

class QueueTestDomainError extends Data.TaggedError("QueueTestDomainError")<{
  readonly cause: unknown;
}> {}

const driverError = (code: string, message = "driver failure") =>
  Object.assign(new Error(message), { code });

const queryFailure = (reason: SqlError.SqlErrorReason) =>
  new EffectDrizzleQueryError({
    query: "select 1",
    params: [],
    cause: Cause.fail(new SqlError.SqlError({ reason })),
  });

describe("isDatabaseUnavailable", () => {
  test.each([
    [
      "rejected credentials",
      new SqlError.AuthenticationError({
        cause: driverError("28P01"),
        operation: "acquireConnection",
      }),
    ],
    [
      "a missing database",
      new SqlError.UnknownError({ cause: driverError("3D000") }),
    ],
    [
      "a deleted Neon endpoint",
      new SqlError.UnknownError({
        cause: driverError(
          "XX000",
          "The requested endpoint could not be found, or you don't have access to it. Please check the provided ID and try again."
        ),
      }),
    ],
  ])(
    "finds %s under a domain error and a Drizzle query error",
    (_label, reason) => {
      expect(
        isDatabaseUnavailable(
          Cause.fail(new QueueTestDomainError({ cause: queryFailure(reason) }))
        )
      ).toBe(true);
    }
  );

  test("finds an unavailable database reported as a defect", () => {
    expect(
      isDatabaseUnavailable(
        Cause.die(
          new SqlError.SqlError({
            reason: new SqlError.AuthenticationError({
              cause: driverError("28000"),
            }),
          })
        )
      )
    ).toBe(true);
  });

  test.each([
    [
      "a dropped connection",
      new SqlError.ConnectionError({ cause: driverError("08006") }),
    ],
    [
      "a unique violation",
      new SqlError.UniqueViolation({
        cause: driverError("23505"),
        constraint: "unique_key",
      }),
    ],
    [
      "an unclassified driver error",
      new SqlError.UnknownError({ cause: driverError("XX000", "internal") }),
    ],
  ])("leaves %s retryable", (_label, reason) => {
    expect(isDatabaseUnavailable(Cause.fail(queryFailure(reason)))).toBe(false);
  });

  test("stops at cyclic causes", () => {
    const cyclic = new Error("cyclic");
    cyclic.cause = cyclic;

    expect(isDatabaseUnavailable(cyclic)).toBe(false);
  });
});
