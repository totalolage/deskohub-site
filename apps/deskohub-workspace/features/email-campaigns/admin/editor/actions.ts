"use server";

import { Schema } from "effect";
import { m } from "@/features/administration/i18n";
import { defineAdministrationAction } from "@/features/administrators/server/administration-request.server";
import { CampaignImageService } from "@/features/email-campaigns/backend/campaign-image.service";
import { emailCampaignsActionFailureCopy } from "../campaign-operation-failure";

const authorizeCampaignImageUploadAction = defineAdministrationAction(
  {
    operation: "email-campaigns.admin.authorize-image-upload",
    schema: Schema.toStandardSchemaV1(Schema.Undefined),
    failureCopy: emailCampaignsActionFailureCopy,
    capabilities: CampaignImageService.Live,
    publicFailure: (_, locale) =>
      m.emailCampaignsImageUploadFailed({}, { locale }),
  },
  () => CampaignImageService.use((images) => images.authorizeUpload)
);

/**
 * Lets the administrator's browser upload one body image straight to the
 * Deskohub Cloudinary account, which shrinks it and strips its metadata.
 */
export const authorizeCampaignImageUpload: typeof authorizeCampaignImageUploadAction =
  async (...args: Parameters<typeof authorizeCampaignImageUploadAction>) => {
    "use server";
    return await authorizeCampaignImageUploadAction(...args);
  };
