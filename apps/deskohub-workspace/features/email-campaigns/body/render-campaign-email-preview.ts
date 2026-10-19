import { Effect } from "effect";
import type { Locale } from "@/features/i18n";
import { getRuntimeMarketingPreferencesAccessUrl } from "@/features/legal/marketing-preferences-access-url";
import type {
  CampaignLocaleContent,
  CampaignPurpose,
  CampaignTemplateKey,
} from "./campaign-content";
import {
  CampaignEmailFooter,
  renderCampaignEmail,
} from "./render-campaign-email";

/**
 * Renders one locale of a campaign for an admin preview, with the purpose's
 * footer. The real footer link carries the recipient's token; the preview has
 * none.
 */
export const renderCampaignEmailPreview = Effect.fn(
  "renderCampaignEmailPreview"
)(function* (input: {
  readonly templateKey: CampaignTemplateKey;
  readonly purpose: CampaignPurpose;
  readonly locale: Locale;
  readonly content: CampaignLocaleContent;
}) {
  const marketingPreferencesUrl =
    yield* getRuntimeMarketingPreferencesAccessUrl("preview");
  return yield* renderCampaignEmail({
    templateKey: input.templateKey,
    locale: input.locale,
    content: input.content,
    footer:
      input.purpose === "marketing"
        ? CampaignEmailFooter.Marketing({ marketingPreferencesUrl })
        : CampaignEmailFooter.Operational(),
  });
});
