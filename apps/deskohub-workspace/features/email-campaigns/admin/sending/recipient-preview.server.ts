import "server-only";

import { Effect, Layer } from "effect";
import { redirect } from "next/navigation";
import type { CampaignRow } from "@/db/schema";
import { localizeAdministrationHref } from "@/features/administration/administration-href";
import { getRequestLocale } from "@/features/i18n/server/request-locale";
import { runWorkspaceEffect } from "@/shared/backend/workspace-effect";
import { CampaignAudienceService } from "../../backend/campaign-audience.service";
import {
  CampaignRecipientService,
  type ICampaignRecipientService,
} from "../../backend/campaign-recipient.service";
import type { CampaignId } from "../../campaign-identifiers";
import { describeAudienceFilter } from "../audience-filter-summary";
import { loadDiscountGroupOptions } from "../audiences/discount-group-options.server";
import { loadAdminCampaign } from "../campaign-page-data.server";

export type CampaignRecipientResolution = Effect.Success<
  ReturnType<ICampaignRecipientService["resolve"]>
>;

export type RecipientPreview =
  | { readonly kind: "no-audience"; readonly campaign: CampaignRow }
  | {
      readonly kind: "unavailable";
      readonly campaign: CampaignRow;
      readonly audienceTitle: string;
      readonly audienceSummary: string;
    }
  | {
      readonly kind: "resolved";
      readonly campaign: CampaignRow;
      readonly audienceTitle: string;
      readonly audienceSummary: string;
      readonly resolution: CampaignRecipientResolution;
    };

/**
 * Resolves a Draft's audience as the real send would right now. A campaign
 * that left Draft shows its frozen recipients on the campaign page instead.
 */
export const loadRecipientPreview = async (
  campaignId: CampaignId
): Promise<RecipientPreview> => {
  const campaign = await loadAdminCampaign(campaignId);
  const locale = await getRequestLocale();
  if (campaign.status !== "draft") {
    redirect(
      localizeAdministrationHref(`/admin/email-campaigns/${campaignId}`, locale)
    );
  }
  const { audienceId } = campaign;
  if (audienceId === null) return { kind: "no-audience", campaign };
  const discountGroups = await loadDiscountGroupOptions();
  return Effect.gen(function* () {
    const audiences = yield* CampaignAudienceService;
    const recipients = yield* CampaignRecipientService;
    const audience = yield* audiences.get(audienceId);
    const described = {
      campaign,
      audienceTitle: audience.title,
      audienceSummary: describeAudienceFilter(audience.filter, locale, {
        discountGroups,
      }),
    };
    return yield* recipients
      .resolve({ purpose: campaign.purpose, filter: audience.filter })
      .pipe(
        Effect.map(
          (resolution): RecipientPreview => ({
            kind: "resolved",
            ...described,
            resolution,
          })
        ),
        Effect.catchTag(
          "CampaignRecipientResolutionError",
          (): Effect.Effect<RecipientPreview> =>
            Effect.succeed({ kind: "unavailable", ...described })
        )
      );
  }).pipe(
    Effect.catchTag(
      "CampaignAudienceNotFound",
      (): Effect.Effect<RecipientPreview> =>
        Effect.succeed({ kind: "no-audience", campaign })
    ),
    Effect.provide(
      Layer.mergeAll(
        CampaignAudienceService.Live,
        CampaignRecipientService.Live
      )
    ),
    runWorkspaceEffect("email-campaigns.admin.preview-recipients", {
      boundary: "route",
    })
  );
};
