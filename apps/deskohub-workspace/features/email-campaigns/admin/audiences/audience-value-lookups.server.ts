import "server-only";

import { Effect } from "effect";
import { cache } from "react";
import { authorizeAdministratorPage } from "@/features/administrators/server/administrator-authorization.server";
import { runWorkspaceEffect } from "@/shared/backend/workspace-effect";
import { CampaignService } from "../../backend/campaign.service";
import type {
  AudienceCampaignOption,
  AudienceValueLookups,
} from "../audience-filter-summary";
import { loadDiscountGroupOptions } from "./discount-group-options.server";

/** Every campaign an audience can count emails of, newest first, by title. */
const loadCampaignOptions = async (): Promise<
  readonly AudienceCampaignOption[]
> => {
  await authorizeAdministratorPage();
  return Effect.gen(function* () {
    const campaigns = yield* CampaignService;
    const rows = yield* campaigns.list;
    return rows.map(({ id, title, delivery, status }) => ({
      id,
      name: title,
      delivery,
      status,
    }));
  }).pipe(
    Effect.provide(CampaignService.Live),
    runWorkspaceEffect("email-campaigns.admin.load-campaign-options", {
      boundary: "route",
    })
  );
};

/**
 * The names audience builders and summaries show for looked-up values:
 * Dotypos discount groups and campaigns.
 */
export const loadAudienceValueLookups = cache(
  async (): Promise<AudienceValueLookups> => {
    const [discountGroups, campaigns] = await Promise.all([
      loadDiscountGroupOptions(),
      loadCampaignOptions(),
    ]);
    return { discountGroups, campaigns };
  }
);
