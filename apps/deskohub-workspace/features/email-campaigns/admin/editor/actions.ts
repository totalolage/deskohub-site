"use server";

import type { StandardSchemaV1 } from "@standard-schema/spec";
import { Effect } from "effect";
import { m } from "@/features/administration/i18n";
import { requireAdministratorAuthorization } from "@/features/administrators/server/administrator-authorization.server";
import { CampaignImageService } from "@/features/email-campaigns/backend/campaign-image.service";
import type { Locale } from "@/features/i18n";
import { defineWorkspaceAction } from "@/shared/backend/workspace-action";
import { PublicSafeActionError } from "@/shared/utils/safe-action-client";

const campaignImageMaxMegabytes = 5;
const campaignImageMaxBytes = campaignImageMaxMegabytes * 1024 * 1024;

const campaignImageMediaTypes: ReadonlySet<string> = new Set([
  "image/gif",
  "image/jpeg",
  "image/png",
  "image/webp",
]);

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
): Effect.Effect<File, PublicSafeActionError> => {
  if (!(file instanceof File) || file.size === 0) {
    return Effect.fail(
      new PublicSafeActionError({
        message: m.emailCampaignsImageUploadMissing({}, { locale }),
      })
    );
  }
  if (!campaignImageMediaTypes.has(file.type)) {
    return Effect.fail(
      new PublicSafeActionError({
        message: m.emailCampaignsImageUploadUnsupportedType({}, { locale }),
      })
    );
  }
  if (file.size > campaignImageMaxBytes) {
    return Effect.fail(
      new PublicSafeActionError({
        message: m.emailCampaignsImageUploadTooLarge(
          { maxMegabytes: campaignImageMaxMegabytes },
          { locale }
        ),
      })
    );
  }
  return Effect.succeed(file);
};

const uploadCampaignImageAction = defineWorkspaceAction(
  {
    operation: "email-campaigns.admin.upload-image",
    schema: campaignImageUploadSchema,
    logInput: false,
  },
  ({ file }, { locale }) =>
    validateCampaignImage(file, locale).pipe(
      Effect.andThen((image) =>
        requireAdministratorAuthorization.pipe(
          Effect.andThen(
            CampaignImageService.use((images) => images.upload(image))
          ),
          Effect.provide(CampaignImageService.Live),
          Effect.mapError(
            (cause) =>
              new PublicSafeActionError({
                message: m.emailCampaignsImageUploadFailed({}, { locale }),
                cause,
              })
          )
        )
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
