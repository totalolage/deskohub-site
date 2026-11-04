import { Data, Effect, Option, Result, Schema } from "effect";
import { m } from "@/features/administration/i18n";
import type { CampaignImageUploadAuthorization } from "@/features/email-campaigns/backend/campaign-image.service";
import {
  campaignImageMaxWidth,
  isCampaignImageWidth,
} from "@/features/email-campaigns/body/campaign-image";
import type { Locale } from "@/features/i18n";
import {
  downscaleImage,
  type ImageDecodeError,
} from "@/shared/browser/image-downscaling";
import { type ImageSize, readImageSize } from "@/shared/browser/image-size";
import { reportWorkspaceBrowserFailure } from "@/shared/browser/workspace-browser-logs";
import { imageFrameCount } from "@/shared/utils/image-animation";
import { authorizeEmailImageUpload } from "./image-upload-actions";

/**
 * The largest image the Deskohub Cloudinary account takes, the `media_limits`
 * of its Free plan; an animation's frames together have at most
 * `maxAnimationPixels`. The editor shrinks a larger still picture before it
 * uploads, so the admin never has to.
 */
export const emailImageUploadLimits = {
  maxBytes: 10 * 1024 * 1024,
  maxPixels: 25_000_000,
  maxAnimationPixels: 50_000_000,
} as const;

type EmailImagePreparation = "upload" | "shrink" | "refuse";

/**
 * What the editor does with a file before Cloudinary takes it: uploads it as
 * it is, shrinks it, or refuses it. Shrinking keeps only an animation's first
 * frame, so an animation above the limits is refused instead. A picture the
 * browser can't read may still be one Cloudinary reads, such as HEIC, so only
 * its bytes count.
 */
export const emailImagePreparation = ({
  bytes,
  size,
  frames,
}: {
  readonly bytes: number;
  readonly size: Option.Option<ImageSize>;
  readonly frames: number;
}): EmailImagePreparation => {
  const { maxBytes, maxPixels, maxAnimationPixels } = emailImageUploadLimits;
  const pixels = Option.match(size, {
    onNone: () => 0,
    onSome: ({ width, height }) => width * height,
  });
  const fits =
    bytes <= maxBytes &&
    pixels <= maxPixels &&
    (frames === 1 || pixels * frames <= maxAnimationPixels);
  if (fits) return "upload";
  return frames > 1 ? "refuse" : "shrink";
};

/** Cloudinary refused the file: it isn't a picture it can store. */
class EmailImageRejectedError extends Data.TaggedError(
  "EmailImageRejectedError"
) {}

/** The file is an animation above the account's limits. */
class EmailImageTooLargeError extends Data.TaggedError(
  "EmailImageTooLargeError"
) {}

/** The upload didn't complete, or its answer isn't the image authorized. */
export class EmailImageUploadError extends Data.TaggedError(
  "EmailImageUploadError"
)<{ readonly cause?: unknown }> {}

/** An authorization was refused, with the admin message why. */
class EmailImageAuthorizationError extends Data.TaggedError(
  "EmailImageAuthorizationError"
)<{ readonly message: string }> {}

/** The fields of Cloudinary's upload answer the editor uses. */
const StoredEmailImage = Schema.Struct({
  public_id: Schema.String,
  secure_url: Schema.String,
  width: Schema.Finite,
});

/** A stored body image, ready to insert. */
export interface UploadedEmailImage {
  readonly url: string;
  readonly width: number;
}

const authorize = (locale: Locale) =>
  Effect.tryPromise({
    try: () => authorizeEmailImageUpload(undefined),
    catch: (cause) => new EmailImageUploadError({ cause }),
  }).pipe(
    Effect.flatMap((result) =>
      Effect.fromOption(Option.fromNullishOr(result?.data)).pipe(
        Effect.mapError(
          () =>
            new EmailImageAuthorizationError({
              message:
                result?.serverError ??
                m.emailsEditorImageUploadFailed({}, { locale }),
            })
        )
      )
    )
  );

/**
 * Posts the file straight to Cloudinary with the signed fields. Cloudinary
 * answers 400 for a file it can't store as an image.
 */
export const sendEmailImage = ({
  image,
  authorization,
}: {
  readonly image: Blob;
  readonly authorization: CampaignImageUploadAuthorization;
}): Effect.Effect<
  UploadedEmailImage,
  EmailImageRejectedError | EmailImageUploadError
> =>
  Effect.tryPromise({
    try: (signal) => {
      const form = new FormData();
      for (const [name, value] of Object.entries(authorization.fields)) {
        form.set(name, value);
      }
      form.set("file", image);
      return fetch(authorization.url, { method: "POST", body: form, signal });
    },
    catch: (cause) => new EmailImageUploadError({ cause }),
  }).pipe(
    Effect.filterOrFail(
      (response) => response.status !== 400,
      () => new EmailImageRejectedError()
    ),
    Effect.filterOrFail(
      (response) => response.ok,
      (response) => new EmailImageUploadError({ cause: response.status })
    ),
    Effect.flatMap((response) =>
      Effect.tryPromise({
        try: () => response.json(),
        catch: (cause) => new EmailImageUploadError({ cause }),
      })
    ),
    Effect.flatMap((answer) =>
      Schema.decodeUnknownEffect(StoredEmailImage)(answer).pipe(
        Effect.mapError((cause) => new EmailImageUploadError({ cause }))
      )
    ),
    Effect.filterOrFail(
      (stored) =>
        stored.public_id === authorization.publicId &&
        isCampaignImageWidth(stored.width),
      () => new EmailImageUploadError({ cause: "unexpected-image" })
    ),
    Effect.map((stored) => ({ url: stored.secure_url, width: stored.width })),
    Effect.withSpan("sendCampaignImage")
  );

