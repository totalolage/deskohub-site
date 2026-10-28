import { Effect, Option, Result } from "effect";
import { m } from "@/features/administration/i18n";
import type { Locale } from "@/features/i18n";
import type { ImageFit } from "@/shared/browser/image-fit";
import { shrinkImageToFit } from "@/shared/browser/image-shrinking";
import { reportWorkspaceBrowserFailure } from "@/shared/browser/workspace-browser-logs";
import { campaignBodyColumnWidth } from "../../body/campaign-image";
import {
  campaignImageMaxBytes,
  campaignImageMediaTypes,
  campaignImageTooLargeMessage,
  campaignImageUploadIssue,
} from "./campaign-image-upload";

/**
 * A body image fits when it's within the upload limit and at most twice the
 * body column's width: sharp on high-density screens, and no heavier than
 * needed, since every recipient downloads the uploaded file as it is.
 */
const campaignImageFit: ImageFit = {
  maxBytes: campaignImageMaxBytes,
  maxWidth: 2 * campaignBodyColumnWidth,
  acceptedTypes: campaignImageMediaTypes,
};

const preparationFailureCode = "email-campaigns.admin.image-preparation.failed";

/**
 * The image to upload, or the admin message why there's none. A file that
 * already fits is uploaded as it is; a larger or wider one, or one in a
 * format the upload doesn't take, is shrunk in the browser until it fits,
 * once `onShrinking` has run.
 */
export const prepareCampaignImage = (
  file: File,
  locale: Locale,
  onShrinking: Effect.Effect<void> = Effect.void
): Effect.Effect<Result.Result<File, string>> =>
  shrinkImageToFit(file, campaignImageFit, onShrinking).pipe(
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
