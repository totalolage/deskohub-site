import "server-only";

import { and, eq, isNull, sql } from "drizzle-orm";
import {
  emailCampaignAutomationVersions,
  emailCampaignSends,
  emailCampaigns,
} from "@/db/schema";
import type { CampaignPurpose } from "../body/campaign-content";
import type { CampaignId } from "../campaign-identifiers";

/**
 * The one send of a `once` campaign. An automated campaign has a send per
 * delivered batch, each with its `automation_version_id`; one-off reads,
 * retries and views select only the send without one.
 */
export const onceCampaignSend = (campaignId: CampaignId) =>
  and(
    eq(emailCampaignSends.campaignId, campaignId),
    isNull(emailCampaignSends.automationVersionId)
  );

/**
 * Left-joins a send's automation version: an automated send mails the
 * purpose, template and content its version pinned, not the campaign's
 * current draft.
 */
export const sendAutomationVersion = eq(
  emailCampaignAutomationVersions.id,
  emailCampaignSends.automationVersionId
);

/**
 * The purpose a send was mailed under, given {@link sendAutomationVersion}
 * and its campaign joined: the version's for an automated send, else the
 * campaign's.
 */
export const sendPurpose = sql<CampaignPurpose>`coalesce(${emailCampaignAutomationVersions.purpose}, ${emailCampaigns.purpose})`;
