/**
 * Dotypos Configuration
 *
 * Centralized configuration for Dotypos API integration
 */

import { Context, Layer, Schema } from "effect";
import { env } from "@/env";

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
 * Configuration Layer that uses validated environment variables
 */
export const DotyposConfigLayer = Layer.succeed(DotyposConfigTag, {
  clientId: env.DOTYPOS_CLIENT_ID,
  clientSecret: env.DOTYPOS_CLIENT_SECRET,
  refreshToken: env.DOTYPOS_REFRESH_TOKEN,
  cloudId: env.DOTYPOS_CLOUD_ID,
  branchId: env.DOTYPOS_BRANCH_ID,
  employeeId: env.DOTYPOS_EMPLOYEE_ID,
  apiUrl: env.DOTYPOS_API_URL,
  apiTimeout: env.DOTYPOS_API_TIMEOUT,
});
