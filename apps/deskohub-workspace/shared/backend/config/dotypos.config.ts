import {
  DotyposRuntimeConfig,
  type DotyposRuntimeConfigObj,
  DotyposService,
} from "@deskohub/dotypos";
import { Layer } from "effect";
import { env } from "@/env";

export const DotyposRuntimeConfigLive = Layer.succeed(DotyposRuntimeConfig, {
  clientId: env.DOTYPOS_CLIENT_ID,
  clientSecret: env.DOTYPOS_CLIENT_SECRET,
  refreshToken: env.DOTYPOS_REFRESH_TOKEN,
  cloudId: env.DOTYPOS_CLOUD_ID,
  branchId: env.DOTYPOS_BRANCH_ID,
  employeeId: env.DOTYPOS_EMPLOYEE_ID,
  apiUrl: env.DOTYPOS_API_URL,
  apiTimeout: env.DOTYPOS_API_TIMEOUT,
  reservationTableIds: [],
} satisfies DotyposRuntimeConfigObj);

export const DotyposServiceLive = DotyposService.Default.pipe(
  Layer.provide(DotyposRuntimeConfigLive)
);
