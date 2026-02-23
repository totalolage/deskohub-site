import { Context, Layer, Schema } from "effect";

export const DotyposRuntimeConfigSchema = Schema.Struct({
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
  reservationTableIds: Schema.Array(Schema.NonEmptyString),
});

export type DotyposRuntimeConfigObj = Schema.Schema.Type<
  typeof DotyposRuntimeConfigSchema
>;

export class DotyposRuntimeConfig extends Context.Tag(
  "@deskohub/dotypos/DotyposRuntimeConfig"
)<DotyposRuntimeConfig, DotyposRuntimeConfigObj>() {}

export const makeDotyposRuntimeConfigLayer = (
  config: DotyposRuntimeConfigObj
) => Layer.succeed(DotyposRuntimeConfig, config);
