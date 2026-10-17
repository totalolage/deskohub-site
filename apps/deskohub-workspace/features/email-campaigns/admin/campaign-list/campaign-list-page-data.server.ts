import "server-only";

import { Effect, Layer } from "effect";
import { authorizeAdministratorPage } from "@/features/administrators/server/administrator-authorization.server";
import { runWorkspaceEffect } from "@/shared/backend/workspace-effect";
import { CampaignService } from "../../backend/campaign.service";
import { CampaignAudienceService } from "../../backend/campaign-audience.service";
import type { CampaignPurpose } from "../../body/campaign-content";
import type { CampaignId } from "../../campaign-identifiers";
import type { CampaignStatus } from "../../campaign-states";

export type CampaignListItem = {
  readonly id: CampaignId;
  readonly title: string;
  readonly purpose: CampaignPurpose;
  readonly status: CampaignStatus;
  /** Null when the campaign has no audience or its audience was deleted. */
  readonly audienceTitle: string | null;
  /** ISO instant. */
  readonly updatedAt: string;
};

/** Every campaign, newest first, with its audience title. */
export const loadCampaignList = async (): Promise<
  readonly CampaignListItem[]
> => {
  await authorizeAdministratorPage();
  return Effect.gen(function* () {
    const campaigns = yield* CampaignService;
    const audiences = yield* CampaignAudienceService;
    const [campaignRows, audienceRows] = yield* Effect.all(
      [campaigns.list, audiences.list({ includeArchived: true })],
      { concurrency: "unbounded" }
    );
    const audienceTitles = new Map(
      audienceRows.map((audience) => [audience.id, audience.title])
    );
    return campaignRows.map((campaign) => ({
      id: campaign.id,
      title: campaign.title,
      purpose: campaign.purpose,
      status: campaign.status,
      audienceTitle:
        (campaign.audienceId && audienceTitles.get(campaign.audienceId)) ??
        null,
      updatedAt: campaign.updatedAt.toString(),
    }));
  }).pipe(
    Effect.provide(
      Layer.mergeAll(CampaignService.Live, CampaignAudienceService.Live)
    ),
    runWorkspaceEffect("email-campaigns.admin.load-campaigns", {
      boundary: "route",
    })
  );
};
