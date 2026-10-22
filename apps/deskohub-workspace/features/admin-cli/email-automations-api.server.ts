import { WorkspaceAdminApi } from "@deskohub/workspace-admin-api";
import { Effect } from "effect";
import { HttpApiBuilder } from "effect/unstable/httpapi";
import { cliCampaignOperationInvoker } from "./cli-campaign-operations.server";

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
        invoke("getAutomationEngineHealth", {})
      );
  })
);
