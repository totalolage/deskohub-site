import "server-only";

import type {
  AdministrationCampaignDetail,
  AutomationDetail,
} from "@deskohub/workspace-admin-api";
import { Effect, Option } from "effect";
import { notFound } from "next/navigation";
import { cache } from "react";
import type { CampaignId } from "../../campaign-identifiers";
import {
  invokeCampaignOperation,
  runCampaignPageQuery,
} from "../campaign-operation-query.server";

/** An automated campaign with its automation, as its admin pages show it. */
export interface AutomatedCampaign {
  readonly campaign: AdministrationCampaignDetail;
  readonly automation: AutomationDetail;
}

const findAutomatedCampaign = cache((campaignId: CampaignId) =>
  runCampaignPageQuery(
    "email-campaigns.admin.load-automated-campaign",
    Effect.gen(function* () {
      const campaign = yield* invokeCampaignOperation("getCampaign", {
        campaignId,
      });
      if (campaign.delivery !== "automated") return Option.none();
      const automation = yield* invokeCampaignOperation("getAutomation", {
        campaignId,
      });
      return Option.some({ campaign, automation });
    }).pipe(Effect.catchTag("OperationNotFound", () => Effect.succeedNone))
  )
);

/**
 * The automated campaign an automation route shows, or the not-found page
 * for a missing or one-off campaign.
 */
export const loadAutomatedCampaign = async (
  campaignId: CampaignId
): Promise<AutomatedCampaign> =>
  Option.getOrElse(await findAutomatedCampaign(campaignId), () => notFound());
