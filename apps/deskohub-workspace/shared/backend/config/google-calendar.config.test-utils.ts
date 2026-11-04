import { Duration } from "effect";
import type { DeploymentEnvironment } from "@/shared/deployment/deployment-stage";
import { getGoogleCalendarRequestTimeout } from "./google-calendar.config";

/**
 * How long a Google Calendar load of a deployment takes when its first
 * attempt times out and the retry answers just before its own timeout: the
 * slowest load that still succeeds (9.5 seconds in production, 29.5
 * elsewhere).
 */
export const getSlowestSuccessfulCalendarLoad = (
  deploymentEnvironment: DeploymentEnvironment
) => {
  const attempt = Duration.toMillis(
    getGoogleCalendarRequestTimeout(deploymentEnvironment)
  );
  return Duration.millis(attempt + 100 + (attempt - 600));
};
