import { Schema } from "effect";
import { m } from "@/features/administration/i18n";
import type { Locale } from "@/features/i18n";
import { audienceFilterSchema } from "../../audience-filter";
import { campaignAudienceIdSchema } from "../../campaign-identifiers";

const audienceTitleMaxLength = 120;

/**
 * A trimmed, non-empty title of at most 120 characters. With a locale, its
 * issues carry the editor's messages; the save action only enforces it.
 */
const audienceTitleSchema = (locale?: Locale) =>
  Schema.Trim.check(
    Schema.isNonEmpty(
      locale && {
        message: m.emailCampaignsAudienceTitleRequired({}, { locale }),
      }
    ),
    Schema.isMaxLength(
      audienceTitleMaxLength,
      locale && {
        message: m.emailCampaignsAudienceTitleTooLong(
          { max: audienceTitleMaxLength },
          { locale }
        ),
      }
    )
  );

/** What the audience editor validates before it saves, worded in `locale`. */
export const createAudienceFormSchema = (locale: Locale) =>
  Schema.Struct({
    title: audienceTitleSchema(locale),
    filter: audienceFilterSchema,
  });
export type AudienceFormValues = ReturnType<
  typeof createAudienceFormSchema
>["Encoded"];

const parseOptions = {
  errors: "all",
  onExcessProperty: "error",
} as const;

/** Creates an audience, or replaces an existing one's title and filter. */
export const saveAudienceStandardSchema = Schema.toStandardSchemaV1(
  Schema.Struct({
    audienceId: Schema.optionalKey(campaignAudienceIdSchema),
    title: audienceTitleSchema(),
    filter: audienceFilterSchema,
  }),
  { parseOptions }
);

export const audienceReferenceStandardSchema = Schema.toStandardSchemaV1(
  Schema.Struct({ audienceId: campaignAudienceIdSchema }),
  { parseOptions }
);
