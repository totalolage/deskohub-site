import { Match } from "effect";
import { sharedViewErrorMessage } from "../../../customer-api/customer-view-error-message";
import type { AppLocale } from "../../../i18n/app-locale";
import { m } from "../../../i18n/messages";
import type { NoticeTone } from "../../../ui/notice-presentation";
import type { AvatarFeedback } from "./avatar-action";

/** The live message for the latest avatar action, or none. */
export const avatarFeedbackNotice = (
  feedback: AvatarFeedback,
  locale: AppLocale
): { readonly tone: NoticeTone; readonly message: string | undefined } =>
  Match.value(feedback).pipe(
    Match.tagsExhaustive({
      Idle: () => ({ tone: "info" as const, message: undefined }),
      Picking: () => ({ tone: "info" as const, message: undefined }),
      Withheld: () => ({ tone: "info" as const, message: undefined }),
      Uploading: () => ({
        tone: "info" as const,
        message: m.profile_avatar_uploading({}, { locale }),
      }),
      Removing: () => ({
        tone: "info" as const,
        message: m.profile_avatar_removing({}, { locale }),
      }),
      Updated: () => ({
        tone: "info" as const,
        message: m.profile_avatar_updated({}, { locale }),
      }),
      Removed: () => ({
        tone: "info" as const,
        message: m.profile_avatar_removed({}, { locale }),
      }),
      Rejected: ({ reason }) => ({
        tone: "error" as const,
        message: {
          "file-missing": m.profile_avatar_file_missing,
          "file-too-large": m.profile_avatar_file_too_large,
          "unsupported-format": m.profile_avatar_unsupported_format,
          "undecodable-image": m.profile_avatar_undecodable,
          "image-dimensions-too-large": m.profile_avatar_dimensions_too_large,
        }[reason]({}, { locale }),
      }),
      FileUnreadable: () => ({
        tone: "error" as const,
        message: m.profile_avatar_failed({}, { locale }),
      }),
      PickerFailed: () => ({
        tone: "error" as const,
        message: m.profile_avatar_picker_failed({}, { locale }),
      }),
      // A failure every screen words alike reads as there; only one the
      // avatar alone explains falls back to its own copy.
      Failed: ({ error }) => ({
        tone:
          error._tag === "Unconfirmed"
            ? ("warning" as const)
            : ("error" as const),
        message:
          sharedViewErrorMessage(error, locale) ??
          m.profile_avatar_failed({}, { locale }),
      }),
    })
  );
