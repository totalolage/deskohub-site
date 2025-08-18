/**
 * Dotypos Configuration
 *
 * Centralized configuration for Dotypos API integration
 */

import { Config, Context, Effect, Layer, Schema } from "effect";

/**
 * Dotypos Configuration Schema with validation
 */
export const DotyposConfigSchema = Schema.Struct({
  clientId: Schema.NonEmptyString,
  clientSecret: Schema.NonEmptyString,
  refreshToken: Schema.NonEmptyString,
  cloudId: Schema.NonEmptyString,
  branchId: Schema.NonEmptyString,
  employeeId: Schema.NonEmptyString,
  apiUrl: Schema.NonEmptyString,
  apiTimeout: Schema.Number.pipe(
    Schema.positive(),
    Schema.annotations({ description: "API timeout in milliseconds" })
  ),
});

export type DotyposConfig = Schema.Schema.Type<typeof DotyposConfigSchema>;

/**
 * Context tag for dependency injection
 */
export class DotyposConfigTag extends Context.Tag("DotyposConfig")<
  DotyposConfigTag,
  DotyposConfig
>() {}

/**
 * Configuration Layer that reads from environment variables
 */
export const DotyposConfigLayer = Layer.effect(
  DotyposConfigTag,
  Effect.gen(function* () {
    yield* Effect.logDebug("Loading Dotypos configuration");
    const rawConfig = yield* Config.all({
      clientId: Config.string("DOTYPOS_CLIENT_ID"),
      clientSecret: Config.string("DOTYPOS_CLIENT_SECRET"),
      refreshToken: Config.string("DOTYPOS_REFRESH_TOKEN"),
      cloudId: Config.string("DOTYPOS_CLOUD_ID"),
      branchId: Config.string("DOTYPOS_BRANCH_ID").pipe(
        Config.withDefault("128665136") // Default to "Pokladna" branch
      ),
      employeeId: Config.string("DOTYPOS_EMPLOYEE_ID"),
      apiUrl: Config.string("DOTYPOS_API_URL").pipe(
        Config.withDefault("https://api.dotykacka.cz/v2")
      ),
      apiTimeout: Config.number("DOTYPOS_API_TIMEOUT").pipe(
        Config.withDefault(30000)
      ),
    });

    const config = yield* Schema.decodeUnknown(DotyposConfigSchema)(rawConfig);
    yield* Effect.logInfo("Dotypos configuration loaded successfully");
    return config;
  })
);
