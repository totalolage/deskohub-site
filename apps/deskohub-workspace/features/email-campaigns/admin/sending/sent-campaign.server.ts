import "server-only";

import { Effect } from "effect";
import { cache } from "react";
import { runAdministrationPage } from "@/features/administrators/server/administration-request.server";
import type { CampaignId } from "../../campaign-identifiers";
import {
  campaignOperationCapabilities,
  invokeCampaignOperation,
} from "../campaign-operation-query.server";

const sentCampaign = Effect.fn("loadSentCampaign")(function* (
  campaignId: CampaignId
) {
  const { send } = yield* invokeCampaignOperation("getCampaignSendStatus", {
    campaignId,
  });
  const audienceTitle =
    send?.audienceId == null
      ? null
      : yield* invokeCampaignOperation("getCampaignAudience", {
          audienceId: send.audienceId,
        }).pipe(
          Effect.map((audience): string | null => audience.title),
          Effect.catchTag("OperationNotFound", () => Effect.succeed(null))
        );
  return { send, audienceTitle };
});

/**
 * The campaign's send status and the current title of the audience it
 * snapshotted.
 */
export const loadSentCampaign = cache((campaignId: CampaignId) =>
  runAdministrationPage(
    "email-campaigns.admin.load-sent-campaign",
    sentCampaign(campaignId),
    campaignOperationCapabilities
  )
);
