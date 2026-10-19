import "server-only";

import { Effect } from "effect";
import type { CampaignPurpose } from "../../body/campaign-content";
import type { CampaignId } from "../../campaign-identifiers";
import { isOnceCampaign, type OnceCampaignStatus } from "../../campaign-states";
import {
  invokeCampaignOperation,
  runCampaignPageQuery,
} from "../campaign-operation-query.server";

export type CampaignListItem = {
  readonly id: CampaignId;
  readonly title: string;
  readonly purpose: CampaignPurpose;
  readonly status: OnceCampaignStatus;
  /** Null when the campaign has no audience or its audience was deleted. */
  readonly audienceTitle: string | null;
  /** ISO instant. */
  readonly updatedAt: string;
};

/**
 * Every one-off campaign, newest first, with its audience title. Automated
 * campaigns have no admin pages yet.
 */
export const loadCampaignList = (): Promise<readonly CampaignListItem[]> =>
  runCampaignPageQuery(
    "email-campaigns.admin.load-campaigns",
    Effect.all(
      [
        invokeCampaignOperation("listCampaigns", {}),
        invokeCampaignOperation("listCampaignAudiences", {}),
      ],
      { concurrency: "unbounded" }
    ).pipe(
      Effect.map(([campaigns, audiences]) => {
        const audienceTitles = new Map(
          audiences.map((audience) => [audience.id, audience.title])
        );
        return campaigns.filter(isOnceCampaign).map(
          (campaign): CampaignListItem => ({
            id: campaign.id,
            title: campaign.title,
            purpose: campaign.purpose,
            status: campaign.status,
            audienceTitle:
              (campaign.audienceId &&
                audienceTitles.get(campaign.audienceId)) ??
              null,
            updatedAt: campaign.updatedAt,
          })
        );
      })
    )
  );
