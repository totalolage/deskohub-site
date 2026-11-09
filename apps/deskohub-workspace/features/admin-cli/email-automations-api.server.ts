import {
  AdminCliAutomationsApi,
  type AutomationEngineHealthType,
  AutomationEngineWarning,
  automationEngineWarningDhwVersions,
  type DhwVersion,
  openEngineWarningsDhwVersion,
  operationGroupHandlers,
  WorkspaceAdminApi,
} from "@deskohub/workspace-admin-api";
import { Effect, Option, Schema } from "effect";
import { cliCampaignOperationInvoker } from "./cli-campaign-operations.server";
import {
  cliClientIsAtLeast,
  currentCliClientVersion,
} from "./cli-client-version";

const isKnownWarning = Schema.is(AutomationEngineWarning);

/**
 * The report without the warnings the calling binary can't decode. Released
 * binaries read warnings as a closed list and would reject the whole report
 * on a newer code, so they get the rest of it instead. A request without a
 * version gets every warning: the group's minimum refuses a binary that
 * sends none, so it is an AI assistant, whose tools derive from the current
 * contract.
 */
const engineHealthReadableBy = (
  health: AutomationEngineHealthType,
  clientVersion: Option.Option<DhwVersion>
): AutomationEngineHealthType =>
  Option.isNone(clientVersion)
    ? health
    : {
        ...health,
        warnings: health.warnings.filter((warning) =>
          cliClientIsAtLeast(
            clientVersion,
            isKnownWarning(warning)
              ? automationEngineWarningDhwVersions[warning]
              : openEngineWarningsDhwVersion
          )
        ),
      };

/**
 * Every automation endpoint is the port's operation of the same name, with
 * the input the request carries. The engine health report leaves out what
 * the calling binary can't decode.
 */
export const AdminCliAutomationsApiHandlers = operationGroupHandlers(
  WorkspaceAdminApi,
  AdminCliAutomationsApi,
  cliCampaignOperationInvoker,
  {
    getAutomationEngineHealth: (health: AutomationEngineHealthType) =>
      Effect.map(currentCliClientVersion, (clientVersion) =>
        engineHealthReadableBy(health, clientVersion)
      ),
  }
);
