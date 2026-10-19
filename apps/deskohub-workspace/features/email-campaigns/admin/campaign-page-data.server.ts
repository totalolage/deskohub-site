import "server-only";

import type { CampaignOperationError } from "@deskohub/workspace-admin-api";
import { Effect, Option, Schema } from "effect";
import { notFound } from "next/navigation";
import { cache } from "react";
import type { CurrentAdministrator } from "@/features/administrators/backend/current-administrator";
import { authorizeAdministratorPage } from "@/features/administrators/server/administrator-authorization.server";
import { runWorkspaceEffect } from "@/shared/backend/workspace-effect";
import {
  CampaignService,
  type OnceCampaign,
} from "../backend/campaign.service";
import type { CampaignOperations } from "../backend/campaign-operations.service";
import type { OperationRequestLedger } from "../backend/operation-request-ledger.service";
import {
  type CampaignAudienceId,
  type CampaignId,
  campaignAudienceIdSchema,
  campaignIdSchema,
} from "../campaign-identifiers";
import { isOnceCampaign } from "../campaign-states";
import {
  invokeCampaignOperation,
  runCampaignPageQuery,
} from "./campaign-operation-query.server";

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

/**
 * The one-off campaign a campaign route shows, after the admin page check.
 * Automated campaigns have no admin pages yet, so they aren't found. It
 * reads the stored campaign rather than the port's projection: the draft
 * composer edits the stored body document, and the port's Markdown body
 * doesn't round-trip it.
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

/** The title an entity's breadcrumb shows, or none when it isn't found. */
const findTitle = (
  operation: string,
  lookup: Effect.Effect<
    { readonly title: string },
    CampaignOperationError,
    CampaignOperations | CurrentAdministrator | OperationRequestLedger
  >
) =>
  runCampaignPageQuery(
    operation,
    lookup.pipe(
      Effect.map(({ title }) => Option.some(title)),
      Effect.catchTag("OperationNotFound", () => Effect.succeedNone)
    )
  ).then(Option.getOrUndefined);

const findCampaignTitle = cache((campaignId: CampaignId) =>
  findTitle(
    "email-campaigns.admin.load-campaign-title",
    invokeCampaignOperation("getCampaign", { campaignId })
  )
);

const findAudienceTitle = cache((audienceId: CampaignAudienceId) =>
  findTitle(
    "email-campaigns.admin.load-audience-title",
    invokeCampaignOperation("getCampaignAudience", { audienceId })
  )
);

export const loadCampaignBreadcrumbLabel = async (campaignId: string) => {
  await authorizeAdministratorPage();
  const decoded = Schema.decodeOption(campaignIdSchema)(campaignId);
  if (Option.isNone(decoded)) return undefined;
  return findCampaignTitle(decoded.value);
};

export const loadAudienceBreadcrumbLabel = async (audienceId: string) => {
  await authorizeAdministratorPage();
  const decoded = Schema.decodeOption(campaignAudienceIdSchema)(audienceId);
  if (Option.isNone(decoded)) return undefined;
  return findAudienceTitle(decoded.value);
};
