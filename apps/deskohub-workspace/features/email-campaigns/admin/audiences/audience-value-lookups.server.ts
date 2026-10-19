import "server-only";

import { Effect } from "effect";
import { cache } from "react";
import type {
  AudienceCampaignOption,
  AudienceValueLookups,
} from "../audience-filter-summary";
import {
  invokeCampaignOperation,
  runCampaignPageQuery,
} from "../campaign-operation-query.server";
import { loadDiscountGroupOptions } from "./discount-group-options.server";

/** Every campaign an audience can count emails of, newest first, by title. */
const loadCampaignOptions = (): Promise<readonly AudienceCampaignOption[]> =>
  runCampaignPageQuery(
    "email-campaigns.admin.load-campaign-options",
    invokeCampaignOperation("listCampaigns", {}).pipe(
      Effect.map((campaigns) =>
        campaigns.map(({ id, title, delivery, status }) => ({
          id,
          name: title,
          delivery,
          status,
        }))
      )
    )
  );

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
