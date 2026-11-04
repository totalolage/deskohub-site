import { getDotyposRequestWorstCase } from "@deskohub/dotypos";
import { getGoogleCalendarRequestWorstCaseDuration } from "@deskohub/google-calendar";
import { Duration } from "effect";
import { env } from "@/env";
import { getGoogleCalendarRequestTimeout } from "@/shared/backend/config/google-calendar.config";
import { getNexiRequestTimeoutMilliseconds } from "@/shared/backend/config/nexi.config";
import type { DeploymentEnvironment } from "@/shared/deployment/deployment-stage";

/** Database, pricing, and fast Dotypos work besides the slow requests. */
const checkoutSubmitOverhead = Duration.seconds(10);

/**
 * The pay submit covers one Dotypos request attempt (the live hold guards or
 * the reservation note) and one Nexi hosted page request, which runs once,
 * plus the rest of its work. The Dotypos requests it sends are retried, and
 * this budget does not cover their retries. The discount affirmation awaits
 * Google Calendar in sequence with that work, so one retried Calendar load is
 * added on top. With the default timeouts that is about 55 seconds in
 * production and 100 seconds against the Nexi sandbox.
 */
export const getCheckoutSubmitDeadline = (
  deploymentEnvironment: DeploymentEnvironment
) =>
  [
    getGoogleCalendarRequestWorstCaseDuration(
      getGoogleCalendarRequestTimeout(deploymentEnvironment)
    ),
    getDotyposRequestWorstCase(env.DOTYPOS_API_TIMEOUT).once,
    Duration.millis(getNexiRequestTimeoutMilliseconds(deploymentEnvironment)),
  ].reduce(
    (deadline, requestTimeout) => Duration.sum(deadline, requestTimeout),
    checkoutSubmitOverhead
  );

export const checkoutSubmitDeadline = getCheckoutSubmitDeadline(env.VERCEL_ENV);
