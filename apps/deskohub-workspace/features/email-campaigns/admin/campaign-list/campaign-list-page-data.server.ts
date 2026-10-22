import "server-only";

import { Effect, Option, Schema } from "effect";
import type { CampaignPurpose } from "../../body/campaign-content";
import type { CampaignId } from "../../campaign-identifiers";
import {
  type AutomatedCampaignStatus,
  type CampaignDelivery,
  campaignDeliveries,
  isAutomatedCampaign,
  isOnceCampaign,
  type OnceCampaignStatus,
} from "../../campaign-states";
import {
  invokeCampaignOperation,
  runCampaignPageQuery,
} from "../campaign-operation-query.server";

export type CampaignListItem = {
  readonly id: CampaignId;
  readonly title: string;
  readonly purpose: CampaignPurpose;
  /** Null when the campaign has no audience or its audience was deleted. */
  readonly audienceTitle: string | null;
  /** ISO instant. */
  readonly updatedAt: string;
} & (
  | { readonly delivery: "once"; readonly status: OnceCampaignStatus }
  | { readonly delivery: "automated"; readonly status: AutomatedCampaignStatus }
);

/** The list's URL parameters. */
export type CampaignListSearchParams = Promise<
  Readonly<Record<string, string | string[] | undefined>>
>;

/** The delivery the list is filtered to, or none for every campaign. */
export const loadCampaignListDelivery = async (
  searchParams: CampaignListSearchParams
): Promise<CampaignDelivery | undefined> =>
  Option.getOrUndefined(
    Schema.decodeUnknownOption(Schema.Literals(campaignDeliveries))(
      (await searchParams).delivery
    )
  );

/**
 * Every campaign of the given delivery, or of both, newest first, with its
 * audience title.
 */
export const loadCampaignList = (
  delivery: Promise<CampaignDelivery | undefined>
): Promise<readonly CampaignListItem[]> =>
  runCampaignPageQuery(
    "email-campaigns.admin.load-campaigns",
    Effect.all(
      [
        invokeCampaignOperation("listCampaigns", {}),
        invokeCampaignOperation("listCampaignAudiences", {}),
        Effect.promise(() => delivery),
      ],
      { concurrency: "unbounded" }
    ).pipe(
      Effect.map(([campaigns, audiences, shownDelivery]) => {
        const audienceTitles = new Map(
          audiences.map((audience) => [audience.id, audience.title])
        );
        return campaigns.flatMap((campaign): CampaignListItem[] => {
          if (shownDelivery && campaign.delivery !== shownDelivery) return [];
          const listed = {
            id: campaign.id,
            title: campaign.title,
            purpose: campaign.purpose,
            audienceTitle:
              (campaign.audienceId &&
                audienceTitles.get(campaign.audienceId)) ??
              null,
            updatedAt: campaign.updatedAt,
          };
          if (isOnceCampaign(campaign)) {
            return [{ ...listed, delivery: "once", status: campaign.status }];
          }
          if (isAutomatedCampaign(campaign)) {
            return [
              { ...listed, delivery: "automated", status: campaign.status },
            ];
          }
          return [];
        });
      })
    )
  );
