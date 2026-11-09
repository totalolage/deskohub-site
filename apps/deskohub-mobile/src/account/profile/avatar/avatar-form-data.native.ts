import { customerAvatarFileField } from "@deskohub/workspace-customer-api";
import { Effect } from "effect";
import { File } from "expo-file-system";
import { type AvatarFile, AvatarFileUnreadable } from "./avatar-file";

/**
 * The upload body: one `file` part holding the picked image as an
 * expo-file-system `File`. Expo replaces the global `fetch` with
 * `expo/fetch`, whose multipart encoder reads a part's bytes through the
 * `File` and refuses React Native's `{ uri, name, type }` part. It takes the
 * part's file name and content type from the file itself (the type from its
 * extension), not from the picker.
 *
 * The file is checked here, before the write is sent: once the request is on
 * its way, a file that can't be read would leave the upload unconfirmed.
 */
export const avatarFormData = (
  file: AvatarFile
): Effect.Effect<FormData, AvatarFileUnreadable> =>
  Effect.try({
    try: () => new File(file.uri),
    catch: (cause) => new AvatarFileUnreadable({ cause }),
  }).pipe(
    Effect.filterOrFail(
      (picked) => picked.exists,
      () => new AvatarFileUnreadable({})
    ),
    Effect.map((picked) => {
      const body = new FormData();
      // `File` implements Blob at runtime; the app's merged global Blob type
      // declares members it lacks, so only the type needs widening.
      body.append(
        customerAvatarFileField,
        picked as unknown as Blob,
        file.name
      );
      return body;
    })
  );
