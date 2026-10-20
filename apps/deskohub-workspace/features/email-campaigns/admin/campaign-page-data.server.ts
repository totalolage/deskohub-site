import "server-only";

import { Effect, Option, Schema } from "effect";
import { notFound } from "next/navigation";
import { cache } from "react";
import { authorizeAdministratorPage } from "@/features/administrators/server/administrator-authorization.server";
import { runWorkspaceEffect } from "@/shared/backend/workspace-effect";
import {
  CampaignService,
  type OnceCampaign,
} from "../backend/campaign.service";
import { CampaignAudienceService } from "../backend/campaign-audience.service";
import {
  type CampaignAudienceId,
  type CampaignId,
  campaignAudienceIdSchema,
  campaignIdSchema,
} from "../campaign-identifiers";
import { isOnceCampaign } from "../campaign-states";

/** Decodes a campaign route segment, or renders the not-found page. */
export const requireCampaignRouteId = (value: string): CampaignId =>
  Option.getOrElse(Schema.decodeOption(campaignIdSchema)(value), () =>
    notFound()
  );

/** Decodes an audience route segment, or renders the not-found page. */
export const requireAudienceRouteId = (value: string): CampaignAudienceId =>
  Option.getOrElse(Schema.decodeOption(campaignAudienceIdSchema)(value), () =>
    notFound()
  );

const findCampaign = cache(
  Effect.fn(
    function* (campaignId: CampaignId) {
      const campaigns = yield* CampaignService;
      return yield* campaigns.get(campaignId).pipe(Effect.option);
    },
    (effect) =>
      effect.pipe(
        Effect.provide(CampaignService.Live),
        runWorkspaceEffect("email-campaigns.admin.load-campaign", {
          boundary: "route",
        })
      )
  )
);

const findAudience = cache(
  Effect.fn(
    function* (audienceId: CampaignAudienceId) {
      const audiences = yield* CampaignAudienceService;
      return yield* audiences.get(audienceId).pipe(Effect.option);
    },
    (effect) =>
      effect.pipe(
        Effect.provide(CampaignAudienceService.Live),
        runWorkspaceEffect("email-campaigns.admin.load-audience", {
          boundary: "route",
        })
      )
  )
);

/**
 * The one-off campaign a campaign route shows, after the admin page check.
 * Automated campaigns have no admin pages yet, so they aren't found.
 */
export const loadAdminCampaign = async (
  campaignId: CampaignId
): Promise<OnceCampaign> => {
  await authorizeAdministratorPage();
  return Option.getOrElse(
    Option.filter(await findCampaign(campaignId), isOnceCampaign),
    () => notFound()
  );
};

export const loadCampaignBreadcrumbLabel = async (campaignId: string) => {
  await authorizeAdministratorPage();
  const decoded = Schema.decodeOption(campaignIdSchema)(campaignId);
  if (Option.isNone(decoded)) return undefined;
  return Option.getOrUndefined(await findCampaign(decoded.value))?.title;
};

export const loadAudienceBreadcrumbLabel = async (audienceId: string) => {
  await authorizeAdministratorPage();
  const decoded = Schema.decodeOption(campaignAudienceIdSchema)(audienceId);
  if (Option.isNone(decoded)) return undefined;
  return Option.getOrUndefined(await findAudience(decoded.value))?.title;
};