/** What the editor is doing with the image, to tell the admin. */
export type EmailImageUploadStage = "shrinking" | "uploading";

const uploadFailureCode = "email-campaigns.admin.image-upload.failed";

/** Reports which stage the upload has reached. */
type EmailImageUploadProgress = (
  stage: EmailImageUploadStage
) => Effect.Effect<void>;

/** The file the admin chose, and where the upload reports its stage. */
interface ChosenEmailImage {
  readonly file: File;
  readonly onStage: EmailImageUploadProgress;
}

const shrinkEmailImage = ({ file, onStage }: ChosenEmailImage) =>
  onStage("shrinking").pipe(
    Effect.andThen(
      downscaleImage(file, {
        maxBytes: emailImageUploadLimits.maxBytes,
        maxPixels: emailImageUploadLimits.maxPixels,
        maxWidth: campaignImageMaxWidth,
      })
    ),
    Effect.tap(() => onStage("uploading"))
  );

const readFrameCount = (file: Blob) =>
  Effect.tryPromise({
    try: () => file.arrayBuffer(),
    catch: (cause) => new EmailImageUploadError({ cause }),
  }).pipe(Effect.map((buffer) => imageFrameCount(new Uint8Array(buffer))));

/**
 * The picture to upload: the file as chosen, or shrunk first in the browser
 * when it's a still picture above the account's limits. An animation above
 * them is refused.
 */
const prepareEmailImage = (
  input: ChosenEmailImage
): Effect.Effect<
  Blob,
  ImageDecodeError | EmailImageTooLargeError | EmailImageUploadError
> =>
  Effect.all({
    size: readImageSize(input.file),
    frames: readFrameCount(input.file),
  }).pipe(
    Effect.map(({ size, frames }) =>
      emailImagePreparation({ bytes: input.file.size, size, frames })
    ),
    Effect.flatMap(
      (
        preparation
      ): Effect.Effect<Blob, ImageDecodeError | EmailImageTooLargeError> =>
        preparations[preparation](input)
    )
  );

const preparations = {
  upload: ({ file }: ChosenEmailImage) => Effect.succeed<Blob>(file),
  shrink: shrinkEmailImage,
  refuse: () => Effect.fail(new EmailImageTooLargeError()),
} satisfies Record<
  EmailImagePreparation,
  (input: ChosenEmailImage) => Effect.Effect<Blob, unknown>
>;

/**
 * Uploads a body image straight to Cloudinary, which shrinks it to the
 * stored width, turns it upright and strips its metadata. A still picture
 * above the account's limits is first shrunk in the browser. Succeeds with
 * the stored image, or with the admin message why there's none: only an
 * animation above the limits, or a file neither the browser nor Cloudinary
 * can read, is the admin's to change.
 */
export const uploadEmailImage = (
  file: File,
  locale: Locale,
  onStage: EmailImageUploadProgress
): Effect.Effect<Result.Result<UploadedEmailImage, string>> =>
  Effect.Do.pipe(
    Effect.bind("authorization", () => authorize(locale)),
    Effect.bind("image", () => prepareEmailImage({ file, onStage })),
    Effect.flatMap(sendEmailImage),
    Effect.map(Result.succeed),
    Effect.catchTags({
      ImageDecodeError: () => unreadable(locale),
      EmailImageTooLargeError: () => animationTooLarge(locale),
      EmailImageRejectedError: () => unreadable(locale),
      EmailImageAuthorizationError: ({ message }) =>
        Effect.succeed(Result.fail(message)),
      EmailImageUploadError: (failure) => uploadFailed(locale, failure),
    }),
    Effect.catchDefect((cause) =>
      uploadFailed(locale, new EmailImageUploadError({ cause }))
    )
  );

const unreadable = (locale: Locale) =>
  Effect.succeed(
    Result.fail(m.emailsEditorImageUploadUnreadable({}, { locale }))
  );

const animationTooLarge = (locale: Locale) => {
  const { maxBytes, maxAnimationPixels } = emailImageUploadLimits;
  return Effect.succeed(
    Result.fail(
      m.emailsEditorImageUploadAnimationTooLarge(
        {
          maxMegabytes: maxBytes / (1024 * 1024),
          maxMegapixels: maxAnimationPixels / 1_000_000,
        },
        { locale }
      )
    )
  );
};

const uploadFailed = (locale: Locale, failure: EmailImageUploadError) =>
  reportWorkspaceBrowserFailure(uploadFailureCode, failure).pipe(
    Effect.as(Result.fail(m.emailsEditorImageUploadFailed({}, { locale })))
  );
