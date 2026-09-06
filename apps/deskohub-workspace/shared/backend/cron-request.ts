import "server-only";

import { env } from "@/env";

/**
 * Vercel Cron authorization: requests must carry the deployed cron secret.
 * Development runs stay authorized without the secret so local cron paths
 * remain exercisable.
 */
export const isAuthorizedCronRequest = (request: Request) => {
  if (!env.CRON_SECRET) return env.VERCEL_ENV === "development";

  return request.headers.get("authorization") === `Bearer ${env.CRON_SECRET}`;
};
