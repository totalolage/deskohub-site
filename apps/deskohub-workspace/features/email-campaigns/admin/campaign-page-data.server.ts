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
import {
  AdministrationRecordNotFound,
  runAdministrationPage,
} from "@/features/administrators/server/administration-request.server";
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
  campaignOperationCapabilities,
  invokeCampaignOperation,
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

/** A campaign the port can't find answers with the not-found page. */
const recordNotFound = <A, R>(
  lookup: Effect.Effect<A, CampaignOperationError, R>
) =>
  lookup.pipe(
    Effect.catchTag("OperationNotFound", () =>
      Effect.fail(new AdministrationRecordNotFound())
    )
  );

const findCampaign = cache((campaignId: CampaignId) =>
  runAdministrationPage(
    "email-campaigns.admin.load-campaign",
    invokeCampaignOperation("getCampaign", { campaignId }).pipe(recordNotFound),
    campaignOperationCapabilities
  )
);

/**
 * Which page family a campaign route renders, after the admin page check, or
 * the not-found page.
 */
export const loadCampaignDelivery = async (
  campaignId: CampaignId
): Promise<CampaignDelivery> => (await findCampaign(campaignId)).delivery;

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
  const campaign = await findCampaign(campaignId);
  return isOnceCampaignDetail(campaign) ? campaign : notFound();
};

const findCampaignEditorContent = cache((campaignId: CampaignId) =>
  runAdministrationPage(
    "email-campaigns.admin.load-editor-content",
    invokeCampaignOperation("getCampaignEditorContent", { campaignId }).pipe(
      recordNotFound
    ),
    campaignOperationCapabilities
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
  const campaign = await findCampaignEditorContent(campaignId);
  return campaign.delivery === delivery ? campaign : notFound();
};

/**
 * The title an entity's breadcrumb shows, or undefined when its route id is
 * malformed or it isn't found.
 */
const findTitle = <Id>(
  operation: string,
  id: Option.Option<Id>,
  lookup: (
    id: Id
  ) => Effect.Effect<
    { readonly title: string },
    CampaignOperationError,
    CampaignOperations | CurrentAdministrator | OperationRequestLedger
  >
) =>
  runAdministrationPage(
    operation,
    Option.match(id, {
      onNone: () => Effect.undefined,
      onSome: (decoded) =>
        lookup(decoded).pipe(
          Effect.map(({ title }): string | undefined => title),
          Effect.catchTag("OperationNotFound", () => Effect.undefined)
        ),
    }),
    campaignOperationCapabilities
  );

export const loadCampaignBreadcrumbLabel = cache((campaignId: string) =>
  findTitle(
    "email-campaigns.admin.load-campaign-title",
    Schema.decodeOption(campaignIdSchema)(campaignId),
    (decoded) => invokeCampaignOperation("getCampaign", { campaignId: decoded })
  )
);

export const loadAudienceBreadcrumbLabel = cache((audienceId: string) =>
  findTitle(
    "email-campaigns.admin.load-audience-title",
    Schema.decodeOption(campaignAudienceIdSchema)(audienceId),
    (decoded) =>
      invokeCampaignOperation("getCampaignAudience", { audienceId: decoded })
  )
);
