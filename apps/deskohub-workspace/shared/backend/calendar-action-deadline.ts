import { getGoogleCalendarRequestWorstCaseDuration } from "@deskohub/google-calendar";
import { Duration } from "effect";
import type { DeploymentEnvironment } from "@/shared/deployment/deployment-stage";
import { getGoogleCalendarRequestTimeout } from "./config/google-calendar.config";
import { workspaceActionDeadline } from "./workspace-action";

/**
 * The ordinary action deadline plus `sequentialCalendarLoads` retried Google
 * Calendar loads, for an action that awaits Calendar in sequence with its
 * other work. A Calendar load parallel with other work still counts unless
 * that work is reliably slower. The added budget lets each Calendar retry
 * succeed; like the ordinary deadline, it does not cover every other provider
 * being slow at once.
 */
export const getCalendarActionDeadline = (
  deploymentEnvironment: DeploymentEnvironment,
  sequentialCalendarLoads: number
) =>
  Duration.sum(
    workspaceActionDeadline,
    Duration.times(
      getGoogleCalendarRequestWorstCaseDuration(
        getGoogleCalendarRequestTimeout(deploymentEnvironment)
      ),
      sequentialCalendarLoads
    )
  );
