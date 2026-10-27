import {
  destructiveOperation,
  readPreview,
  writeOperation,
} from "./administration-operation";
import {
  emailAutomationOperations,
  emailCampaignOperations,
} from "./campaign-operations";
import { campaignErrors } from "./email-campaigns";
import { operationGroup, route } from "./operation-endpoints";

/**
 * The CLI's campaign endpoints. Every endpoint declares the
 * `CliInputInvalid` an outdated `dhw` is refused with, so released binaries
 * print the refusal.
 */
export const AdminCliCampaignsApi = operationGroup(
  "campaigns",
  emailCampaignOperations,
  {
    listCampaignAudiences: route.get("/campaign-audiences"),
    getCampaignAudience: route.get("/campaign-audiences/:audienceId"),
    createCampaignAudience: route.post("/campaign-audiences", {
      behavior: writeOperation({ idempotent: true }),
    }),
    updateCampaignAudience: route.patch("/campaign-audiences/:audienceId", {
      behavior: writeOperation({ idempotent: true }),
    }),
    archiveCampaignAudience: route.post(
      "/campaign-audiences/:audienceId/archive",
      {
        behavior: destructiveOperation({
          idempotent: true,
          preview: readPreview("campaigns.getCampaignAudience"),
        }),
      }
    ),
    unarchiveCampaignAudience: route.post(
      "/campaign-audiences/:audienceId/unarchive",
      { behavior: writeOperation({ idempotent: true }) }
    ),
    deleteCampaignAudience: route.delete("/campaign-audiences/:audienceId", {
      behavior: destructiveOperation({
        idempotent: true,
        preview: readPreview("campaigns.getCampaignAudience"),
      }),
    }),
    listCampaignTemplates: route.get("/campaign-templates"),
    // The body is the preview request alone, as released `dhw` sends it.
    previewCampaignTemplate: route.post(
      "/campaign-templates/:templateKey/preview",
      { body: "preview" }
    ),
    listCampaigns: route.get("/campaigns"),
    getCampaign: route.get("/campaigns/:campaignId"),
    getCampaignEditorContent: route.get(
      "/campaigns/:campaignId/editor-content"
    ),
    createCampaign: route.post("/campaigns", {
      behavior: writeOperation({ idempotent: true }),
    }),
    updateCampaign: route.patch("/campaigns/:campaignId", {
      behavior: writeOperation({ idempotent: true }),
    }),
    duplicateCampaign: route.post("/campaigns/:campaignId/duplicate", {
      behavior: writeOperation({ idempotent: true }),
    }),
    deleteCampaign: route.delete("/campaigns/:campaignId", {
      behavior: destructiveOperation({
        idempotent: true,
        preview: readPreview("campaigns.getCampaign"),
      }),
    }),
    previewCampaignRecipients: route.get("/campaigns/:campaignId/recipients"),
    getCampaignSettings: route.get("/campaigns/settings"),
    testSendCampaign: route.post("/campaigns/:campaignId/test-send", {
      behavior: writeOperation({ idempotent: false }),
    }),
    sendCampaign: route.post("/campaigns/:campaignId/send", {
      behavior: destructiveOperation({
        idempotent: true,
        preview: readPreview(
          "campaigns.getCampaign",
          "campaigns.previewCampaignRecipients"
        ),
      }),
    }),
    retryCampaign: route.post("/campaigns/:campaignId/retry", {
      behavior: destructiveOperation({
        idempotent: false,
        preview: readPreview("campaigns.getCampaignSendStatus"),
      }),
    }),
    getCampaignSendStatus: route.get("/campaigns/:campaignId/status"),
  },
  { errors: campaignErrors }
);

/** The CLI's automation endpoints, with the campaign endpoints' errors. */
export const AdminCliAutomationsApi = operationGroup(
  "automations",
  emailAutomationOperations,
  {
    getAutomation: route.get("/automations/:campaignId/flow"),
    updateAutomationFlow: route.put("/automations/:campaignId/flow", {
      behavior: writeOperation({ idempotent: true }),
    }),
    dryRunAutomation: route.post("/automations/:campaignId/dry-run", {
      behavior: writeOperation({ idempotent: false }),
    }),
    getAutomationDryRun: route.get("/automation-dry-runs/:previewId", {
      query: true,
    }),
    activateAutomation: route.post("/automations/:campaignId/activate", {
      behavior: destructiveOperation({
        idempotent: true,
        preview: readPreview("automations.getAutomation"),
      }),
    }),
    pauseAutomation: route.post("/automations/:campaignId/pause", {
      behavior: destructiveOperation({
        idempotent: true,
        preview: readPreview("automations.getAutomation"),
      }),
    }),
    resumeAutomation: route.post("/automations/:campaignId/resume", {
      behavior: destructiveOperation({
        idempotent: true,
        preview: readPreview("automations.getAutomation"),
      }),
    }),
    archiveAutomation: route.post("/automations/:campaignId/archive", {
      behavior: destructiveOperation({
        idempotent: true,
        preview: readPreview("automations.getAutomation"),
      }),
    }),
    listAutomationVersions: route.get("/automations/:campaignId/versions"),
    getAutomationVersion: route.get(
      "/automations/:campaignId/versions/:versionNumber"
    ),
    getAutomationRunStats: route.get("/automations/:campaignId/runs/stats", {
      query: true,
    }),
    listAutomationRuns: route.get("/automations/:campaignId/runs", {
      query: true,
    }),
    getAutomationRun: route.get("/automation-runs/:runId"),
    previewCalendarExpression: route.post("/calendar-expressions/preview"),
    getAutomationEngineHealth: route.get("/automations/engine-health"),
  },
  { errors: campaignErrors }
);
