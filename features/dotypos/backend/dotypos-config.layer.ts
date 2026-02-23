import { env } from "@/env";
import { makeDotyposConfigLayer } from "@/shared/backend/config/dotypos.config";

export const DotyposConfigFromEnv = makeDotyposConfigLayer({
  clientId: env.DOTYPOS_CLIENT_ID,
  clientSecret: env.DOTYPOS_CLIENT_SECRET,
  refreshToken: env.DOTYPOS_REFRESH_TOKEN,
  cloudId: env.DOTYPOS_CLOUD_ID,
  branchId: env.DOTYPOS_BRANCH_ID,
  employeeId: env.DOTYPOS_EMPLOYEE_ID,
  apiUrl: env.DOTYPOS_API_URL,
  apiTimeout: env.DOTYPOS_API_TIMEOUT,
});
