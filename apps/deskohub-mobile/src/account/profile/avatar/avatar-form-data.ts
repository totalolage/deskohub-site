import { customerAvatarFileField } from "@deskohub/workspace-customer-api";
import { Effect } from "effect";
import { type AvatarFile, AvatarFileUnreadable } from "./avatar-file";

/**
 * The upload body: one `file` part with the picked image's bytes. On the web
 * the picker hands back a blob or data URI, read here into a `File`.
 */
export const avatarFormData = (
  file: AvatarFile
): Effect.Effect<FormData, AvatarFileUnreadable> =>
  Effect.tryPromise({
    try: () => fetch(file.uri).then((response) => response.arrayBuffer()),
    catch: (cause) => new AvatarFileUnreadable({ cause }),
  }).pipe(
    Effect.map((bytes) => {
      const body = new FormData();
      body.append(
        customerAvatarFileField,
        new File([bytes], file.name, { type: file.mediaType })
      );
      return body;
    })
  );
