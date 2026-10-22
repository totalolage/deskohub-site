import { WorkspaceAdminApi } from "@deskohub/workspace-admin-api";
import { Effect } from "effect";
import { HttpApiBuilder } from "effect/unstable/httpapi";
import { cliCampaignOperationInvoker } from "./cli-campaign-operations.server";

/**
 * Every campaign endpoint is the port's operation of the same name: the
 * session's administrator, the session's mutation ledger, and the request's
 * params and payload as the input.
 */
export const AdminCliCampaignsApiHandlers = HttpApiBuilder.group(
  WorkspaceAdminApi,
  "campaigns",
  Effect.fn(function* (handlers) {
    const invoke = yield* cliCampaignOperationInvoker;

    return handlers
      .handle("listCampaignAudiences", () =>
        invoke("listCampaignAudiences", {})
      )
      .handle("getCampaignAudience", ({ params }) =>
        invoke("getCampaignAudience", params)
      )
      .handle("createCampaignAudience", ({ payload }) =>
        invoke("createCampaignAudience", payload)
      )
      .handle("updateCampaignAudience", ({ params, payload }) =>
        invoke("updateCampaignAudience", { ...params, ...payload })
      )
      .handle("archiveCampaignAudience", ({ params }) =>
        invoke("archiveCampaignAudience", params)
      )
      .handle("unarchiveCampaignAudience", ({ params }) =>
        invoke("unarchiveCampaignAudience", params)
      )
      .handle("deleteCampaignAudience", ({ params }) =>
        invoke("deleteCampaignAudience", params)
      )
      .handle("listCampaignTemplates", () =>
        invoke("listCampaignTemplates", {})
      )
      .handle("previewCampaignTemplate", ({ params, payload }) =>
        invoke("previewCampaignTemplate", { ...params, preview: payload })
      )
      .handle("listCampaigns", () => invoke("listCampaigns", {}))
      .handle("getCampaign", ({ params }) => invoke("getCampaign", params))
      .handle("getCampaignEditorContent", ({ params }) =>
        invoke("getCampaignEditorContent", params)
      )
      .handle("createCampaign", ({ payload }) =>
        invoke("createCampaign", payload)
      )
      .handle("updateCampaign", ({ params, payload }) =>
        invoke("updateCampaign", { ...params, ...payload })
      )
      .handle("duplicateCampaign", ({ params, payload }) =>
        invoke("duplicateCampaign", { ...params, ...payload })
      )
      .handle("deleteCampaign", ({ params }) =>
        invoke("deleteCampaign", params)
      )
      .handle("previewCampaignRecipients", ({ params }) =>
        invoke("previewCampaignRecipients", params)
      )
      .handle("getCampaignSettings", () => invoke("getCampaignSettings", {}))
      .handle("testSendCampaign", ({ params, payload }) =>
        invoke("testSendCampaign", { ...params, ...payload })
      )
      .handle("sendCampaign", ({ params, payload }) =>
        invoke("sendCampaign", { ...params, ...payload })
      )
      .handle("retryCampaign", ({ params, payload }) =>
        invoke("retryCampaign", { ...params, ...payload })
      )
      .handle("getCampaignSendStatus", ({ params }) =>
        invoke("getCampaignSendStatus", params)
      );
  })
);
