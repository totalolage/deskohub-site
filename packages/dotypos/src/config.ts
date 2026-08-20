import { Context, Layer, Schema } from "effect";
import {
  DotyposBranchIdSchema,
  DotyposClientIdSchema,
  DotyposCloudIdSchema,
  DotyposEmployeeIdSchema,
  DotyposTableIdSchema,
} from "./types";

export const DotyposRuntimeConfigSchema = Schema.Struct({
  clientId: DotyposClientIdSchema,
  clientSecret: Schema.NonEmptyString,
  refreshToken: Schema.NonEmptyString,
  cloudId: DotyposCloudIdSchema,
  branchId: DotyposBranchIdSchema,
  employeeId: DotyposEmployeeIdSchema,
  apiUrl: Schema.NonEmptyString,
  apiTimeout: Schema.Finite.check(
    Schema.isGreaterThan(0, { description: "API timeout in milliseconds" })
  ),
  reservationTableIds: Schema.Array(DotyposTableIdSchema),
});

export type DotyposRuntimeConfigObj = Schema.Schema.Type<
  typeof DotyposRuntimeConfigSchema
>;

export class DotyposRuntimeConfig extends Context.Service<
  DotyposRuntimeConfig,
  DotyposRuntimeConfigObj
>()("@deskohub/dotypos/DotyposRuntimeConfig") {}

export const makeDotyposRuntimeConfigLayer = (
  config: DotyposRuntimeConfigObj
) => Layer.succeed(DotyposRuntimeConfig, config);
