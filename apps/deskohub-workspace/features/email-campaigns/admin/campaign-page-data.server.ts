import "server-only";

import type {
  AdministrationCampaignDetailType,
  AdministrationCampaignEditorContentType,
  CampaignOperationError,
} from "@deskohub/workspace-admin-api";
import { Effect, Option, Schema } from "effect";
import { notFound } from "next/navigation";
import { cache } from "react";
import type { CurrentAdministrator } from "@/features/administrators/backend/current-administrator";
import { authorizeAdministratorPage } from "@/features/administrators/server/administrator-authorization.server";
import type { CampaignOperations } from "../backend/campaign-operations.service";
import type { OperationRequestLedger } from "../backend/operation-request-ledger.service";
import {
  type CampaignAudienceId,
  type CampaignId,
  campaignAudienceIdSchema,
  campaignIdSchema,
} from "../campaign-identifiers";
import {
  type CampaignDelivery,
  isOnceCampaign,
  type OnceCampaignStatus,
} from "../campaign-states";
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

const findCampaign = cache((campaignId: CampaignId) =>
  runCampaignPageQuery(
    "email-campaigns.admin.load-campaign",
    invokeCampaignOperation("getCampaign", { campaignId }).pipe(
      Effect.map(Option.some),
      Effect.catchTag("OperationNotFound", () => Effect.succeedNone)
    )
  )
);

/**
 * Which page family a campaign route renders, after the admin page check, or
 * the not-found page.
 */
export const loadCampaignDelivery = async (
  campaignId: CampaignId
): Promise<CampaignDelivery> => {
  await authorizeAdministratorPage();
  return Option.getOrElse(
    Option.map(await findCampaign(campaignId), ({ delivery }) => delivery),
    () => notFound()
  );
};

/** A one-off campaign as the port reports it. */
export type OnceCampaignDetail = AdministrationCampaignDetailType & {
  readonly delivery: "once";
  readonly status: OnceCampaignStatus;
};

const isOnceCampaignDetail = (
  campaign: AdministrationCampaignDetailType
): campaign is OnceCampaignDetail => isOnceCampaign(campaign);

/**
 * The one-off campaign a sent campaign's page shows, after the admin page
 * check. Automated campaigns have their own pages, so they aren't found here.
 */
export const loadAdminCampaign = async (
  campaignId: CampaignId
): Promise<OnceCampaignDetail> => {
  await authorizeAdministratorPage();
  return Option.getOrElse(
    Option.filter(await findCampaign(campaignId), isOnceCampaignDetail),
    () => notFound()
  );
};

const findCampaignEditorContent = cache((campaignId: CampaignId) =>
  runCampaignPageQuery(
    "email-campaigns.admin.load-editor-content",
    invokeCampaignOperation("getCampaignEditorContent", { campaignId }).pipe(
      Effect.map(Option.some),
      Effect.catchTag("OperationNotFound", () => Effect.succeedNone)
    )
  )
);

/**
 * The campaign a composer edits, with its bodies as the editor holds them,
 * after the admin page check: a one-off campaign, or an automated campaign's
 * email and audience. A campaign of the other delivery renders the
 * not-found page.
 */
export const loadCampaignEditorContent = async (
  campaignId: CampaignId,
  delivery: CampaignDelivery
): Promise<AdministrationCampaignEditorContentType> => {
  await authorizeAdministratorPage();
  return Option.getOrElse(
    Option.filter(
      await findCampaignEditorContent(campaignId),
      (campaign) => campaign.delivery === delivery
    ),
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
