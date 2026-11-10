import { EffectLogger } from "drizzle-orm/effect-postgres";
import { Effect, Layer, LogLevel, Result } from "effect";
import { censorDatabaseQueryParams } from "./censorship";

const stringifyDatabaseQueryParameter = <T>(value: T): string =>
  Result.try(() => JSON.stringify(value) ?? String(value)).pipe(
    Result.getOrElse(() => String(value))
  );

/**
 * Logs one row per Drizzle query. The row carries the SQL text and its
 * censored parameters only while Debug logs are enabled, as in preview and
 * development; at a production minimum level it keeps the parameter count
 * alone, so query rows stay small.
 */
export const DatabaseQueryLoggerLive = Layer.succeed(EffectLogger, {
  logQuery: (query, params) =>
    Effect.flatMap(LogLevel.isEnabled("Debug"), (detailed) =>
      Effect.logInfo("Database query").pipe(
        Effect.annotateLogs(
          detailed
            ? {
                params: censorDatabaseQueryParams(query, params).map(
                  stringifyDatabaseQueryParameter
                ),
                parameterCount: params.length,
                query,
              }
            : { parameterCount: params.length }
        )
      )
    ),
});
