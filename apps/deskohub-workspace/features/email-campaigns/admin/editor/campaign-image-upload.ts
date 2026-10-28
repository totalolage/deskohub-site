import { Data, Effect, Option, Result, Schema } from "effect";
import { m } from "@/features/administration/i18n";
import type { Locale } from "@/features/i18n";
import { downscaleImage } from "@/shared/browser/image-downscaling";
import { type ImageSize, readImageSize } from "@/shared/browser/image-size";
import { reportWorkspaceBrowserFailure } from "@/shared/browser/workspace-browser-logs";
import type { CampaignImageUploadAuthorization } from "../../backend/campaign-image.service";
import {
  campaignImageMaxWidth,
  isCampaignImageWidth,
} from "../../body/campaign-image";
import { authorizeCampaignImageUpload } from "./actions";

/**
 * The largest image the Deskohub Cloudinary account takes, the `media_limits`
 * of its Free plan. The editor shrinks a larger one before it uploads, so the
 * admin never has to.
 */
export const campaignImageUploadLimits = {
  maxBytes: 10 * 1024 * 1024,
  maxPixels: 25_000_000,
} as const;

/**
 * Whether the editor must shrink a file before Cloudinary takes it. A picture
 * the browser can't read may still be one Cloudinary reads, such as HEIC, so
 * only its bytes count.
 */
export const needsShrinkingBeforeUpload = (
  bytes: number,
  size: Option.Option<ImageSize>
): boolean =>
  bytes > campaignImageUploadLimits.maxBytes ||
  Option.exists(
    size,
    ({ width, height }) => width * height > campaignImageUploadLimits.maxPixels
  );

/** Cloudinary refused the file: it isn't a picture it can store. */
class CampaignImageRejectedError extends Data.TaggedError(
  "CampaignImageRejectedError"
) {}

/** The upload didn't complete, or its answer isn't the image authorized. */
export class CampaignImageUploadError extends Data.TaggedError(
  "CampaignImageUploadError"
)<{ readonly cause?: unknown }> {}

/** An authorization was refused, with the admin message why. */
class CampaignImageAuthorizationError extends Data.TaggedError(
  "CampaignImageAuthorizationError"
)<{ readonly message: string }> {}

/** The fields of Cloudinary's upload answer the editor uses. */
const StoredCampaignImage = Schema.Struct({
  public_id: Schema.String,
  secure_url: Schema.String,
  width: Schema.Finite,
});

/** A stored body image, ready to insert. */
export interface UploadedCampaignImage {
  readonly url: string;
  readonly width: number;
}

const authorize = (locale: Locale) =>
  Effect.tryPromise({
    try: () => authorizeCampaignImageUpload(undefined),
    catch: (cause) => new CampaignImageUploadError({ cause }),
  }).pipe(
    Effect.flatMap((result) =>
      result?.data
        ? Effect.succeed(result.data)
        : Effect.fail(
            new CampaignImageAuthorizationError({
              message:
                result?.serverError ??
                m.emailCampaignsImageUploadFailed({}, { locale }),
            })
          )
    )
  );

/**
 * Posts the file straight to Cloudinary with the signed fields. Cloudinary
 * answers 400 for a file it can't store as an image.
 */
export const sendCampaignImage = Effect.fn("sendCampaignImage")(function* (
  file: Blob,
  authorization: CampaignImageUploadAuthorization
) {
  const response = yield* Effect.tryPromise({
    try: (signal) => {
      const form = new FormData();
      for (const [name, value] of Object.entries(authorization.fields)) {
        form.set(name, value);
      }
      form.set("file", file);
      return fetch(authorization.url, { method: "POST", body: form, signal });
    },
    catch: (cause) => new CampaignImageUploadError({ cause }),
  });
  if (response.status === 400) return yield* new CampaignImageRejectedError();
  if (!response.ok) {
    return yield* new CampaignImageUploadError({ cause: response.status });
  }
  const answer = yield* Effect.tryPromise({
    try: () => response.json(),
    catch: (cause) => new CampaignImageUploadError({ cause }),
  });
  const image = yield* Schema.decodeUnknownEffect(StoredCampaignImage)(
    answer
  ).pipe(Effect.mapError((cause) => new CampaignImageUploadError({ cause })));
  if (
    image.public_id !== authorization.publicId ||
    !isCampaignImageWidth(image.width)
  ) {
    return yield* new CampaignImageUploadError({ cause: "unexpected-image" });
  }
  return { url: image.secure_url, width: image.width };
});

/** What the editor is doing with the image, to tell the admin. */
export type CampaignImageUploadStage = "shrinking" | "uploading";

const uploadFailureCode = "email-campaigns.admin.image-upload.failed";

/**
 * Uploads a body image straight to Cloudinary, which shrinks it to the
 * stored width, turns it upright and strips its metadata. A file above the
 * account's limits is first shrunk in the browser. Succeeds with the stored
 * image, or with the admin message why there's none: only a file neither the
 * browser nor Cloudinary can read is the admin's to change.
 */
export const uploadCampaignImage = (
  file: File,
  locale: Locale,
  onStage: (stage: CampaignImageUploadStage) => Effect.Effect<void>
): Effect.Effect<Result.Result<UploadedCampaignImage, string>> =>
  Effect.gen(function* () {
    const authorization = yield* authorize(locale);
    const size = yield* readImageSize(file);
    const image = needsShrinkingBeforeUpload(file.size, size)
      ? yield* onStage("shrinking").pipe(
          Effect.andThen(
            downscaleImage(file, {
              ...campaignImageUploadLimits,
              maxWidth: campaignImageMaxWidth,
            })
          ),
          Effect.tap(() => onStage("uploading"))
        )
      : file;
    return yield* sendCampaignImage(image, authorization);
  }).pipe(
    Effect.map(Result.succeed),
    Effect.catchTags({
      ImageDecodeError: () => unreadable(locale),
      CampaignImageRejectedError: () => unreadable(locale),
      CampaignImageAuthorizationError: ({ message }) =>
        Effect.succeed(Result.fail(message)),
      CampaignImageUploadError: (failure) => uploadFailed(locale, failure),
    }),
    Effect.catchDefect((cause) =>
      uploadFailed(locale, new CampaignImageUploadError({ cause }))
    )
  );

const unreadable = (locale: Locale) =>
  Effect.succeed(
    Result.fail(m.emailCampaignsImageUploadUnreadable({}, { locale }))
  );

const uploadFailed = (locale: Locale, failure: CampaignImageUploadError) =>
  reportWorkspaceBrowserFailure(uploadFailureCode, failure).pipe(
    Effect.as(Result.fail(m.emailCampaignsImageUploadFailed({}, { locale })))
  );
