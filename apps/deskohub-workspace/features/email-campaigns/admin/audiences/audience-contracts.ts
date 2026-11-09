import { administrationCampaignAudienceTitleMaxLength } from "@deskohub/workspace-admin-api";
import { Schema } from "effect";
import { m } from "@/features/administration/i18n";
import type { Locale } from "@/features/i18n";
import { audienceFilterSchema } from "../../audience-filter";

/** The contract's title rules, with the editor's messages in `locale`. */
const audienceTitleSchema = (locale: Locale) =>
  Schema.Trim.check(
    Schema.isNonEmpty({
      message: m.emailCampaignsAudienceTitleRequired({}, { locale }),
    }),
    Schema.isMaxLength(administrationCampaignAudienceTitleMaxLength, {
      message: m.emailCampaignsAudienceTitleTooLong(
        { max: administrationCampaignAudienceTitleMaxLength },
        { locale }
      ),
    })
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
