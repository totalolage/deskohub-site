"use server";

import type { StandardSchemaV1 } from "@standard-schema/spec";
import { Effect, Option } from "effect";
import { m } from "@/features/administration/i18n";
import { defineAdministrationAction } from "@/features/administrators/server/administration-request.server";
import { CampaignImageService } from "@/features/email-campaigns/backend/campaign-image.service";
import type { Locale } from "@/features/i18n";
import { PublicSafeActionError } from "@/shared/utils/safe-action-client";
import { emailCampaignsActionFailureCopy } from "../campaign-operation-failure";
import { campaignImageUploadIssue } from "./campaign-image-upload";

/**
 * Reads the upload form. The file itself is checked in the action, which
 * knows the admin's language for the message.
 */
const campaignImageUploadSchema: StandardSchemaV1<
  unknown,
  { readonly file: FormDataEntryValue | null }
> = {
  "~standard": {
    version: 1,
    vendor: "deskohub",
    validate: (value) => ({
      value: { file: value instanceof FormData ? value.get("file") : null },
    }),
  },
};

/** A non-empty image of an accepted type and size, or the admin message why not. */
const validateCampaignImage = (
  file: FormDataEntryValue | null,
  locale: Locale
): Effect.Effect<File, PublicSafeActionError> =>
  file instanceof File
    ? Option.match(campaignImageUploadIssue(file, locale), {
        onNone: () => Effect.succeed(file),
        onSome: (message) =>
          Effect.fail(new PublicSafeActionError({ message })),
      })
    : Effect.fail(
        new PublicSafeActionError({
          message: m.emailCampaignsImageUploadMissing({}, { locale }),
        })
      );

const uploadCampaignImageAction = defineAdministrationAction(
  {
    operation: "email-campaigns.admin.upload-image",
    schema: campaignImageUploadSchema,
    logInput: false,
    failureCopy: emailCampaignsActionFailureCopy,
    capabilities: CampaignImageService.Live,
    publicFailure: (_, locale) =>
      m.emailCampaignsImageUploadFailed({}, { locale }),
  },
  ({ file }, { locale }) =>
    validateCampaignImage(file, locale).pipe(
      Effect.andThen((image) =>
        CampaignImageService.use((images) => images.upload(image))
      )
    )
);

/** Uploads a body image to the Deskohub Cloudinary account. */
export const uploadCampaignImage: typeof uploadCampaignImageAction = async (
  ...args: Parameters<typeof uploadCampaignImageAction>
) => {
  "use server";
  return await uploadCampaignImageAction(...args);
};
