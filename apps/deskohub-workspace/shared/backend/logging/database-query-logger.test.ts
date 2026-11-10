import { describe, expect, test } from "bun:test";
import { testEmailAddress } from "@deskohub/test-email";
import { EffectLogger } from "drizzle-orm/effect-postgres";
import {
  type Context,
  Effect,
  Layer,
  Logger,
  type LogLevel,
  References,
} from "effect";
import { CENSORED_LOG_VALUE } from "@/shared/utils/log-classification";
import { DatabaseQueryLoggerLive } from "./database-query-logger";

type LogAnnotations = Context.Service.Shape<
  typeof References.CurrentLogAnnotations
>;

interface CapturedQueryRow {
  readonly annotations: LogAnnotations;
  readonly logLevel: LogLevel.LogLevel;
}

const privateEmail = testEmailAddress("private");

/** Logs one query at `minimumLogLevel` and returns the rows it emitted. */
const logQueryAt = async (
  minimumLogLevel: LogLevel.LogLevel,
  query: string,
  params: unknown[]
) => {
  const rows: CapturedQueryRow[] = [];
  const captureLogger = Logger.make(({ fiber, logLevel }) => {
    rows.push({
      annotations: fiber.getRef(References.CurrentLogAnnotations),
      logLevel,
    });
  });

  await Effect.runPromise(
    Effect.flatMap(EffectLogger, (logger) =>
      logger.logQuery(query, params)
    ).pipe(
      Effect.provideService(References.MinimumLogLevel, minimumLogLevel),
      Effect.provide(
        Layer.merge(DatabaseQueryLoggerLive, Logger.layer([captureLogger]))
      )
    )
  );

  return rows;
};

describe("DatabaseQueryLoggerLive", () => {
  test("keeps SQL text and parameters off the row at an Info minimum level", async () => {
    const rows = await logQueryAt(
      "Info",
      "select * from customers where email = $1",
      [privateEmail, 42]
    );

    expect(rows).toEqual([
      { annotations: { parameterCount: 2 }, logLevel: "Info" },
    ]);
  });

  test.each(["Debug", "All"] as const)(
    "keeps the SQL text and only selectively censored parameters at a %s minimum level",
    async (minimumLogLevel) => {
      const rows = await logQueryAt(minimumLogLevel, "select $1, $2, $3", [
        "visible",
        { email: privateEmail, sessionDuration: 123 },
        42,
        undefined,
        10n,
      ]);

      expect(rows).toEqual([
        {
          annotations: {
            params: [
              '"visible"',
              `{"email":"${CENSORED_LOG_VALUE}","sessionDuration":123}`,
              "42",
              "undefined",
              "10",
            ],
            parameterCount: 5,
            query: "select $1, $2, $3",
          },
          logLevel: "Info",
        },
      ]);
      expect(JSON.stringify(rows)).not.toContain(privateEmail);
    }
  );
});
