import {
  CustomerAvatarRejected,
  customerAvatarMaxUploadBytes,
  customerAvatarMediaTypes,
} from "@deskohub/workspace-customer-api";
import { Data, Effect, Option } from "effect";
import type { PickedImage } from "../../../customer-api/device-capabilities";

export type AvatarMediaType = (typeof customerAvatarMediaTypes)[number];

/** A picked image the app will upload as the avatar's one file part. */
export interface AvatarFile {
  readonly uri: string;
  readonly name: string;
  readonly mediaType: AvatarMediaType;
}

/** The picked image's bytes couldn't be read for the upload. */
export class AvatarFileUnreadable extends Data.TaggedError(
  "AvatarFileUnreadable"
)<{ readonly cause?: unknown }> {}

const mediaTypeOfExtension: Readonly<Record<string, AvatarMediaType>> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
};

const isAvatarMediaType = (value: string): value is AvatarMediaType =>
  customerAvatarMediaTypes.some((mediaType) => mediaType === value);

// The extension of a file name or of a URI's path, lower-cased.
const extensionOf = (path: string) =>
  Option.fromNullishOr(
    /\.([a-z0-9]+)$/i.exec(path.split(/[?#]/, 1)[0] ?? "")?.[1]
  ).pipe(Option.map((extension) => extension.toLowerCase()));

/**
 * The picked image's media type: the one the picker reported, else the one
 * its name's (or URI's) extension implies. Only the checks use it: on native,
 * `expo/fetch` sends the part with the type of the file's own extension.
 */
export const avatarMediaTypeOf = (picked: PickedImage): Option.Option<string> =>
  Option.fromNullishOr(picked.mimeType?.toLowerCase()).pipe(
    Option.orElse(() =>
      extensionOf(picked.name).pipe(
        Option.orElse(() => extensionOf(picked.uri)),
        Option.flatMap((extension) =>
          Option.fromNullishOr(mediaTypeOfExtension[extension])
        )
      )
    )
  );

/**
 * Checks a picked image against the upload contract before anything is sent:
 * a JPEG, PNG or WebP of at most `customerAvatarMaxUploadBytes`. An image
 * whose size the picker didn't report goes up, and the Workspace decides.
 */
export const acceptAvatarFile = (
  picked: PickedImage
): Effect.Effect<AvatarFile, CustomerAvatarRejected> =>
  Effect.succeed(avatarMediaTypeOf(picked)).pipe(
    Effect.map(Option.filter(isAvatarMediaType)),
    Effect.flatMap(
      Option.match({
        onNone: () =>
          Effect.fail(
            new CustomerAvatarRejected({ reason: "unsupported-format" })
          ),
        onSome: (mediaType) =>
          Effect.succeed({ uri: picked.uri, name: picked.name, mediaType }),
      })
    ),
    Effect.filterOrFail(
      () =>
        picked.size === undefined ||
        picked.size <= customerAvatarMaxUploadBytes,
      () => new CustomerAvatarRejected({ reason: "file-too-large" })
    )
  );
