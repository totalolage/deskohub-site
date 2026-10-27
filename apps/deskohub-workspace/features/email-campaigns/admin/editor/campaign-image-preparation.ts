import { Effect, Option, Result } from "effect";
import { m } from "@/features/administration/i18n";
import type { Locale } from "@/features/i18n";
import {
  type ImageFit,
  imageFitsAsIs,
  shrinkImageToFit,
} from "@/shared/browser/image-shrinking";
import { reportWorkspaceBrowserFailure } from "@/shared/browser/workspace-browser-logs";
import { campaignBodyColumnWidth } from "../../body/campaign-image";
import {
  campaignImageMaxBytes,
  campaignImageMediaTypes,
  campaignImageTooLargeMessage,
  campaignImageUploadIssue,
} from "./campaign-image-upload";

/**
 * A body image fits when it's within the upload limit. One that has to be
 * shrunk keeps twice the body column's width, sharp on high-density screens.
 */
const campaignImageFit: ImageFit = {
  maxBytes: campaignImageMaxBytes,
  maxWidth: 2 * campaignBodyColumnWidth,
  acceptedTypes: campaignImageMediaTypes,
};

const preparationFailureCode = "email-campaigns.admin.image-preparation.failed";

/** Whether the admin's file has to be shrunk before it can be uploaded. */
export const campaignImageNeedsShrinking = (file: File): boolean =>
  !imageFitsAsIs(file, campaignImageFit);

/**
 * The image to upload, or the admin message why there's none. A file that's
 * already within the limit is uploaded as it is; a larger one, or one in a
 * format the upload doesn't take, is shrunk in the browser until it fits.
 */
export const prepareCampaignImage = (
  file: File,
  locale: Locale
): Effect.Effect<Result.Result<File, string>> =>
  shrinkImageToFit(file, campaignImageFit).pipe(
    Effect.map((image) =>
      Option.match(campaignImageUploadIssue(image, locale), {
        onNone: () => Result.succeed(image),
        onSome: Result.fail,
      })
    ),
    Effect.catchTags({
      ImageDecodeError: () =>
        Effect.succeed(
          Result.fail(
            campaignImageMediaTypes.some((type) => type === file.type)
              ? m.emailCampaignsImageUploadUnreadable({}, { locale })
              : m.emailCampaignsImageUploadUnsupportedType({}, { locale })
          )
        ),
      ImageTooLargeError: () =>
        Effect.succeed(Result.fail(campaignImageTooLargeMessage(locale))),
    }),
    Effect.catchDefect((defect) =>
      reportWorkspaceBrowserFailure(preparationFailureCode, defect).pipe(
        Effect.as(
          Result.fail(m.emailCampaignsImageUploadFailed({}, { locale }))
        )
      )
    )
  );
