/**
 * Dotypos Configuration
 *
 * Centralized configuration for Dotypos API integration
 */

import { Context, Layer, Schema } from "effect";

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

export type DotyposConfigObj = Schema.Schema.Type<typeof DotyposConfigSchema>;

export type DotyposConfigInput = {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  cloudId: string;
  branchId: string;
  employeeId: string;
  apiUrl: string;
  apiTimeout: number;
};

const decodeDotyposConfig = Schema.decodeUnknownSync(DotyposConfigSchema);

export const parseDotyposConfig = (
  input: DotyposConfigInput
): DotyposConfigObj => decodeDotyposConfig(input);

/**
 * Context tag for dependency injection
 */
export const DotyposConfig =
  Context.GenericTag<DotyposConfigObj>("@app/DotyposConfig");

export const makeDotyposConfigLayer = (input: DotyposConfigInput) =>
  Layer.succeed(DotyposConfig, parseDotyposConfig(input));
