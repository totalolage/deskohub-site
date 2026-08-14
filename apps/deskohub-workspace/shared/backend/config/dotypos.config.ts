import {
  DotyposRuntimeConfig,
  DotyposRuntimeConfigSchema,
  DotyposService,
} from "@deskohub/dotypos";
import { Layer, Schema } from "effect";
import { env } from "@/env";

export const WorkspaceDotyposRuntimeConfigLayer = Layer.effect(
  DotyposRuntimeConfig,
  Schema.decodeUnknownEffect(DotyposRuntimeConfigSchema)({
    clientId: env.DOTYPOS_CLIENT_ID,
    clientSecret: env.DOTYPOS_CLIENT_SECRET,
    refreshToken: env.DOTYPOS_REFRESH_TOKEN,
    cloudId: env.DOTYPOS_CLOUD_ID,
    branchId: env.DOTYPOS_BRANCH_ID,
    employeeId: env.DOTYPOS_EMPLOYEE_ID,
    apiUrl: env.DOTYPOS_API_URL,
    apiTimeout: env.DOTYPOS_API_TIMEOUT,
    reservationTableIds: [],
  })
);

export const WorkspaceDotyposLayer = DotyposService.LiveWithDependencies.pipe(
  Layer.provide(WorkspaceDotyposRuntimeConfigLayer)
);
