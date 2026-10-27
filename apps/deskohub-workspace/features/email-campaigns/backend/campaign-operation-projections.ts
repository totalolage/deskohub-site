import type {
  AdministrationCampaignAudienceType,
  AdministrationCampaignDetailType,
  AdministrationCampaignEditorContentType,
  AdministrationCampaignSendStatusResultType,
  AdministrationCampaignSummaryType,
} from "@deskohub/workspace-admin-api";
import { type Effect, Option } from "effect";
import type { CampaignAudienceRow, CampaignRow } from "@/db/schema";
import {
  campaignContentLocales,
  writeCampaignContent,
} from "../body/campaign-content-codec";
import type { ICampaignSendStatusService } from "./campaign-send-status.service";

export const toAdministrationAudience = (
  audience: CampaignAudienceRow
): AdministrationCampaignAudienceType => ({
  id: audience.id,
  title: audience.title,
  filter: audience.filter,
  archivedAt: audience.archivedAt?.toString() ?? null,
  createdAt: audience.createdAt.toString(),
  updatedAt: audience.updatedAt.toString(),
});

export const toAdministrationCampaignSummary = (
  campaign: CampaignRow
): AdministrationCampaignSummaryType => ({
  id: campaign.id,
  title: campaign.title,
  purpose: campaign.purpose,
  templateKey: campaign.templateKey,
  delivery: campaign.delivery,
  status: campaign.status,
  audienceId: campaign.audienceId,
  locales: campaignContentLocales(campaign.content),
  createdAt: campaign.createdAt.toString(),
  updatedAt: campaign.updatedAt.toString(),
});

export const toAdministrationCampaignDetail = (
  campaign: CampaignRow
): AdministrationCampaignDetailType => ({
  ...toAdministrationCampaignSummary(campaign),
  content: writeCampaignContent(campaign.content, "markdown"),
});

/** The campaign with its bodies as stored, which the editor edits losslessly. */
export const toAdministrationCampaignEditorContent = (
  campaign: CampaignRow
): AdministrationCampaignEditorContentType => ({
  ...toAdministrationCampaignSummary(campaign),
  content: writeCampaignContent(campaign.content, "document"),
});

export const toAdministrationSendStatus = (
  status: Effect.Success<ReturnType<ICampaignSendStatusService["get"]>>
): AdministrationCampaignSendStatusResultType => ({
  send: Option.match(status, {
    onNone: () => null,
    onSome: (send) => ({
      sendId: send.sendId,
      createdAt: send.createdAt.toString(),
      completedAt: send.completedAt?.toString() ?? null,
      audienceId: send.audienceId,
      audienceFilter: send.audienceFilter,
      counts: send.counts,
      recipients: send.recipients.map((recipient) => ({
        customerId: recipient.dotyposCustomerId,
        locale: recipient.locale,
        status: recipient.status,
        skipReason: recipient.skipReason,
        statusUpdatedAt: recipient.statusUpdatedAt.toString(),
      })),
    }),
  }),
});
