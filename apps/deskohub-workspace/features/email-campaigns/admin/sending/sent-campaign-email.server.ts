import "server-only";

import { Effect } from "effect";
import type { CampaignRow } from "@/db/schema";
import { runWorkspaceEffect } from "@/shared/backend/workspace-effect";
import { renderCampaignEmailPreview } from "../../body/render-campaign-email-preview";
import { campaignLocales } from "../../recipient-locale";

/**
 * Each locale the campaign has content for, Czech first, rendered as the
 * recipients got it. A locale that fails to render keeps its subject and
 * preheader and has no HTML.
 */
export const loadSentCampaignEmails = Effect.fn(
  function* (campaign: CampaignRow) {
    return yield* Effect.forEach(
      campaignLocales.flatMap((locale) => {
        const content = campaign.content[locale];
        return content === undefined ? [] : [{ locale, content }];
      }),
      ({ locale, content }) =>
        renderCampaignEmailPreview({
          templateKey: campaign.templateKey,
          purpose: campaign.purpose,
          locale,
          content,
        }).pipe(
          Effect.map(({ html }) => html),
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
  },
  (effect) =>
    effect.pipe(
      runWorkspaceEffect("email-campaigns.admin.render-sent-campaign", {
        boundary: "route",
      })
    )
);
