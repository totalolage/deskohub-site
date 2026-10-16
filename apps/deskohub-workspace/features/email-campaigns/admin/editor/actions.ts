"use server";

import type { StandardSchemaV1 } from "@standard-schema/spec";
import { Effect } from "effect";
import { CampaignImageService } from "@/features/email-campaigns/backend/campaign-image.service";
import { requireAdministratorAuthorization } from "@/features/administrators/server/administrator-authorization.server";
import { defineWorkspaceAction } from "@/shared/backend/workspace-action";
import { PublicSafeActionError } from "@/shared/utils/safe-action-client";

const campaignImageMaxBytes = 5 * 1024 * 1024;

const campaignImageMediaTypes: ReadonlySet<string> = new Set([
  "image/gif",
  "image/jpeg",
  "image/png",
  "image/webp",
]);

const imageUploadIssue = (message: string): StandardSchemaV1.Issue => ({
  message,
});

const campaignImageUploadSchema: StandardSchemaV1<
  unknown,
  { readonly file: File }
> = {
  "~standard": {
    version: 1,
    vendor: "deskohub",
    validate: (value) => {
      const file = value instanceof FormData ? value.get("file") : null;
      if (!(file instanceof File) || file.size === 0) {
        return { issues: [imageUploadIssue("Choose an image to upload.")] };
      }
      if (!campaignImageMediaTypes.has(file.type)) {
        return {
          issues: [imageUploadIssue("Upload a PNG, JPEG, GIF, or WebP image.")],
        };
      }
      if (file.size > campaignImageMaxBytes) {
        return {
          issues: [imageUploadIssue("The image must be 5 MB or smaller.")],
        };
      }
      return { value: { file } };
    },
  },
};

const uploadCampaignImageAction = defineWorkspaceAction(
  {
    operation: "email-campaigns.admin.upload-image",
    schema: campaignImageUploadSchema,
    logInput: false,
  },
  ({ file }) =>
    requireAdministratorAuthorization.pipe(
      Effect.andThen(CampaignImageService.use((images) => images.upload(file))),
      Effect.provide(CampaignImageService.Live),
      Effect.mapError(
        (cause) =>
          new PublicSafeActionError({
            message: "The image could not be uploaded. Try again.",
            cause,
          })
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
