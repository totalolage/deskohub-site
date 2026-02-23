/**
 * Dotypos Configuration
 *
 * Centralized configuration for Dotypos API integration
 */

import {
  DotyposRuntimeConfig,
  type DotyposRuntimeConfigObj,
} from "@deskohub/dotypos/config";
import { Effect, Layer, Schema } from "effect";
import { env } from "@/env";
import { siteConstants } from "@/shared/utils/constants";
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
  reservationTableIds: Schema.Array(Schema.NonEmptyString),
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
): DotyposConfigObj =>
  decodeDotyposConfig({
    ...input,
    reservationTableIds:
      siteConstants.tableReservation.tablesToAssignReservationsTo,
  });

/**
 * Context tag for dependency injection
 */
export class DotyposConfig extends Effect.Service<DotyposConfig>()(
  "DotyposConfig",
  {
    succeed: {
      clientId: env.DOTYPOS_CLIENT_ID,
      clientSecret: env.DOTYPOS_CLIENT_SECRET,
      refreshToken: env.DOTYPOS_REFRESH_TOKEN,
      cloudId: env.DOTYPOS_CLOUD_ID,
      branchId: env.DOTYPOS_BRANCH_ID,
      employeeId: env.DOTYPOS_EMPLOYEE_ID,
      apiUrl: env.DOTYPOS_API_URL,
      apiTimeout: env.DOTYPOS_API_TIMEOUT,
      reservationTableIds:
        siteConstants.tableReservation.tablesToAssignReservationsTo,
    },
  }
) {}

export const DotyposRuntimeConfigLive = Layer.succeed(DotyposRuntimeConfig, {
  clientId: env.DOTYPOS_CLIENT_ID,
  clientSecret: env.DOTYPOS_CLIENT_SECRET,
  refreshToken: env.DOTYPOS_REFRESH_TOKEN,
  cloudId: env.DOTYPOS_CLOUD_ID,
  branchId: env.DOTYPOS_BRANCH_ID,
  employeeId: env.DOTYPOS_EMPLOYEE_ID,
  apiUrl: env.DOTYPOS_API_URL,
  apiTimeout: env.DOTYPOS_API_TIMEOUT,
  reservationTableIds:
    siteConstants.tableReservation.tablesToAssignReservationsTo,
} satisfies DotyposRuntimeConfigObj);

export const makeDotyposConfigLayer = (input: DotyposConfigInput) =>
  Layer.succeed(DotyposRuntimeConfig, parseDotyposConfig(input));
