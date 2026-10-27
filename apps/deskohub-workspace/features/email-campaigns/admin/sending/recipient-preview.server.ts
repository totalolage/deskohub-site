import "server-only";

import type {
  AdministrationCampaignAudienceType,
  AdministrationCampaignDetailType,
  AdministrationCampaignRecipientPreviewType,
  CampaignOperationError,
} from "@deskohub/workspace-admin-api";
import { Effect, Match, Option } from "effect";
import { redirect } from "next/navigation";
import {
  AdministrationRecordNotFound,
  runAdministrationPage,
} from "@/features/administrators/server/administration-request.server";
import { getLocalizedPagePath } from "@/features/i18n/routing";
import { getRequestLocale } from "@/features/i18n/server/request-locale";
import type { CampaignId } from "../../campaign-identifiers";
import { describeAudienceFilter } from "../audience-filter-summary";
import { loadAudienceValueLookups } from "../audiences/audience-value-lookups.server";
import {
  campaignOperationCapabilities,
  invokeCampaignOperation,
} from "../campaign-operation-query.server";

type Campaign = AdministrationCampaignDetailType;

export type RecipientPreview =
  | { readonly kind: "no-audience"; readonly campaign: Campaign }
  | {
      readonly kind: "unavailable";
      readonly campaign: Campaign;
      readonly audienceTitle: string;
      readonly audienceSummary: string;
    }
  | {
      readonly kind: "resolved";
      readonly campaign: Campaign;
      readonly audienceTitle: string;
      readonly audienceSummary: string;
      readonly resolution: AdministrationCampaignRecipientPreviewType;
    };

/** What the port says about a campaign's recipients, before the summary. */
type RecipientPreviewQuery =
  | { readonly kind: "not-draft" }
  | { readonly kind: "no-audience"; readonly campaign: Campaign }
  | {
      readonly kind: "unavailable";
      readonly campaign: Campaign;
      readonly audience: AdministrationCampaignAudienceType;
    }
  | {
      readonly kind: "resolved";
      readonly campaign: Campaign;
      readonly audience: AdministrationCampaignAudienceType;
      readonly resolution: AdministrationCampaignRecipientPreviewType;
    };

/**
 * The Draft lost its audience after it was read: someone cleared it, or the
 * audience was deleted.
 */
const isAudienceGone = (error: CampaignOperationError) =>
  error._tag === "OperationConflict" ||
  (error._tag === "OperationNotFound" && error.code === "audience-not-found");

const isResolutionUnavailable = (error: CampaignOperationError) =>
  error._tag === "OperationUnavailable" &&
  error.code === "recipient-resolution-unavailable";

const queryRecipientPreview = Effect.fn("loadRecipientPreview")(
  function* (campaignId: CampaignId) {
    const campaign = yield* invokeCampaignOperation("getCampaign", {
      campaignId,
    });
    // Automated campaigns have no admin pages yet.
    if (campaign.delivery !== "once") {
      return yield* new AdministrationRecordNotFound();
    }
    if (campaign.status !== "draft") return { kind: "not-draft" } as const;
    if (campaign.audienceId === null) {
      return { kind: "no-audience", campaign } as const;
    }
    const found = yield* invokeCampaignOperation("getCampaignAudience", {
      audienceId: campaign.audienceId,
    }).pipe(
      Effect.map(Option.some),
      Effect.catchTag("OperationNotFound", () => Effect.succeedNone)
    );
    if (Option.isNone(found)) return { kind: "no-audience", campaign } as const;
    const audience = found.value;
    return yield* invokeCampaignOperation("previewCampaignRecipients", {
      campaignId,
    }).pipe(
      Effect.map(
        (resolution): RecipientPreviewQuery => ({
          kind: "resolved",
          campaign,
          audience,
          resolution,
        })
      ),
      Effect.catchIf(isResolutionUnavailable, () =>
        Effect.succeed<RecipientPreviewQuery>({
          kind: "unavailable",
          campaign,
          audience,
        })
      ),
      Effect.catchIf(isAudienceGone, () =>
        Effect.succeed<RecipientPreviewQuery>({ kind: "no-audience", campaign })
      )
    );
  },
  Effect.catchTag("OperationNotFound", () =>
    Effect.fail(new AdministrationRecordNotFound())
  )
);

/**
 * Resolves a Draft's audience as the real send would right now. A campaign
 * that left Draft shows its frozen recipients on the campaign page instead.
 */
export const loadRecipientPreview = async (
  campaignId: CampaignId
): Promise<RecipientPreview> => {
  const [query, lookups, locale] = await Promise.all([
    runAdministrationPage(
      "email-campaigns.admin.preview-recipients",
      queryRecipientPreview(campaignId),
      campaignOperationCapabilities
    ),
    loadAudienceValueLookups(),
    getRequestLocale(),
  ]);
  const describe = (audience: AdministrationCampaignAudienceType) => ({
    audienceTitle: audience.title,
    audienceSummary: describeAudienceFilter(audience.filter, locale, lookups),
  });
  return Match.value(query).pipe(
    Match.discriminatorsExhaustive("kind")({
      "not-draft": () =>
        redirect(
          getLocalizedPagePath(
            locale,
            "/[locale]/admin/email-campaigns/[campaignId]",
            { campaignId }
          )
        ),
      "no-audience": ({ campaign }): RecipientPreview => ({
        kind: "no-audience",
        campaign,
      }),
      unavailable: ({ campaign, audience }): RecipientPreview => ({
        kind: "unavailable",
        campaign,
        ...describe(audience),
      }),
      resolved: ({ campaign, audience, resolution }): RecipientPreview => ({
        kind: "resolved",
        campaign,
        ...describe(audience),
        resolution,
      }),
    })
  );
};
