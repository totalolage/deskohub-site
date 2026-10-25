import {
  type AutomationEngineHealthType,
  AutomationEngineWarning,
  automationEngineWarningDhwVersions,
  type DhwVersion,
  openEngineWarningsDhwVersion,
  WorkspaceAdminApi,
} from "@deskohub/workspace-admin-api";
import { Effect, Option, Schema } from "effect";
import { HttpApiBuilder } from "effect/unstable/httpapi";
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
 * the request's params, query and payload as the input.
 */
export const AdminCliAutomationsApiHandlers = HttpApiBuilder.group(
  WorkspaceAdminApi,
  "automations",
  Effect.fn(function* (handlers) {
    const invoke = yield* cliCampaignOperationInvoker;

    return handlers
      .handle("getAutomation", ({ params }) => invoke("getAutomation", params))
      .handle("updateAutomationFlow", ({ params, payload }) =>
        invoke("updateAutomationFlow", { ...params, ...payload })
      )
      .handle("dryRunAutomation", ({ params }) =>
        invoke("dryRunAutomation", params)
      )
      .handle("getAutomationDryRun", ({ params, query }) =>
        invoke("getAutomationDryRun", { ...params, ...query })
      )
      .handle("activateAutomation", ({ params, payload }) =>
        invoke("activateAutomation", { ...params, ...payload })
      )
      .handle("pauseAutomation", ({ params }) =>
        invoke("pauseAutomation", params)
      )
      .handle("resumeAutomation", ({ params }) =>
        invoke("resumeAutomation", params)
      )
      .handle("archiveAutomation", ({ params }) =>
        invoke("archiveAutomation", params)
      )
      .handle("listAutomationVersions", ({ params }) =>
        invoke("listAutomationVersions", params)
      )
      .handle("getAutomationVersion", ({ params }) =>
        invoke("getAutomationVersion", params)
      )
      .handle("getAutomationRunStats", ({ params, query }) =>
        invoke("getAutomationRunStats", { ...params, ...query })
      )
      .handle("listAutomationRuns", ({ params, query }) =>
        invoke("listAutomationRuns", { ...params, ...query })
      )
      .handle("getAutomationRun", ({ params }) =>
        invoke("getAutomationRun", params)
      )
      .handle("previewCalendarExpression", ({ payload }) =>
        invoke("previewCalendarExpression", payload)
      )
      .handle("getAutomationEngineHealth", () =>
        Effect.zipWith(
          invoke("getAutomationEngineHealth", {}),
          currentCliClientVersion,
          engineHealthReadableBy
        )
      );
  })
);
