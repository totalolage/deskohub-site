import { EffectLogger } from "drizzle-orm/effect-postgres";
import { Effect, Layer } from "effect";
import { censorDatabaseQueryParams } from "./censorship";

const stringifyDatabaseQueryParameter = (value: unknown): string => {
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
};

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
