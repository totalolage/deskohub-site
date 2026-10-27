import "server-only";

import type {
  AdministrationCampaignDetail,
  AutomationDetail,
} from "@deskohub/workspace-admin-api";
import { Effect } from "effect";
import { cache } from "react";
import {
  AdministrationRecordNotFound,
  runAdministrationPage,
} from "@/features/administrators/server/administration-request.server";
import type { CampaignId } from "../../campaign-identifiers";
import {
  campaignOperationCapabilities,
  invokeCampaignOperation,
} from "../campaign-operation-query.server";

/** An automated campaign with its automation, as its admin pages show it. */
export interface AutomatedCampaign {
  readonly campaign: AdministrationCampaignDetail;
  readonly automation: AutomationDetail;
}

/**
 * The automated campaign an automation route shows, or the not-found page
 * for a missing or one-off campaign.
 */
export const loadAutomatedCampaign = cache(
  (campaignId: CampaignId): Promise<AutomatedCampaign> =>
    runAdministrationPage(
      "email-campaigns.admin.load-automated-campaign",
      Effect.gen(function* () {
        const campaign = yield* invokeCampaignOperation("getCampaign", {
          campaignId,
        });
        if (campaign.delivery !== "automated") {
          return yield* new AdministrationRecordNotFound();
        }
        const automation = yield* invokeCampaignOperation("getAutomation", {
          campaignId,
        });
        return { campaign, automation };
      }).pipe(
        Effect.catchTag("OperationNotFound", () =>
          Effect.fail(new AdministrationRecordNotFound())
        )
      ),
      campaignOperationCapabilities
    )
);
