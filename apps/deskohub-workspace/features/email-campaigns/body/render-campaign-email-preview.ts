import { Effect, Match } from "effect";
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
 * The preview footer for `purpose`. The real marketing link carries the
 * recipient's token; the preview has none.
 */
const previewFooter = (purpose: CampaignPurpose) =>
  Match.value(purpose).pipe(
    Match.when("marketing", () =>
      getRuntimeMarketingPreferencesAccessUrl("preview").pipe(
        Effect.map((marketingPreferencesUrl) =>
          CampaignEmailFooter.Marketing({ marketingPreferencesUrl })
        )
      )
    ),
    Match.when("operational", () =>
      Effect.succeed(CampaignEmailFooter.Operational())
    ),
    Match.exhaustive
  );

/**
 * Renders one locale of a campaign for an admin preview, with the purpose's
 * footer.
 */
export const renderCampaignEmailPreview = Effect.fn(
  "renderCampaignEmailPreview"
)(function* (input: {
  readonly templateKey: CampaignTemplateKey;
  readonly purpose: CampaignPurpose;
  readonly locale: Locale;
  readonly content: CampaignLocaleContent;
}) {
  return yield* renderCampaignEmail({
    templateKey: input.templateKey,
    locale: input.locale,
    content: input.content,
    footer: yield* previewFooter(input.purpose),
  });
});
