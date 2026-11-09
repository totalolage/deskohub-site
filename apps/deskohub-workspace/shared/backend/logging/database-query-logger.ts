import { EffectLogger } from "drizzle-orm/effect-postgres";
import { Effect, Layer, Result } from "effect";
import { censorDatabaseQueryParams } from "./censorship";

const stringifyDatabaseQueryParameter = <T>(value: T): string =>
  Result.try(() => JSON.stringify(value) ?? String(value)).pipe(
    Result.getOrElse(() => String(value))
  );

export const DatabaseQueryLoggerLive = Layer.succeed(EffectLogger, {
  logQuery: (query, params) =>
    Effect.log("Database query").pipe(
      Effect.annotateLogs({
        params: censorDatabaseQueryParams(query, params).map(
          stringifyDatabaseQueryParameter
        ),
        parameterCount: params.length,
        query,
      })
    ),
});
