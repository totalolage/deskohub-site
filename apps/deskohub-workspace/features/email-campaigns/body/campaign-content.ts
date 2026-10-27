import { type Option, Schema } from "effect";
import { locales } from "@/features/i18n";
import { campaignBodyDocument } from "./campaign-body-document";

/**
 * Marketing campaigns need marketing consent and carry an unsubscribe link.
 * Operational campaigns announce service changes and carry a reason line.
 */
export const CampaignPurpose = Schema.Literals(["marketing", "operational"]);
export type CampaignPurpose = typeof CampaignPurpose.Type;

/** Keys of the code-defined campaign email templates. */
export const CampaignTemplateKey = Schema.Literals(["workspace"]);
export type CampaignTemplateKey = typeof CampaignTemplateKey.Type;

/**
 * One locale's campaign texts. Its body's images must come from the
 * Cloudinary account `imageCloudName`.
 */
export const campaignLocaleContent = (imageCloudName: Option.Option<string>) =>
  Schema.Struct({
    subject: Schema.String,
    preheader: Schema.String,
    body: campaignBodyDocument(imageCloudName),
    /**
     * Replaces the fixed reason line in an operational campaign's footer.
     * Marketing campaigns ignore it.
     */
    operationalReason: Schema.optionalKey(
      Schema.Trimmed.check(Schema.isNonEmpty())
    ),
  });
export type CampaignLocaleContent = ReturnType<
  typeof campaignLocaleContent
>["Type"];

/** Per-locale campaign texts; a locale without content is absent. */
export const campaignLocalizedContent = (
  imageCloudName: Option.Option<string>
) =>
  Schema.Record(
    Schema.Literals(locales),
    Schema.optionalKey(campaignLocaleContent(imageCloudName))
  );
export type CampaignLocalizedContent = ReturnType<
  typeof campaignLocalizedContent
>["Type"];

/** Everything a campaign email renders from. */
export type CampaignContent = {
  readonly purpose: CampaignPurpose;
  readonly templateKey: CampaignTemplateKey;
  readonly locales: CampaignLocalizedContent;
};
