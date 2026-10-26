import "server-only";

import type { AdministrationCampaignDetailType } from "@deskohub/workspace-admin-api";
import { Effect } from "effect";
import { runAdministrationPage } from "@/features/administrators/server/administration-request.server";
import { campaignLocales } from "../../recipient-locale";
import {
  campaignOperationCapabilities,
  invokeCampaignOperation,
} from "../campaign-operation-query.server";

const sentCampaignEmails = Effect.fn("loadSentCampaignEmails")(function* (
  campaign: AdministrationCampaignDetailType
) {
  return yield* Effect.forEach(
    campaignLocales.flatMap((locale) => {
      const content = campaign.content[locale];
      return content === undefined ? [] : [{ locale, content }];
    }),
    ({ locale, content }) =>
      invokeCampaignOperation("previewCampaignTemplate", {
        templateKey: campaign.templateKey,
        preview: { _tag: "Campaign", campaignId: campaign.id, locale },
      }).pipe(
        Effect.map(({ html }): string | undefined => html),
        Effect.tapError((error) =>
          Effect.logError("Sent campaign email failed to render", error)
        ),
        Effect.orElseSucceed(() => undefined),
        Effect.map((html) => ({
          locale,
          subject: content.subject,
          preheader: content.preheader,
          html,
        }))
      )
  );
});

/**
 * Each locale the campaign has content for, Czech first, rendered as the
 * recipients got it. A locale that fails to render keeps its subject and
 * preheader and has no HTML.
 */
export const loadSentCampaignEmails = (
  campaign: AdministrationCampaignDetailType
) =>
  runAdministrationPage(
    "email-campaigns.admin.render-sent-campaign",
    sentCampaignEmails(campaign),
    campaignOperationCapabilities
  );
