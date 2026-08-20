import "@/shared/testing/workspace-test-env";
import { describe, expect, test } from "bun:test";
import { Effect, Schema } from "effect";
import {
  CalendarResourceConfig,
  salesCalendarIdSchema,
  workspaceLimitationsCalendarIdSchema,
} from "./google-calendar.config";

describe("CalendarResourceConfig", () => {
  test("decodes calendar resource identifiers from the environment", async () => {
    const config = await Effect.runPromise(
      CalendarResourceConfig.pipe(
        Effect.provide(CalendarResourceConfig.Default)
      )
    );

    expect(config.workspaceLimitationsCalendarId.length).toBeGreaterThan(0);
    expect(config.salesCalendarId.length).toBeGreaterThan(0);
  });

  test.each([
    ["workspace limitations", workspaceLimitationsCalendarIdSchema],
    ["sales", salesCalendarIdSchema],
  ] as const)("rejects an empty %s calendar identifier", async (_, schema) => {
    const result = await Effect.runPromise(
      Schema.decodeUnknownEffect(schema)("").pipe(Effect.result)
    );

    expect(result._tag).toBe("Failure");
  });
});
