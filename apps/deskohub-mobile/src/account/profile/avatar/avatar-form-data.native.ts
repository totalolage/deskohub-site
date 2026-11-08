import { customerAvatarFileField } from "@deskohub/workspace-customer-api";
import { Effect } from "effect";
import type { AvatarFile, AvatarFileUnreadable } from "./avatar-file";

/**
 * The upload body: one `file` part that React Native's networking streams
 * from the picked image's URI. Its FormData takes a `{ uri, name, type }`
 * part in place of a Blob, which the DOM types don't describe.
 */
export const avatarFormData = (
  file: AvatarFile
): Effect.Effect<FormData, AvatarFileUnreadable> =>
  Effect.sync(() => {
    const body = new FormData();
    body.append(customerAvatarFileField, {
      uri: file.uri,
      name: file.name,
      type: file.mediaType,
    } as unknown as Blob);
    return body;
  });
